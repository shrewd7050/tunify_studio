import numpy as np
import torch
import soundfile as sf
from pathlib import Path
import gc
import logging

logger = logging.getLogger("tunify")


_model_cache = {"model": None, "device": None, "dtype": None}


def _get_device():
    if torch.cuda.is_available():
        return torch.device("cuda")
    return torch.device("cpu")


def _get_dtype(device):
    if device.type == "cuda":
        return torch.float16
    return torch.float32


def _enable_xformers(model):
    try:
        from audiocraft.modules.transformer import set_efficient_attention_backend
        set_efficient_attention_backend('xformers')
        logger.info("[MusicGen] xformers memory-efficient attention enabled")
    except Exception as e:
        logger.info(f"[MusicGen] xformers not available, using default SDPA: {e}")


def _load_model(model_name: str = "facebook/musicgen-small"):
    """Load MusicGen model (cached after first load)."""
    if _model_cache["model"] is not None:
        return _model_cache["model"], _model_cache["device"], _model_cache["dtype"]

    from audiocraft.models import MusicGen

    device = _get_device()
    dtype = _get_dtype(device)
    logger.info(f"[MusicGen] Loading model '{model_name}' on {device} ({dtype})...")

    model = MusicGen.get_pretrained(model_name)
    if hasattr(model, "to"):
        model.to(device=device, dtype=dtype)
    else:
        model.compression_model = model.compression_model.to(device=device, dtype=dtype)
        model.lm = model.lm.to(device=device, dtype=dtype)
    model.set_generation_params(duration=30)
    _enable_xformers(model)

    if hasattr(torch, "compile"):
        try:
            model.lm = torch.compile(model.lm, mode="reduce-overhead")
            model.compression_model = torch.compile(model.compression_model, mode="reduce-overhead")
            logger.info("[MusicGen] torch.compile applied to LM and compression model")
        except Exception as e:
            logger.info(f"[MusicGen] torch.compile not available: {e}")

    _model_cache["model"] = model
    _model_cache["device"] = device
    _model_cache["dtype"] = dtype

    logger.info(f"[MusicGen] Model loaded on {device} ({dtype})")
    return model, device, dtype


def _generate_chunk(model, device, dtype, prompt, duration, temperature, top_k, top_p, context_audio=None):
    """Generate a single chunk, optionally using context audio for continuation."""
    duration = max(1.0, float(duration))
    model.set_generation_params(
        duration=duration,
        temperature=temperature,
        top_k=top_k,
        top_p=top_p if top_p > 0 else 0.0,
    )

    with torch.inference_mode():
        if context_audio is not None:
            melody_tensor = torch.from_numpy(context_audio).float()
            if melody_tensor.ndim == 1:
                melody_tensor = melody_tensor.unsqueeze(0)
            melody_tensor = melody_tensor.to(device=device, dtype=dtype)
            try:
                if device.type == "cuda":
                    with torch.autocast(device_type="cuda", dtype=dtype):
                        wav = model.generate_with_chroma([prompt], melody_tensor, model.sample_rate)
                else:
                    wav = model.generate_with_chroma([prompt], melody_tensor, model.sample_rate)
            except Exception:
                if device.type == "cuda":
                    with torch.autocast(device_type="cuda", dtype=dtype):
                        wav = model.generate([prompt])
                else:
                    wav = model.generate([prompt])
        else:
            if device.type == "cuda":
                with torch.autocast(device_type="cuda", dtype=dtype):
                    wav = model.generate([prompt])
            else:
                wav = model.generate([prompt])

    wav = wav.squeeze()
    audio_np = wav.cpu().float().numpy()
    if audio_np.ndim > 1:
        audio_np = audio_np.mean(axis=0)
    peak = np.max(np.abs(audio_np))
    return audio_np / (peak + 1e-8)


def generate_music(
    prompt: str,
    output_path: str,
    duration: float = 30.0,
    temperature: float = 1.0,
    top_k: int = 250,
    top_p: float = 0.0,
    model_name: str = "facebook/musicgen-small",
) -> dict:
    """
    Generate music from a text prompt using MusicGen.
    Supports durations beyond 30s via chunked generation with crossfade.

    Args:
        prompt: Text description of the music to generate
        output_path: Path to save the generated audio
        duration: Duration in seconds
        temperature: Higher = more creative, lower = more conservative
        top_k: Top-k sampling
        top_p: Top-p (nucleus) sampling
        model_name: Model to use ('small', 'medium', 'large')
    """
    model, device, dtype = _load_model(model_name)
    sr = model.sample_rate
    crossfade_sec = 2.0

    if duration <= 30.0:
        logger.info(f"[MusicGen] Generating: '{prompt}' ({duration}s)")
        audio_np = _generate_chunk(model, device, dtype, prompt, duration, temperature, top_k, top_p)
    else:
        logger.info(f"[MusicGen] Generating: '{prompt}' ({duration}s) via chunked generation")
        chunks = []
        remaining = duration
        context_audio = None

        while remaining > 0:
            chunk_dur = min(30.0, remaining)
            chunk_np = _generate_chunk(model, device, dtype, prompt, chunk_dur, temperature, top_k, top_p, context_audio)
            chunks.append(chunk_np)
            crossfade_samples = int(sr * crossfade_sec)
            context_audio = chunk_np[-crossfade_samples:]
            remaining -= chunk_dur
            logger.info(f"[MusicGen] Chunk done, {remaining:.1f}s remaining")

        audio_np = chunks[0]
        for i in range(1, len(chunks)):
            cf = int(sr * crossfade_sec)
            if len(audio_np) >= cf and len(chunks[i]) >= cf:
                fade_out = np.linspace(1, 0, cf)
                fade_in = np.linspace(0, 1, cf)
                audio_np[-cf:] = audio_np[-cf:] * fade_out + chunks[i][:cf] * fade_in
                audio_np = np.concatenate([audio_np, chunks[i][cf:]])
            else:
                audio_np = np.concatenate([audio_np, chunks[i]])

    audio_int16 = (audio_np / (np.max(np.abs(audio_np)) + 1e-8) * 32767).astype(np.int16)
    sf.write(output_path, audio_int16, sr)

    if device.type == "cuda":
        torch.cuda.synchronize()
        torch.cuda.empty_cache()
    gc.collect()

    actual_duration = len(audio_int16) / sr
    logger.info(f"[MusicGen] Saved to {output_path} ({actual_duration:.1f}s)")

    return {
        "success": True,
        "prompt": prompt,
        "duration": actual_duration,
        "sample_rate": sr,
        "output_path": output_path,
    }


def generate_music_from_audio(
    input_audio_path: str,
    output_path: str,
    prompt: str = None,
    duration: float = 30.0,
    melody_strength: float = 0.5,
    model_name: str = "facebook/musicgen-small",
) -> dict:
    """
    Generate music continuation / accompaniment from an input audio file.
    Uses the input audio as melody reference.
    """
    model, device, dtype = _load_model(model_name)

    import librosa
    y, sr = librosa.load(input_audio_path, sr=model.sample_rate, mono=True)

    duration = min(duration, 30.0)
    model.set_generation_params(duration=duration)

    if prompt is None:
        prompt = "musical accompaniment, backing track, instrumental"

    logger.info(f"[MusicGen] Generating accompaniment for audio: '{prompt}'")

    melody_tensor = torch.from_numpy(y).unsqueeze(0).to(device=device, dtype=dtype)

    with torch.inference_mode():
        if device.type == "cuda":
            with torch.autocast(device_type="cuda", dtype=dtype):
                wav = model.generate_with_chroma(
                    [prompt], melody_tensor, model.sample_rate,
                )
        else:
            wav = model.generate_with_chroma(
                [prompt], melody_tensor, model.sample_rate,
            )

    audio_np = wav[0].cpu().float().numpy()
    if audio_np.ndim > 1:
        audio_np = audio_np.mean(axis=0)

    audio_np = audio_np / (np.max(np.abs(audio_np)) + 1e-8)
    audio_np = (audio_np * 32767).astype(np.int16)

    sf.write(output_path, audio_np, model.sample_rate)

    if device.type == "cuda":
        torch.cuda.synchronize()
        torch.cuda.empty_cache()
    gc.collect()

    return {
        "success": True,
        "prompt": prompt,
        "duration": duration,
        "sample_rate": model.sample_rate,
        "output_path": output_path,
    }

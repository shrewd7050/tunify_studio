import numpy as np
import torch
import soundfile as sf
from pathlib import Path


_model_cache = {"model": None, "device": None}


def _get_device():
    if torch.cuda.is_available():
        return torch.device("cuda")
    return torch.device("cpu")


def _load_model(model_name: str = "facebook/musicgen-small"):
    """Load MusicGen model (cached after first load)."""
    if _model_cache["model"] is not None:
        return _model_cache["model"], _model_cache["device"]

    from audiocraft.models import MusicGen

    device = _get_device()
    print(f"[MusicGen] Loading model on {device}...")

    model = MusicGen.get_pretrained(model_name)
    model.to(device)
    model.set_generation_params(duration=30)

    _model_cache["model"] = model
    _model_cache["device"] = device

    print(f"[MusicGen] Model loaded successfully on {device}")
    return model, device


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

    Args:
        prompt: Text description of the music to generate
        output_path: Path to save the generated audio
        duration: Duration in seconds (max 30 for small model)
        temperature: Higher = more creative, lower = more conservative
        top_k: Top-k sampling
        top_p: Top-p (nucleus) sampling
        model_name: Model to use ('small', 'medium', 'large')
    """
    model, device = _load_model(model_name)

    duration = min(duration, 30.0)
    model.set_generation_params(
        duration=duration,
        temperature=temperature,
        top_k=top_k,
        top_p=top_p if top_p > 0 else None,
    )

    print(f"[MusicGen] Generating: '{prompt}' ({duration}s)")

    wav = model.generate([prompt])

    audio_np = wav[0].cpu().numpy()
    if audio_np.ndim > 1:
        audio_np = audio_np.mean(axis=0)

    audio_np = audio_np / (np.max(np.abs(audio_np)) + 1e-8)
    audio_np = (audio_np * 32767).astype(np.int16)

    sf.write(output_path, audio_np, model.sample_rate)

    print(f"[MusicGen] Saved to {output_path}")

    return {
        "success": True,
        "prompt": prompt,
        "duration": duration,
        "sample_rate": model.sample_rate,
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
    model, device = _load_model(model_name)

    import librosa
    y, sr = librosa.load(input_audio_path, sr=model.sample_rate, mono=True)

    duration = min(duration, 30.0)
    model.set_generation_params(duration=duration)

    if prompt is None:
        prompt = "musical accompaniment, backing track, instrumental"

    print(f"[MusicGen] Generating accompaniment for audio: '{prompt}'")

    wav = model.generate_with_chroma(
        [prompt],
        torch.from_numpy(y).unsqueeze(0).to(device),
        torch.from_numpy(y).unsqueeze(0).to(device),
    )

    audio_np = wav[0].cpu().numpy()
    if audio_np.ndim > 1:
        audio_np = audio_np.mean(axis=0)

    audio_np = audio_np / (np.max(np.abs(audio_np)) + 1e-8)
    audio_np = (audio_np * 32767).astype(np.int16)

    sf.write(output_path, audio_np, model.sample_rate)

    return {
        "success": True,
        "prompt": prompt,
        "duration": duration,
        "sample_rate": model.sample_rate,
        "output_path": output_path,
    }

"""
RVC-based voice conversion for Tunify Voice Swap.

Uses HuBERT for content encoding + VITS for synthesis.
Converts user voice timbre while preserving melody and rhythm.
Falls back to improved librosa pitch shifting when RVC is unavailable.
"""

import os
import gc
import logging
import numpy as np
import soundfile as sf

logger = logging.getLogger("tunify")

_rvc_cache = {"inference": None, "model_path": None}


def _get_rvc_inference(model_path=None, device=None):
    if _rvc_cache["inference"] is not None and _rvc_cache["model_path"] == model_path:
        return _rvc_cache["inference"]

    try:
        from rvc_python.infer import RVCInference
    except ImportError:
        raise RuntimeError("rvc-python not installed. Install with: pip install rvc-python")

    if device is None:
        import torch
        device = "cuda:0" if torch.cuda.is_available() else "cpu:0"

    logger.info(f"[VoiceConvert] Initializing RVC on {device}")
    rvc = RVCInference(device=device)

    if model_path and os.path.exists(model_path):
        logger.info(f"[VoiceConvert] Loading voice model: {model_path}")
        rvc.load_model(model_path)
        _rvc_cache["model_path"] = model_path
    else:
        logger.warning("[VoiceConvert] No voice model specified, using default")
        _rvc_cache["model_path"] = None

    _rvc_cache["inference"] = rvc
    return rvc


def convert_voice(
    input_path: str,
    output_path: str,
    model_path: str = None,
    pitch_shift: int = 0,
    f0_method: str = "rmvpe",
    index_rate: float = 0.5,
    filter_radius: int = 3,
    rms_mix_rate: float = 0.25,
    protect: float = 0.33,
    resample_sr: int = 0,
    device: str = None,
) -> dict:
    try:
        rvc = _get_rvc_inference(model_path=model_path, device=device)
    except RuntimeError as e:
        logger.warning(f"[VoiceConvert] RVC unavailable: {e}")
        return _fallback_pitch_convert(input_path, output_path, pitch_shift)

    rvc.set_params(
        f0method=f0_method,
        f0up_key=pitch_shift,
        index_rate=index_rate,
        filter_radius=filter_radius,
        resample_sr=resample_sr,
        rms_mix_rate=rms_mix_rate,
        protect=protect,
    )

    logger.info(
        f"[VoiceConvert] Converting: {input_path} -> {output_path} "
        f"(pitch={pitch_shift}, f0={f0_method}, index_rate={index_rate})"
    )

    try:
        rvc.infer_file(input_path, output_path)
        y, sr = sf.read(output_path)
        duration = len(y) / sr
        logger.info(f"[VoiceConvert] Done: {duration:.1f}s")
        return {
            "success": True,
            "duration": duration,
            "sample_rate": sr,
            "output_path": output_path,
            "method": "rvc",
        }
    except Exception as e:
        logger.error(f"[VoiceConvert] RVC inference failed: {e}")
        return _fallback_pitch_convert(input_path, output_path, pitch_shift)


def _fallback_pitch_convert(input_path, output_path, pitch_shift_semitones=0.0):
    import librosa

    logger.info(f"[VoiceConvert] Fallback: librosa pitch shift by {pitch_shift_semitones} semitones")
    y, sr = librosa.load(input_path, sr=44100, mono=True)

    if abs(pitch_shift_semitones) > 0.01:
        y = librosa.effects.pitch_shift(
            y.astype(np.float32), sr=sr, n_steps=float(pitch_shift_semitones)
        )

    sf.write(output_path, y, sr)
    duration = len(y) / sr

    return {
        "success": True,
        "duration": duration,
        "sample_rate": sr,
        "output_path": output_path,
        "method": "librosa_fallback",
    }


def unload_rvc():
    global _rvc_cache
    if _rvc_cache["inference"] is not None:
        try:
            del _rvc_cache["inference"]
        except Exception:
            pass
        _rvc_cache["inference"] = None
        _rvc_cache["model_path"] = None
        gc.collect()
        try:
            import torch
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except ImportError:
            pass
        logger.info("[VoiceConvert] RVC model unloaded")

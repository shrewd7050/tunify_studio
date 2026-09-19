"""Wrapper to run demucs with soundfile backend instead of torchcodec.

torchaudio 2.11+ requires torchcodec which needs ffmpeg shared DLLs.
This wrapper patches torchaudio.load and torchaudio.save to use soundfile.
"""
import sys
import numpy as np
import soundfile as sf
import torch
import torchaudio


def _patched_load(uri, *args, **kwargs):
    """Load audio using soundfile instead of torchcodec."""
    data, sr = sf.read(uri, dtype="float32", always_2d=True)
    waveform = torch.from_numpy(data.T)
    return waveform, sr


def _patched_save(uri, tensor, sample_rate, *args, **kwargs):
    """Save audio using soundfile instead of torchcodec."""
    if isinstance(tensor, torch.Tensor):
        data = tensor.detach().cpu().numpy()
    else:
        data = np.array(tensor)
    if data.ndim == 1:
        sf.write(uri, data, sample_rate)
    elif data.ndim == 2:
        sf.write(uri, data.T, sample_rate)
    else:
        sf.write(uri, data, sample_rate)


torchaudio.load = _patched_load
torchaudio.save = _patched_save

from demucs.__main__ import main

if __name__ == "__main__":
    main()

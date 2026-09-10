import numpy as np
import librosa
import soundfile as sf
import scipy.signal
from pathlib import Path


NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

KEY_OFFSETS = {
    'C': 0, 'C#': 1, 'D': 2, 'D#': 3, 'E': 4, 'F': 5,
    'F#': 6, 'G': 7, 'G#': 8, 'A': 9, 'A#': 10, 'B': 11,
}

SCALE_INTERVALS = {
    'major': [0, 2, 4, 5, 7, 9, 11],
    'minor': [0, 2, 3, 5, 7, 8, 10],
    'pentatonic_major': [0, 2, 4, 7, 9],
    'pentatonic_minor': [0, 3, 5, 7, 10],
    'blues': [0, 3, 5, 6, 7, 10],
}


def get_scale_pitches(key: str, scale: str, octave_low: int = 3, octave_high: int = 6) -> list:
    """Get all valid pitch frequencies for a key/scale combination."""
    key_offset = KEY_OFFSETS.get(key.upper(), 0)
    intervals = SCALE_INTERVALS.get(scale, SCALE_INTERVALS['major'])

    pitches = []
    for octave in range(octave_low, octave_high + 1):
        for interval in intervals:
            midi_note = (octave + 1) * 12 + key_offset + interval
            freq = 440.0 * (2 ** ((midi_note - 69) / 12.0))
            pitches.append(freq)

    return sorted(pitches)


def snap_to_nearest(freq, target_pitches):
    """Snap a frequency to the nearest valid pitch in the scale."""
    if freq <= 0:
        return freq
    distances = [abs(freq - tp) for tp in target_pitches]
    return target_pitches[int(np.argmin(distances))]


def _snap_to_nearest_batch(freqs, target_pitches_arr):
    """Vectorized snap: snap array of frequencies to nearest target pitches."""
    result = np.copy(freqs)
    valid = (~np.isnan(freqs)) & (freqs > 0)
    if not np.any(valid):
        return result
    f = freqs[valid]
    distances = np.abs(f[:, np.newaxis] - target_pitches_arr[np.newaxis, :])
    nearest = target_pitches_arr[np.argmin(distances, axis=1)]
    result[valid] = nearest
    return result


def auto_tune(
    input_path: str,
    output_path: str,
    key: str = None,
    scale: str = 'major',
    correction_strength: float = 0.8,
    pitch_shift_semitones: float = 0.0,
) -> dict:
    """
    Auto-tune an audio file using librosa pitch detection and correction.

    Args:
        input_path: Path to input audio
        output_path: Path to save auto-tuned audio
        key: Musical key (e.g., 'C', 'A', 'F#'). Auto-detected if None.
        scale: Scale type ('major', 'minor', 'pentatonic_major', etc.)
        correction_strength: 0.0 = no correction, 1.0 = hard pitch snap
        pitch_shift_semitones: Transpose up/down in semitones
    """
    y, sr = librosa.load(input_path, sr=44100, mono=True)

    key_info = None
    if key is None:
        from src.ml.pitch_detection import detect_key_and_scale
        key_info = detect_key_and_scale(input_path)
        key = key_info['key']
        scale = key_info['scale']

    target_pitches = get_scale_pitches(key, scale)
    target_pitches_arr = np.array(target_pitches)

    n_fft = 2048
    hop_length = 512

    f0, voiced_flag, voiced_probs = librosa.pyin(
        y, fmin=librosa.note_to_hz('C2'), fmax=librosa.note_to_hz('C7'), sr=sr,
        hop_length=hop_length
    )
    times = librosa.times_like(f0, sr=sr, hop_length=hop_length)

    shifted_f0 = np.where(
        (~np.isnan(f0)) & (f0 > 0),
        f0 * (2 ** (pitch_shift_semitones / 12.0)),
        f0,
    )
    snapped = _snap_to_nearest_batch(shifted_f0, target_pitches_arr)
    valid_mask = (~np.isnan(f0)) & (f0 > 0) & (~np.isnan(snapped))
    corrected_pitches = np.copy(f0)
    corrected_pitches[valid_mask] = f0[valid_mask] + (snapped[valid_mask] - f0[valid_mask]) * correction_strength

    valid_mask = (~np.isnan(f0)) & (f0 > 0) & (~np.isnan(corrected_pitches)) & (corrected_pitches > 0)
    ratios = np.where(valid_mask, corrected_pitches / np.maximum(f0, 1e-8), 1.0)

    D = librosa.stft(y, n_fft=n_fft, hop_length=hop_length)
    freqs = librosa.fft_frequencies(sr=sr, n_fft=n_fft)
    mag = np.abs(D)
    phase = np.angle(D)
    n_frames = D.shape[1]

    if len(ratios) != n_frames:
        ratios = np.interp(
            np.linspace(0, 1, n_frames),
            np.linspace(0, 1, len(ratios)),
            ratios,
        )

    output_D = np.empty_like(D)
    for i in range(n_frames):
        r = ratios[i]
        if abs(r - 1.0) < 0.001:
            output_D[:, i] = D[:, i]
        else:
            new_mag = np.interp(freqs, freqs * r, mag[:, i], left=0.0, right=0.0)
            output_D[:, i] = new_mag * np.exp(1j * phase[:, i])

    output_y = librosa.istft(output_D, hop_length=hop_length, length=len(y))

    sf.write(output_path, output_y, sr)

    return {
        "success": True,
        "key": key,
        "scale": scale,
        "tempo": key_info["tempo"] if key_info is not None else None,
        "correction_strength": correction_strength,
        "pitch_shift": pitch_shift_semitones,
        "duration": float(len(y) / sr),
        "output_path": output_path,
    }

import numpy as np
import librosa
import soundfile as sf
import parselmouth
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
    key_offset = KEY_OFFSETS.get(key.upper().rstrip('#') if key.upper() not in KEY_OFFSETS else key.upper(), 0)
    if key.upper() in KEY_OFFSETS:
        key_offset = KEY_OFFSETS[key.upper()]
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


def auto_tune(
    input_path: str,
    output_path: str,
    key: str = None,
    scale: str = 'major',
    correction_strength: float = 0.8,
    pitch_shift_semitones: float = 0.0,
) -> dict:
    """
    Auto-tune an audio file using parselmouth pitch manipulation.

    Args:
        input_path: Path to input audio
        output_path: Path to save auto-tuned audio
        key: Musical key (e.g., 'C', 'A', 'F#'). Auto-detected if None.
        scale: Scale type ('major', 'minor', 'pentatonic_major', etc.)
        correction_strength: 0.0 = no correction, 1.0 = hard pitch snap
        pitch_shift_semitones: Transpose up/down in semitones
    """
    y, sr = librosa.load(input_path, sr=44100, mono=True)

    if key is None:
        from src.ml.pitch_detection import detect_key_and_scale
        key_info = detect_key_and_scale(input_path)
        key = key_info['key']
        scale = key_info['scale']

    target_pitches = get_scale_pitches(key, scale)

    snd = parselmouth.Sound(y, sampling_frequency=sr)
    pitch_obj = snd.to_pitch(time_step=0.01, pitch_floor=60, pitch_cease=600)

    time_steps = pitch_obj.xs()
    pitch_values = pitch_obj.selected_array['frequency']

    corrected_pitches = np.copy(pitch_values)
    for i, f0 in enumerate(pitch_values):
        if f0 > 0:
            shifted_f0 = f0 * (2 ** (pitch_shift_semitones / 12.0))
            snapped = snap_to_nearest(shifted_f0, target_pitches)
            corrected_pitches[i] = f0 + (snapped - f0) * correction_strength

    pitch_tier = parselmouth.PitchTier(sampling_frequency=sr)
    for i, t in enumerate(time_steps):
        if corrected_pitches[i] > 0:
            pitch_tier.add(t, corrected_pitches[i])

    duration = len(y) / sr
    output_y = np.zeros_like(y)

    for i in range(len(time_steps) - 1):
        t_start = time_steps[i]
        t_end = time_steps[i + 1]
        if t_start >= duration:
            break

        idx_start = max(0, int(t_start * sr))
        idx_end = min(len(y), int(t_end * sr))

        if idx_end <= idx_start:
            continue

        segment = y[idx_start:idx_end]

        if corrected_pitches[i] > 0 and pitch_values[i] > 0:
            ratio = corrected_pitches[i] / pitch_values[i]
            target_semitones = 12.0 * np.log2(ratio) + pitch_shift_semitones
            if abs(target_semitones) > 0.01:
                shifted = librosa.effects.pitch_shift(
                    segment.astype(np.float32), sr=sr, n_steps=float(target_semitones)
                )
                output_y[idx_start:idx_end] = shifted
            else:
                output_y[idx_start:idx_end] = segment
        else:
            output_y[idx_start:idx_end] = segment

    sf.write(output_path, output_y, sr)

    return {
        "success": True,
        "key": key,
        "scale": scale,
        "correction_strength": correction_strength,
        "pitch_shift": pitch_shift_semitones,
        "duration": float(len(y) / sr),
        "output_path": output_path,
    }

"""
Vocal matching and alignment module for Tunify Voice Swap.

Pipeline:
  1. Extract melody (note events) from vocal audio using pyin
  2. Compute chroma features for key-invariant matching
  3. Match user vocal phrase to original via sliding-window chroma + contour correlation
  4. Extract the matching backing section
  5. Time-stretch user vocal to match section duration
  6. Pitch-correct user vocal toward original melody notes
"""

import numpy as np
import librosa
import soundfile as sf
import logging

logger = logging.getLogger("tunify")


# ---------------------------------------------------------------------------
# Melody extraction
# ---------------------------------------------------------------------------

def extract_melody(audio_path, sr=22050, min_note_duration=0.05):
    """
    Extract melody as note events from vocal audio.

    Uses librosa pyin for f0 detection, then groups consecutive voiced frames
    with similar pitch into discrete note events.

    Returns:
        [{"start": float, "end": float, "midi": float, "confidence": float}, ...]
    """
    y, sr = librosa.load(audio_path, sr=sr, mono=True)

    f0, voiced_flag, voiced_probs = librosa.pyin(
        y,
        fmin=librosa.note_to_hz("C2"),
        fmax=librosa.note_to_hz("C7"),
        sr=sr,
    )

    times = librosa.times_like(f0, sr=sr)

    notes = []
    current = None

    for i in range(len(f0)):
        is_voiced = (not np.isnan(f0[i])) and f0[i] > 0 and (voiced_probs[i] >= 0.3)

        if not is_voiced:
            if current is not None:
                notes.append(current)
                current = None
            continue

        midi = float(librosa.hz_to_midi(f0[i]))

        if current is None:
            current = {
                "start": float(times[i]),
                "end": float(times[i]),
                "midi": midi,
                "confidence": float(voiced_probs[i]),
                "_n": 1,
            }
        else:
            if abs(midi - current["midi"]) < 1.0:
                current["end"] = float(times[i])
                n = current["_n"]
                current["midi"] = (current["midi"] * n + midi) / (n + 1)
                current["confidence"] = (current["confidence"] * n + voiced_probs[i]) / (n + 1)
                current["_n"] = n + 1
            else:
                notes.append(current)
                current = {
                    "start": float(times[i]),
                    "end": float(times[i]),
                    "midi": midi,
                    "confidence": float(voiced_probs[i]),
                    "_n": 1,
                }

    if current is not None:
        notes.append(current)

    notes = [n for n in notes if (n["end"] - n["start"]) >= min_note_duration]
    for n in notes:
        del n["_n"]

    logger.info(f"[melody] extracted {len(notes)} notes from {audio_path}")
    return notes


# ---------------------------------------------------------------------------
# Chroma features
# ---------------------------------------------------------------------------

def compute_chroma_contour(audio_path, sr=22050, hop_length=512):
    """
    Compute chroma-CQT features (12-dimensional, key-invariant).

    Returns:
        (chroma: np.ndarray(12, n_frames), times: np.ndarray(n_frames))
    """
    y, sr = librosa.load(audio_path, sr=sr, mono=True)
    chroma = librosa.feature.chroma_cqt(y=y, sr=sr, hop_length=hop_length)
    times = librosa.times_like(chroma, sr=sr, hop_length=hop_length)
    return chroma, times


# ---------------------------------------------------------------------------
# Phrase matching
# ---------------------------------------------------------------------------

def match_vocal_phrase(original_vocal_path, user_vocal_path, sr=22050):
    """
    Find which time-range in the original vocal matches the user's recording.

    Uses two complementary methods:
      A) Chroma-based sliding-window cosine similarity  (key-invariant)
      B) Pitch-contour interval correlation             (melody-shape)

    Returns dict with keys:
        success, original_start, original_end, confidence,
        user_duration, original_duration,
        chroma_score, contour_score
    """
    logger.info("[match] starting vocal phrase matching")

    orig_y, _ = librosa.load(original_vocal_path, sr=sr, mono=True)
    user_y, _ = librosa.load(user_vocal_path, sr=sr, mono=True)

    orig_duration = len(orig_y) / sr
    user_duration = len(user_y) / sr
    logger.info(f"[match] original vocal: {orig_duration:.1f}s  user vocal: {user_duration:.1f}s")

    if user_duration < 1.0 or orig_duration < 2.0:
        logger.warning("[match] audio too short for reliable matching")
        return _fail_result(user_duration, orig_duration)

    # ---- Method A: chroma sliding window ----
    orig_chroma, orig_times = compute_chroma_contour(original_vocal_path, sr=sr)
    user_chroma, _ = compute_chroma_contour(user_vocal_path, sr=sr)

    user_profile = np.mean(user_chroma, axis=1)
    norm = np.linalg.norm(user_profile)
    if norm > 0:
        user_profile = user_profile / norm

    window_frames = user_chroma.shape[1]
    n_orig = orig_chroma.shape[1]

    best_chroma_score = -1.0
    best_chroma_frame = 0

    if window_frames < n_orig:
        for i in range(n_orig - window_frames + 1):
            w = orig_chroma[:, i : i + window_frames]
            wp = np.mean(w, axis=1)
            wn = np.linalg.norm(wp)
            if wn > 0:
                wp = wp / wn
            score = float(np.dot(user_profile, wp))
            if score > best_chroma_score:
                best_chroma_score = score
                best_chroma_frame = i

    chroma_start = float(orig_times[best_chroma_frame])
    logger.info(f"[match] chroma: start={chroma_start:.1f}s  score={best_chroma_score:.3f}")

    # ---- Method B: pitch-contour interval correlation ----
    orig_melody = extract_melody(original_vocal_path, sr=sr)
    user_melody = extract_melody(user_vocal_path, sr=sr)

    contour_score = 0.0
    contour_start = chroma_start

    if len(orig_melody) >= 3 and len(user_melody) >= 3:
        orig_midi = np.array([n["midi"] for n in orig_melody])
        user_midi = np.array([n["midi"] for n in user_melody])

        orig_int = np.diff(orig_midi)
        user_int = np.diff(user_midi) - np.mean(np.diff(user_midi))

        best_c = -1.0
        best_i = 0
        user_len = len(user_int)

        if user_len < len(orig_int):
            for i in range(len(orig_int) - user_len + 1):
                w = orig_int[i : i + user_len]
                w = w - np.mean(w)
                std_w = np.std(w)
                std_u = np.std(user_int)
                if std_w > 1e-8 and std_u > 1e-8:
                    c = float(np.corrcoef(w, user_int)[0, 1])
                    if c > best_c:
                        best_c = c
                        best_i = i

            contour_score = max(0.0, best_c)
            if best_i < len(orig_melody) - 1:
                contour_start = orig_melody[best_i]["start"]

    logger.info(f"[match] contour: start={contour_start:.1f}s  score={contour_score:.3f}")

    # ---- Combine ----
    combined = best_chroma_score * 0.6 + contour_score * 0.4
    final_start = chroma_start
    final_end = final_start + user_duration
    final_start = max(0.0, min(final_start, orig_duration - user_duration))
    final_end = min(orig_duration, final_start + user_duration)

    logger.info(
        f"[match] combined={combined:.3f}  section={final_start:.1f}s–{final_end:.1f}s"
    )

    return {
        "success": combined > 0.3,
        "original_start": round(final_start, 2),
        "original_end": round(final_end, 2),
        "confidence": round(min(1.0, max(0.0, combined)), 3),
        "user_duration": round(user_duration, 2),
        "original_duration": round(orig_duration, 2),
        "chroma_score": round(best_chroma_score, 3),
        "contour_score": round(contour_score, 3),
    }


def _fail_result(user_dur, orig_dur):
    return {
        "success": False,
        "original_start": 0.0,
        "original_end": user_dur,
        "confidence": 0.0,
        "user_duration": round(user_dur, 2),
        "original_duration": round(orig_dur, 2),
        "chroma_score": 0.0,
        "contour_score": 0.0,
    }


# ---------------------------------------------------------------------------
# Backing extraction
# ---------------------------------------------------------------------------

def extract_backing_section(backing_path, start_time, end_time, output_path, sr=44100, fade_ms=50):
    """
    Slice a time-range from the backing track with short fades.
    """
    y, sr = librosa.load(backing_path, sr=sr, mono=True)
    s = max(0, int(start_time * sr))
    e = min(len(y), int(end_time * sr))
    section = y[s:e].copy()

    fade_n = int(sr * fade_ms / 1000)
    if fade_n > 0 and fade_n < len(section):
        section[:fade_n] *= np.linspace(0, 1, fade_n)
        section[-fade_n:] *= np.linspace(1, 0, fade_n)

    sf.write(output_path, section, sr)
    dur = len(section) / sr
    logger.info(f"[backing] extracted {dur:.1f}s ({start_time:.1f}s–{end_time:.1f}s)")
    return {"success": True, "output_path": output_path, "duration": dur}


# ---------------------------------------------------------------------------
# Time-stretch
# ---------------------------------------------------------------------------

def time_stretch_vocal(audio_path, output_path, target_duration, sr=44100):
    """
    Time-stretch audio to *target_duration* without changing pitch.
    Skips if the required rate is extreme (<0.5 or >2.0).
    """
    y, sr = librosa.load(audio_path, sr=sr, mono=True)
    orig_dur = len(y) / sr

    if abs(orig_dur - target_duration) < 0.1 or target_duration <= 0:
        sf.write(output_path, y, sr)
        return {"success": True, "original_duration": orig_dur, "stretched_duration": orig_dur, "stretched": False}

    rate = orig_dur / target_duration
    if rate < 0.5 or rate > 2.0:
        logger.warning(f"[stretch] rate {rate:.2f} too extreme – copying without stretch")
        sf.write(output_path, y, sr)
        return {"success": True, "original_duration": orig_dur, "stretched_duration": orig_dur, "stretched": False}

    y_s = librosa.effects.time_stretch(y, rate=rate)
    sf.write(output_path, y_s, sr)
    s_dur = len(y_s) / sr
    logger.info(f"[stretch] {orig_dur:.1f}s → {s_dur:.1f}s (rate={rate:.3f})")
    return {"success": True, "original_duration": orig_dur, "stretched_duration": s_dur, "stretched": True}


# ---------------------------------------------------------------------------
# Melody-based pitch correction
# ---------------------------------------------------------------------------

def pitch_correct_to_melody(input_path, output_path, target_melody, correction_strength=0.8, sr=44100):
    """
    Correct pitch of *input_path* toward the notes in *target_melody*.

    Unlike ``auto_tune`` (which snaps to a fixed scale), this corrects toward
    the specific MIDI notes from the matched original section.

    Parameters
    ----------
    target_melody : list[dict]
        Note events with at least ``"start"``, ``"end"``, ``"midi"`` keys.
        Times should already be shifted to start near 0.
    correction_strength : float
        0 = no correction, 1 = hard snap to target notes.

    Returns dict with success, notes_corrected, duration.
    """
    y, sr = librosa.load(input_path, sr=sr, mono=True)

    f0, voiced_flag, voiced_probs = librosa.pyin(
        y,
        fmin=librosa.note_to_hz("C2"),
        fmax=librosa.note_to_hz("C7"),
        sr=sr,
        hop_length=512,
    )
    times = librosa.times_like(f0, sr=sr, hop_length=512)

    if len(target_melody) == 0:
        sf.write(output_path, y, sr)
        logger.warning("[pitch-correct] empty target melody – copying input")
        return {"success": True, "notes_corrected": 0, "duration": len(y) / sr}

    t_start = np.array([n["start"] for n in target_melody])
    t_midi = np.array([n["midi"] for n in target_melody])

    target_curve = np.interp(times, t_start, t_midi)
    target_hz = 440.0 * (2 ** ((target_curve - 69) / 12.0))

    valid = (~np.isnan(f0)) & (f0 > 0)
    ratios = np.ones_like(f0)
    ratios[valid] = 1.0 + (target_hz[valid] / f0[valid] - 1.0) * correction_strength

    n_fft = 2048
    hop = 512
    D = librosa.stft(y, n_fft=n_fft, hop_length=hop)
    freqs = librosa.fft_frequencies(sr=sr, n_fft=n_fft)
    mag = np.abs(D)
    phase = np.angle(D)
    n_frames = D.shape[1]

    if len(ratios) != n_frames:
        ratios = np.interp(np.linspace(0, 1, n_frames), np.linspace(0, 1, len(ratios)), ratios)

    out_D = np.empty_like(D)
    for i in range(n_frames):
        r = ratios[i]
        if abs(r - 1.0) < 0.001:
            out_D[:, i] = D[:, i]
        else:
            new_mag = np.interp(freqs, freqs * r, mag[:, i], left=0.0, right=0.0)
            out_D[:, i] = new_mag * np.exp(1j * phase[:, i])

    out_y = librosa.istft(out_D, hop_length=hop, length=len(y))
    sf.write(output_path, out_y, sr)

    n_corrected = int(np.sum(valid))
    logger.info(f"[pitch-correct] corrected {n_corrected} frames toward target melody")
    return {"success": True, "notes_corrected": n_corrected, "duration": float(len(y) / sr)}

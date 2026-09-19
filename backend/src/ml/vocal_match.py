"""
Vocal matching and alignment module for Tunify Voice Swap.

Improved pipeline:
  1. Extract melody (note events) from vocal audio using pyin
  2. MFCC + chroma features for robust matching
  3. DTW-aligned phrase matching (handles tempo differences)
  4. Beat-aware backing extraction with crossfading
  5. Phase-vocoder time-stretching
  6. Frequency-dependent pitch correction (lows/mids/highs scaled differently)
"""

import numpy as np
import librosa
import soundfile as sf
import logging
from scipy.ndimage import median_filter

logger = logging.getLogger("tunify")


def extract_melody(audio_path, sr=22050, min_note_duration=0.05):
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


def compute_chroma_contour(audio_path, sr=22050, hop_length=512):
    y, sr = librosa.load(audio_path, sr=sr, mono=True)
    chroma = librosa.feature.chroma_cqt(y=y, sr=sr, hop_length=hop_length)
    times = librosa.times_like(chroma, sr=sr, hop_length=hop_length)
    return chroma, times


def compute_mfcc_features(audio_path, sr=22050, hop_length=512, n_mfcc=20):
    y, sr = librosa.load(audio_path, sr=sr, mono=True)
    mfcc = librosa.feature.mfcc(y=y, sr=sr, n_mfcc=n_mfcc, hop_length=hop_length)
    delta_mfcc = librosa.feature.delta(mfcc)
    combined = np.vstack([mfcc, delta_mfcc])
    times = librosa.times_like(mfcc, sr=sr, hop_length=hop_length)
    return combined, times


def match_vocal_phrase(original_vocal_path, user_vocal_path, sr=22050):
    logger.info("[match] starting vocal phrase matching (MFCC+DTW + chroma)")

    orig_y, _ = librosa.load(original_vocal_path, sr=sr, mono=True)
    user_y, _ = librosa.load(user_vocal_path, sr=sr, mono=True)

    orig_duration = len(orig_y) / sr
    user_duration = len(user_y) / sr
    logger.info(f"[match] original vocal: {orig_duration:.1f}s  user vocal: {user_duration:.1f}s")

    if user_duration < 1.0 or orig_duration < 2.0:
        logger.warning("[match] audio too short for reliable matching")
        return _fail_result(user_duration, orig_duration)

    # ---- Method A: MFCC + DTW alignment ----
    mfcc_score = 0.0
    mfcc_start = 0.0
    orig_mfcc = None

    try:
        orig_mfcc, orig_mfcc_times = compute_mfcc_features(original_vocal_path, sr=sr)
        user_mfcc, _ = compute_mfcc_features(user_vocal_path, sr=sr)

        hop = 512
        frame_dur = hop / sr
        user_frames = user_mfcc.shape[1]
        orig_frames = orig_mfcc.shape[1]

        best_dtw_cost = float("inf")
        best_dtw_start_frame = 0

        window_size = user_frames
        if window_size < orig_frames:
            step = max(1, window_size // 4)
            for i in range(0, orig_frames - window_size + 1, step):
                orig_slice = orig_mfcc[:, i:i + window_size]
                D, wp = librosa.sequence.dtw(X=orig_slice.T, Y=user_mfcc.T, metric="cosine")
                cost = D[-1, -1] / max(len(wp), 1)
                if cost < best_dtw_cost:
                    best_dtw_cost = cost
                    best_dtw_start_frame = i

        mfcc_start = float(best_dtw_start_frame * frame_dur)
        max_cost = 5.0
        mfcc_score = max(0.0, 1.0 - min(best_dtw_cost, max_cost) / max_cost)
        logger.info(f"[match] MFCC+DTW: start={mfcc_start:.1f}s  score={mfcc_score:.3f}")

    except Exception as e:
        logger.warning(f"[match] MFCC+DTW failed, falling back to chroma only: {e}")

    # ---- Method B: Chroma sliding window (key-invariant) ----
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
        step = max(1, window_frames // 4)
        for i in range(0, n_orig - window_frames + 1, step):
            w = orig_chroma[:, i:i + window_frames]
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

    # ---- Method C: Pitch-contour interval correlation ----
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
            step = max(1, user_len // 4)
            for i in range(0, len(orig_int) - user_len + 1, step):
                w = orig_int[i:i + user_len]
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

    # ---- Combine all methods ----
    if orig_mfcc is not None:
        combined = mfcc_score * 0.35 + best_chroma_score * 0.35 + contour_score * 0.30
        final_start = mfcc_start if mfcc_score > best_chroma_score else chroma_start
    else:
        combined = best_chroma_score * 0.6 + contour_score * 0.4
        final_start = chroma_start

    final_end = final_start + user_duration
    final_start = max(0.0, min(final_start, orig_duration - user_duration))
    final_end = min(orig_duration, final_start + user_duration)

    logger.info(f"[match] combined={combined:.3f}  section={final_start:.1f}s-{final_end:.1f}s")

    return {
        "success": combined > 0.15,
        "original_start": round(final_start, 2),
        "original_end": round(final_end, 2),
        "confidence": round(min(1.0, max(0.0, combined)), 3),
        "user_duration": round(user_duration, 2),
        "original_duration": round(orig_duration, 2),
        "chroma_score": round(best_chroma_score, 3),
        "contour_score": round(contour_score, 3),
        "mfcc_score": round(mfcc_score, 3) if orig_mfcc is not None else None,
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
        "mfcc_score": None,
    }


def extract_backing_section(backing_path, start_time, end_time, output_path, sr=44100, fade_ms=300):
    y, sr = librosa.load(backing_path, sr=sr, mono=True)

    try:
        tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr)
        beat_times = librosa.frames_to_time(beat_frames, sr=sr)

        if len(beat_times) > 0:
            start_snap = float(beat_times[np.argmin(np.abs(beat_times - start_time))])
            end_snap = float(beat_times[np.argmin(np.abs(beat_times - end_time))])
            if end_snap <= start_snap:
                end_snap = start_snap + (end_time - start_time)
            start_time = max(0.0, start_snap)
            end_time = min(len(y) / sr, end_snap)
            logger.info(f"[backing] snapped to beat grid: {start_time:.2f}s - {end_time:.2f}s")
    except Exception as e:
        logger.warning(f"[backing] beat detection failed, using raw times: {e}")

    s = max(0, int(start_time * sr))
    e = min(len(y), int(end_time * sr))
    section = y[s:e].copy()

    fade_n = int(sr * fade_ms / 1000)
    if fade_n > 0 and fade_n < len(section):
        section[:fade_n] *= np.linspace(0, 1, fade_n)
        section[-fade_n:] *= np.linspace(1, 0, fade_n)

    sf.write(output_path, section, sr)
    dur = len(section) / sr
    logger.info(f"[backing] extracted {dur:.1f}s ({start_time:.1f}s - {end_time:.1f}s)")
    return {"success": True, "output_path": output_path, "duration": dur}


def time_stretch_vocal(audio_path, output_path, target_duration, sr=44100):
    y, sr = librosa.load(audio_path, sr=sr, mono=True)
    orig_dur = len(y) / sr

    if abs(orig_dur - target_duration) < 0.1 or target_duration <= 0:
        sf.write(output_path, y, sr)
        return {"success": True, "original_duration": orig_dur, "stretched_duration": orig_dur, "stretched": False, "output_path": output_path}

    rate = orig_dur / target_duration
    if rate < 0.25 or rate > 4.0:
        logger.warning(f"[stretch] rate {rate:.2f} too extreme - copying without stretch")
        sf.write(output_path, y, sr)
        return {"success": True, "original_duration": orig_dur, "stretched_duration": orig_dur, "stretched": False, "output_path": output_path}

    n_fft = 2048
    hop = 512
    D = librosa.stft(y, n_fft=n_fft, hop_length=hop)
    D_stretched = librosa.phase_vocoder(D, rate=rate)
    y_s = librosa.istft(D_stretched, hop_length=hop)
    sf.write(output_path, y_s, sr)
    s_dur = len(y_s) / sr
    logger.info(f"[stretch] {orig_dur:.1f}s -> {s_dur:.1f}s (rate={rate:.3f})")
    return {"success": True, "original_duration": orig_dur, "stretched_duration": s_dur, "stretched": True, "output_path": output_path}


def _freq_dependent_strength(freq_hz, base_strength):
    if freq_hz < 200:
        return base_strength * 0.5
    elif freq_hz < 1000:
        return base_strength * 1.0
    else:
        return base_strength * 1.2


def pitch_correct_to_melody(input_path, output_path, target_melody, correction_strength=0.8, sr=44100):
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
        logger.warning("[pitch-correct] empty target melody - copying input")
        return {"success": True, "notes_corrected": 0, "duration": len(y) / sr}

    t_start = np.array([n["start"] for n in target_melody])
    t_midi = np.array([n["midi"] for n in target_melody])

    target_curve = np.interp(times, t_start, t_midi)
    target_hz = 440.0 * (2 ** ((target_curve - 69) / 12.0))

    valid = (~np.isnan(f0)) & (f0 > 0)
    ratios = np.ones_like(f0)

    for i in range(len(f0)):
        if valid[i]:
            strength = _freq_dependent_strength(f0[i], correction_strength)
            ratios[i] = 1.0 + (target_hz[i] / f0[i] - 1.0) * strength

    n_fft = 2048
    hop = 512
    D = librosa.stft(y, n_fft=n_fft, hop_length=hop)
    freqs = librosa.fft_frequencies(sr=sr, n_fft=n_fft)
    mag = np.abs(D)
    phase = np.angle(D)
    n_frames = D.shape[1]

    if len(ratios) != n_frames:
        ratios = np.interp(np.linspace(0, 1, n_frames), np.linspace(0, 1, len(ratios)), ratios)

    ratios = median_filter(ratios, size=5)

    out_D = np.empty_like(D)
    for i in range(n_frames):
        r = ratios[i]
        if abs(r - 1.0) < 0.001:
            out_D[:, i] = D[:, i]
        else:
            new_mag = np.interp(freqs, freqs * r, mag[:, i], left=0.0, right=0.0)
            phase_shift = np.cumsum(np.full(len(freqs), 2 * np.pi * (r - 1) * freqs / sr))
            out_D[:, i] = new_mag * np.exp(1j * (phase[:, i] + phase_shift))

    out_y = librosa.istft(out_D, hop_length=hop, length=len(y))
    sf.write(output_path, out_y, sr)

    n_corrected = int(np.sum(valid))
    logger.info(f"[pitch-correct] corrected {n_corrected} frames toward target melody (freq-dependent)")
    return {"success": True, "notes_corrected": n_corrected, "duration": float(len(y) / sr)}

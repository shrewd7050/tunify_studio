import os
import uuid
import shutil
import time
import logging
import asyncio
from pathlib import Path
from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from fastapi.responses import FileResponse
from typing import Optional

import numpy as np
import static_ffmpeg
static_ffmpeg.add_paths()
from pydub import AudioSegment

LOG_DIR = Path("logs")
LOG_DIR.mkdir(exist_ok=True)
logger = logging.getLogger("tunify")
logger.setLevel(logging.DEBUG)
if not logger.handlers:
    fh = logging.FileHandler(LOG_DIR / "tunify.log", encoding="utf-8")
    fh.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
    logger.addHandler(fh)
    ch = logging.StreamHandler()
    ch.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
    logger.addHandler(ch)

router = APIRouter()

UPLOAD_DIR = Path("uploads")
OUTPUT_DIR = Path("outputs")
UPLOAD_DIR.mkdir(exist_ok=True)
OUTPUT_DIR.mkdir(exist_ok=True)


def _build_backing_prompt(key: str, scale: str, tempo: float, vocal_profile: dict) -> str:
    """Build a concise MusicGen prompt based on vocal analysis."""
    parts = [f"{key} {scale} backing track"]

    if tempo:
        parts.append(f"{tempo:.0f} bpm")

    vocal_range = vocal_profile.get("vocal_range", "tenor/alto")
    if vocal_range in ("bass/baritone"):
        parts.append("warm pads, soft strings, gentle piano")
    elif vocal_range in ("soprano/high"):
        parts.append("rich bass, warm low-end synths, full pads")
    else:
        parts.append("balanced bass, synth pads, electric guitar")

    parts.append("punchy drums, professional mix, radio quality")

    return ", ".join(parts)


def _is_webm(filepath: Path) -> bool:
    """Check if a file is WebM format by reading magic bytes."""
    try:
        with open(filepath, "rb") as f:
            header = f.read(4)
        return header == b'\x1a\x45\xdf\xa3'
    except Exception:
        return False


def _convert_to_wav(input_path: Path, output_path: Path) -> None:
    """Convert any audio format to WAV using pydub + ffmpeg."""
    audio = AudioSegment.from_file(str(input_path))
    audio = audio.set_frame_rate(44100).set_channels(1)
    audio.export(str(output_path), format="wav")


@router.post("/upload")
async def upload_audio(file: UploadFile = File(...)):
    """Upload an audio file for processing."""
    allowed = {".wav", ".mp3", ".ogg", ".flac", ".m4a", ".aac", ".webm"}
    ext = Path(file.filename).suffix.lower()
    if ext not in allowed:
        raise HTTPException(400, f"Unsupported format: {ext}. Allowed: {allowed}")

    job_id = str(uuid.uuid4())[:8]
    filename = f"{job_id}{ext}"
    filepath = UPLOAD_DIR / filename

    with open(filepath, "wb") as f:
        shutil.copyfileobj(file.file, f)

    if _is_webm(filepath):
        wav_path = UPLOAD_DIR / f"{job_id}.wav"
        try:
            _convert_to_wav(filepath, wav_path)
            filepath.unlink()
            filename = f"{job_id}.wav"
            filepath = wav_path
            logger.info(f"[upload] job={job_id} converted WebM to WAV")
        except Exception as e:
            logger.error(f"[upload] job={job_id} WebM conversion failed: {e}")
            filepath.unlink(missing_ok=True)
            raise HTTPException(400, f"Failed to convert audio: {e}. Please upload a WAV or MP3 file.")

    return {
        "success": True,
        "job_id": job_id,
        "filename": filename,
        "path": str(filepath),
    }


@router.post("/process")
async def process_audio(
    job_id: str = Form(...),
    key: Optional[str] = Form(None),
    scale: str = Form("major"),
    correction_strength: float = Form(0.8),
    pitch_shift: float = Form(0.0),
):
    """Full pipeline: auto-tune vocals, generate backing track, mix."""
    from src.ml.auto_tune import auto_tune
    from src.ml.music_gen import generate_music
    from src.ml.mixer import mix_tracks
    import soundfile as sf_info

    correction_strength = max(0.0, min(1.0, correction_strength))

    input_files = list(UPLOAD_DIR.glob(f"{job_id}.*"))
    if not input_files:
        raise HTTPException(404, f"No audio found for job {job_id}")

    input_path = str(input_files[0])

    file_size = os.path.getsize(input_path)
    if file_size < 100:
        raise HTTPException(400, f"Audio file is too small ({file_size} bytes). Please upload a valid audio file.")

    autotuned_path = str(OUTPUT_DIR / f"{job_id}_autotuned.wav")
    backing_path = str(OUTPUT_DIR / f"{job_id}_backing.wav")
    mixed_path = str(OUTPUT_DIR / f"{job_id}_final.wav")

    loop = asyncio.get_event_loop()

    try:
        t0 = time.time()

        from src.ml.pitch_detection import detect_key_and_scale, analyze_vocal_profile

        logger.info(f"[process] job={job_id} analyzing {input_path}")
        analysis, vocal_profile = await asyncio.gather(
            loop.run_in_executor(None, lambda: detect_key_and_scale(input_path)),
            loop.run_in_executor(None, lambda: analyze_vocal_profile(input_path)),
        )

        if key is None:
            key = analysis["key"]
            scale = analysis["scale"]
        tempo = analysis.get("tempo")

        prompt = _build_backing_prompt(key, scale, tempo, vocal_profile)
        logger.info(f"[process] job={job_id} key={key} {scale} tempo={tempo} vocal={vocal_profile['vocal_range']} prompt='{prompt}'")

        song_duration = sf_info.info(input_path).duration

        tune_future = loop.run_in_executor(
            None,
            lambda: auto_tune(
                input_path=input_path,
                output_path=autotuned_path,
                key=key,
                scale=scale,
                correction_strength=correction_strength,
                pitch_shift_semitones=pitch_shift,
            ),
        )

        gen_future = loop.run_in_executor(
            None,
            lambda: generate_music(
                prompt=prompt,
                output_path=backing_path,
                duration=song_duration,
            ),
        )

        tune_result, gen_result = await asyncio.gather(
            tune_future,
            gen_future,
            return_exceptions=True,
        )
        logger.info(f"[process] job={job_id} auto_tune + generate_music done in {time.time()-t0:.1f}s")

        if isinstance(tune_result, Exception):
            logger.error(f"[process] job={job_id} auto_tune failed: {tune_result}")
            raise HTTPException(500, f"Auto-tune failed: {tune_result}")

        gen_result_ok = None if isinstance(gen_result, Exception) else gen_result
        if isinstance(gen_result, Exception):
            logger.warning(f"[process] job={job_id} generate_music failed: {gen_result}. Proceeding with autotuned only.")

        if gen_result_ok:
            try:
                logger.info(f"[process] job={job_id} starting mix_tracks")
                await loop.run_in_executor(
                    None,
                    lambda: mix_tracks(
                        vocal_path=autotuned_path,
                        backing_path=backing_path,
                        output_path=mixed_path,
                    ),
                )
                logger.info(f"[process] job={job_id} mix_tracks done in {time.time()-t0:.1f}s")
            except Exception as mix_err:
                logger.warning(f"[process] job={job_id} mix_tracks failed: {mix_err}")

        result = {
            "success": True,
            "job_id": job_id,
            "key": tune_result["key"],
            "scale": tune_result["scale"],
            "duration": tune_result["duration"],
            "processing_time": round(time.time() - t0, 1),
            "autotuned_url": f"/outputs/{job_id}_autotuned.wav",
        }
        if gen_result_ok:
            result["backing_url"] = f"/outputs/{job_id}_backing.wav"
            result["final_url"] = f"/outputs/{job_id}_final.wav"

        logger.info(f"[process] job={job_id} complete in {time.time()-t0:.1f}s")
        return result

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[process] job={job_id} FAILED: {e}", exc_info=True)
        raise HTTPException(500, f"Processing failed: {str(e)}")


@router.post("/autotune")
async def autotune_only(
    file: UploadFile = File(...),
    key: Optional[str] = Form(None),
    scale: str = Form("major"),
    correction_strength: float = Form(0.8),
    pitch_shift: float = Form(0.0),
):
    """Auto-tune a vocal track without generating backing music."""
    from src.ml.auto_tune import auto_tune

    correction_strength = max(0.0, min(1.0, correction_strength))

    job_id = str(uuid.uuid4())[:8]
    ext = Path(file.filename).suffix.lower() or ".wav"
    input_path = str(UPLOAD_DIR / f"{job_id}{ext}")
    output_path = str(OUTPUT_DIR / f"{job_id}_autotuned.wav")

    with open(input_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    t0 = time.time()
    result = auto_tune(
        input_path=input_path,
        output_path=output_path,
        key=key,
        scale=scale,
        correction_strength=correction_strength,
        pitch_shift_semitones=pitch_shift,
    )

    return {
        "success": True,
        "job_id": job_id,
        "key": result["key"],
        "scale": result["scale"],
        "duration": result["duration"],
        "processing_time": round(time.time() - t0, 1),
        "download_url": f"/outputs/{job_id}_autotuned.wav",
    }


@router.post("/separate")
async def separate_vocals_endpoint(file: UploadFile = File(...)):
    """Separate vocals from accompaniment."""
    from src.ml.mixer import separate_vocals as separate_vocals_fn

    job_id = str(uuid.uuid4())[:8]
    ext = Path(file.filename).suffix.lower() or ".wav"
    input_path = str(UPLOAD_DIR / f"{job_id}{ext}")

    with open(input_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    result = separate_vocals_fn(input_path, str(OUTPUT_DIR / job_id))

    return {
        "success": True,
        "job_id": job_id,
        **result,
    }


@router.post("/voice-swap")
async def voice_swap(
    original: UploadFile = File(...),
    voice: UploadFile = File(...),
    correction_strength: float = Form(0.8),
):
    """Swap vocals: separate backing from original song, auto-tune user voice to match, mix together."""
    from src.ml.auto_tune import auto_tune
    from src.ml.mixer import load_and_resample, align_lengths, normalize_audio, _apply_multiband_processing
    from src.ml.pitch_detection import detect_key_and_scale

    loop = asyncio.get_event_loop()
    t0 = time.time()
    job_id = str(uuid.uuid4())[:8]

    try:
        orig_ext = Path(original.filename).suffix.lower() or ".wav"
        orig_raw_path = str(UPLOAD_DIR / f"{job_id}_orig{orig_ext}")
        with open(orig_raw_path, "wb") as f:
            shutil.copyfileobj(original.file, f)

        if orig_ext not in (".wav",):
            orig_path = str(UPLOAD_DIR / f"{job_id}_orig.wav")
            _convert_to_wav(Path(orig_raw_path), Path(orig_path))
        else:
            orig_path = orig_raw_path

        voice_ext = Path(voice.filename).suffix.lower() or ".wav"
        voice_raw_path = str(UPLOAD_DIR / f"{job_id}_voice{voice_ext}")
        with open(voice_raw_path, "wb") as f:
            shutil.copyfileobj(voice.file, f)

        if voice_ext not in (".wav",):
            voice_path = str(UPLOAD_DIR / f"{job_id}_voice.wav")
            _convert_to_wav(Path(voice_raw_path), Path(voice_path))
        else:
            voice_path = voice_raw_path

        logger.info(f"[voice-swap] job={job_id} orig={orig_ext} voice={voice_ext} converted to wav")

        logger.info(f"[voice-swap] job={job_id} separating vocals from original")
        try:
            from src.ml.mixer import separate_vocals
            sep_result = await loop.run_in_executor(
                None, lambda: separate_vocals(orig_path, str(OUTPUT_DIR / job_id))
            )
        except Exception as sep_err:
            logger.error(f"[voice-swap] job={job_id} separation crashed: {sep_err}")
            raise HTTPException(500, f"Vocal separation failed: {sep_err}. Make sure Demucs is installed.")

        if not sep_result.get("success"):
            raise HTTPException(500, f"Vocal separation failed: {sep_result.get('error', 'unknown')}")

        original_backing_path = sep_result["accompaniment_path"]

        logger.info(f"[voice-swap] job={job_id} detecting key from original")
        key_info = await loop.run_in_executor(None, lambda: detect_key_and_scale(orig_path))
        key = key_info["key"]
        scale = key_info["scale"]
        tempo = key_info.get("tempo")
        logger.info(f"[voice-swap] job={job_id} key={key} {scale} tempo={tempo}")

        autotuned_voice_path = str(OUTPUT_DIR / f"{job_id}_voice_tuned.wav")
        logger.info(f"[voice-swap] job={job_id} auto-tuning voice to {key} {scale}")
        tune_result = await loop.run_in_executor(
            None,
            lambda: auto_tune(
                input_path=voice_path,
                output_path=autotuned_voice_path,
                key=key,
                scale=scale,
                correction_strength=correction_strength,
            ),
        )
        logger.info(f"[voice-swap] job={job_id} auto-tune done in {time.time()-t0:.1f}s")

        final_path = str(OUTPUT_DIR / f"{job_id}_voice_swap.wav")
        logger.info(f"[voice-swap] job={job_id} mixing voice with original backing")

        def _do_mix():
            vocal, sr = load_and_resample(autotuned_voice_path, target_sr=44100)
            backing, _ = load_and_resample(original_backing_path, target_sr=44100)
            vocal, backing = align_lengths(vocal, backing)
            vocal = normalize_audio(vocal, target_db=-18.0)
            backing = normalize_audio(backing, target_db=-20.0)
            vocal, backing = _apply_multiband_processing(vocal, backing, sr)
            mixed = vocal + backing
            peak = np.max(np.abs(mixed))
            if peak > 0.95:
                mixed = mixed * (0.95 / peak)
            if mixed.ndim == 1:
                stereo = np.stack([mixed, mixed], axis=-1)
            else:
                stereo = mixed
            import soundfile as sf
            sf.write(final_path, stereo, sr)
            return {"duration": float(len(mixed) / sr), "sample_rate": sr}

        await loop.run_in_executor(None, _do_mix)
        logger.info(f"[voice-swap] job={job_id} done in {time.time()-t0:.1f}s")

        return {
            "success": True,
            "job_id": job_id,
            "key": key,
            "scale": scale,
            "tempo": tempo,
            "duration": tune_result["duration"],
            "processing_time": round(time.time() - t0, 1),
            "voice_swapped_url": f"/outputs/{job_id}_voice_swap.wav",
            "original_backing_url": f"/outputs/{job_id}_orig/htdemucs/{Path(orig_path).stem}/no_vocals.wav",
            "tuned_voice_url": f"/outputs/{job_id}_voice_tuned.wav",
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[voice-swap] job={job_id} FAILED: {e}", exc_info=True)
        raise HTTPException(500, f"Voice swap failed: {str(e)}")


@router.get("/download/{filename}")
async def download_file(filename: str):
    """Download a processed audio file."""
    filepath = (OUTPUT_DIR / filename).resolve()
    if not filepath.exists() or not filepath.is_relative_to(OUTPUT_DIR.resolve()):
        raise HTTPException(404, "File not found")
    return FileResponse(filepath, media_type="audio/wav", filename=filename)


@router.get("/analyze/{filename}")
async def analyze_audio(filename: str):
    """Analyze audio: detect key, tempo, pitch."""
    from src.ml.pitch_detection import detect_key_and_scale, detect_pitch

    input_files = list(UPLOAD_DIR.glob(f"*{filename}*"))
    if not input_files:
        input_files = list(OUTPUT_DIR.glob(f"*{filename}*"))
    if not input_files:
        raise HTTPException(404, "Audio file not found")

    filepath = str(input_files[0])

    key_info = detect_key_and_scale(filepath)

    return {
        "success": True,
        "key": key_info["key"],
        "scale": key_info["scale"],
        "tempo": key_info["tempo"],
        "confidence": key_info["confidence"],
    }


@router.post("/effects")
async def apply_effects_to_audio(
    job_id: str = Form(...),
    effects: str = Form("[]"),
):
    """Apply audio effects to a file. effects is a JSON array of {name, params}."""
    import json
    from src.ml.effects import apply_effects

    input_files = list(UPLOAD_DIR.glob(f"{job_id}.*"))
    if not input_files:
        input_files = list(OUTPUT_DIR.glob(f"{job_id}_final.*"))
    if not input_files:
        input_files = list(OUTPUT_DIR.glob(f"{job_id}_autotuned.*"))
    if not input_files:
        input_files = list(OUTPUT_DIR.glob(f"{job_id}_effects.*"))
    if not input_files:
        raise HTTPException(404, f"No audio found for job {job_id}")

    input_path = str(input_files[0])
    output_path = str(OUTPUT_DIR / f"{job_id}_effects.wav")

    try:
        t0 = time.time()
        effects_list = json.loads(effects)
        logger.info(f"[effects] job={job_id} applying {len(effects_list)} effects to {input_path}")

        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            None, lambda: apply_effects(input_path, output_path, effects_list)
        )

        result["processing_time"] = round(time.time() - t0, 1)
        logger.info(f"[effects] job={job_id} done in {time.time()-t0:.1f}s: {result.get('effects_applied', [])}")
        return {
            "success": True,
            "job_id": job_id,
            "effects_url": f"/outputs/{job_id}_effects.wav",
            **{k: v for k, v in result.items() if k != "output_path"},
        }
    except Exception as e:
        logger.error(f"[effects] job={job_id} FAILED: {e}", exc_info=True)
        raise HTTPException(500, f"Effects failed: {str(e)}")


def _find_audio_file(job_id: str) -> str:
    """Find the best audio file for a job ID, checking uploads and outputs."""
    candidates = [
        list(UPLOAD_DIR.glob(f"{job_id}.*")),
        list(OUTPUT_DIR.glob(f"{job_id}_final.*")),
        list(OUTPUT_DIR.glob(f"{job_id}_autotuned.*")),
        list(OUTPUT_DIR.glob(f"{job_id}_effects.*")),
        list(OUTPUT_DIR.glob(f"{job_id}_edited.*")),
    ]
    for group in candidates:
        if group:
            return str(group[0])
    raise HTTPException(404, f"No audio found for job {job_id}")


@router.get("/editor/waveform/{job_id}")
async def get_waveform(job_id: str, num_points: int = 2000):
    """Get waveform data for visualization."""
    from src.ml.editor import get_waveform_data, get_audio_info
    try:
        filepath = _find_audio_file(job_id)
        waveform = get_waveform_data(filepath, num_points)
        info = get_audio_info(filepath)
        return {"success": True, "job_id": job_id, **waveform, "info": info}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[editor] waveform job={job_id} FAILED: {e}", exc_info=True)
        raise HTTPException(500, f"Waveform failed: {str(e)}")


@router.post("/editor/cut")
async def cut_audio(
    job_id: str = Form(...),
    start_time: float = Form(...),
    end_time: float = Form(...),
):
    """Cut a region from audio."""
    from src.ml.editor import cut_region
    try:
        input_path = _find_audio_file(job_id)
        output_path = str(OUTPUT_DIR / f"{job_id}_edited.wav")
        t0 = time.time()
        result = await asyncio.get_event_loop().run_in_executor(
            None, lambda: cut_region(input_path, output_path, start_time, end_time)
        )
        result["processing_time"] = round(time.time() - t0, 1)
        result["job_id"] = job_id
        result["edited_url"] = f"/outputs/{job_id}_edited.wav"
        logger.info(f"[editor] cut job={job_id} {start_time:.2f}-{end_time:.2f}s done in {result['processing_time']}s")
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[editor] cut job={job_id} FAILED: {e}", exc_info=True)
        raise HTTPException(500, f"Cut failed: {str(e)}")


@router.post("/editor/trim")
async def trim_audio(
    job_id: str = Form(...),
    start_time: float = Form(...),
    end_time: float = Form(...),
):
    """Keep only the selected region (trim everything else)."""
    from src.ml.editor import trim_region
    try:
        input_path = _find_audio_file(job_id)
        output_path = str(OUTPUT_DIR / f"{job_id}_edited.wav")
        t0 = time.time()
        result = await asyncio.get_event_loop().run_in_executor(
            None, lambda: trim_region(input_path, output_path, start_time, end_time)
        )
        result["processing_time"] = round(time.time() - t0, 1)
        result["job_id"] = job_id
        result["edited_url"] = f"/outputs/{job_id}_edited.wav"
        logger.info(f"[editor] trim job={job_id} {start_time:.2f}-{end_time:.2f}s done in {result['processing_time']}s")
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[editor] trim job={job_id} FAILED: {e}", exc_info=True)
        raise HTTPException(500, f"Trim failed: {str(e)}")


@router.post("/editor/reverse")
async def reverse_audio(
    job_id: str = Form(...),
    start_time: Optional[float] = Form(None),
    end_time: Optional[float] = Form(None),
):
    """Reverse audio, optionally only within a region."""
    from src.ml.editor import reverse_region
    try:
        input_path = _find_audio_file(job_id)
        output_path = str(OUTPUT_DIR / f"{job_id}_edited.wav")
        t0 = time.time()
        result = await asyncio.get_event_loop().run_in_executor(
            None, lambda: reverse_region(input_path, output_path, start_time, end_time)
        )
        result["processing_time"] = round(time.time() - t0, 1)
        result["job_id"] = job_id
        result["edited_url"] = f"/outputs/{job_id}_edited.wav"
        logger.info(f"[editor] reverse job={job_id} done in {result['processing_time']}s")
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[editor] reverse job={job_id} FAILED: {e}", exc_info=True)
        raise HTTPException(500, f"Reverse failed: {str(e)}")


@router.post("/editor/silence")
async def silence_audio(
    job_id: str = Form(...),
    start_time: float = Form(...),
    end_time: float = Form(...),
):
    """Silence a region of audio."""
    from src.ml.editor import silence_region
    try:
        input_path = _find_audio_file(job_id)
        output_path = str(OUTPUT_DIR / f"{job_id}_edited.wav")
        t0 = time.time()
        result = await asyncio.get_event_loop().run_in_executor(
            None, lambda: silence_region(input_path, output_path, start_time, end_time)
        )
        result["processing_time"] = round(time.time() - t0, 1)
        result["job_id"] = job_id
        result["edited_url"] = f"/outputs/{job_id}_edited.wav"
        logger.info(f"[editor] silence job={job_id} {start_time:.2f}-{end_time:.2f}s done in {result['processing_time']}s")
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[editor] silence job={job_id} FAILED: {e}", exc_info=True)
        raise HTTPException(500, f"Silence failed: {str(e)}")


@router.post("/editor/normalize")
async def normalize_audio_endpoint(
    job_id: str = Form(...),
    target_db: float = Form(-18.0),
    start_time: Optional[float] = Form(None),
    end_time: Optional[float] = Form(None),
):
    """Normalize audio volume, optionally within a region."""
    from src.ml.editor import normalize_audio
    try:
        input_path = _find_audio_file(job_id)
        output_path = str(OUTPUT_DIR / f"{job_id}_edited.wav")
        t0 = time.time()
        result = await asyncio.get_event_loop().run_in_executor(
            None, lambda: normalize_audio(input_path, output_path, target_db, start_time, end_time)
        )
        result["processing_time"] = round(time.time() - t0, 1)
        result["job_id"] = job_id
        result["edited_url"] = f"/outputs/{job_id}_edited.wav"
        logger.info(f"[editor] normalize job={job_id} done in {result['processing_time']}s")
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[editor] normalize job={job_id} FAILED: {e}", exc_info=True)
        raise HTTPException(500, f"Normalize failed: {str(e)}")


@router.post("/editor/fade")
async def fade_audio_endpoint(
    job_id: str = Form(...),
    fade_in_ms: float = Form(0),
    fade_out_ms: float = Form(0),
    start_time: Optional[float] = Form(None),
    end_time: Optional[float] = Form(None),
):
    """Apply fade in/out, optionally within a region."""
    from src.ml.editor import fade_audio
    try:
        input_path = _find_audio_file(job_id)
        output_path = str(OUTPUT_DIR / f"{job_id}_edited.wav")
        t0 = time.time()
        result = await asyncio.get_event_loop().run_in_executor(
            None, lambda: fade_audio(input_path, output_path, fade_in_ms, fade_out_ms, start_time, end_time)
        )
        result["processing_time"] = round(time.time() - t0, 1)
        result["job_id"] = job_id
        result["edited_url"] = f"/outputs/{job_id}_edited.wav"
        logger.info(f"[editor] fade job={job_id} done in {result['processing_time']}s")
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[editor] fade job={job_id} FAILED: {e}", exc_info=True)
        raise HTTPException(500, f"Fade failed: {str(e)}")


@router.post("/editor/effect-region")
async def apply_effect_to_region(
    job_id: str = Form(...),
    effect_name: str = Form(...),
    effect_params: str = Form("{}"),
    start_time: float = Form(...),
    end_time: float = Form(...),
):
    """Apply an effect to a specific region of audio."""
    import json
    from src.ml.editor import apply_region_effect
    try:
        input_path = _find_audio_file(job_id)
        output_path = str(OUTPUT_DIR / f"{job_id}_edited.wav")
        params = json.loads(effect_params)
        t0 = time.time()
        result = await asyncio.get_event_loop().run_in_executor(
            None, lambda: apply_region_effect(input_path, output_path, effect_name, params, start_time, end_time)
        )
        result["processing_time"] = round(time.time() - t0, 1)
        result["job_id"] = job_id
        result["edited_url"] = f"/outputs/{job_id}_edited.wav"
        logger.info(f"[editor] effect-region job={job_id} effect={effect_name} done in {result['processing_time']}s")
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[editor] effect-region job={job_id} FAILED: {e}", exc_info=True)
        raise HTTPException(500, f"Region effect failed: {str(e)}")


@router.post("/editor/add-layer")
async def add_layer_endpoint(
    job_id: str = Form(...),
    layer: UploadFile = File(...),
    layer_start_time: float = Form(0.0),
    layer_volume_db: float = Form(0.0),
):
    """Add an audio layer on top of the existing track."""
    from src.ml.multitrack import add_layer
    try:
        input_path = _find_audio_file(job_id)
        layer_id = str(uuid.uuid4())[:8]
        ext = Path(layer.filename).suffix.lower() or ".wav"
        layer_path = str(UPLOAD_DIR / f"{layer_id}{ext}")
        with open(layer_path, "wb") as f:
            shutil.copyfileobj(layer.file, f)
        output_path = str(OUTPUT_DIR / f"{job_id}_edited.wav")
        t0 = time.time()
        result = await asyncio.get_event_loop().run_in_executor(
            None, lambda: add_layer(input_path, layer_path, output_path, layer_start_time, layer_volume_db)
        )
        result["processing_time"] = round(time.time() - t0, 1)
        result["job_id"] = job_id
        result["edited_url"] = f"/outputs/{job_id}_edited.wav"
        logger.info(f"[editor] add-layer job={job_id} done in {result['processing_time']}s")
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[editor] add-layer job={job_id} FAILED: {e}", exc_info=True)
        raise HTTPException(500, f"Add layer failed: {str(e)}")

import os
import uuid
import shutil
from pathlib import Path
from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from fastapi.responses import FileResponse
from typing import Optional

router = APIRouter()

UPLOAD_DIR = Path("uploads")
OUTPUT_DIR = Path("outputs")
UPLOAD_DIR.mkdir(exist_ok=True)
OUTPUT_DIR.mkdir(exist_ok=True)


@router.post("/upload")
async def upload_audio(file: UploadFile = File(...)):
    """Upload an audio file for processing."""
    allowed = {".wav", ".mp3", ".ogg", ".flac", ".m4a", ".aac"}
    ext = Path(file.filename).suffix.lower()
    if ext not in allowed:
        raise HTTPException(400, f"Unsupported format: {ext}. Allowed: {allowed}")

    job_id = str(uuid.uuid4())[:8]
    filename = f"{job_id}{ext}"
    filepath = UPLOAD_DIR / filename

    with open(filepath, "wb") as f:
        shutil.copyfileobj(file.file, f)

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

    input_files = list(UPLOAD_DIR.glob(f"{job_id}.*"))
    if not input_files:
        raise HTTPException(404, f"No audio found for job {job_id}")

    input_path = str(input_files[0])

    autotuned_path = str(OUTPUT_DIR / f"{job_id}_autotuned.wav")
    backing_path = str(OUTPUT_DIR / f"{job_id}_backing.wav")
    mixed_path = str(OUTPUT_DIR / f"{job_id}_final.wav")

    try:
        tune_result = auto_tune(
            input_path=input_path,
            output_path=autotuned_path,
            key=key,
            scale=scale,
            correction_strength=correction_strength,
            pitch_shift_semitones=pitch_shift,
        )

        from src.ml.pitch_detection import detect_key_and_scale
        key_info = detect_key_and_scale(input_path)
        prompt = f"musical backing track in {key_info['key']} {key_info['scale']}, tempo {key_info['tempo']:.0f} bpm, instrumental accompaniment"

        gen_result = generate_music(
            prompt=prompt,
            output_path=backing_path,
            duration=min(tune_result["duration"], 30.0),
        )

        mix_result = mix_tracks(
            vocal_path=autotuned_path,
            backing_path=backing_path,
            output_path=mixed_path,
        )

        return {
            "success": True,
            "job_id": job_id,
            "key": tune_result["key"],
            "scale": tune_result["scale"],
            "duration": tune_result["duration"],
            "autotuned_url": f"/outputs/{job_id}_autotuned.wav",
            "backing_url": f"/outputs/{job_id}_backing.wav",
            "final_url": f"/outputs/{job_id}_final.wav",
        }

    except Exception as e:
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

    job_id = str(uuid.uuid4())[:8]
    ext = Path(file.filename).suffix.lower() or ".wav"
    input_path = str(UPLOAD_DIR / f"{job_id}{ext}")
    output_path = str(OUTPUT_DIR / f"{job_id}_autotuned.wav")

    with open(input_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

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
        "download_url": f"/outputs/{job_id}_autotuned.wav",
    }


@router.post("/separate")
async def separate_vocals(file: UploadFile = File(...)):
    """Separate vocals from accompaniment."""
    from src.ml.mixer import separate_vocals

    job_id = str(uuid.uuid4())[:8]
    ext = Path(file.filename).suffix.lower() or ".wav"
    input_path = str(UPLOAD_DIR / f"{job_id}{ext}")

    with open(input_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    result = separate_vocals(input_path, str(OUTPUT_DIR / job_id))

    return {
        "success": True,
        "job_id": job_id,
        **result,
    }


@router.get("/download/{filename}")
async def download_file(filename: str):
    """Download a processed audio file."""
    filepath = OUTPUT_DIR / filename
    if not filepath.exists():
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

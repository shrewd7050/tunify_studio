import os
import uuid
import shutil
import time
from pathlib import Path
from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from typing import Optional

router = APIRouter()

OUTPUT_DIR = Path("outputs")
OUTPUT_DIR.mkdir(exist_ok=True)


@router.post("/music")
async def generate_music_endpoint(
    prompt: str = Form(...),
    duration: float = Form(10.0),
    temperature: float = Form(1.0),
    top_k: int = Form(250),
):
    """Generate music from a text prompt."""
    from src.ml.music_gen import generate_music

    duration = max(1.0, min(30.0, duration))

    job_id = str(uuid.uuid4())[:8]
    output_path = str(OUTPUT_DIR / f"{job_id}_generated.wav")

    try:
        t0 = time.time()
        result = generate_music(
            prompt=prompt,
            output_path=output_path,
            duration=min(duration, 30.0),
            temperature=temperature,
            top_k=top_k,
        )
        result["processing_time"] = round(time.time() - t0, 1)
        return {
            "success": True,
            "job_id": job_id,
            "download_url": f"/outputs/{job_id}_generated.wav",
            **{k: v for k, v in result.items() if k != "output_path"},
        }
    except Exception as e:
        raise HTTPException(500, f"Generation failed: {str(e)}")


@router.post("/accompaniment")
async def generate_accompaniment(
    file: UploadFile = File(...),
    prompt: Optional[str] = Form(None),
    duration: float = Form(30.0),
):
    """Generate an AI accompaniment based on input audio."""
    from src.ml.music_gen import generate_music_from_audio

    job_id = str(uuid.uuid4())[:8]
    ext = Path(file.filename).suffix.lower() or ".wav"
    input_path = str(OUTPUT_DIR / f"{job_id}_input{ext}")
    output_path = str(OUTPUT_DIR / f"{job_id}_accompaniment.wav")

    with open(input_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    try:
        t0 = time.time()
        result = generate_music_from_audio(
            input_audio_path=input_path,
            output_path=output_path,
            prompt=prompt or "musical accompaniment, backing track, instrumental",
            duration=min(duration, 30.0),
        )
        result["processing_time"] = round(time.time() - t0, 1)
        return {
            "success": True,
            "job_id": job_id,
            "download_url": f"/outputs/{job_id}_accompaniment.wav",
            **{k: v for k, v in result.items() if k != "output_path"},
        }
    except Exception as e:
        raise HTTPException(500, f"Generation failed: {str(e)}")

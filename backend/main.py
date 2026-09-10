import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from src.routes.audio import router as audio_router
from src.routes.generate import router as generate_router
import torch
import logging
import threading

logger = logging.getLogger("tunify")

app = FastAPI(title="Tunify API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

from pathlib import Path

Path("uploads").mkdir(exist_ok=True)
Path("outputs").mkdir(exist_ok=True)

app.include_router(audio_router, prefix="/api/audio", tags=["Audio"])
app.include_router(generate_router, prefix="/api/generate", tags=["Generate"])

app.mount("/outputs", StaticFiles(directory="outputs"), name="outputs")


def _prewarm_model():
    """Load MusicGen model in background thread so first request is fast."""
    try:
        from src.ml.music_gen import _load_model
        _load_model("facebook/musicgen-small")
        logger.info("[Tunify] MusicGen model pre-warmed successfully")
    except Exception as e:
        logger.warning(f"[Tunify] Model pre-warm failed: {e}")


@app.on_event("startup")
async def startup_event():
    if torch.cuda.is_available():
        logger.info(f"[Tunify] GPU: {torch.cuda.get_device_name(0)}")
        logger.info(f"[Tunify] VRAM: {torch.cuda.get_device_properties(0).total_memory / (1024**3):.1f} GB")
    threading.Thread(target=_prewarm_model, daemon=True).start()


@app.get("/")
async def root():
    gpu_info = {}
    if torch.cuda.is_available():
        gpu_info = {
            "device": torch.cuda.get_device_name(0),
            "vram_gb": round(torch.cuda.get_device_properties(0).total_memory / (1024**3), 1),
            "cuda_version": torch.version.cuda,
        }
    return {
        "message": "Tunify API is running",
        "version": "1.0.0",
        "gpu": gpu_info if gpu_info else "CPU only",
        "torch": torch.__version__,
    }


@app.get("/health")
async def health():
    return {"status": "ok"}


if __name__ == "__main__":
    if torch.cuda.is_available():
        print(f"[Tunify] GPU: {torch.cuda.get_device_name(0)}")
        print(f"[Tunify] CUDA: {torch.version.cuda}")
        print(f"[Tunify] VRAM: {torch.cuda.get_device_properties(0).total_memory / (1024**3):.1f} GB")
        print(f"[Tunify] PyTorch: {torch.__version__}")
    else:
        print("[Tunify] No GPU detected, running on CPU")

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)

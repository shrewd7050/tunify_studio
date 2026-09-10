import uvicorn
import torch

print(f"[Tunify] GPU: {torch.cuda.get_device_name(0)}")
print(f"[Tunify] CUDA: {torch.version.cuda}")
print(f"[Tunify] VRAM: {torch.cuda.get_device_properties(0).total_memory / (1024**3):.1f} GB")
print(f"[Tunify] PyTorch: {torch.__version__}")

uvicorn.run("main:app", host="0.0.0.0", port=8000)

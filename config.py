# config.py
"""Centralised configuration for the Nexus AI backend.

Every value can be overridden with an environment variable so the app
can be deployed without touching source code.  A .env file is *not*
required; see .env.example for the full list of recognised variables.
"""

import os


def _env_bool(key: str, default: bool = False) -> bool:
    return os.getenv(key, str(default)).lower() in ("1", "true", "yes")


def _env_int(key: str, default: int) -> int:
    try:
        return int(os.getenv(key, default))
    except (ValueError, TypeError):
        return default


def _env_float(key: str, default: float) -> float:
    try:
        return float(os.getenv(key, default))
    except (ValueError, TypeError):
        return default


# ── Flask ────────────────────────────────────────────────────────────
FLASK_DEBUG: bool = _env_bool("FLASK_DEBUG", False)
SECRET_KEY: str = os.getenv("SECRET_KEY", "nexus-dev-key-change-me")
APP_HOST: str = os.getenv("APP_HOST", "0.0.0.0")
APP_PORT: int = _env_int("APP_PORT", 5000)

# ── ComfyUI connection ───────────────────────────────────────────────
# Default base URL used when the frontend does not supply a tunnel URL.
COMFYUI_BASE_URL: str = os.getenv("COMFYUI_BASE_URL", "")
COMFYUI_TIMEOUT: int = _env_int("COMFYUI_TIMEOUT", 15)
COMFYUI_CONNECT_TIMEOUT: int = _env_int("COMFYUI_CONNECT_TIMEOUT", 5)
OBJECT_INFO_CACHE_TTL: int = _env_int("OBJECT_INFO_CACHE_TTL", 300)

# ── Active workflow blueprint ────────────────────────────────────────
# Change this to swap the workflow builder without touching routes.
ACTIVE_WORKFLOW: str = os.getenv("ACTIVE_WORKFLOW", "anima")

# ── Generation defaults (mirrored to the frontend via /api/config) ──
DEFAULT_CHECKPOINT: str = os.getenv("DEFAULT_CHECKPOINT", "anima_wai.safetensors")
DEFAULT_VAE: str = os.getenv("DEFAULT_VAE", "qwen_image_vae.safetensors")
DEFAULT_CLIP: str = os.getenv("DEFAULT_CLIP", "qwen_3_06b_base.safetensors")
DEFAULT_SAMPLER: str = os.getenv("DEFAULT_SAMPLER", "euler_ancestral")
DEFAULT_SCHEDULER: str = os.getenv("DEFAULT_SCHEDULER", "simple")
DEFAULT_STEPS: int = _env_int("DEFAULT_STEPS", 20)
DEFAULT_CFG: float = _env_float("DEFAULT_CFG", 4.5)
DEFAULT_WIDTH: int = _env_int("DEFAULT_WIDTH", 1152)
DEFAULT_HEIGHT: int = _env_int("DEFAULT_HEIGHT", 896)
DEFAULT_BATCH_SIZE: int = _env_int("DEFAULT_BATCH_SIZE", 1)
DEFAULT_BATCH_COUNT: int = _env_int("DEFAULT_BATCH_COUNT", 1)

# Hires-fix defaults
DEFAULT_HIRES_SCALE: float = _env_float("DEFAULT_HIRES_SCALE", 1.5)
DEFAULT_HIRES_STEPS: int = _env_int("DEFAULT_HIRES_STEPS", 12)
DEFAULT_HIRES_CFG: float = _env_float("DEFAULT_HIRES_CFG", 4.0)
DEFAULT_HIRES_SAMPLER: str = os.getenv("DEFAULT_HIRES_SAMPLER", "euler_ancestral")
DEFAULT_HIRES_DENOISE: float = _env_float("DEFAULT_HIRES_DENOISE", 0.4)
DEFAULT_HIRES_SHARPEN_SIGMA: float = _env_float("DEFAULT_HIRES_SHARPEN_SIGMA", 0.18)

# ── Validation bounds ────────────────────────────────────────────────
MAX_STEPS: int = 150
MAX_CFG: float = 30.0
MAX_BATCH_SIZE: int = 8
MAX_BATCH_COUNT: int = 16
MAX_WIDTH: int = 4096
MAX_HEIGHT: int = 4096
MIN_DIMENSION: int = 64
MAX_LORAS: int = 10

# ── Civitai ────────────────────────────────────────────────────────────────────
CIVITAI_API_BASE: str = os.getenv(
    "CIVITAI_API_BASE",
    "https://civitai.com/api/v1"
).rstrip("/")
CIVITAI_API_TOKEN: str = os.getenv("CIVITAI_API_TOKEN", "").strip()

CIVITAI_TIMEOUT: int = _env_int("CIVITAI_TIMEOUT", 30)
CIVITAI_LORA_FOLDER: str = os.getenv("CIVITAI_LORA_FOLDER", "loras")
CIVITAI_CHECKPOINT_FOLDER: str = os.getenv(
    "CIVITAI_CHECKPOINT_FOLDER", "checkpoints"
)
CIVITAI_DIFFUSION_FOLDER: str = os.getenv(
    "CIVITAI_DIFFUSION_FOLDER", "diffusion_models"
)
CIVITAI_ANIMA_PATTERNS: str = os.getenv(
    "CIVITAI_ANIMA_PATTERNS",
    "anima,animaxl,aam xl anim anima",
)

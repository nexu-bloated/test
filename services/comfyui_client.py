# services/comfyui_client.py
"""HTTP client for a remote ComfyUI instance.

All network I/O to ComfyUI is funnelled through this module so that
routes never touch ``requests`` directly.  A shared ``Session`` with
connection pooling and automatic retries is used for every call.
"""

from __future__ import annotations

import logging
import time
import urllib.parse
from typing import Any, Dict, List, Optional, Tuple

import requests
from requests.adapters import HTTPAdapter

import config

logger = logging.getLogger(__name__)

# ── Shared session with pooling ──────────────────────────────────────
_session = requests.Session()
_adapter = HTTPAdapter(pool_connections=10, pool_maxsize=20, max_retries=2)
_session.mount("http://", _adapter)
_session.mount("https://", _adapter)

_HEADERS = {
    "Bypass-Tunnel-Reminder": "true",
    "User-Agent": "Nexus-AI-App/2.1",
}

# ── /object_info cache ───────────────────────────────────────────────
_object_info_cache: Dict[str, Tuple[float, dict]] = {}


class ComfyUIError(Exception):
    """Raised when ComfyUI returns an error or is unreachable."""

    def __init__(self, message: str, status_code: int = 502):
        super().__init__(message)
        self.status_code = status_code


def _url(base: str, path: str) -> str:
    return f"{base.rstrip('/')}{path}"

def invalidate_object_info_cache(base_url: str) -> None:
    """Remove the cached /object_info entry for a given base URL."""
    base_url = _validate_base_url(base_url)
    _object_info_cache.pop(base_url, None)

def _validate_base_url(base_url: str) -> str:
    """Return a cleaned base URL or raise."""
    base_url = (base_url or "").strip().rstrip("/")
    if not base_url:
        base_url = config.COMFYUI_BASE_URL
    if not base_url:
        raise ComfyUIError("No ComfyUI / tunnel URL configured.", 400)
    parsed = urllib.parse.urlparse(base_url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise ComfyUIError("Invalid ComfyUI URL.", 400)
    return base_url


# ── Object info (cached) ─────────────────────────────────────────────

def get_object_info(base_url: str) -> dict:
    """Fetch and cache ``/object_info`` for *base_url*."""
    base_url = _validate_base_url(base_url)
    now = time.time()
    cached = _object_info_cache.get(base_url)
    if cached and (now - cached[0]) < config.OBJECT_INFO_CACHE_TTL:
        return cached[1]

    try:
        resp = _session.get(
            _url(base_url, "/object_info"),
            headers=_HEADERS,
            timeout=config.COMFYUI_TIMEOUT,
        )
        resp.raise_for_status()
        data = resp.json()
    except requests.exceptions.Timeout:
        raise ComfyUIError("Connection to ComfyUI timed out.", 504)
    except requests.exceptions.ConnectionError:
        raise ComfyUIError("Cannot connect to ComfyUI.", 502)
    except Exception as exc:
        raise ComfyUIError(f"Failed to fetch object_info: {exc}", 500)

    _object_info_cache[base_url] = (now, data)
    return data


def _extract_options(info: dict, node_class: str, field: str) -> List[str]:
    """Pull a list of option strings out of the object_info tree."""
    return (
        info.get(node_class, {})
        .get("input", {})
        .get("required", {})
        .get(field, [[]])[0]
    )


def get_checkpoints(base_url: str) -> List[str]:
    info = get_object_info(base_url)
    # Keep diffusion-model/UNET choices first for existing workflows, while
    # also exposing conventional checkpoint files downloaded to checkpoints/.
    values = _extract_options(info, "UNETLoader", "unet_name")
    values.extend(_extract_options(info, "CheckpointLoaderSimple", "ckpt_name"))
    return list(dict.fromkeys(values))


def get_loras(base_url: str) -> List[str]:
    return _extract_options(get_object_info(base_url), "LoraLoader", "lora_name")


def get_vaes(base_url: str) -> List[str]:
    return _extract_options(get_object_info(base_url), "VAELoader", "vae_name")


def get_clips(base_url: str) -> List[str]:
    return _extract_options(get_object_info(base_url), "CLIPLoader", "clip_name")


def get_samplers(base_url: str) -> Tuple[List[str], List[str]]:
    info = get_object_info(base_url)
    samplers = _extract_options(info, "KSamplerAdvanced", "sampler_name")
    schedulers = _extract_options(info, "KSamplerAdvanced", "scheduler")
    return samplers, schedulers


# ── Prompt submission ────────────────────────────────────────────────

def submit_prompt(base_url: str, workflow: dict, client_id: str = "nexus_ui") -> dict:
    """POST a workflow graph to ``/prompt`` and return the JSON reply."""
    base_url = _validate_base_url(base_url)
    payload = {"prompt": workflow, "client_id": client_id}
    try:
        resp = _session.post(
            _url(base_url, "/prompt"),
            json=payload,
            headers=_HEADERS,
            timeout=config.COMFYUI_TIMEOUT,
        )
        resp.raise_for_status()
        return resp.json()
    except requests.exceptions.Timeout:
        raise ComfyUIError("Generation request timed out.", 504)
    except requests.exceptions.ConnectionError:
        raise ComfyUIError("Lost connection to ComfyUI tunnel.", 502)
    except Exception as exc:
        raise ComfyUIError(f"Prompt submission failed: {exc}", 500)


# ── History ──────────────────────────────────────────────────────────

def get_history(base_url: str) -> dict:
    base_url = _validate_base_url(base_url)
    try:
        resp = _session.get(
            _url(base_url, "/history"),
            headers=_HEADERS,
            timeout=config.COMFYUI_TIMEOUT,
        )
        resp.raise_for_status()
        return resp.json()
    except requests.exceptions.Timeout:
        raise ComfyUIError("History fetch timed out.", 504)
    except Exception as exc:
        raise ComfyUIError(f"History fetch failed: {exc}", 500)


# ── Queue ────────────────────────────────────────────────────────────

def get_queue(base_url: str) -> dict:
    base_url = _validate_base_url(base_url)
    try:
        resp = _session.get(
            _url(base_url, "/queue"),
            headers=_HEADERS,
            timeout=config.COMFYUI_CONNECT_TIMEOUT,
        )
        resp.raise_for_status()
        return resp.json()
    except Exception as exc:
        raise ComfyUIError(f"Queue fetch failed: {exc}", 500)


# ── Image proxy ──────────────────────────────────────────────────────

def proxy_image(
    base_url: str,
    filename: str,
    subfolder: str = "",
    img_type: str = "output",
) -> requests.Response:
    """Stream an image from ComfyUI's ``/view`` endpoint."""
    base_url = _validate_base_url(base_url)
    if not filename or ".." in filename or "/" in filename or "\\" in filename:
        raise ComfyUIError("Invalid filename.", 400)

    img_url = (
        f"{base_url}/view?"
        f"filename={urllib.parse.quote(filename)}"
        f"&type={urllib.parse.quote(img_type)}"
        f"&subfolder={urllib.parse.quote(subfolder)}"
    )
    try:
        resp = _session.get(
            img_url, headers=_HEADERS, stream=True, timeout=config.COMFYUI_TIMEOUT
        )
        resp.raise_for_status()
        return resp
    except Exception as exc:
        raise ComfyUIError(f"Image proxy failed: {exc}", 500)


# ── Health ───────────────────────────────────────────────────────────

def health_check(base_url: str) -> bool:
    """Return True if ComfyUI responds to ``/object_info`` quickly."""
    try:
        get_object_info(base_url)
        return True
    except ComfyUIError:
        return False

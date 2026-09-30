"""Nexus Civitai download nodes for ComfyUI.

Includes:
    - NexusCivitaiModelDownload
    - NexusCivitaiLoRADownload

Place this file in:
    ComfyUI/custom_nodes/nexus_civitai_nodes.py

Then restart ComfyUI.
"""

from __future__ import annotations

import os
import re
from pathlib import Path
from urllib.parse import urlparse, parse_qsl, urlencode, urlunparse

import folder_paths
import requests


# ---------------------------------------------------------------------------
# CIVITAI TOKEN
# ---------------------------------------------------------------------------
# Option 1:
#   Set environment variable CIVITAI_API_TOKEN before starting ComfyUI.
#
# Option 2:
#   Hardcode your token below.
#
# Example:
#   _CIVITAI_TOKEN = "your_real_civitai_token_here"
# ---------------------------------------------------------------------------

_CIVITAI_TOKEN = os.getenv("1a7289844a1b6086de77e3fa8f2dfa58", "").strip()

if not _CIVITAI_TOKEN:
    _CIVITAI_TOKEN = "1a7289844a1b6086de77e3fa8f2dfa58"

# If the placeholder is still there, treat it as empty.
if _CIVITAI_TOKEN == "PASTE_YOUR_CIVITAI_TOKEN_HERE":
    _CIVITAI_TOKEN = "1a7289844a1b6086de77e3fa8f2dfa58"


_ALLOWED_FOLDERS = {"loras", "checkpoints", "diffusion_models"}
_ALLOWED_EXTENSIONS = {".safetensors", ".pt", ".ckpt", ".bin"}


def _safe_filename(value: str) -> str:
    """Sanitize filename to prevent path traversal and invalid characters."""
    name = os.path.basename(str(value or "").replace("\\", "/"))
    name = re.sub(r'[\/*?:"<>|]', " ", name).strip().lstrip(".")

    if not name:
        raise ValueError("A valid file name is required.")

    path = Path(name)

    # If no extension was supplied, default to safetensors.
    if not path.suffix:
        name = f"{name}.safetensors"
        path = Path(name)

    if path.suffix.lower() not in _ALLOWED_EXTENSIONS:
        raise ValueError("Unsupported model file extension.")

    return name


def _is_civitai_url(url: str) -> bool:
    """Return True if URL is a valid http/https Civitai URL."""
    parsed = urlparse(str(url or ""))
    hostname = (parsed.hostname or "").lower()

    return (
        parsed.scheme in {"http", "https"}
        and (
            hostname == "civitai.com"
            or hostname.endswith(".civitai.com")
        )
    )


def _add_civitai_token(url: str) -> str:
    """Append Civitai token to URL if token is configured and not already present."""
    if not _CIVITAI_TOKEN:
        return url

    parsed = urlparse(url)
    query_items = parse_qsl(parsed.query, keep_blank_values=True)

    # Do not add another token parameter if one already exists.
    if any(key.lower() == "token" for key, _ in query_items):
        return url

    query_items.append(("token", _CIVITAI_TOKEN))

    return urlunparse(
        parsed._replace(
            query=urlencode(query_items)
        )
    )


def _download_civitai_file(
    download_url: str,
    file_name: str,
    overwrite: bool,
    target_folder: str,
    fallback_folder: str,
):
    """Shared Civitai download logic for both Model and LoRA nodes."""

    download_url = str(download_url or "").strip()

    if not _is_civitai_url(download_url):
        raise ValueError("Only Civitai http/https download URLs are supported.")

    target_folder = str(target_folder or fallback_folder).strip().lower()

    if target_folder not in _ALLOWED_FOLDERS:
        raise ValueError("Invalid target folder.")

    download_url = _add_civitai_token(download_url)

    filename = _safe_filename(file_name)

    model_dirs = folder_paths.get_folder_paths(target_folder)
    if not model_dirs:
        raise ValueError(f"ComfyUI has no '{target_folder}' model folder.")

    destination = Path(model_dirs[0]).resolve()
    destination.mkdir(parents=True, exist_ok=True)

    output = (destination / filename).resolve()

    if output.parent != destination:
        raise ValueError("Invalid destination path.")

    if output.exists() and not overwrite:
        return {
            "ui": {
                "nexus_civitai_download": [
                    {
                        "status": "already_exists",
                        "filename": filename,
                        "destination": target_folder,
                    }
                ]
            }
        }

    temp_output = output.with_suffix(output.suffix + ".part")

    headers = {
        "User-Agent": "ComfyUI-Nexus-Civitai-Downloader"
    }

    try:
        with requests.get(
            download_url,
            stream=True,
            timeout=(15, 600),
            headers=headers,
            allow_redirects=True,
        ) as response:
            if response.status_code in (401, 403):
                raise ValueError(
                    "Civitai returned 401/403. "
                    "The model may require login or your Civitai token is missing/invalid."
                )

            response.raise_for_status()

            with open(temp_output, "wb") as handle:
                for chunk in response.iter_content(chunk_size=1024 * 1024):
                    if chunk:
                        handle.write(chunk)

        os.replace(temp_output, output)

    finally:
        if temp_output.exists():
            temp_output.unlink()

    return {
        "ui": {
            "nexus_civitai_download": [
                {
                    "status": "completed",
                    "filename": filename,
                    "destination": target_folder,
                }
            ]
        }
    }


class NexusCivitaiModelDownload:
    """Download a checkpoint or other model from Civitai into a ComfyUI model folder."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "download_url": ("STRING", {"default": ""}),
                "file_name": ("STRING", {"default": "model.safetensors"}),
                "overwrite": ("BOOLEAN", {"default": False}),
                "model_type": ("STRING", {"default": "Checkpoint"}),
                "base_model": ("STRING", {"default": ""}),
                "target_folder": (
                    sorted(_ALLOWED_FOLDERS),
                    {"default": "checkpoints"},
                ),
            }
        }

    RETURN_TYPES = ()
    FUNCTION = "download"
    OUTPUT_NODE = True
    CATEGORY = "Nexus/Civitai"

    def download(
        self,
        download_url,
        file_name,
        overwrite,
        model_type=None,
        base_model=None,
        target_folder=None,
    ):
        try:
            return _download_civitai_file(
                download_url=download_url,
                file_name=file_name,
                overwrite=overwrite,
                target_folder=target_folder,
                fallback_folder="checkpoints",
            )
        except Exception as exc:
            return {
                "ui": {
                    "nexus_civitai_download": [
                        {
                            "status": "failed",
                            "filename": None,
                            "error": str(exc),
                        }
                    ]
                }
            }


class NexusCivitaiLoRADownload:
    """Download a LoRA from Civitai into the ComfyUI loras folder."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "download_url": ("STRING", {"default": ""}),
                "file_name": ("STRING", {"default": "lora.safetensors"}),
                "overwrite": ("BOOLEAN", {"default": False}),
            },
            "optional": {
                "model_type": ("STRING", {"default": "LoRA"}),
                "base_model": ("STRING", {"default": ""}),
                "target_folder": (
                    sorted(_ALLOWED_FOLDERS),
                    {"default": "loras"},
                ),
            },
        }

    RETURN_TYPES = ()
    FUNCTION = "download"
    OUTPUT_NODE = True
    CATEGORY = "Nexus/Civitai"

    def download(
        self,
        download_url,
        file_name,
        overwrite,
        model_type=None,
        base_model=None,
        target_folder=None,
    ):
        try:
            return _download_civitai_file(
                download_url=download_url,
                file_name=file_name,
                overwrite=overwrite,
                target_folder=target_folder,
                fallback_folder="loras",
            )
        except Exception as exc:
            return {
                "ui": {
                    "nexus_civitai_download": [
                        {
                            "status": "failed",
                            "filename": None,
                            "error": str(exc),
                        }
                    ]
                }
            }


NODE_CLASS_MAPPINGS = {
    "NexusCivitaiModelDownload": NexusCivitaiModelDownload,
    "NexusCivitaiLoRADownload": NexusCivitaiLoRADownload,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "NexusCivitaiModelDownload": "Nexus Civitai Model Download",
    "NexusCivitaiLoRADownload": "Nexus Civitai LoRA Download",
}

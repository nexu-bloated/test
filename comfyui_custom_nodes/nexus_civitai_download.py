"""Destination-aware Civitai downloader for ComfyUI.
Includes both NexusCivitaiModelDownload and NexusCivitaiLoRADownload.
Install this file under custom_nodes, then restart ComfyUI.
"""
from __future__ import annotations
import os
import re
from pathlib import Path
from urllib.parse import urlparse
import folder_paths
import requests

_ALLOWED_FOLDERS = {"loras", "checkpoints", "diffusion_models"}
_ALLOWED_EXTENSIONS = {".safetensors", ".pt", ".ckpt", ".bin"}

def _safe_filename(value: str) -> str:
    # basename plus a restrictive character filter prevents traversal on all OSes.
    name = os.path.basename(str(value or "").replace("\\", "/"))
    name = re.sub(r'[\/*?:"<>|]', " ", name).strip().lstrip(".")
    if not name:
        raise ValueError("A valid file name is required.")
    if Path(name).suffix.lower() not in _ALLOWED_EXTENSIONS:
        raise ValueError("Unsupported model file extension.")
    return name

def _download_civitai_file(download_url, file_name, overwrite, target_folder, ui_key):
    """Shared logic for downloading files safely from Civitai."""
    if target_folder not in _ALLOWED_FOLDERS:
        raise ValueError("Invalid target folder.")

    parsed = urlparse(str(download_url or ""))
    hostname = (parsed.hostname or "").lower()
    if parsed.scheme not in {"http", "https"} or not (
        hostname == "civitai.com" or hostname.endswith(".civitai.com")
    ):
        raise ValueError("Only Civitai download URLs are supported.")

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
        return {"ui": {ui_key: [{
            "status": "already_exists", "filename": filename,
            "destination": target_folder,
        }]}}

    temp_output = output.with_suffix(output.suffix + ".part")
    try:
        with requests.get(download_url, stream=True, timeout=(15, 600)) as response:
            response.raise_for_status()
            with open(temp_output, "wb") as handle:
                for chunk in response.iter_content(chunk_size=1024 * 1024):
                    if chunk:
                        handle.write(chunk)
        os.replace(temp_output, output)
    finally:
        if temp_output.exists():
            temp_output.unlink()

    return {"ui": {ui_key: [{
        "status": "completed", "filename": filename,
        "destination": target_folder,
    }]}}


class NexusCivitaiModelDownload:
    """Download a checkpoint or other model to an approved ComfyUI model folder."""
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "download_url": ("STRING", {"default": ""}),
                "file_name": ("STRING", {"default": "model.safetensors"}),
                "overwrite": ("BOOLEAN", {"default": False}),
                "model_type": ("STRING", {"default": "Checkpoint"}),
                "base_model": ("STRING", {"default": ""}),
                "target_folder": (sorted(_ALLOWED_FOLDERS), {"default": "checkpoints"}),
            }
        }

    RETURN_TYPES = ()
    FUNCTION = "download"
    OUTPUT_NODE = True
    CATEGORY = "Nexus/Civitai"

    def download(self, download_url, file_name, overwrite, model_type, base_model, target_folder):
        try:
            return _download_civitai_file(download_url, file_name, overwrite, target_folder, "nexus_civitai_download")
        except Exception as exc:
            return {"ui": {"nexus_civitai_download": [{
                "status": "failed", "filename": None, "error": str(exc),
            }]}}


class NexusCivitaiLoRADownload:
    """Download a LoRA to the ComfyUI loras folder."""
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "download_url": ("STRING", {"default": ""}),
                "file_name": ("STRING", {"default": "lora.safetensors"}),
                "overwrite": ("BOOLEAN", {"default": False}),
                "model_type": ("STRING", {"default": "LoRA"}),
                "base_model": ("STRING", {"default": ""}),
                "target_folder": (sorted(_ALLOWED_FOLDERS), {"default": "loras"}),
            }
        }

    RETURN_TYPES = ()
    FUNCTION = "download"
    OUTPUT_NODE = True
    CATEGORY = "Nexus/Civitai"

    def download(self, download_url, file_name, overwrite, model_type, base_model, target_folder):
        try:
            return _download_civitai_file(download_url, file_name, overwrite, target_folder, "nexus_civitai_lora_download")
        except Exception as exc:
            return {"ui": {"nexus_civitai_lora_download": [{
                "status": "failed", "filename": None, "error": str(exc),
            }]}}


# Node Mappings
NODE_CLASS_MAPPINGS = {
    "NexusCivitaiModelDownload": NexusCivitaiModelDownload,
    "NexusCivitaiLoRADownload": NexusCivitaiLoRADownload,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "NexusCivitaiModelDownload": "Nexus Civitai Model Download",
    "NexusCivitaiLoRADownload": "Nexus Civitai LoRA Download",
}

"""Flask Blueprint – all HTTP endpoints for the Nexus AI frontend.

Every response uses the envelope::

    {"ok": true,  "data": {…}}   on success
    {"ok": false, "error": "…"}  on failure

The frontend (static/js/api.js) is the only intended consumer.
"""
from __future__ import annotations

import logging
import os
import random
import re
import urllib.parse
from typing import Any, Dict, List

import requests
from flask import Blueprint, Response, jsonify, render_template, request

import config
from services import comfyui_client as comfy
from services.comfyui_client import ComfyUIError
from workflows import get_workflow

logger = logging.getLogger(__name__)

api_bp = Blueprint("api", __name__)


# ── LoRA tag parsing (Anima 2.9B) ───────────────────────────────────
# Matches tags like:  <lora:name:0.8>  or  <lora:name:0.8:0.5>
ANIMA_LORA_TAG_RE = re.compile(
    r"<lora:([^<>:\r\n]+):(-?\d+(?:\.\d+)?)(?::(-?\d+(?:\.\d+)?))?>",
    re.IGNORECASE,
)


# ── helpers ──────────────────────────────────────────────────────────
def _ok(data: Any = None, status: int = 200):
    return jsonify({"ok": True, "data": data or {}}), status


def _err(message: str, status: int = 400):
    return jsonify({"ok": False, "error": message}), status


def _tunnel_url() -> str:
    """Extract and validate the tunnel URL from the JSON body.

    Falls back to ``config.COMFYUI_BASE_URL`` when the client does not
    supply one, mirroring the original behaviour so existing endpoints
    keep working.
    """
    data = request.json or {}
    url = (data.get("tunnel_url") or "").strip().rstrip("/")
    if not url:
        url = config.COMFYUI_BASE_URL
    return url


def _configured_civitai_folder(setting: str, fallback: str) -> str:
    """Return only a ComfyUI model-folder name, never an arbitrary path."""
    allowed = {"loras", "checkpoints", "diffusion_models"}
    value = str(getattr(config, setting, fallback) or "").strip()
    return value if value in allowed else fallback


def _resolve_civitai_target_folder(data: dict) -> str:
    """Choose the safe remote ComfyUI destination for a Civitai model."""
    model_type = str(
        data.get("model_type") or data.get("civitai_type") or data.get("type") or ""
    ).lower()

    lora_folder = _configured_civitai_folder("CIVITAI_LORA_FOLDER", "loras")

    if any(kind in model_type for kind in ("lora", "locon", "lycoris", "dora")):
        return lora_folder

    if "checkpoint" not in model_type:
        return lora_folder

    tags = data.get("tags", "")
    if isinstance(tags, (list, tuple)):
        tags = " ".join(str(tag) for tag in tags)

    haystack = " ".join(
        str(data.get(key) or "")
        for key in (
            "base_model",
            "model_name",
            "version_name",
            "file_name",
            "destination_hint",
        )
    )
    haystack = f"{haystack} {tags}".lower()

    patterns = [
        pattern.strip().lower()
        for pattern in str(getattr(config, "CIVITAI_ANIMA_PATTERNS", "anima")).split(",")
        if pattern.strip()
    ]

    if any(pattern in haystack for pattern in patterns):
        return _configured_civitai_folder("CIVITAI_DIFFUSION_FOLDER", "diffusion_models")

    return _configured_civitai_folder("CIVITAI_CHECKPOINT_FOLDER", "checkpoints")


def proxy_image(tunnel_url: str, filename: str, subfolder: str, img_type: str):
    """Proxy an image from ComfyUI.

    Query params are URL-encoded so special characters in generated
    filenames (e.g. the literal ``%`` from a ``%date:yyyyMMdd%`` prefix)
    do not corrupt the request to ComfyUI.
    """
    params = urllib.parse.urlencode(
        {
            "filename": filename,
            "subfolder": subfolder,
            "type": img_type,
        }
    )
    url = f"{tunnel_url.rstrip('/')}/view?{params}"

    try:
        resp = requests.get(
            url,
            stream=True,
            timeout=getattr(config, "COMFYUI_TIMEOUT", 30),
        )
    except requests.RequestException as exc:
        raise ComfyUIError(f"Could not fetch image: {exc}", 502)

    if not resp.ok:
        raise ComfyUIError(
            f"ComfyUI image request failed (HTTP {resp.status_code}).",
            resp.status_code,
        )

    return resp


@api_bp.after_request
def _cache_headers(response: Response) -> Response:
    """Make API JSON responses non-cacheable, except proxied images."""
    if request.path == "/api/image":
        return response
    response.headers.setdefault("Cache-Control", "no-store")
    return response


# ── pages ────────────────────────────────────────────────────────────
@api_bp.route("/")
def index():
    return render_template("index.html")


# ── health / config ──────────────────────────────────────────────────
@api_bp.route("/api/health", methods=["GET"])
def health():
    tunnel = request.args.get("tunnel_url", "").strip().rstrip("/")
    if not tunnel:
        tunnel = config.COMFYUI_BASE_URL
    alive = comfy.health_check(tunnel) if tunnel else False
    return _ok({"backend": True, "comfyui": alive, "tunnel": bool(tunnel)})


@api_bp.route("/api/config", methods=["GET"])
def frontend_config():
    """Expose safe defaults so the frontend can pre-fill the form."""
    return _ok(
        {
            # ── NEW: engine-mode metadata for Anima Base / Anima 2.9B ──
            "available_workflows": ["anima", "anima_2_9"],
            "model_modes": {
                "anima": {
                    "label": "Anima Base",
                    "checkpoint": config.DEFAULT_CHECKPOINT,
                    "sampler": config.DEFAULT_SAMPLER,
                    "scheduler": config.DEFAULT_SCHEDULER,
                    "cfg": config.DEFAULT_CFG,
                    "vae": config.DEFAULT_VAE,
                    "clip": config.DEFAULT_CLIP,
                },
                "anima_2_9": {
                    "label": "Anima 2.9B",
                    "checkpoint": getattr(
                        config,
                        "DEFAULT_ANIMA_2_9_CHECKPOINT",
                        "anima29B_v10_int8.safetensors",
                    ),
                    "sampler": getattr(config, "DEFAULT_ANIMA_2_9_SAMPLER", "er_sde"),
                    "scheduler": "simple",
                    "cfg": getattr(config, "DEFAULT_ANIMA_2_9_CFG", 4.0),
                    "vae": "qwen_image_vae.safetensors",
                    "clip": "qwen_3_06b_base.safetensors",
                },
            },
            # ── original defaults (kept intact) ──
            "default_checkpoint": config.DEFAULT_CHECKPOINT,
            "default_vae": config.DEFAULT_VAE,
            "default_clip": config.DEFAULT_CLIP,
            "default_sampler": config.DEFAULT_SAMPLER,
            "default_scheduler": config.DEFAULT_SCHEDULER,
            "default_steps": config.DEFAULT_STEPS,
            "default_cfg": config.DEFAULT_CFG,
            "default_width": config.DEFAULT_WIDTH,
            "default_height": config.DEFAULT_HEIGHT,
            "default_batch_size": config.DEFAULT_BATCH_SIZE,
            "default_batch_count": config.DEFAULT_BATCH_COUNT,
            "default_hires_scale": config.DEFAULT_HIRES_SCALE,
            "default_hires_steps": config.DEFAULT_HIRES_STEPS,
            "default_hires_cfg": config.DEFAULT_HIRES_CFG,
            "default_hires_sampler": config.DEFAULT_HIRES_SAMPLER,
            "default_hires_denoise": config.DEFAULT_HIRES_DENOISE,
            "default_hires_sharpen_sigma": config.DEFAULT_HIRES_SHARPEN_SIGMA,
            "active_workflow": config.ACTIVE_WORKFLOW,
            "max_steps": config.MAX_STEPS,
            "max_cfg": config.MAX_CFG,
            "max_batch_size": config.MAX_BATCH_SIZE,
            "max_batch_count": config.MAX_BATCH_COUNT,
            "max_loras": config.MAX_LORAS,
        }
    )


# ── model discovery ──────────────────────────────────────────────────
@api_bp.route("/api/checkpoints", methods=["POST"])
def checkpoints():
    try:
        url = _tunnel_url()
        data = request.json or {}
        if bool(data.get("refresh", False)):
            comfy.invalidate_object_info_cache(url)
        return _ok({"checkpoints": comfy.get_checkpoints(url)})
    except ComfyUIError as exc:
        return _err(str(exc), exc.status_code)


@api_bp.route("/api/loras", methods=["POST"])
def loras():
    try:
        url = _tunnel_url()
        data = request.json or {}
        # Force cache bypass when refresh=true
        if bool(data.get("refresh", False)):
            comfy.invalidate_object_info_cache(url)
        return _ok({"loras": comfy.get_loras(url)})
    except ComfyUIError as exc:
        return _err(str(exc), exc.status_code)


@api_bp.route("/api/vaes", methods=["POST"])
def vaes():
    try:
        url = _tunnel_url()
        return _ok({"vaes": comfy.get_vaes(url)})
    except ComfyUIError as exc:
        return _err(str(exc), exc.status_code)


@api_bp.route("/api/clips", methods=["POST"])
def clips():
    try:
        url = _tunnel_url()
        return _ok({"clips": comfy.get_clips(url)})
    except ComfyUIError as exc:
        return _err(str(exc), exc.status_code)


@api_bp.route("/api/samplers", methods=["POST"])
def samplers():
    try:
        url = _tunnel_url()
        s, sc = comfy.get_samplers(url)
        return _ok({"samplers": s, "schedulers": sc})
    except ComfyUIError as exc:
        return _err(str(exc), exc.status_code)


# ── generation ───────────────────────────────────────────────────────
@api_bp.route("/api/generate", methods=["POST"])
def generate():
    data = request.json or {}

    tunnel_url = (data.get("tunnel_url") or "").strip().rstrip("/")
    if not tunnel_url:
        tunnel_url = config.COMFYUI_BASE_URL
    if not tunnel_url:
        return _err("Valid Tunnel URL is required.", 400)

    client_id = data.get("client_id", "nexus_ui")

    try:
        # NEW: per-request workflow selection.
        # Falls back to config.ACTIVE_WORKFLOW when nothing is supplied.
        requested_workflow = (
            data.get("workflow_name") or data.get("model_mode") or ""
        ).strip().lower()

        wf = get_workflow(requested_workflow or None)
        params = wf.prepare(data)

        batch_count: int = params["batch_count"]
        seed_mode: str = params["seed_mode"]
        base_seed: int = params["seed"]

        all_results: List[dict] = []
        for batch_idx in range(batch_count):
            if seed_mode == "increment":
                current_seed = base_seed + batch_idx
            elif seed_mode == "fixed":
                current_seed = base_seed
            else:
                current_seed = random.randint(1, 10**12)

            params["seed"] = current_seed
            workflow_graph = wf.build_workflow(params)
            result = comfy.submit_prompt(tunnel_url, workflow_graph, client_id)
            all_results.append(result)

        return _ok({"results": all_results, "seed_used": base_seed})

    except ComfyUIError as exc:
        return _err(str(exc), exc.status_code)
    except ValueError as exc:
        return _err(str(exc), 400)
    except Exception as exc:
        logger.exception("Unexpected generation error")
        return _err(f"Generation failed: {exc}", 500)


# ── history ──────────────────────────────────────────────────────────
@api_bp.route("/api/history", methods=["POST"])
def history():
    try:
        url = _tunnel_url()
        raw = comfy.get_history(url)

        images: List[dict] = []
        for prompt_id, entry in reversed(list(raw.items())):
            outputs = entry.get("outputs", {})
            workflow_cfg = entry.get("prompt", [None, None, {}])[2]

            meta: Dict[str, Any] = {
                "seed": 0,
                "steps": 20,
                "cfg": 4.5,
                "width": 1152,
                "height": 896,
                "pos": "",
                "neg": "",
                "ckpt": "",
                "loras": [],
                "sampler": "euler_ancestral",
                "scheduler": "simple",
                "prompt_id": prompt_id,
                # NEW: lets the frontend restore the engine mode on remix.
                "workflow_name": "",
            }

            if isinstance(workflow_cfg, dict):
                for node in workflow_cfg.values():
                    c_type = node.get("class_type")
                    inputs = node.get("inputs", {})

                    if c_type == "KSamplerAdvanced":
                        meta["seed"] = inputs.get("noise_seed", meta["seed"])
                        meta["steps"] = inputs.get("steps", meta["steps"])
                        meta["cfg"] = inputs.get("cfg", meta["cfg"])
                        meta["sampler"] = inputs.get("sampler_name", meta["sampler"])
                        meta["scheduler"] = inputs.get("scheduler", meta["scheduler"])

                    elif c_type == "EmptyLatentImage":
                        meta["width"] = inputs.get("width", meta["width"])
                        meta["height"] = inputs.get("height", meta["height"])

                    # NEW: Anima 2.9B latent node.
                    elif c_type == "AnimaLatentImage":
                        meta["width"] = inputs.get("width", meta["width"])
                        meta["height"] = inputs.get("height", meta["height"])

                    elif c_type == "CLIPTextEncode":
                        if not meta["pos"]:
                            meta["pos"] = inputs.get("text", "")
                        else:
                            meta["neg"] = inputs.get("text", "")

                    elif c_type == "UNETLoader":
                        meta["ckpt"] = inputs.get("unet_name", "")

                    # NEW: Anima 2.9B booster loader carries the checkpoint.
                    elif c_type == "AnimaBoosterLoader":
                        meta["ckpt"] = inputs.get("model_name", "")

                    elif c_type == "LoraLoader":
                        meta["loras"].append(
                            {
                                "name": inputs.get("lora_name", ""),
                                "weight": inputs.get("strength_model", 1.0),
                            }
                        )

                    # NEW: Anima 2.9B LoRA tag loader.
                    elif c_type == "AnimaLoRARemapTagLoader":
                        meta["workflow_name"] = "anima_2_9"
                        text = str(inputs.get("text", ""))
                        for match in ANIMA_LORA_TAG_RE.finditer(text):
                            name = match.group(1).strip()
                            try:
                                weight = float(match.group(2)) if match.group(2) else 1.0
                            except (TypeError, ValueError):
                                weight = 1.0
                            try:
                                clip_weight = (
                                    float(match.group(3)) if match.group(3) else weight
                                )
                            except (TypeError, ValueError):
                                clip_weight = weight
                            if name:
                                meta["loras"].append(
                                    {
                                        "name": name,
                                        "weight": weight,
                                        "clip_weight": clip_weight,
                                    }
                                )

            for output in outputs.values():
                if "images" in output:
                    for img in output["images"]:
                        if img.get("type") == "output":
                            images.append(
                                {
                                    "filename": img["filename"],
                                    "subfolder": img.get("subfolder", ""),
                                    "type": img["type"],
                                    "meta": meta,
                                }
                            )

        return _ok({"images": images})

    except ComfyUIError as exc:
        return _err(str(exc), exc.status_code)
    except Exception as exc:
        logger.exception("History error")
        return _err(f"History fetch failed: {exc}", 500)


# ── image proxy ──────────────────────────────────────────────────────
@api_bp.route("/api/image", methods=["GET"])
def image_proxy():
    tunnel_url = request.args.get("tunnel_url", "").strip().rstrip("/")
    filename = request.args.get("filename", "")
    subfolder = request.args.get("subfolder", "")
    img_type = request.args.get("type", "output")

    if not tunnel_url:
        tunnel_url = config.COMFYUI_BASE_URL
    if not tunnel_url:
        return _err("No tunnel URL.", 400)
    if not filename:
        return _err("Filename required.", 400)

    try:
        resp = proxy_image(tunnel_url, filename, subfolder, img_type)

        headers = {
            # Generated images are immutable. Cache aggressively.
            "Cache-Control": "public, max-age=86400, immutable",
        }
        # Pass through useful caching/streaming metadata when present.
        for header in ("Content-Length", "ETag", "Last-Modified", "Accept-Ranges"):
            value = resp.headers.get(header)
            if value:
                headers[header] = value

        return Response(
            resp.iter_content(chunk_size=8192),
            content_type=resp.headers.get("Content-Type", "image/png"),
            headers=headers,
        )
    except ComfyUIError as exc:
        return _err(str(exc), exc.status_code)


# ── queue ────────────────────────────────────────────────────────────
@api_bp.route("/api/queue", methods=["POST"])
def queue():
    try:
        url = _tunnel_url()
        q = comfy.get_queue(url)

        running = len(q.get("queue_running", []))
        pending = len(q.get("queue_pending", []))
        return _ok({"running": running, "pending": pending})
    except ComfyUIError as exc:
        return _err(str(exc), exc.status_code)


# ── Civitai search ───────────────────────────────────────────────────
@api_bp.route("/api/civitai/search", methods=["GET"])
def civitai_search():
    """Proxy for Civitai model search."""
    try:
        limit = min(max(int(request.args.get("limit", 24) or 24), 1), 100)
    except ValueError:
        limit = 24

    params: List[tuple] = [("limit", limit)]

    for key in ("query", "username", "sort", "period", "cursor", "nsfw"):
        value = (request.args.get(key) or "").strip()
        if value:
            params.append((key, value))

    types = [t.strip() for t in request.args.getlist("types") if t.strip()]
    if not types:
        types = ["LORA"]
    for t in types:
        params.append(("types", t))

    base_models = [bm.strip() for bm in request.args.getlist("baseModels") if bm.strip()]
    for bm in base_models:
        params.append(("baseModels", bm))

    # Handle multiple tags
    tags = [t.strip() for t in request.args.getlist("tag") if t.strip()]
    for t in tags:
        params.append(("tag", t))

    headers = None
    token = getattr(config, "CIVITAI_API_TOKEN", "").strip()
    if token:
        headers = {"Authorization": f"Bearer {token}"}

    civitai_base = getattr(config, "CIVITAI_API_BASE", "https://civitai.com/api/v1").rstrip("/")

    try:
        upstream = requests.get(
            f"{civitai_base}/models",
            params=params,
            headers=headers,
            timeout=getattr(config, "CIVITAI_TIMEOUT", 30),
        )
    except requests.RequestException as exc:
        return _err(f"Could not reach Civitai: {exc}", 502)

    try:
        payload = upstream.json()
    except ValueError:
        return _err("Civitai returned invalid JSON.", 502)

    if not upstream.ok:
        message = payload.get("error") if isinstance(payload, dict) else None
        return _err(
            message or f"Civitai request failed (HTTP {upstream.status_code}).",
            upstream.status_code,
        )

    return _ok(payload)


@api_bp.route("/api/civitai/download", methods=["POST"])
def civitai_download():
    data = request.json or {}

    tunnel_url = (data.get("tunnel_url") or "").strip().rstrip("/")
    download_url = (data.get("download_url") or "").strip()
    fallback_url = (data.get("fallback_download_url") or "").strip()
    file_name = (data.get("file_name") or "").strip()
    overwrite = bool(data.get("overwrite", False))
    model_type = (data.get("model_type") or data.get("civitai_type") or "").strip()
    base_model = (data.get("base_model") or "").strip()
    target_folder = _resolve_civitai_target_folder(data)

    if not tunnel_url:
        return _err("tunnel_url is required.", 400)
    if not download_url and not fallback_url:
        return _err("download_url is required.", 400)

    url_to_use = download_url or fallback_url

    # Normalize relative URLs
    if url_to_use.startswith("/"):
        url_to_use = f"https://civitai.com{url_to_use}"

    # Basic validation: must be civitai
    parsed = urllib.parse.urlparse(url_to_use)
    hostname = (parsed.hostname or "").lower()
    if hostname != "civitai.com" and not hostname.endswith(".civitai.com"):
        return _err("Only Civitai download URLs are supported.", 400)

    # Sanitize file_name
    if not file_name:
        model_name = (data.get("model_name") or "civitai_lora").strip()
        file_name = re.sub(r"[^\w\-_\. ]", "_", model_name) + ".safetensors"

    file_name = os.path.basename(file_name)
    file_name = re.sub(r'[\\/*?:"<>|]', "", file_name)

    allowed_exts = [".safetensors", ".pt", ".ckpt", ".bin"]
    ext = os.path.splitext(file_name)[1].lower()
    if ext not in allowed_exts:
        if not ext:
            file_name += ".safetensors"
        else:
            return _err(f"Disallowed file extension: {ext}", 400)

    is_lora = any(
        kind in model_type.lower() for kind in ("lora", "locon", "lycoris", "dora")
    )

    # Preserve the established LoRA prompt exactly. Checkpoints require the
    # destination-aware node installed on the remote ComfyUI instance.
    if is_lora or not model_type:
        prompt = {
            "1": {
                "class_type": "NexusCivitaiLoRADownload",
                "inputs": {
                    "download_url": url_to_use,
                    "file_name": file_name,
                    "overwrite": overwrite,
                    "model_type": model_type or "LoRA",
                    "base_model": base_model,
                    "target_folder": target_folder,
                },
            }
        }
    else:
        prompt = {
            "1": {
                "class_type": "NexusCivitaiModelDownload",
                "inputs": {
                    "download_url": url_to_use,
                    "file_name": file_name,
                    "overwrite": overwrite,
                    "model_type": model_type or "Checkpoint",
                    "base_model": base_model,
                    "target_folder": target_folder,
                },
            }
        }

    payload = {"prompt": prompt}

    try:
        resp = requests.post(f"{tunnel_url}/prompt", json=payload, timeout=15)
    except requests.RequestException as exc:
        return _err(f"Could not reach ComfyUI tunnel: {exc}", 502)

    if not resp.ok:
        if resp.status_code == 400 and "NexusCivitaiModelDownload" in resp.text:
            return _err(
                "Checkpoint download node is not installed on the remote ComfyUI machine.",
                400,
            )
        if resp.status_code == 400 and "NexusCivitaiLoRADownload" in resp.text:
            return _err("Download node is not installed on the remote ComfyUI machine.", 400)
        return _err(f"ComfyUI rejected the prompt: {resp.text[:200]}", 502)

    try:
        result = resp.json()
    except ValueError:
        return _err("ComfyUI returned invalid JSON.", 502)

    prompt_id = result.get("prompt_id")
    if not prompt_id:
        return _err("ComfyUI did not return a prompt_id.", 502)

    return _ok(
        {
            "status": "queued",
            "prompt_id": prompt_id,
            "filename": file_name,
            "model_type": model_type,
            "target_folder": target_folder,
        }
    )


@api_bp.route("/api/civitai/download/status", methods=["GET"])
def civitai_download_status():
    tunnel_url = (request.args.get("tunnel_url") or "").strip().rstrip("/")
    prompt_id = (request.args.get("prompt_id") or "").strip()

    if not tunnel_url or not prompt_id:
        return _err("tunnel_url and prompt_id are required.", 400)

    try:
        hist_resp = requests.get(f"{tunnel_url}/history/{prompt_id}", timeout=10)
    except requests.RequestException:
        return _err("Could not reach ComfyUI tunnel.", 502)

    if hist_resp.ok:
        try:
            history = hist_resp.json()
        except ValueError:
            return _err("ComfyUI returned invalid JSON.", 502)

        if prompt_id in history:
            entry = history[prompt_id]
            status_info = entry.get("status", {})
            status_str = status_info.get("status_str", "unknown")

            if status_str == "success":
                outputs = entry.get("outputs", {})
                for node_id, node_out in outputs.items():
                    ui_data = node_out.get("ui", {})
                    if "nexus_civitai_download" in ui_data:
                        download_info = ui_data["nexus_civitai_download"][0]
                        return _ok(
                            {
                                "status": download_info.get("status", "completed"),
                                "prompt_id": prompt_id,
                                "filename": download_info.get("filename"),
                                "destination": download_info.get("destination"),
                                "error": None,
                            }
                        )
                return _ok(
                    {
                        "status": "completed",
                        "prompt_id": prompt_id,
                        "filename": None,
                        "error": None,
                    }
                )

            elif status_str == "error":
                msgs = status_info.get("messages", [])
                error_msg = "Download failed on remote machine."
                for msg in msgs:
                    if isinstance(msg, list) and len(msg) >= 2:
                        if isinstance(msg[1], dict) and "exception_message" in msg[1]:
                            error_msg = msg[1]["exception_message"]
                            break
                        elif isinstance(msg[1], str):
                            error_msg = msg[1]
                            break
                return _ok(
                    {
                        "status": "failed",
                        "prompt_id": prompt_id,
                        "filename": None,
                        "error": error_msg,
                    }
                )

    try:
        queue_resp = requests.get(f"{tunnel_url}/queue", timeout=10)
        if queue_resp.ok:
            queue_data = queue_resp.json()
            running = queue_data.get("queue_running", [])
            pending = queue_data.get("queue_pending", [])
            for item in running:
                if len(item) > 1 and item[1] == prompt_id:
                    return _ok(
                        {
                            "status": "running",
                            "prompt_id": prompt_id,
                            "filename": None,
                            "error": None,
                        }
                    )
            for item in pending:
                if len(item) > 1 and item[1] == prompt_id:
                    return _ok(
                        {
                            "status": "pending",
                            "prompt_id": prompt_id,
                            "filename": None,
                            "error": None,
                        }
                    )
    except requests.RequestException:
        pass

    return _ok(
        {
            "status": "not_found",
            "prompt_id": prompt_id,
            "filename": None,
            "error": None,
        }
    )


@api_bp.route("/api/loras/trigger-words", methods=["POST"])
def lora_trigger_words():
    data = request.json or {}
    url = _tunnel_url()
    name = (data.get("lora_name") or "").strip()

    if not url:
        return _err("tunnel_url is required.", 400)
    if not name:
        return _err("lora_name is required.", 400)

    try:
        resp = requests.post(
            f"{url}/nexus/lora_trigger_words",
            json={"lora_name": name},
            timeout=120,  # first call may SHA256 a big file
        )
    except requests.RequestException as exc:
        return _err(f"Could not reach ComfyUI tunnel: {exc}", 502)

    if resp.status_code in (404, 405):
        return _err(
            "Trigger-words node is not installed on the remote ComfyUI machine.",
            400,
        )

    try:
        body = resp.json()
    except ValueError:
        return _err("ComfyUI returned invalid JSON.", 502)

    if not resp.ok or body.get("ok") is False:
        return _err(body.get("error") or "Trigger word lookup failed.", 502)

    return _ok(
        {
            "trigger_words": body.get("trigger_words") or [],
            "source": body.get("source") or "unknown",
        }
    )

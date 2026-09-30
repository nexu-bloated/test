"""Concrete Anima workflow blueprint.
The node graph is a faithful refactor of the workflow that was
previously built inline inside the `/generate` route of the original
`app.py`.  Node IDs are preserved so that existing ComfyUI history
entries remain parseable.
If the Anima model architecture changes, edit this file only – the
routes and frontend are agnostic to the graph shape.
"""
from __future__ import annotations
import random
from typing import Any, Dict, List
import config
from workflows.workflow_blueprint import WorkflowBlueprint

class AnimaWorkflow(WorkflowBlueprint):
    """ComfyUI workflow builder for the Anima model variant.
    """
    # ── defaults ─────────────────────────────────────────────────────
    def get_default_params(self) -> Dict[str, Any]:
        return {
            "positive_prompt": "",
            "negative_prompt": "",
            "seed": 0,
            "seed_mode": "random",
            "steps": config.DEFAULT_STEPS,
            "cfg": config.DEFAULT_CFG,
            "width": config.DEFAULT_WIDTH,
            "height": config.DEFAULT_HEIGHT,
            "sampler_name": config.DEFAULT_SAMPLER,
            "scheduler": config.DEFAULT_SCHEDULER,
            "batch_size": config.DEFAULT_BATCH_SIZE,
            "batch_count": config.DEFAULT_BATCH_COUNT,
            "checkpoint": config.DEFAULT_CHECKPOINT,
            "vae": config.DEFAULT_VAE,
            "clip": config.DEFAULT_CLIP,
            "loras": [],
            "hires_enabled": False,
            "hires_scale": config.DEFAULT_HIRES_SCALE,
            "hires_steps": config.DEFAULT_HIRES_STEPS,
            "hires_cfg": config.DEFAULT_HIRES_CFG,
            "hires_sampler": config.DEFAULT_HIRES_SAMPLER,
            "hires_scheduler": config.DEFAULT_SCHEDULER,
            "hires_denoise": config.DEFAULT_HIRES_DENOISE,
            "hires_sharpen_radius": 2,
            "hires_sharpen_sigma": config.DEFAULT_HIRES_SHARPEN_SIGMA,
            "hires_sharpen_alpha": 1.0,
            "extra_params": {},
        }

    # ── graph ────────────────────────────────────────────────────────
    def build_workflow(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Build the full ComfyUI prompt graph for one seed.
        The caller (route layer) is responsible for iterating over
        ``batch_count`` and calling this method once per seed.
        """
        width: int = params["width"]
        height: int = params["height"]
        batch_size: int = params["batch_size"]
        seed: int = params["seed"]
        steps: int = params["steps"]
        cfg: float = params["cfg"]
        sampler_name: str = params["sampler_name"]
        scheduler: str = params["scheduler"]
        checkpoint: str = params["checkpoint"]
        vae_name: str = params["vae"]
        clip_name: str = params["clip"]
        pos_prompt: str = params["positive_prompt"]
        neg_prompt: str = params["negative_prompt"]
        loras: List[dict] = params.get("loras", [])

        # ── static loader nodes ──────────────────────────────────────
        workflow: Dict[str, Any] = {
            # Replaced EmptyLatentImage with AnimaLatentImage to ensure correct patch grid alignment (divisible by 16)
            "244": {
                "class_type": "AnimaLatentImage",
                "inputs": {
                    "preset": "Custom",
                    "width": width,
                    "height": height,
                    "batch_size": batch_size,
                },
            },
            "238:210": {
                "class_type": "VAELoader",
                "inputs": {"vae_name": vae_name},
            },
            "238:209": {
                "class_type": "CLIPLoader",
                "inputs": {
                    "clip_name": clip_name,
                    "type": "stable_diffusion",
                    "device": "default",
                },
            },
            # Replaced UNETLoader with AnimaBoosterLoader for T4 optimizations (SageAttention & Torch Compile)
            "238:208": {
                "class_type": "AnimaBoosterLoader",
                "inputs": {
                    "model_name": checkpoint,
                    "sage_attention": "auto",
                    "torch_compile": True,
                },
            },
        }

        # ── dynamic LoRA chain ───────────────────────────────────────
        last_model_node = "238:208"
        last_model_idx = 0
        last_clip_node = "238:209"
        last_clip_idx = 0

        for i, lora in enumerate(loras):
            node_id = str(100 + i)
            workflow[node_id] = {
                "class_type": "LoraLoader",
                "inputs": {
                    "lora_name": lora.get("name", ""),
                    "strength_model": float(lora.get("weight", 1.0)),
                    "strength_clip": float(
                        lora.get("clip_weight", lora.get("weight", 1.0))
                    ),
                    "model": [last_model_node, last_model_idx],
                    "clip": [last_clip_node, last_clip_idx],
                },
            }
            last_model_node = node_id
            last_model_idx = 0
            last_clip_node = node_id
            last_clip_idx = 1

        # ── Anima TeaCache (T4 Speed Optimization) ─────────────────
        # Placed after LoRAs to cache the final patched model before sampling
        # v1 (Legacy Fast) is optimal for T4 to skip redundant late-step computations
        workflow["300"] = {
            "class_type": "AnimaTeaCache",
            "inputs": {
                "model": [last_model_node, last_model_idx],
                "threshold": 0.15,
                "teacache_version": "v1 (Legacy Fast)",
                "adaptive_mode": True,
                "early_steps_factor": 0.4,
                "late_steps_factor": 1.8,
                "cache_device": "cuda",
            },
        }
        last_model_node = "300"
        last_model_idx = 0

        # ── text encoding ────────────────────────────────────────────
        workflow["262"] = {
            "class_type": "CLIPTextEncode",
            "inputs": {
                "text": pos_prompt,
                "clip": [last_clip_node, last_clip_idx],
            },
        }
        workflow["263"] = {
            "class_type": "CLIPTextEncode",
            "inputs": {
                "text": neg_prompt,
                "clip": [last_clip_node, last_clip_idx],
            },
        }

        # ── main sampler (KSamplerAdvanced – node 297) ───────────────
        workflow["297"] = {
            "class_type": "KSamplerAdvanced",
            "inputs": {
                "add_noise": "enable",
                "noise_seed": seed,
                "steps": steps,
                "cfg": cfg,
                "sampler_name": sampler_name,
                "scheduler": scheduler,
                "start_at_step": 0,
                "end_at_step": 10000,
                "return_with_leftover_noise": "disable",
                "model": [last_model_node, last_model_idx],
                "positive": ["262", 0],
                "negative": ["263", 0],
                "latent_image": ["244", 0],
            },
        }

        # ── decode / hires-fix / save ────────────────────────────────
        if params.get("hires_enabled"):
            decode_output, decode_idx = self._build_hires_branch(
                workflow, params, last_model_node, last_model_idx, seed
            )
        else:
            # Standard single-pass decode (node 295)
            workflow["295"] = {
                "class_type": "VAEDecode",
                "inputs": {
                    "samples": ["297", 0],
                    "vae": ["238:210", 0],
                },
            }
            decode_output, decode_idx = "295", 0

        # ── SaveImage (node 235) ─────────────────────────────────────
        workflow["235"] = {
            "class_type": "SaveImage",
            "inputs": {
                "filename_prefix": "%date:yyyyMMdd%",
                "images": [decode_output, decode_idx],
            },
        }

        return workflow

    # ── hires-fix sub-graph ──────────────────────────────────────────
    @staticmethod
    def _build_hires_branch(
        workflow: Dict[str, Any],
        params: Dict[str, Any],
        model_node: str,
        model_idx: int,
        seed: int,
    ) -> tuple[str, int]:
        """Append the hires-fix nodes and return (output_node, output_idx).
        Pipeline:
          310 VAEDecode  → 311 ImageScale (lanczos)
          → 312 VAEEncode → 313 KSampler (2nd pass)
          → 314 VAEDecode → 315 ImageSharpen
        """
        width = params["width"]
        height = params["height"]
        scale = float(params.get("hires_scale", 1.5))

        # 310 – decode first-pass latent to pixels
        workflow["310"] = {
            "class_type": "VAEDecode",
            "inputs": {"samples": ["297", 0], "vae": ["238:210", 0]},
        }

        # 311 – upscale decoded image (lanczos avoids latent artefacts)
        workflow["311"] = {
            "class_type": "ImageScale",
            "inputs": {
                "upscale_method": "lanczos",
                "width": int(width * scale),
                "height": int(height * scale),
                "crop": "disabled",
                "image": ["310", 0],
            },
        }

        # 312 – re-encode to latent
        workflow["312"] = {
            "class_type": "VAEEncode",
            "inputs": {"pixels": ["311", 0], "vae": ["238:210", 0]},
        }

        # 313 – second-pass KSampler
        workflow["313"] = {
            "class_type": "KSampler",
            "inputs": {
                "seed": seed + 1,
                "steps": int(params.get("hires_steps", 12)),
                "cfg": float(params.get("hires_cfg", 4.0)),
                "sampler_name": params.get("hires_sampler", "euler_ancestral"),
                "scheduler": params.get("hires_scheduler", "simple"),
                "denoise": float(params.get("hires_denoise", 0.4)),
                "model": [model_node, model_idx],
                "positive": ["262", 0],
                "negative": ["263", 0],
                "latent_image": ["312", 0],
            },
        }

        # 314 – final decode
        workflow["314"] = {
            "class_type": "VAEDecode",
            "inputs": {"samples": ["313", 0], "vae": ["238:210", 0]},
        }

        # 315 – sharpen
        workflow["315"] = {
            "class_type": "ImageSharpen",
            "inputs": {
                "sharpen_radius": int(params.get("hires_sharpen_radius", 2)),
                "sigma": float(params.get("hires_sharpen_sigma", 0.18)),
                "alpha": float(params.get("hires_sharpen_alpha", 1.0)),
                "image": ["314", 0],
            },
        }

        return "315", 0

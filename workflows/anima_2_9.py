# workflows/anima_2_9.py
"""Concrete Anima 2.9B workflow blueprint.
Node IDs match the workflow_2_9.json specification exactly.
"""
from __future__ import annotations

from typing import Any, Dict, List

import config
from workflows.workflow_blueprint import WorkflowBlueprint


class Anima29Workflow(WorkflowBlueprint):
    """ComfyUI workflow builder for the Anima 2.9B variant."""

    # ── defaults ─────────────────────────────────────────────────────
    def get_default_params(self) -> Dict[str, Any]:
        defaults = {
            "positive_prompt": "",
            "negative_prompt": "",
            "seed": 0,
            "seed_mode": "random",
            "steps": 20,
            "cfg": getattr(config, "DEFAULT_ANIMA_2_9_CFG", 4.0),
            "width": config.DEFAULT_WIDTH,
            "height": config.DEFAULT_HEIGHT,
            "sampler_name": getattr(config, "DEFAULT_ANIMA_2_9_SAMPLER", "er_sde"),
            "scheduler": "simple",
            "batch_size": config.DEFAULT_BATCH_SIZE,
            "batch_count": config.DEFAULT_BATCH_COUNT,
            "checkpoint": getattr(config, "DEFAULT_ANIMA_2_9_CHECKPOINT", "anima29B_v10_int8.safetensors"),
            "vae": "qwen_image_vae.safetensors",
            "clip": "qwen_3_06b_base.safetensors",
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

            # Anima 2.9B specific engine settings
            "sage_attention": "auto",
            "torch_compile": True,
            "teacache_threshold": getattr(config, "DEFAULT_ANIMA_2_9_TEACACHE_THRESHOLD", 0.25),
            "teacache_version": getattr(config, "DEFAULT_ANIMA_2_9_TEACACHE_VERSION", "v2 (Standard Precise)"),
            "teacache_adaptive_mode": True,
            "teacache_early_steps_factor": 0.4,
            "teacache_late_steps_factor": 1.8,
            "teacache_start_percent": 0.0,
            "teacache_end_percent": 1.0,
            "teacache_cache_device": "cuda",
            "remap_tag_text": "",
            "remap_default_weight": 1.0,
            "remap_weight_multiplier": 1.0,
            "remap_auto_remap": True,
            "remap_save_remapped": False,
            "remap_extend_to_new_layers": False,
            "remap_extend_strength": 0.6,
            "remap_manifest": getattr(config, "DEFAULT_ANIMA_2_9_REMAP_MANIFEST", "expand_manifest_preview_v1.json"),
        }
        return defaults

    # ── normalisation ────────────────────────────────────────────────
    def normalize_frontend_settings(self, settings: Dict[str, Any]) -> Dict[str, Any]:
        params = super().normalize_frontend_settings(settings)

        extra = settings.get("extra_params", {}) or {}

        params["sage_attention"] = settings.get("sage_attention", extra.get("sage_attention", params.get("sage_attention", "auto")))
        params["torch_compile"] = bool(settings.get("torch_compile", extra.get("torch_compile", params.get("torch_compile", True))))
        params["teacache_threshold"] = float(settings.get("teacache_threshold", extra.get("teacache_threshold", params.get("teacache_threshold", 0.25))))
        params["teacache_version"] = settings.get("teacache_version", extra.get("teacache_version", params.get("teacache_version", "v2 (Standard Precise)")))
        params["teacache_adaptive_mode"] = bool(settings.get("teacache_adaptive_mode", extra.get("teacache_adaptive_mode", params.get("teacache_adaptive_mode", True))))
        params["teacache_early_steps_factor"] = float(settings.get("teacache_early_steps_factor", extra.get("teacache_early_steps_factor", params.get("teacache_early_steps_factor", 0.4))))
        params["teacache_late_steps_factor"] = float(settings.get("teacache_late_steps_factor", extra.get("teacache_late_steps_factor", params.get("teacache_late_steps_factor", 1.8))))
        params["teacache_start_percent"] = float(settings.get("teacache_start_percent", extra.get("teacache_start_percent", params.get("teacache_start_percent", 0.0))))
        params["teacache_end_percent"] = float(settings.get("teacache_end_percent", extra.get("teacache_end_percent", params.get("teacache_end_percent", 1.0))))
        params["teacache_cache_device"] = settings.get("teacache_cache_device", extra.get("teacache_cache_device", params.get("teacache_cache_device", "cuda")))
        params["remap_tag_text"] = settings.get("remap_tag_text", extra.get("remap_tag_text", params.get("remap_tag_text", "")))
        params["remap_default_weight"] = float(settings.get("remap_default_weight", extra.get("remap_default_weight", params.get("remap_default_weight", 1.0))))
        params["remap_weight_multiplier"] = float(settings.get("remap_weight_multiplier", extra.get("remap_weight_multiplier", params.get("remap_weight_multiplier", 1.0))))
        params["remap_auto_remap"] = bool(settings.get("remap_auto_remap", extra.get("remap_auto_remap", params.get("remap_auto_remap", True))))
        params["remap_save_remapped"] = bool(settings.get("remap_save_remapped", extra.get("remap_save_remapped", params.get("remap_save_remapped", False))))
        params["remap_extend_to_new_layers"] = bool(settings.get("remap_extend_to_new_layers", extra.get("remap_extend_to_new_layers", params.get("remap_extend_to_new_layers", False))))
        params["remap_extend_strength"] = float(settings.get("remap_extend_strength", extra.get("remap_extend_strength", params.get("remap_extend_strength", 0.6))))
        params["remap_manifest"] = settings.get("remap_manifest", extra.get("remap_manifest", params.get("remap_manifest", "expand_manifest_preview_v1.json")))

        return params

    # ── lora helpers ─────────────────────────────────────────────────
    @staticmethod
    def _sanitize_lora_name(name: str) -> str:
        name = str(name or "").strip()
        if not name:
            return ""
        forbidden = set("<>\r\n:")
        if any(char in forbidden for char in name):
            raise ValueError(
                f"Invalid LoRA name: {name}. "
                "LoRA names cannot contain '<', '>', ':', or newline characters."
            )
        return name

    @staticmethod
    def _clamp_lora_weight(value) -> float:
        try:
            value = float(value)
        except (TypeError, ValueError):
            value = 1.0
        return max(-10.0, min(10.0, value))

    @classmethod
    def _format_lora_tag(cls, name: str, weight, clip_weight=None) -> str:
        name = cls._sanitize_lora_name(name)
        if not name:
            return ""
        model_weight = cls._clamp_lora_weight(weight)
        if clip_weight is None:
            return f"<lora:{name}:{model_weight:.2f}>"
        clip_weight = cls._clamp_lora_weight(clip_weight)
        if abs(clip_weight - model_weight) < 0.0001:
            return f"<lora:{name}:{model_weight:.2f}>"
        return f"<lora:{name}:{model_weight:.2f}:{clip_weight:.2f}>"

    @classmethod
    def _build_anima_lora_tag_text(cls, loras, manual_text: str = "") -> str:
        tags = []
        for lora in loras or []:
            if not isinstance(lora, dict):
                continue
            name = lora.get("name", "")
            weight = lora.get("weight", lora.get("strength_model", 1.0))
            clip_weight = lora.get("clip_weight", lora.get("strength_clip", weight))
            tag = cls._format_lora_tag(name, weight, clip_weight)
            if tag:
                tags.append(tag)

        manual_text = str(manual_text or "").strip()
        parts = []
        if tags:
            parts.append(" ".join(tags))
        if manual_text:
            parts.append(manual_text)
        return " ".join(parts).strip()

    # ── graph ────────────────────────────────────────────────────────
    def build_workflow(self, params: Dict[str, Any]) -> Dict[str, Any]:
        lora_tag_text = self._build_anima_lora_tag_text(
            params.get("loras", []),
            params.get("remap_tag_text", ""),
        )

        workflow: Dict[str, Any] = {
            "238_208": {
                "class_type": "AnimaBoosterLoader",
                "inputs": {
                    "model_name": params["checkpoint"],
                    "sage_attention": params.get("sage_attention", "auto"),
                    "torch_compile": bool(params.get("torch_compile", True)),
                },
            },
            "238_209": {
                "class_type": "CLIPLoader",
                "inputs": {
                    "clip_name": params["clip"],
                    "type": "stable_diffusion",
                    "device": "default",
                },
            },
            "238_210": {
                "class_type": "VAELoader",
                "inputs": {
                    "vae_name": params["vae"],
                },
            },
            "244": {
                "class_type": "AnimaLatentImage",
                "inputs": {
                    "preset": "Custom",
                    "width": params["width"],
                    "height": params["height"],
                    "batch_size": params["batch_size"],
                },
            },
            "300": {
                "class_type": "AnimaTeaCache",
                "inputs": {
                    "model": ["238_208", 0],
                    "threshold": float(params.get("teacache_threshold", 0.25)),
                    "teacache_version": params.get("teacache_version", "v2 (Standard Precise)"),
                    "adaptive_mode": bool(params.get("teacache_adaptive_mode", True)),
                    "early_steps_factor": float(params.get("teacache_early_steps_factor", 0.4)),
                    "late_steps_factor": float(params.get("teacache_late_steps_factor", 1.8)),
                    "start_percent": float(params.get("teacache_start_percent", 0.0)),
                    "end_percent": float(params.get("teacache_end_percent", 1.0)),
                    "cache_device": params.get("teacache_cache_device", "cuda"),
                },
            },
            "305": {
                "class_type": "AnimaLoRARemapTagLoader",
                "inputs": {
                    "text": lora_tag_text,
                    "default_weight": float(params.get("remap_default_weight", 1.0)),
                    "weight_multiplier": float(params.get("remap_weight_multiplier", 1.0)),
                    "auto_remap": bool(params.get("remap_auto_remap", True)),
                    "save_remapped": bool(params.get("remap_save_remapped", False)),
                    "extend_to_new_layers": bool(params.get("remap_extend_to_new_layers", False)),
                    "extend_strength": float(params.get("remap_extend_strength", 0.6)),
                    "manifest": params.get("remap_manifest", "expand_manifest_preview_v1.json"),
                    "model": ["300", 0],
                    "clip": ["238_209", 0],
                },
            },
            "262": {
                "class_type": "CLIPTextEncode",
                "inputs": {
                    "text": params["positive_prompt"],
                    "clip": ["305", 1],
                },
            },
            "263": {
                "class_type": "CLIPTextEncode",
                "inputs": {
                    "text": params["negative_prompt"],
                    "clip": ["305", 1],
                },
            },
            "297": {
                "class_type": "KSamplerAdvanced",
                "inputs": {
                    "add_noise": "enable",
                    "noise_seed": params["seed"],
                    "steps": params["steps"],
                    "cfg": params["cfg"],
                    "sampler_name": params["sampler_name"],
                    "scheduler": params["scheduler"],
                    "start_at_step": 0,
                    "end_at_step": 10000,
                    "return_with_leftover_noise": "disable",
                    "model": ["305", 0],
                    "positive": ["262", 0],
                    "negative": ["263", 0],
                    "latent_image": ["244", 0],
                },
            },
            "295": {
                "class_type": "VAEDecode",
                "inputs": {
                    "samples": ["297", 0],
                    "vae": ["238_210", 0],
                },
            },
            "235": {
                "class_type": "SaveImage",
                "inputs": {
                    "filename_prefix": "%date:yyyyMMdd%",
                    "images": ["295", 0],
                },
            },
        }
        return workflow

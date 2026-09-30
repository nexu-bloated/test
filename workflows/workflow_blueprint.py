# workflows/workflow_blueprint.py
"""Abstract base class for ComfyUI workflow builders.

A *blueprint* knows how to:

1. Declare its default generation parameters.
2. Validate / clamp incoming parameters.
3. Normalise raw frontend settings into a canonical parameter dict.
4. Build a ComfyUI-compatible prompt graph (dict of node-id → node).

Concrete subclasses (e.g. ``AnimaWorkflow``) implement the actual node
graph.  Swapping the model architecture later means writing a new
subclass and registering it in ``workflows/__init__.py``.
"""

from __future__ import annotations

import random
from abc import ABC, abstractmethod
from typing import Any, Dict, List

import config


class WorkflowBlueprint(ABC):
    """Model-agnostic interface for building ComfyUI workflows."""

    # ── defaults ─────────────────────────────────────────────────────

    @abstractmethod
    def get_default_params(self) -> Dict[str, Any]:
        """Return a dict of every parameter this workflow understands,
        populated with sane defaults."""

    # ── validation ───────────────────────────────────────────────────

    def validate_params(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Clamp / validate *params* in-place and return them.

        The base implementation enforces universal numeric bounds.
        Subclasses may call ``super().validate_params(params)`` and then
        add model-specific checks.
        """
        params["steps"] = max(1, min(int(params.get("steps", 20)), config.MAX_STEPS))
        params["cfg"] = max(0.0, min(float(params.get("cfg", 4.5)), config.MAX_CFG))
        params["width"] = max(
            config.MIN_DIMENSION,
            min(int(params.get("width", 1024)), config.MAX_WIDTH),
        )
        params["height"] = max(
            config.MIN_DIMENSION,
            min(int(params.get("height", 1024)), config.MAX_HEIGHT),
        )
        params["batch_size"] = max(
            1, min(int(params.get("batch_size", 1)), config.MAX_BATCH_SIZE)
        )
        params["batch_count"] = max(
            1, min(int(params.get("batch_count", 1)), config.MAX_BATCH_COUNT)
        )

        # Seed
        seed_mode = params.get("seed_mode", "random")
        if seed_mode not in ("random", "fixed", "increment"):
            seed_mode = "random"
        params["seed_mode"] = seed_mode

        seed = params.get("seed", 0)
        try:
            seed = int(seed)
        except (ValueError, TypeError):
            seed = 0
        if seed_mode == "random" or seed <= 0:
            seed = random.randint(1, 10**12)
        params["seed"] = seed

        # LoRA cap
        loras: List[dict] = params.get("loras", [])
        if len(loras) > config.MAX_LORAS:
            loras = loras[: config.MAX_LORAS]
        params["loras"] = loras

        return params

    # ── normalisation ────────────────────────────────────────────────

    def normalize_frontend_settings(self, settings: Dict[str, Any]) -> Dict[str, Any]:
        """Map raw JSON from the frontend into the canonical parameter
        dict expected by ``build_workflow``.

        The base implementation handles the common fields; subclasses
        should call ``super()`` and then layer model-specific mappings.
        """
        resolution = str(settings.get("resolution", "1152x896")).split("x")
        width = int(resolution[0]) if resolution[0].isdigit() else config.DEFAULT_WIDTH
        height = (
            int(resolution[1])
            if len(resolution) > 1 and resolution[1].isdigit()
            else config.DEFAULT_HEIGHT
        )

        params: Dict[str, Any] = {
            "positive_prompt": settings.get("positive_prompt", ""),
            "negative_prompt": settings.get("negative_prompt", ""),
            "seed": settings.get("seed", 0),
            "seed_mode": settings.get("seed_mode", "random"),
            "steps": settings.get("steps", config.DEFAULT_STEPS),
            "cfg": settings.get("cfg", config.DEFAULT_CFG),
            "width": width,
            "height": height,
            "sampler_name": settings.get("sampler", config.DEFAULT_SAMPLER),
            "scheduler": settings.get("scheduler", config.DEFAULT_SCHEDULER),
            "batch_size": settings.get("batch_size", config.DEFAULT_BATCH_SIZE),
            "batch_count": settings.get("batch_count", config.DEFAULT_BATCH_COUNT),
            "checkpoint": settings.get("checkpoint", config.DEFAULT_CHECKPOINT),
            "vae": settings.get("vae", config.DEFAULT_VAE),
            "clip": settings.get("clip", config.DEFAULT_CLIP),
            "loras": settings.get("loras", []),
            # Hires fix
            "hires_enabled": bool(settings.get("hires_fix", False)),
            "hires_scale": settings.get("hires_scale", config.DEFAULT_HIRES_SCALE),
            "hires_steps": settings.get("hires_steps", config.DEFAULT_HIRES_STEPS),
            "hires_cfg": settings.get("hires_cfg", config.DEFAULT_HIRES_CFG),
            "hires_sampler": settings.get("hires_sampler", config.DEFAULT_HIRES_SAMPLER),
            "hires_scheduler": settings.get(
                "hires_scheduler", config.DEFAULT_SCHEDULER
            ),
            "hires_denoise": settings.get("hires_denoise", config.DEFAULT_HIRES_DENOISE),
            "hires_sharpen_radius": settings.get("hires_sharpen_radius", 2),
            "hires_sharpen_sigma": settings.get(
                "hires_sharpen_sigma", config.DEFAULT_HIRES_SHARPEN_SIGMA
            ),
            "hires_sharpen_alpha": settings.get("hires_sharpen_alpha", 1.0),
            "extra_params": settings.get("extra_params", {}),
        }
        return params

    # ── graph construction ───────────────────────────────────────────

    @abstractmethod
    def build_workflow(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Return a ComfyUI-compatible prompt dict (node-id → node)."""

    # ── convenience ──────────────────────────────────────────────────

    def prepare(self, settings: Dict[str, Any]) -> Dict[str, Any]:
        """Normalise → validate → return ready-to-build params."""
        params = self.normalize_frontend_settings(settings)
        params = self.validate_params(params)
        return params

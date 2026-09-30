// static/js/components/generationForm.js
/**
generationForm.js – Collects, validates, and submits generation settings.
*/
import { generateImage } from "../api.js";
import state, { getModelModeDefaults } from "../state.js";
import * as ui from "../ui.js";

export function collectSettings() {
  const loras = [];
  ui.els.loraContainer.querySelectorAll(".nexus-lora-row").forEach((row) => {
    const select = row.querySelector("select");
    const weightInput = row.querySelector('input[type="number"]');
    if (select && select.value) {
      const weight = parseFloat(weightInput?.value ?? "1.0");
      loras.push({
        name: select.value,
        weight: Number.isNaN(weight) ? 1.0 : weight,
      });
    }
  });

  const settings = {
    tunnel_url: state.tunnelUrl,
    positive_prompt: ui.els.posPrompt.value,
    negative_prompt: ui.els.negPrompt.value,
    sampler: ui.els.selSampler.value || state.sampler,
    scheduler: ui.els.selScheduler.value || state.scheduler,
    steps: state.steps,
    cfg: state.cfg,
    resolution: state.resolution,
    batch_size: state.batchSize,
    batch_count: 1,
    seed_mode: state.seedMode,
    seed: state.seedMode === "fixed" ? state.fixedSeed : 0,
    loras,
    hires_fix: !!ui.els.hiresToggle.checked,
    hires_scale: state.hiresScale,
    hires_steps: parseInt(ui.els.rangeHiresSteps.value, 10) || 12,
    hires_cfg: parseFloat(ui.els.rangeHiresCfg.value) || 4.0,
    hires_sampler: ui.els.selHiresSampler.value || "euler_ancestral",
    hires_denoise: parseFloat(ui.els.rangeHiresDenoise.value) || 0.4,
    hires_sharpen_sigma: parseFloat(ui.els.rangeHiresSharpen.value) || 0.18,
  };

  const modeDefaults = getModelModeDefaults();

  const checkpoint =
    ui.els.selCheckpoint.value || modeDefaults.checkpoint;
  const vae = ui.els.selVae.value || modeDefaults.vae;
  const clip = ui.els.selClip.value || modeDefaults.clip;

  if (checkpoint) settings.checkpoint = checkpoint;
  if (vae) settings.vae = vae;
  if (clip) settings.clip = clip;

  settings.workflow_name = state.modelMode;
  settings.model_mode = state.modelMode;

  if (state.modelMode === "anima_2_9") {
    settings.extra_params = {
      sage_attention: state.anima29.sage_attention,
      torch_compile: state.anima29.torch_compile,
      teacache_threshold: state.anima29.teacache_threshold,
      teacache_version: state.anima29.teacache_version,
      teacache_adaptive_mode: state.anima29.teacache_adaptive_mode,
      teacache_early_steps_factor: state.anima29.teacache_early_steps_factor,
      teacache_late_steps_factor: state.anima29.teacache_late_steps_factor,
      teacache_start_percent: state.anima29.teacache_start_percent,
      teacache_end_percent: state.anima29.teacache_end_percent,
      teacache_cache_device: state.anima29.teacache_cache_device,
      remap_tag_text: state.anima29.remap_tag_text,
      remap_default_weight: state.anima29.remap_default_weight,
      remap_weight_multiplier: state.anima29.remap_weight_multiplier,
      remap_auto_remap: state.anima29.remap_auto_remap,
      remap_save_remapped: state.anima29.remap_save_remapped,
      remap_extend_to_new_layers: state.anima29.remap_extend_to_new_layers,
      remap_extend_strength: state.anima29.remap_extend_strength,
      remap_manifest: state.anima29.remap_manifest,
    };
  }

  return settings;
}

export function validate(settings) {
  if (!settings.tunnel_url) {
    return "Enter a Tunnel URL and connect first.";
  }
  if (!settings.resolution || state.width <= 0 || state.height <= 0) {
    return "Select a valid resolution.";
  }
  if (state.width < 64 || state.width > 4096 || state.height < 64 || state.height > 4096) {
    return "Resolution must be between 64 and 4096 pixels.";
  }
  if (settings.steps < 1 || settings.steps > 50) {
    return "Steps must be between 1 and 50.";
  }
  if (settings.cfg < 0 || settings.cfg > 20) {
    return "CFG must be between 0.0 and 20.0.";
  }
  if (settings.batch_size < 1 || settings.batch_size > 4) {
    return "Batch must be between 1 and 4.";
  }
  if (settings.seed_mode === "fixed") {
    if (!Number.isSafeInteger(settings.seed) || settings.seed < 1) {
      return "Fixed seed must be a positive integer.";
    }
  }

  // LoRA validation for Anima 2.9B removed. LoRAs are now supported via AnimaLoRARemapTagLoader.

  return null;
}

export async function submitGeneration(onSuccess) {
  if (state.generating) return;
  const settings = collectSettings();
  const error = validate(settings);
  if (error) {
    ui.toast(error, "danger");
    return;
  }
  state.generating = true;
  ui.setGenerating(true);
  try {
    const data = await generateImage(settings);
    state.currentPromptId = data?.results?.[0]?.prompt_id ?? null;
    ui.toast("Generation submitted ✓", "success");
    if (onSuccess) onSuccess(data);
  } catch (err) {
    ui.toast(err.message || "Generation failed.", "danger");
  } finally {
    state.generating = false;
    ui.setGenerating(false);
  }
}

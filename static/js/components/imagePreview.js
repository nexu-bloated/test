// static/js/imagePreview.js
/**
 * imagePreview.js – Gallery rendering, polling, inspect, remix, and PNG import.
 */

import {
  getHistory,
  getQueue,
  imageKey,
  imageUrl,
} from "../api.js";

import state, {
  RESOLUTION_PRESETS,
  addCustomResolution,
  savePrefs,
  setFixedSeed,
  setSeedMode,
  updatePref,
} from "../state.js";

import * as ui from "../ui.js";
import * as imageCache from "../imageCache.js";

let queuePollTimer = null;
let fallbackGalleryTimer = null;
let queueInFlight = false;
let lastQueueActive = false;

let refreshPromise = null;
let gallerySignature = "";
let sessionToken = 0;

let inspectToken = 0;
let currentInspectKey = null;

function stableImageUrl(img) {
  return imageUrl(
    state.tunnelUrl,
    img.filename,
    img.subfolder,
    img.type,
    img.meta?.prompt_id || ""
  );
}

function signatureFor(images) {
  return `${state.gallerySort}::${images.map(imageKey).join(",")}`;
}

/**
 * Reset all transient image session state.
 * Call when tunnel changes.
 */
export function resetImageSession() {
  sessionToken += 1;

  closeInspect();

  gallerySignature = "";
  state.gallery = [];
  lastQueueActive = false;
  queueInFlight = false;

  imageCache.clear();
}

// ── gallery refresh ─────────────────────────────────────────────────

/**
 * Fetch history and re-render the gallery.
 * Single-flight + signature-diffed.
 */
export function refreshGallery(force = false) {
  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = performRefresh(force).finally(() => {
    refreshPromise = null;
  });

  return refreshPromise;
}

async function performRefresh(force) {
  if (!state.tunnelUrl) return;

  const token = sessionToken;

  try {
    const data = await getHistory(state.tunnelUrl);

    if (token !== sessionToken) return;

    let images = data.images || [];

    if (state.gallerySort === "oldest") {
      images = [...images].reverse();
    }

    state.gallery = images;

    const signature = signatureFor(images);

    if (!force && signature === gallerySignature) {
      return;
    }

    gallerySignature = signature;

    ui.renderGallery(images, stableImageUrl, imageKey);
  } catch (err) {
    if (token === sessionToken) {
      ui.toast(err.message || "Could not refresh the gallery.", "danger");
    }
  }
}

// ── queue polling ───────────────────────────────────────────────────

function startTimers() {
  if (queuePollTimer) return;

  pollQueue();

  queuePollTimer = setInterval(pollQueue, 3500);

  // Slow fallback only.
  fallbackGalleryTimer = setInterval(() => {
    refreshGallery(false);
  }, 30000);
}

function stopTimers() {
  if (queuePollTimer) {
    clearInterval(queuePollTimer);
    queuePollTimer = null;
  }

  if (fallbackGalleryTimer) {
    clearInterval(fallbackGalleryTimer);
    fallbackGalleryTimer = null;
  }
}

function onVisibilityChange() {
  if (document.hidden) {
    stopTimers();
  } else {
    startTimers();
    refreshGallery(false);
  }
}

export function startQueuePolling() {
  stopQueuePolling();

  document.addEventListener("visibilitychange", onVisibilityChange);

  if (!document.hidden) {
    startTimers();
  }
}

export function stopQueuePolling() {
  document.removeEventListener("visibilitychange", onVisibilityChange);
  stopTimers();
}

async function pollQueue() {
  if (!state.tunnelUrl) return;
  if (document.hidden) return;
  if (queueInFlight) return;

  queueInFlight = true;

  try {
    const q = await getQueue(state.tunnelUrl);

    const running = q.running ?? 0;
    const pending = q.pending ?? 0;
    const active = running + pending > 0;

    ui.setQueueLabel(running, pending);

    // Refresh once when queue settles.
    if (lastQueueActive && !active) {
      refreshGallery(true);
    }

    lastQueueActive = active;
  } catch {
    // Queue telemetry is non-critical.
  } finally {
    queueInFlight = false;
  }
}

/**
 * Tell the preview system that new images are likely soon.
 */
export function expectNewImages() {
  lastQueueActive = true;

  // Quick check for fast jobs.
  setTimeout(() => {
    refreshGallery(true);
  }, 1200);
}

// ── inspect / lightbox ──────────────────────────────────────────────

export function openInspect(index) {
  if (index < 0 || index >= state.gallery.length) return;

  state.inspectIndex = index;

  const img = state.gallery[index];
  const key = imageKey(img);
  const stableUrl = stableImageUrl(img);

  const cached = imageCache.getIfCached(key);

  if (currentInspectKey && currentInspectKey !== key) {
    imageCache.unpin(currentInspectKey);
  }

  currentInspectKey = key;
  imageCache.pin(key);

  // Show immediately from cache if possible.
  ui.showInspect(
    cached || stableUrl,
    index,
    state.gallery.length,
    img.filename || ""
  );

  const token = ++inspectToken;

  // Upgrade to cached object URL when ready.
  imageCache
    .getCachedObjectUrl(key, stableUrl)
    .then((objectUrl) => {
      if (token === inspectToken && state.inspectIndex === index) {
        ui.setInspectImage(objectUrl);
      }
    })
    .catch(() => {
      if (token === inspectToken && state.inspectIndex === index) {
        ui.setInspectImage(stableUrl);
      }
    });

  prefetchInspectNeighbors(index);
}

export function closeInspect() {
  if (currentInspectKey) {
    imageCache.unpin(currentInspectKey);
  }

  currentInspectKey = null;
  inspectToken += 1;

  ui.hideInspect();
}

export function navigateInspect(direction) {
  if (!state.gallery.length) return;

  const next =
    (state.inspectIndex + direction + state.gallery.length) %
    state.gallery.length;

  openInspect(next);
}

export function currentInspectMeta() {
  return state.gallery[state.inspectIndex]?.meta ?? null;
}

// ── prefetch ────────────────────────────────────────────────────────

export function prefetchImageByIndex(index) {
  const img = state.gallery[index];

  if (!img) return;
  if (document.hidden) return;
  if (navigator.connection?.saveData) return;

  imageCache.prefetch(imageKey(img), stableImageUrl(img));
}

function prefetchInspectNeighbors(index) {
  if (!state.gallery.length) return;
  if (document.hidden) return;
  if (navigator.connection?.saveData) return;

  const indexes = [index - 1, index + 1, index + 2];

  for (const i of indexes) {
    const wrapped = (i + state.gallery.length) % state.gallery.length;
    if (wrapped !== index) {
      prefetchImageByIndex(wrapped);
    }
  }
}

// ── remix ───────────────────────────────────────────────────────────

export function openRemix(meta) {
  state.remixMeta = meta || null;
  ui.showRemix(state.remixMeta);
}

function syncPromptCounts() {
  ui.els.posCount.textContent = String(ui.els.posPrompt.value.length);
  ui.els.negCount.textContent = String(ui.els.negPrompt.value.length);
}

function addRemixLoras(loras) {
  ui.clearLoraRows();

  for (const lora of Array.isArray(loras) ? loras : []) {
    if (!lora?.name) continue;

    ui.addLoraRow(
      state._loraNames || [],
      undefined,
      lora.name,
      Number.isFinite(Number(lora.weight)) ? Number(lora.weight) : 1.0
    );
  }
}

/**
 * Apply normalized image metadata to the current generation form.
 */
export function applyRemixData(meta) {
  const m = meta || {};

  ui.els.posPrompt.value = typeof m.pos === "string" ? m.pos : "";
  ui.els.negPrompt.value = typeof m.neg === "string" ? m.neg : "";

  syncPromptCounts();

  const steps = Number.parseInt(m.steps, 10);
  if (Number.isSafeInteger(steps) && steps >= 1 && steps <= 50) {
    updatePref("steps", steps, false);
    ui.els.rangeSteps.value = String(steps);
    ui.els.stepsVal.textContent = String(steps);
    ui.updateRangeFill(ui.els.rangeSteps);
  }

  const cfg = Number.parseFloat(m.cfg);
  if (Number.isFinite(cfg) && cfg >= 0 && cfg <= 20) {
    updatePref("cfg", cfg, false);
    ui.els.rangeCfg.value = String(cfg);
    ui.els.cfgVal.textContent = cfg.toFixed(1);
    ui.updateRangeFill(ui.els.rangeCfg);
  }

  const seed = Number.parseInt(m.seed, 10);
  if (Number.isSafeInteger(seed) && seed > 0) {
    setFixedSeed(seed, false);
    setSeedMode("fixed", false);
  } else {
    setSeedMode("random", false);
  }

  ui.updateSeedUI(state.seedMode, state.fixedSeed);

  const width = Number.parseInt(m.width, 10);
  const height = Number.parseInt(m.height, 10);

  if (
    Number.isSafeInteger(width) &&
    Number.isSafeInteger(height) &&
    width >= 64 &&
    width <= 4096 &&
    height >= 64 &&
    height <= 4096
  ) {
    addCustomResolution(width, height);
    ui.syncControlsFromState(state, RESOLUTION_PRESETS);
  }

  if (m.ckpt) {
    ui.selectOrAddOption(ui.els.selCheckpoint, m.ckpt);
  }

  if (m.sampler) {
    updatePref("sampler", m.sampler, false);
    ui.selectOrAddOption(ui.els.selSampler, m.sampler);
  }

  if (m.scheduler) {
    updatePref("scheduler", m.scheduler, false);
    ui.selectOrAddOption(ui.els.selScheduler, m.scheduler);
  }

  addRemixLoras(m.loras);

  savePrefs();
  ui.hideRemix();

  if (ui.isOpen(ui.els.inspectModal)) {
    closeInspect();
  }

  ui.toast("Metadata injected from image.", "success");
}

/**
 * Apply the metadata currently displayed by the Remix modal.
 */
export function applyRemixToForm() {
  if (state.remixMeta) {
    applyRemixData(state.remixMeta);
  }
}

// ── PNG metadata import ─────────────────────────────────────────────

function decodeTextChunk(buffer, start, length) {
  const bytes = new Uint8Array(buffer, start, length);
  const separator = bytes.indexOf(0);

  if (separator < 0) return null;

  return {
    keyword: new TextDecoder("latin1").decode(bytes.slice(0, separator)),
    content: new TextDecoder("utf-8").decode(bytes.slice(separator + 1)),
  };
}

/**
 * Read the ComfyUI `prompt` tEXt chunk from a PNG File.
 */
export async function extractComfyUIMetadata(file) {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];

  if (
    bytes.length < 8 ||
    pngSignature.some((value, index) => bytes[index] !== value)
  ) {
    throw new Error("PNG required.");
  }

  const view = new DataView(buffer);

  let offset = 8;
  let promptData = null;

  while (offset + 12 <= view.byteLength) {
    const length = view.getUint32(offset);
    const dataStart = offset + 8;
    const chunkEnd = dataStart + length + 4;

    if (chunkEnd > view.byteLength) break;

    const type = String.fromCharCode(
      view.getUint8(offset + 4),
      view.getUint8(offset + 5),
      view.getUint8(offset + 6),
      view.getUint8(offset + 7)
    );

    if (type === "tEXt") {
      const text = decodeTextChunk(buffer, dataStart, length);

      if (text?.keyword === "prompt") {
        try {
          promptData = JSON.parse(text.content);
          break;
        } catch {
          throw new Error("The ComfyUI prompt metadata is invalid.");
        }
      }
    }

    offset = chunkEnd;
  }

  if (!promptData || typeof promptData !== "object") {
    throw new Error("No ComfyUI prompt metadata was found.");
  }

  return normalizeComfyPrompt(promptData);
}

function normalizeComfyPrompt(promptData) {
  const meta = {
    seed: 0,
    steps: 30,
    cfg: 6.0,
    width: 1152,
    height: 896,
    pos: "",
    neg: "",
    ckpt: "",
    loras: [],
    sampler: "",
    scheduler: "",
  };

  const textNodes = [];

  for (const node of Object.values(promptData)) {
    const type = node?.class_type;
    const inputs = node?.inputs || {};

    if (
      type === "KSampler" ||
      type === "SpectrumSPDKSampler" ||
      type === "KSamplerAdvanced"
    ) {
      if (Number(inputs.denoise ?? 1) >= 0.99) {
        meta.seed = inputs.seed ?? inputs.noise_seed ?? meta.seed;
        meta.steps = inputs.steps ?? meta.steps;
        meta.cfg = inputs.cfg ?? meta.cfg;
        meta.sampler = inputs.sampler_name ?? inputs.sampler ?? meta.sampler;
        meta.scheduler = inputs.scheduler ?? meta.scheduler;
      }
    } else if (type === "EmptyLatentImage") {
      meta.width = inputs.width ?? meta.width;
      meta.height = inputs.height ?? meta.height;
    } else if (type === "CLIPTextEncode") {
      textNodes.push(inputs.text || "");
    } else if (type === "UNETLoader" || type === "CheckpointLoaderSimple") {
      meta.ckpt = inputs.unet_name ?? inputs.ckpt_name ?? meta.ckpt;
    } else if (type === "LoraLoader") {
      if (inputs.lora_name) {
        meta.loras.push({
          name: inputs.lora_name,
          weight: inputs.strength_model ?? 1.0,
        });
      }
    }
  }

  meta.pos = textNodes[0] || "";
  meta.neg = textNodes[1] || "";

  return meta;
}

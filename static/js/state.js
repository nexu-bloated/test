// static/js/state.js
/**
 * state.js – Central UI state and safe localStorage persistence.
 */

const LS_KEY = "nexus_ui_prefs_v2";

export const RESOLUTION_PRESETS = [
  { value: "1152x896", label: "Landscape — 1152 × 896" },
  { value: "896x1152", label: "Portrait — 896 × 1152" },
  { value: "1024x1024", label: "Square — 1024 × 1024" },
  { value: "832x1216", label: "Tall — 832 × 1216" },
  { value: "1216x832", label: "Wide — 1216 × 832" },
  { value: "768x1344", label: "Anime — 768 × 1344" },
  { value: "1344x768", label: "Cinema — 1344 × 768" },
  { value: "864x1536", label: "Mobile — 864 × 1536" },
  { value: "1536x864", label: "Desktop — 1536 × 864" },
];

const state = {
  // connection / runtime
  tunnelUrl: "",
  connected: false,
  generating: false,
  currentPromptId: null,

  // gallery / inspect / remix
  gallery: [],
  gallerySort: "newest",
  inspectIndex: -1,
  remixMeta: null,

  // generation params
  resolution: "1152x896",
  width: 1152,
  height: 896,
  customResolutions: [],

  batchSize: 1,
  seedMode: "random", // "random" | "fixed"
  fixedSeed: 0,

  sampler: "euler_ancestral",
  scheduler: "simple",
  steps: 20,
  cfg: 4.5,

  hiresScale: 1.5,
  expanded: false,

  // internal caches
  _loraNames: [],
  // Civitai search state.
  // downloadLinks stores the Civitai download structure for each search result.
  civitai: {
      searchResults: [],
      downloadLinks: {},
      pendingDownload: null,
      nextCursor: null,
      activeDownloads: {},
      completedDownloads: {},
    },

  // Anima-specific fallbacks carried from the original codebase.
  // TODO: Verify Anima-specific ComfyUI node values.
  modelDefaults: {
    checkpoint: "anima_wai.safetensors",
    vae: "qwen_image_vae.safetensors",
    clip: "qwen_3_06b_base.safetensors",
  },
};

export default state;

function clampInt(value, min, max, fallback) {
  const n = parseInt(value, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function clampFloat(value, min, max, fallback) {
  const n = parseFloat(value);
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

export function parseResolution(value) {
  const parts = String(value || "").split("x");
  const width = parseInt(parts[0], 10);
  const height = parseInt(parts[1], 10);
  return {
    width: Number.isNaN(width) ? 0 : width,
    height: Number.isNaN(height) ? 0 : height,
  };
}

function isPresetResolution(value) {
  return RESOLUTION_PRESETS.some((p) => p.value === value);
}

export function setResolution(value, save = true) {
  const { width, height } = parseResolution(value);

  if (width > 0 && height > 0) {
    state.resolution = value;
    state.width = width;
    state.height = height;

    if (!isPresetResolution(value) && !state.customResolutions.includes(value)) {
      state.customResolutions.push(value);
    }
  } else {
    state.resolution = "1152x896";
    state.width = 1152;
    state.height = 896;
  }

  if (save) savePrefs();
}

export function addCustomResolution(width, height) {
  const value = `${width}x${height}`;
  if (!state.customResolutions.includes(value)) {
    state.customResolutions.push(value);
  }
  setResolution(value, true);
  return value;
}

export function setSeedMode(mode, save = true) {
  state.seedMode = mode === "fixed" ? "fixed" : "random";
  if (save) savePrefs();
}

export function setFixedSeed(seed, save = true) {
  const n = parseInt(seed, 10);
  state.fixedSeed = Number.isSafeInteger(n) && n > 0 ? n : 0;
  if (save) savePrefs();
}

export function updatePref(key, value, save = true) {
  state[key] = value;
  if (save) savePrefs();
}

export function loadPrefs() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return;

    const saved = JSON.parse(raw);

    if (typeof saved.tunnelUrl === "string") {
      state.tunnelUrl = saved.tunnelUrl.trim();
    }

    if (Array.isArray(saved.customResolutions)) {
      state.customResolutions = saved.customResolutions.filter(
        (x) => typeof x === "string"
      );
    }

    if (saved.resolution) {
      setResolution(saved.resolution, false);
    }

    state.batchSize = clampInt(saved.batchSize, 1, 4, 1);
    state.seedMode = saved.seedMode === "fixed" ? "fixed" : "random";
    state.fixedSeed = clampInt(saved.fixedSeed, 1, Number.MAX_SAFE_INTEGER, 0);

    if (typeof saved.sampler === "string" && saved.sampler) {
      state.sampler = saved.sampler;
    }

    if (typeof saved.scheduler === "string" && saved.scheduler) {
      state.scheduler = saved.scheduler;
    }

    state.steps = clampInt(saved.steps, 1, 50, 20);
    state.cfg = clampFloat(saved.cfg, 0, 20, 4.5);
    state.hiresScale = clampFloat(saved.hiresScale, 1, 4, 1.5);
  } catch {
    // ignore corrupt storage
  }
}

export function savePrefs() {
  try {
    localStorage.setItem(
      LS_KEY,
      JSON.stringify({
        tunnelUrl: state.tunnelUrl,
        resolution: state.resolution,
        customResolutions: state.customResolutions,
        batchSize: state.batchSize,
        seedMode: state.seedMode,
        fixedSeed: state.fixedSeed,
        sampler: state.sampler,
        scheduler: state.scheduler,
        steps: state.steps,
        cfg: state.cfg,
        hiresScale: state.hiresScale,
      })
    );
  } catch {
    // storage unavailable – non-fatal
  }
}

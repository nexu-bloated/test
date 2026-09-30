// static/js/main.js
/**
 * main.js – Entry point.
 * Initializes state, binds events, and connects modules.
 */
import { initLoraTriggers } from "./components/loraTriggers.js";
import * as api from "./api.js";
import {
  initPromptEditor,
  isPromptModalOpen,
  applyPromptModal,
  cancelPromptModal,
} from "./components/promptEditor.js";
import state, {
  RESOLUTION_PRESETS,
  addCustomResolution,
  loadPrefs,
  savePrefs,
  setFixedSeed,
  setResolution,
  setSeedMode,
  updatePref,
} from "./state.js";
import { initCivitaiSearch } from "./components/civitaiSearch.js";
import * as ui from "./ui.js";

import { submitGeneration } from "./components/generationForm.js";

import {
  applyRemixData,
  applyRemixToForm,
  closeInspect,
  currentInspectMeta,
  expectNewImages,
  extractComfyUIMetadata,
  navigateInspect,
  openInspect,
  openRemix,
  prefetchImageByIndex,
  refreshGallery,
  resetImageSession,
  startQueuePolling,
  stopQueuePolling,
} from "./components/imagePreview.js";

document.addEventListener("DOMContentLoaded", init);

function init() {
  loadPrefs();
  initLoraTriggers();
  ui.syncControlsFromState(state, RESOLUTION_PRESETS);

  initializeRangeFills();
  syncPromptCounts();
  syncHiresScaleButtons();
  syncHiresVisibility();

  bindEvents();
  initPromptEditor();
  if (state.tunnelUrl) {
    ui.els.tunnelUrl.value = state.tunnelUrl;
    connectUplink();
  }
  initCivitaiSearch();
}

function initializeRangeFills() {
  [
    ui.els.rangeSteps,
    ui.els.rangeCfg,
    ui.els.rangeBatch,
    ui.els.rangeHiresSteps,
    ui.els.rangeHiresCfg,
    ui.els.rangeHiresDenoise,
    ui.els.rangeHiresSharpen,
  ].forEach((el) => ui.updateRangeFill(el));
}

function syncPromptCounts() {
  ui.els.posCount.textContent = String(ui.els.posPrompt.value.length);
  ui.els.negCount.textContent = String(ui.els.negPrompt.value.length);
}

function syncHiresScaleButtons() {
  document.querySelectorAll(".hires-scale-btn").forEach((btn) => {
    const scale = parseFloat(btn.dataset.scale);
    btn.classList.toggle("is-active", scale === state.hiresScale);
  });
}

function syncHiresVisibility() {
  ui.els.hiresControls.hidden = !ui.els.hiresToggle.checked;
}

// ── uplink ──────────────────────────────────────────────────────────

async function connectUplink() {
  const url = ui.els.tunnelUrl.value.trim().replace(/\/+$/, "");

  if (!url) {
    ui.toast("Enter a tunnel URL first.", "danger");
    return;
  }

  stopQueuePolling();

  const tunnelChanged = state.tunnelUrl !== url;

  if (tunnelChanged) {
    resetImageSession();
    ui.renderGallery([], () => "");
  }

  state.tunnelUrl = url;
  savePrefs();

  ui.setConnectionStatus(false);
  ui.els.btnConnect.disabled = true;

  try {
    const [ckptRes, vaeRes, clipRes, samplerRes, loraRes] =
      await Promise.allSettled([
        api.getCheckpoints(url),
        api.getVaes(url),
        api.getClips(url),
        api.getSamplers(url),
        api.getLoras(url),
      ]);

    const anyOk =
      ckptRes.status === "fulfilled" ||
      vaeRes.status === "fulfilled" ||
      clipRes.status === "fulfilled" ||
      samplerRes.status === "fulfilled" ||
      loraRes.status === "fulfilled";

    if (!anyOk) {
      throw new Error("Could not reach ComfyUI through that tunnel.");
    }

    if (ckptRes.status === "fulfilled") {
      const list = ckptRes.value.checkpoints || [];

      ui.fillCheckpoints(
        list,
        ui.els.selCheckpoint.value || state.modelDefaults.checkpoint
      );

      if (!ui.els.selCheckpoint.value && list.length) {
        ui.els.selCheckpoint.value = list[0];
      }
    }

    if (vaeRes.status === "fulfilled") {
      const list = vaeRes.value.vaes || [];

      ui.fillVaes(list, ui.els.selVae.value || state.modelDefaults.vae);

      if (!ui.els.selVae.value && list.length) {
        ui.els.selVae.value = list[0];
      }
    }

    if (clipRes.status === "fulfilled") {
      const list = clipRes.value.clips || [];

      ui.fillClips(list, ui.els.selClip.value || state.modelDefaults.clip);

      if (!ui.els.selClip.value && list.length) {
        ui.els.selClip.value = list[0];
      }
    }

    if (samplerRes.status === "fulfilled") {
      const samplers = samplerRes.value.samplers || [];
      const schedulers = samplerRes.value.schedulers || [];

      ui.fillSamplers(samplers, schedulers, state.sampler, state.scheduler);

      if (!ui.els.selSampler.value && samplers.length) {
        ui.els.selSampler.value = samplers[0];
        updatePref("sampler", samplers[0], false);
      }

      if (!ui.els.selScheduler.value && schedulers.length) {
        ui.els.selScheduler.value = schedulers[0];
        updatePref("scheduler", schedulers[0], false);
      }
    }

    state._loraNames =
      loraRes.status === "fulfilled" ? loraRes.value.loras || [] : [];

    state.connected = true;

    ui.setConnectionStatus(true);
    ui.syncControlsFromState(state, RESOLUTION_PRESETS);

    ui.toast("Uplink connected ✓", "success");

    await refreshGallery(true);
    startQueuePolling();
  } catch (err) {
    state.connected = false;

    ui.setConnectionStatus(false);
    stopQueuePolling();

    ui.toast(err.message || "Connection failed.", "danger");
  } finally {
    ui.els.btnConnect.disabled = false;
  }
}

// ── modals ──────────────────────────────────────────────────────────

function openCustomResolutionModal() {
  ui.els.customWidth.value = state.width > 0 ? String(state.width) : "1152";
  ui.els.customHeight.value = state.height > 0 ? String(state.height) : "896";

  ui.setModalError(ui.els.customResError, "");
  ui.openModal(ui.els.customResModal);
}

function cancelCustomResolution() {
  ui.closeModal(ui.els.customResModal);
  ui.els.selResolution.value = state.resolution;
}

function confirmCustomResolution() {
  const width = parseInt(ui.els.customWidth.value, 10);
  const height = parseInt(ui.els.customHeight.value, 10);

  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 64 ||
    width > 4096 ||
    height < 64 ||
    height > 4096
  ) {
    ui.setModalError(
      ui.els.customResError,
      "Width and height must be whole numbers between 64 and 4096."
    );
    return;
  }

  addCustomResolution(width, height);

  ui.syncControlsFromState(state, RESOLUTION_PRESETS);
  ui.closeModal(ui.els.customResModal);

  ui.toast(`Resolution set to ${width} × ${height}.`, "success");
}

function openSeedModal(seed) {
  ui.els.seedInput.value =
    Number.isSafeInteger(seed) && seed > 0 ? String(seed) : "1";

  ui.setModalError(ui.els.seedError, "");
  ui.openModal(ui.els.seedModal);
}

function cancelSeedModal() {
  ui.closeModal(ui.els.seedModal);
  ui.syncControlsFromState(state, RESOLUTION_PRESETS);
}

function confirmSeedModal() {
  const seed = parseInt(ui.els.seedInput.value, 10);

  if (!Number.isSafeInteger(seed) || seed < 1) {
    ui.setModalError(ui.els.seedError, "Seed must be a positive integer.");
    return;
  }

  setFixedSeed(seed);
  setSeedMode("fixed");

  ui.syncControlsFromState(state, RESOLUTION_PRESETS);
  ui.closeModal(ui.els.seedModal);

  ui.toast(`Fixed seed set to ${seed}.`, "success");
}

// ── events ──────────────────────────────────────────────────────────

function bindEvents() {
  const requestGeneration = () => {
    submitGeneration(() => {
      expectNewImages();
    });
  };

  // Connect
  ui.els.btnConnect.addEventListener("click", connectUplink);

  ui.els.tunnelUrl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") connectUplink();
  });

  // Generate
  ui.els.btnGenerate.addEventListener("click", requestGeneration);

  // Expand editor
  ui.els.btnExpandEditor.addEventListener("click", () => {
    state.expanded = !state.expanded;
    ui.setExpanded(state.expanded);
  });

  // Resolution
  ui.els.selResolution.addEventListener("change", () => {
    const value = ui.els.selResolution.value;

    if (value === "custom") {
      openCustomResolutionModal();
    } else {
      setResolution(value);
    }
  });

  // Custom resolution modal
  ui.els.btnCustomConfirm.addEventListener("click", confirmCustomResolution);
  ui.els.btnCustomCancel.addEventListener("click", cancelCustomResolution);
  ui.els.btnCustomClose.addEventListener("click", cancelCustomResolution);

  ui.els.customResModal.addEventListener("click", (e) => {
    if (e.target === ui.els.customResModal) cancelCustomResolution();
  });

  // Seed mode
  ui.els.btnSeedRandom.addEventListener("click", () => {
    setSeedMode("random");
    ui.updateSeedUI("random", state.fixedSeed);
  });

  ui.els.btnSeedFixed.addEventListener("click", () => {
    openSeedModal(state.fixedSeed > 0 ? state.fixedSeed : 1);
  });

  ui.els.btnSeedValue.addEventListener("click", () => {
    if (state.seedMode === "fixed") {
      openSeedModal(state.fixedSeed > 0 ? state.fixedSeed : 1);
    }
  });

  // Seed modal
  ui.els.btnSeedConfirm.addEventListener("click", confirmSeedModal);
  ui.els.btnSeedCancel.addEventListener("click", cancelSeedModal);
  ui.els.btnSeedClose.addEventListener("click", cancelSeedModal);

  ui.els.seedModal.addEventListener("click", (e) => {
    if (e.target === ui.els.seedModal) cancelSeedModal();
  });

  ui.els.seedInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      confirmSeedModal();
    }
  });

  // Batch
  ui.els.rangeBatch.addEventListener("input", () => {
    const value = parseInt(ui.els.rangeBatch.value, 10);

    if (!Number.isNaN(value)) {
      updatePref("batchSize", value);
      ui.updateBatchUI(value);
    }
  });

  // Sampler / scheduler
  ui.els.selSampler.addEventListener("change", () => {
    updatePref("sampler", ui.els.selSampler.value);
  });

  ui.els.selScheduler.addEventListener("change", () => {
    updatePref("scheduler", ui.els.selScheduler.value);
  });

  // Steps / CFG
  ui.els.rangeSteps.addEventListener("input", () => {
    const value = parseInt(ui.els.rangeSteps.value, 10);

    if (!Number.isNaN(value)) {
      updatePref("steps", value);
      ui.els.stepsVal.textContent = String(value);
      ui.updateRangeFill(ui.els.rangeSteps);
    }
  });

  ui.els.rangeCfg.addEventListener("input", () => {
    const value = parseFloat(ui.els.rangeCfg.value);

    if (!Number.isNaN(value)) {
      updatePref("cfg", value);
      ui.els.cfgVal.textContent = Number(value).toFixed(1);
      ui.updateRangeFill(ui.els.rangeCfg);
    }
  });

  // LoRA
  ui.els.btnAddLora.addEventListener("click", () => {
    const names = state._loraNames || [];
    if (!names.length) {
      ui.toast("Connect uplink to load LoRAs.", "danger");
      return;
    }

    ui.addLoraRow(names);

  });

  // Prompt presets
  document.querySelectorAll(".prompt-preset").forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = document.getElementById(btn.dataset.target);
      if (!target) return;

      target.value = btn.dataset.text || "";
      target.dispatchEvent(new Event("input", { bubbles: true }));
    });
  });

  // Prompt char counts
  ui.els.posPrompt.addEventListener("input", () => {
    ui.els.posCount.textContent = String(ui.els.posPrompt.value.length);
  });

  ui.els.negPrompt.addEventListener("input", () => {
    ui.els.negCount.textContent = String(ui.els.negPrompt.value.length);
  });

  // Hires toggle
  ui.els.hiresToggle.addEventListener("change", syncHiresVisibility);

  // Hires scale buttons
  document.querySelectorAll(".hires-scale-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.hiresScale = parseFloat(btn.dataset.scale) || 1.5;
      savePrefs();
      syncHiresScaleButtons();
    });
  });

  // Hires ranges
  ui.els.rangeHiresSteps.addEventListener("input", () => {
    ui.els.hiresStepsVal.textContent = ui.els.rangeHiresSteps.value;
    ui.updateRangeFill(ui.els.rangeHiresSteps);
  });

  ui.els.rangeHiresCfg.addEventListener("input", () => {
    ui.els.hiresCfgVal.textContent = Number(
      ui.els.rangeHiresCfg.value
    ).toFixed(1);
    ui.updateRangeFill(ui.els.rangeHiresCfg);
  });

  ui.els.rangeHiresDenoise.addEventListener("input", () => {
    ui.els.hiresDenoiseVal.textContent = Number(
      ui.els.rangeHiresDenoise.value
    ).toFixed(2);
    ui.updateRangeFill(ui.els.rangeHiresDenoise);
  });

  ui.els.rangeHiresSharpen.addEventListener("input", () => {
    ui.els.hiresSharpenVal.textContent = Number(
      ui.els.rangeHiresSharpen.value
    ).toFixed(2);
    ui.updateRangeFill(ui.els.rangeHiresSharpen);
  });

  // Gallery controls
  ui.els.btnNewest.addEventListener("click", () => {
    state.gallerySort = "newest";
    refreshGallery(false);
  });

  ui.els.btnOldest.addEventListener("click", () => {
    state.gallerySort = "oldest";
    refreshGallery(false);
  });

  ui.els.btnSync.addEventListener("click", () => {
    refreshGallery(true);
  });

  // Gallery card interactions
  ui.els.galleryGrid.addEventListener("click", (e) => {
    const card = e.target.closest("[data-index]");
    if (card) openInspect(parseInt(card.dataset.index, 10));
  });

  ui.els.galleryGrid.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;

    const card = e.target.closest("[data-index]");
    if (!card) return;

    e.preventDefault();
    openInspect(parseInt(card.dataset.index, 10));
  });

  ui.els.galleryGrid.addEventListener("contextmenu", (e) => {
    const card = e.target.closest("[data-index]");
    if (!card) return;

    e.preventDefault();

    const idx = parseInt(card.dataset.index, 10);
    const meta = state.gallery[idx]?.meta;

    if (meta) openRemix(meta);
  });

  // Prefetch on hover/focus for faster inspect.
  ui.els.galleryGrid.addEventListener("pointerover", (e) => {
    const card = e.target.closest("[data-index]");
    if (!card) return;

    if (card.contains(e.relatedTarget)) return;

    prefetchImageByIndex(parseInt(card.dataset.index, 10));
  });

  ui.els.galleryGrid.addEventListener("focusin", (e) => {
    const card = e.target.closest("[data-index]");
    if (!card) return;

    prefetchImageByIndex(parseInt(card.dataset.index, 10));
  });

  // Inspect modal
  ui.els.btnInspectClose.addEventListener("click", closeInspect);
  ui.els.btnInspectPrev.addEventListener("click", () => navigateInspect(-1));
  ui.els.btnInspectNext.addEventListener("click", () => navigateInspect(1));

  ui.els.btnInspectDownload.addEventListener("click", () => {
    const img = state.gallery[state.inspectIndex];
    if (!img) return;

    const a = document.createElement("a");

    a.href = api.imageUrl(
      state.tunnelUrl,
      img.filename,
      img.subfolder,
      img.type,
      img.meta?.prompt_id || ""
    );

    a.download = img.filename;
    a.click();
  });

  ui.els.btnInspectCopyPrompt.addEventListener("click", async () => {
    const meta = currentInspectMeta();
    if (!meta?.pos) return;

    try {
      await navigator.clipboard.writeText(meta.pos);
      ui.toast("Prompt copied.", "info");
    } catch {
      ui.toast("Clipboard unavailable.", "danger");
    }
  });

  ui.els.btnInspectCopySeed.addEventListener("click", async () => {
    const meta = currentInspectMeta();
    if (!meta?.seed) return;

    try {
      await navigator.clipboard.writeText(String(meta.seed));
      ui.toast("Seed copied.", "info");
    } catch {
      ui.toast("Clipboard unavailable.", "danger");
    }
  });

  ui.els.btnInspectRemix.addEventListener("click", () => {
    const meta = currentInspectMeta();
    if (!meta) return;

    closeInspect();
    openRemix(meta);
  });

  ui.els.inspectModal.addEventListener("click", (e) => {
    if (e.target === ui.els.inspectModal) closeInspect();
  });

  // Remix modal
  ui.els.btnRemixApply.addEventListener("click", applyRemixToForm);
  ui.els.btnRemixClose.addEventListener("click", ui.hideRemix);
  ui.els.btnRemixClose2.addEventListener("click", ui.hideRemix);

  ui.els.remixModal.addEventListener("click", (e) => {
    if (e.target === ui.els.remixModal) ui.hideRemix();
  });

  // Drag-and-drop a ComfyUI PNG to inject its embedded prompt metadata.
  let dragCounter = 0;

  const showDropZone = () => {
    ui.els.dropZone?.classList.add("is-visible");
    ui.els.dropZone?.setAttribute("aria-hidden", "false");
  };

  const hideDropZone = () => {
    ui.els.dropZone?.classList.remove("is-visible");
    ui.els.dropZone?.setAttribute("aria-hidden", "true");
  };

  window.addEventListener("dragenter", (e) => {
    if (!e.dataTransfer?.types.includes("Files")) return;

    e.preventDefault();

    dragCounter += 1;
    showDropZone();
  });

  window.addEventListener("dragover", (e) => {
    if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
  });

  window.addEventListener("dragleave", (e) => {
    if (!e.dataTransfer?.types.includes("Files")) return;

    e.preventDefault();

    dragCounter = Math.max(0, dragCounter - 1);

    if (!dragCounter) hideDropZone();
  });

  window.addEventListener("drop", async (e) => {
    if (!e.dataTransfer?.files?.length) return;

    e.preventDefault();

    dragCounter = 0;
    hideDropZone();

    const file = e.dataTransfer.files[0];

    const isPng =
      file.type === "image/png" || file.name.toLowerCase().endsWith(".png");

    if (!isPng) {
      ui.toast("Payload format rejected — PNG required.", "danger");
      return;
    }

    try {
      applyRemixData(await extractComfyUIMetadata(file));
    } catch (err) {
      ui.toast(err.message || "No ComfyUI metadata found in PNG.", "danger");
    }
  });

  // Global keyboard behavior
  document.addEventListener("keydown", (e) => {
    // Expanded prompt editor takes priority.
    if (isPromptModalOpen()) {
      if (e.key === "Escape") {
        e.preventDefault();
        cancelPromptModal();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        applyPromptModal();
        return;
      }

      // Let normal typing / modal focus trapping continue.
      return;
    }

    if (e.key === "Escape") {
      if (ui.isOpen(ui.els.customResModal)) {
        cancelCustomResolution();
        return;
      }

      if (ui.isOpen(ui.els.seedModal)) {
        cancelSeedModal();
        return;
      }

      if (ui.isOpen(ui.els.remixModal)) {
        ui.hideRemix();
        return;
      }

      if (ui.isOpen(ui.els.inspectModal)) {
        ui.hideInspect();
        return;
      }
    }

    if (ui.isOpen(ui.els.inspectModal) && !ui.isOpen(ui.els.remixModal)) {
      if (e.key === "ArrowLeft") navigateInspect(-1);
      if (e.key === "ArrowRight") navigateInspect(1);

      if (e.key === "d" || e.key === "D") {
        ui.els.btnInspectDownload.click();
      }

      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      requestGeneration();
    }
  });
}

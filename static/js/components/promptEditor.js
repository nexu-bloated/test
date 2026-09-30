// static/js/components/promptEditor.js
/**
 * promptEditor.js
 *
 * Adds the older barebones "expand prompt editor" behavior
 * to the current modular Nexus UI.
 *
 * Behavior:
 * - Expand positive/negative prompt into a larger modal editor
 * - Apply button writes changes back to the original textarea
 * - Click outside the modal applies changes
 * - Cancel / ✕ closes without applying
 * - Escape cancels
 */

import * as ui from "../ui.js";

let els = {};
let activeType = null; // "positive" | "negative"

function getPromptTextarea(type) {
  return type === "negative" ? els.negPrompt : els.posPrompt;
}

function updateModalCharCount() {
  if (!els.promptModalCharCount || !els.promptModalArea) return;

  const len = els.promptModalArea.value.length;
  els.promptModalCharCount.textContent = `${len} characters`;
}

export function isPromptModalOpen() {
  return !!(els.promptModal && ui.isOpen(els.promptModal));
}

export function openPromptModal(type) {
  if (!els.promptModal || !els.promptModalArea) return;

  activeType = type === "negative" ? "negative" : "positive";

  const source = getPromptTextarea(activeType);
  if (!source) return;

  if (els.promptModalLabel) {
    els.promptModalLabel.textContent =
      activeType === "positive" ? "Positive Prompt" : "Negative Prompt";

    els.promptModalLabel.classList.toggle(
      "nexus-prompt-label--positive",
      activeType === "positive"
    );

    els.promptModalLabel.classList.toggle(
      "nexus-prompt-label--negative",
      activeType === "negative"
    );
  }

  els.promptModalArea.value = source.value;
  els.promptModalArea.classList.toggle(
    "is-negative",
    activeType === "negative"
  );

  updateModalCharCount();

  ui.openModal(els.promptModal);

  // Put caret at end for a more natural editing feel.
  requestAnimationFrame(() => {
    if (!els.promptModalArea) return;

    els.promptModalArea.focus();

    const pos = els.promptModalArea.value.length;
    els.promptModalArea.setSelectionRange(pos, pos);
  });
}

export function applyPromptModal() {
  if (!activeType) return;

  const target = getPromptTextarea(activeType);

  if (target && els.promptModalArea) {
    target.value = els.promptModalArea.value;

    // Trigger existing char-count / input listeners.
    target.dispatchEvent(new Event("input", { bubbles: true }));
  }

  const focusTarget = target;

  closePromptModal();

  if (focusTarget) {
    try {
      focusTarget.focus({ preventScroll: true });
    } catch {
      focusTarget.focus();
    }
  }

  ui.toast("Prompt applied", "success");
}

export function cancelPromptModal() {
  if (!els.promptModal) return;
  closePromptModal();
}

function closePromptModal() {
  activeType = null;

  if (els.promptModal) {
    ui.closeModal(els.promptModal);
  }
}

async function copyToClipboard(text, emptyMessage, successMessage) {
  if (!text || !text.trim()) {
    ui.toast(emptyMessage, "danger");
    return;
  }

  try {
    await navigator.clipboard.writeText(text);
    ui.toast(successMessage, "success");
  } catch {
    ui.toast("Clipboard unavailable", "danger");
  }
}

export function copyPrompt(type) {
  const source = getPromptTextarea(type);
  copyToClipboard(
    source?.value || "",
    "Prompt is empty",
    "Prompt copied"
  );
}

export function copyPromptModal() {
  copyToClipboard(
    els.promptModalArea?.value || "",
    "Prompt is empty",
    "Copied to clipboard"
  );
}

export function initPromptEditor() {
  els = {
    posPrompt: document.getElementById("posPrompt"),
    negPrompt: document.getElementById("negPrompt"),

    btnPosExpand: document.getElementById("btnPosExpand"),
    btnPosCopy: document.getElementById("btnPosCopy"),

    btnNegExpand: document.getElementById("btnNegExpand"),
    btnNegCopy: document.getElementById("btnNegCopy"),

    promptModal: document.getElementById("promptModal"),
    promptModalLabel: document.getElementById("promptModalLabel"),
    promptModalArea: document.getElementById("promptModalArea"),
    promptModalCharCount: document.getElementById("promptModalCharCount"),

    btnPromptModalApply: document.getElementById("btnPromptModalApply"),
    btnPromptModalCancel: document.getElementById("btnPromptModalCancel"),
    btnPromptModalCancelFooter: document.getElementById(
      "btnPromptModalCancelFooter"
    ),
    btnPromptModalCopy: document.getElementById("btnPromptModalCopy"),
  };

  if (!els.promptModal || !els.promptModalArea) {
    return;
  }

  // Inline expand/copy buttons
  els.btnPosExpand?.addEventListener("click", () => {
    openPromptModal("positive");
  });

  els.btnNegExpand?.addEventListener("click", () => {
    openPromptModal("negative");
  });

  els.btnPosCopy?.addEventListener("click", () => {
    copyPrompt("positive");
  });

  els.btnNegCopy?.addEventListener("click", () => {
    copyPrompt("negative");
  });

  // Modal editor live char count
  els.promptModalArea.addEventListener("input", updateModalCharCount);

  // Modal actions
  els.btnPromptModalApply?.addEventListener("click", applyPromptModal);

  els.btnPromptModalCancel?.addEventListener("click", cancelPromptModal);

  els.btnPromptModalCancelFooter?.addEventListener("click", cancelPromptModal);

  els.btnPromptModalCopy?.addEventListener("click", copyPromptModal);

  // Click outside the modal applies changes,
  // unless the user is currently selecting text.
  els.promptModal.addEventListener("click", (e) => {
    if (e.target !== els.promptModal) return;

    const selection = window.getSelection?.();
    if (selection && selection.toString()) return;

    applyPromptModal();
  });
}

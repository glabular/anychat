import {
  describeAuthSaveError,
  fetchAuthStatus,
  putApiKey,
} from "./api.js";
import { hideAnytypeAuthNotice } from "./anytype-auth-notice.js";

/**
 * Paste / replace Anytype API key. Save probes Anytype then persists via the API.
 */

let modalBound = false;
/** @type {HTMLElement | null} */
let focusBeforeOpen = null;
let submitInFlight = false;
/** @type {(() => void | Promise<void>) | null} */
let onSavedCallback = null;

function getRoot() {
  return document.getElementById("api-key-setup-modal");
}

function getDialog() {
  return document.getElementById("api-key-setup-dialog");
}

function getKeyInput() {
  return /** @type {HTMLInputElement | null} */ (
    document.getElementById("api-key-setup-input")
  );
}

function getForm() {
  return /** @type {HTMLFormElement | null} */ (
    document.getElementById("api-key-setup-form")
  );
}

function getSubmitButton() {
  return /** @type {HTMLButtonElement | null} */ (
    document.getElementById("api-key-setup-submit")
  );
}

function getCancelButton() {
  return document.getElementById("api-key-setup-cancel");
}

function getCloseButton() {
  return document.getElementById("api-key-setup-close");
}

function getErrorEl() {
  return document.getElementById("api-key-setup-error");
}

function getHintEl() {
  return document.getElementById("api-key-setup-hint");
}

function getTitleEl() {
  return document.getElementById("api-key-setup-title");
}

export function isApiKeySetupModalOpen() {
  const root = getRoot();
  return Boolean(root && !root.hidden);
}

function clearError() {
  const errorEl = getErrorEl();
  if (!errorEl) {
    return;
  }
  errorEl.hidden = true;
  errorEl.textContent = "";
}

/**
 * @param {string} message
 */
function showError(message) {
  const errorEl = getErrorEl();
  if (!errorEl) {
    return;
  }
  errorEl.textContent = message;
  errorEl.hidden = false;
}

/**
 * @param {boolean} inFlight
 */
function setSubmitInFlight(inFlight) {
  submitInFlight = inFlight;
  const cancel = getCancelButton();
  const close = getCloseButton();
  const input = getKeyInput();
  if (cancel instanceof HTMLButtonElement) {
    cancel.disabled = inFlight;
  }
  if (close instanceof HTMLButtonElement) {
    close.disabled = inFlight;
  }
  if (input) {
    input.disabled = inFlight;
  }
  syncSaveEnabled();
}

function syncSaveEnabled() {
  const submit = getSubmitButton();
  const input = getKeyInput();
  if (!submit) {
    return;
  }

  const hasText = Boolean(input?.value?.trim());
  submit.disabled = submitInFlight || !hasText;
}

/**
 * @param {{ restoreFocus?: boolean }} [options]
 * @returns {boolean}
 */
export function closeApiKeySetupModal({ restoreFocus = true } = {}) {
  const root = getRoot();
  if (!root || root.hidden) {
    return false;
  }

  if (submitInFlight) {
    return true;
  }

  root.hidden = true;
  clearError();
  setSubmitInFlight(false);

  const input = getKeyInput();
  if (input) {
    input.value = "";
  }
  syncSaveEnabled();

  if (restoreFocus && focusBeforeOpen instanceof HTMLElement) {
    focusBeforeOpen.focus({ preventScroll: true });
  }
  focusBeforeOpen = null;
  return true;
}

/**
 * @param {{ reason?: "missing" | "invalid" | "settings"; onSaved?: () => void | Promise<void> }} [options]
 */
export async function openApiKeySetupModal(options = {}) {
  const root = getRoot();
  const input = getKeyInput();
  const title = getTitleEl();
  const hint = getHintEl();
  if (!root || !input) {
    return;
  }

  // Always refresh the post-save hook when opening from spaces / settings.
  onSavedCallback =
    typeof options.onSaved === "function" ? options.onSaved : onSavedCallback;

  focusBeforeOpen =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

  clearError();
  setSubmitInFlight(false);
  input.value = "";
  syncSaveEnabled();

  let configured = false;
  try {
    const status = await fetchAuthStatus();
    configured = Boolean(status?.configured);
  } catch {
    // Status fetch failed — still allow paste.
  }

  const reason = options.reason || (configured ? "settings" : "missing");

  if (title) {
    if (reason === "invalid") {
      title.textContent = "API key is incorrect";
    } else if (reason === "settings" && configured) {
      title.textContent = "API key settings";
    } else {
      title.textContent = "Set up API key";
    }
  }

  if (hint) {
    hint.hidden = false;
    if (reason === "invalid") {
      hint.textContent =
        "The stored Anytype API key was rejected. Paste a valid key to continue.";
    } else {
      hint.textContent =
        "Paste the API key from the Anytype app.";
    }
  }

  root.hidden = false;
  input.focus({ preventScroll: true });
}

async function handleSubmit() {
  if (submitInFlight) {
    return;
  }

  const input = getKeyInput();
  const apiKey = input?.value?.trim() ?? "";
  if (!apiKey) {
    showError("Paste an API key to continue.");
    input?.focus({ preventScroll: true });
    return;
  }

  // Keep any existing error visible while checking — clearing it then
  // re-showing the same rejection message causes a layout flicker.
  setSubmitInFlight(true);

  try {
    await putApiKey(apiKey);
    hideAnytypeAuthNotice();
    setSubmitInFlight(false);
    closeApiKeySetupModal({ restoreFocus: false });

    const cb = onSavedCallback;
    onSavedCallback = null;
    if (typeof cb === "function") {
      await cb();
    }
  } catch (error) {
    console.error("Could not save API key:", error);
    showError(describeAuthSaveError(error));
    setSubmitInFlight(false);
    input?.focus({ preventScroll: true });
  }
}

export function initApiKeySetupModal() {
  if (modalBound) {
    return;
  }

  const root = getRoot();
  const form = getForm();
  const cancel = getCancelButton();
  const close = getCloseButton();
  if (!root || !form || !cancel || !close) {
    return;
  }

  modalBound = true;

  const input = getKeyInput();
  input?.addEventListener("input", () => {
    clearError();
    syncSaveEnabled();
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void handleSubmit();
  });

  cancel.addEventListener("click", () => {
    closeApiKeySetupModal({ restoreFocus: true });
  });

  close.addEventListener("click", () => {
    closeApiKeySetupModal({ restoreFocus: true });
  });

  root.addEventListener("mousedown", (event) => {
    if (event.target === root) {
      event.preventDefault();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") {
      return;
    }
    if (!isApiKeySetupModalOpen()) {
      return;
    }
    event.preventDefault();
    closeApiKeySetupModal({ restoreFocus: true });
  });
}

/**
 * Wire the post-save reload (spaces) without a cycle at module load.
 * @param {() => void | Promise<void>} callback
 */
export function setApiKeySetupOnSaved(callback) {
  onSavedCallback = callback;
}

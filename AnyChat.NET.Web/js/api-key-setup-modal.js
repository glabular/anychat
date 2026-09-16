import {
  createAuthChallenge,
  describeAuthSaveError,
  fetchAuthStatus,
  putApiKey,
  putApiKeyFromChallenge,
} from "./api.js";
import { applyIdentityNoticeStatus } from "./identity-notice.js";

/**
 * Connect / replace Anytype API key via challenge (preferred) or paste.
 */

/** @typedef {"choose" | "challenge" | "paste"} SetupStep */

/** Anytype’s code window lasts ~30s; only offer a new request after it has expired. */
const RESEND_VISIBLE_AFTER_MS = 31_000;

let modalBound = false;
/** @type {HTMLElement | null} */
let focusBeforeOpen = null;
let submitInFlight = false;
/** @type {(() => void | Promise<void>) | null} */
let onSavedCallback = null;
/** @type {string | null} */
let activeChallengeId = null;
/** @type {"missing" | "invalid" | "settings"} */
let openReason = "missing";
/** @type {ReturnType<typeof setTimeout> | null} */
let resendRevealTimer = null;

function getRoot() {
  return document.getElementById("api-key-setup-modal");
}

function getStepChoose() {
  return document.getElementById("api-key-setup-step-choose");
}

function getStepChallenge() {
  return document.getElementById("api-key-setup-step-challenge");
}

function getStepPaste() {
  return document.getElementById("api-key-setup-step-paste");
}

function getKeyInput() {
  return /** @type {HTMLInputElement | null} */ (
    document.getElementById("api-key-setup-input")
  );
}

function getCodeInput() {
  return /** @type {HTMLInputElement | null} */ (
    document.getElementById("api-key-setup-code-input")
  );
}

function getPasteForm() {
  return /** @type {HTMLFormElement | null} */ (
    document.getElementById("api-key-setup-form")
  );
}

function getChallengeForm() {
  return /** @type {HTMLFormElement | null} */ (
    document.getElementById("api-key-setup-challenge-form")
  );
}

function getPasteSubmitButton() {
  return /** @type {HTMLButtonElement | null} */ (
    document.getElementById("api-key-setup-submit")
  );
}

function getChallengeSubmitButton() {
  return /** @type {HTMLButtonElement | null} */ (
    document.getElementById("api-key-setup-challenge-submit")
  );
}

function getConnectButton() {
  return /** @type {HTMLButtonElement | null} */ (
    document.getElementById("api-key-setup-connect")
  );
}

function getPasteInsteadButton() {
  return /** @type {HTMLButtonElement | null} */ (
    document.getElementById("api-key-setup-paste-instead")
  );
}

function getChallengeBackButton() {
  return document.getElementById("api-key-setup-challenge-back");
}

function getChallengeResendButton() {
  return /** @type {HTMLButtonElement | null} */ (
    document.getElementById("api-key-setup-challenge-resend")
  );
}

function clearResendRevealTimer() {
  if (resendRevealTimer !== null) {
    clearTimeout(resendRevealTimer);
    resendRevealTimer = null;
  }
}

function hideChallengeResend() {
  clearResendRevealTimer();
  const resend = getChallengeResendButton();
  if (resend) {
    resend.hidden = true;
  }
}

function scheduleChallengeResendReveal() {
  hideChallengeResend();
  resendRevealTimer = setTimeout(() => {
    resendRevealTimer = null;
    const resend = getChallengeResendButton();
    if (resend) {
      resend.hidden = false;
    }
  }, RESEND_VISIBLE_AFTER_MS);
}

function getPasteBackButton() {
  return document.getElementById("api-key-setup-paste-back");
}

function getErrorEl() {
  return document.getElementById("api-key-setup-error");
}

function getChooseLeadEl() {
  return document.getElementById("api-key-setup-choose-lead");
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

function isConnectionRequired() {
  return openReason === "missing" || openReason === "invalid";
}

/**
 * @param {boolean} inFlight
 */
function setSubmitInFlight(inFlight) {
  submitInFlight = inFlight;
  const challengeBack = getChallengeBackButton();
  const challengeResend = getChallengeResendButton();
  const pasteBack = getPasteBackButton();
  const connect = getConnectButton();
  const pasteInstead = getPasteInsteadButton();
  const keyInput = getKeyInput();
  const codeInput = getCodeInput();

  for (const el of [
    challengeBack,
    challengeResend,
    pasteBack,
    connect,
    pasteInstead,
  ]) {
    if (el instanceof HTMLButtonElement) {
      el.disabled = inFlight;
    }
  }
  if (keyInput) {
    keyInput.disabled = inFlight;
  }
  if (codeInput) {
    codeInput.disabled = inFlight;
  }
  syncActionEnabled();
}

function syncActionEnabled() {
  const pasteSubmit = getPasteSubmitButton();
  const challengeSubmit = getChallengeSubmitButton();
  const keyInput = getKeyInput();
  const codeInput = getCodeInput();

  if (pasteSubmit) {
    const hasText = Boolean(keyInput?.value?.trim());
    pasteSubmit.disabled = submitInFlight || !hasText;
  }

  if (challengeSubmit) {
    const code = codeInput?.value?.trim() ?? "";
    const codeOk = /^\d{4}$/.test(code);
    challengeSubmit.disabled = submitInFlight || !codeOk || !activeChallengeId;
  }
}

/**
 * @param {SetupStep} step
 */
function showStep(step) {
  const choose = getStepChoose();
  const challenge = getStepChallenge();
  const paste = getStepPaste();

  if (choose) {
    choose.hidden = step !== "choose";
  }
  if (challenge) {
    challenge.hidden = step !== "challenge";
  }
  if (paste) {
    paste.hidden = step !== "paste";
  }

  syncActionEnabled();
}

function applyTitleAndHints() {
  const title = getTitleEl();
  const chooseLead = getChooseLeadEl();
  const pasteHint = getHintEl();

  if (title) {
    if (openReason === "invalid") {
      title.textContent = "Connection rejected";
    } else if (openReason === "settings") {
      title.textContent = "Anytype connection";
    } else {
      title.textContent = "Connect to Anytype";
    }
  }

  if (chooseLead) {
    if (openReason === "invalid") {
      chooseLead.hidden = false;
      chooseLead.textContent =
        "Your previous connection stopped working. Follow these steps to connect again:";
    } else if (openReason === "settings") {
      chooseLead.hidden = false;
      chooseLead.textContent =
        "To replace your connection, follow these steps:";
    } else {
      chooseLead.hidden = true;
      chooseLead.textContent = "";
    }
  }

  if (pasteHint) {
    if (openReason === "invalid") {
      pasteHint.textContent =
        "The stored Anytype API key was rejected. Paste a valid key to continue.";
    } else {
      pasteHint.textContent = "Paste the API key from the Anytype app.";
    }
  }
}

/**
 * @param {{ restoreFocus?: boolean; force?: boolean }} [options]
 * @returns {boolean}
 */
export function closeApiKeySetupModal({
  restoreFocus = true,
  force = false,
} = {}) {
  const root = getRoot();
  if (!root || root.hidden) {
    return false;
  }

  if (submitInFlight) {
    return true;
  }

  // Missing/invalid: stay open until the user connects (unless force after save).
  if (!force && isConnectionRequired()) {
    return true;
  }

  root.hidden = true;
  clearError();
  setSubmitInFlight(false);
  activeChallengeId = null;
  hideChallengeResend();
  showStep("choose");

  const keyInput = getKeyInput();
  if (keyInput) {
    keyInput.value = "";
  }
  const codeInput = getCodeInput();
  if (codeInput) {
    codeInput.value = "";
  }
  syncActionEnabled();

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
  const connect = getConnectButton();
  if (!root || !connect) {
    return;
  }

  onSavedCallback =
    typeof options.onSaved === "function" ? options.onSaved : onSavedCallback;

  focusBeforeOpen =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

  clearError();
  setSubmitInFlight(false);
  activeChallengeId = null;

  const keyInput = getKeyInput();
  if (keyInput) {
    keyInput.value = "";
  }
  const codeInput = getCodeInput();
  if (codeInput) {
    codeInput.value = "";
  }

  let configured = false;
  try {
    const status = await fetchAuthStatus();
    configured = Boolean(status?.configured);
  } catch {
    // Status fetch failed — still allow setup.
  }

  openReason = options.reason || (configured ? "settings" : "missing");
  applyTitleAndHints();
  showStep("choose");

  root.hidden = false;
  connect.focus({ preventScroll: true });
}

async function finishSaveSuccess(status) {
  applyIdentityNoticeStatus({
    configured: status?.configured === true,
    identityKnown: status?.identityKnown === true,
  });
  setSubmitInFlight(false);
  closeApiKeySetupModal({ restoreFocus: false, force: true });

  const cb = onSavedCallback;
  onSavedCallback = null;
  if (typeof cb === "function") {
    await cb();
  }
}

/**
 * @param {{ fromRetry?: boolean }} [options]
 */
async function startChallengeFlow(options = {}) {
  if (submitInFlight) {
    return;
  }

  const fromRetry = options.fromRetry === true;
  clearError();
  if (fromRetry) {
    hideChallengeResend();
  }
  setSubmitInFlight(true);

  try {
    const result = await createAuthChallenge();
    const challengeId =
      typeof result?.challengeId === "string" ? result.challengeId.trim() : "";
    if (!challengeId) {
      throw Object.assign(new Error("Challenge missing id"), { status: 400 });
    }

    activeChallengeId = challengeId;
    const codeInput = getCodeInput();
    if (codeInput) {
      codeInput.value = "";
    }
    showStep("challenge");
    scheduleChallengeResendReveal();
    setSubmitInFlight(false);
    codeInput?.focus({ preventScroll: true });
  } catch (error) {
    console.error("Could not start Anytype challenge:", error);
    showError(describeAuthSaveError(error, { context: "challenge" }));
    setSubmitInFlight(false);
    if (fromRetry) {
      // Keep the link visible so the user can try again after a failed request.
      const resend = getChallengeResendButton();
      if (resend) {
        resend.hidden = false;
      }
      resend?.focus({ preventScroll: true });
    } else {
      getConnectButton()?.focus({ preventScroll: true });
    }
  }
}

async function handleChallengeSubmit() {
  if (submitInFlight) {
    return;
  }

  const codeInput = getCodeInput();
  const code = codeInput?.value?.trim() ?? "";
  if (!/^\d{4}$/.test(code) || !activeChallengeId) {
    showError("Enter the 4-digit code from Anytype Desktop.");
    codeInput?.focus({ preventScroll: true });
    return;
  }

  setSubmitInFlight(true);

  try {
    const status = await putApiKeyFromChallenge(activeChallengeId, code);
    await finishSaveSuccess(status);
  } catch (error) {
    console.error("Could not complete Anytype challenge:", error);
    showError(describeAuthSaveError(error, { context: "challenge" }));
    setSubmitInFlight(false);
    codeInput?.focus({ preventScroll: true });
  }
}

async function handlePasteSubmit() {
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

  setSubmitInFlight(true);

  try {
    const status = await putApiKey(apiKey);
    await finishSaveSuccess(status);
  } catch (error) {
    console.error("Could not save API key:", error);
    showError(describeAuthSaveError(error, { context: "paste" }));
    setSubmitInFlight(false);
    input?.focus({ preventScroll: true });
  }
}

function goBackToChoose() {
  if (submitInFlight) {
    return;
  }

  clearError();
  activeChallengeId = null;
  hideChallengeResend();
  const codeInput = getCodeInput();
  if (codeInput) {
    codeInput.value = "";
  }
  const keyInput = getKeyInput();
  if (keyInput) {
    keyInput.value = "";
  }
  showStep("choose");
  getConnectButton()?.focus({ preventScroll: true });
}

export function initApiKeySetupModal() {
  if (modalBound) {
    return;
  }

  const root = getRoot();
  const pasteForm = getPasteForm();
  const challengeForm = getChallengeForm();
  const connect = getConnectButton();
  const pasteInstead = getPasteInsteadButton();
  const challengeBack = getChallengeBackButton();
  const challengeResend = getChallengeResendButton();
  const pasteBack = getPasteBackButton();
  if (
    !root ||
    !pasteForm ||
    !challengeForm ||
    !connect ||
    !pasteInstead ||
    !challengeBack ||
    !challengeResend ||
    !pasteBack
  ) {
    return;
  }

  modalBound = true;

  const keyInput = getKeyInput();
  keyInput?.addEventListener("input", () => {
    clearError();
    syncActionEnabled();
  });

  const codeInput = getCodeInput();
  codeInput?.addEventListener("input", () => {
    // Keep digits only for a 4-digit Anytype code.
    if (codeInput.value) {
      codeInput.value = codeInput.value.replace(/\D/g, "").slice(0, 4);
    }
    clearError();
    syncActionEnabled();
  });

  pasteForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void handlePasteSubmit();
  });

  challengeForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void handleChallengeSubmit();
  });

  connect.addEventListener("click", () => {
    void startChallengeFlow();
  });

  challengeResend.addEventListener("click", () => {
    void startChallengeFlow({ fromRetry: true });
  });

  pasteInstead.addEventListener("click", () => {
    if (submitInFlight) {
      return;
    }
    clearError();
    showStep("paste");
    getKeyInput()?.focus({ preventScroll: true });
  });

  challengeBack.addEventListener("click", () => {
    goBackToChoose();
  });

  pasteBack.addEventListener("click", () => {
    goBackToChoose();
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

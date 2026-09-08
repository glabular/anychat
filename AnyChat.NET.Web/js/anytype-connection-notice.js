/** @type {ReturnType<typeof setInterval> | null} */
let countdownTimer = null;

/** @type {ReturnType<typeof setTimeout> | null} */
let recoveryTimer = null;

/** True while the recovery probe loop owns backoff (including mid-fetch). */
let recoveryProbeActive = false;

/** True while a probe fetch is in flight. */
let recoveryProbeInFlight = false;

let noticeClickBound = false;

let recoveryBackoffMs = 1000;
const RECOVERY_BACKOFF_MS_MIN = 1000;
const RECOVERY_BACKOFF_MS_MAX = 30000;

/** @type {(() => void | Promise<void>) | null} */
let onRecoveredCallback = null;

function getNotice() {
  return document.getElementById("anytype-connection-notice");
}

function getRetryRow() {
  return document.getElementById("anytype-connection-notice-retry");
}

function getRetryText() {
  return document.getElementById("anytype-connection-notice-retry-text");
}

function probeSpacesUrl() {
  const onApiHost =
    (window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1") &&
    window.location.port === "5249";
  return onApiHost ? "/api/spaces" : "http://localhost:5249/api/spaces";
}

export function isAnytypeConnectionNoticeVisible() {
  const notice = getNotice();
  return Boolean(notice && !notice.hidden);
}

function ensureNoticeClickBound() {
  if (noticeClickBound) {
    return;
  }

  const notice = getNotice();
  if (!notice) {
    return;
  }

  noticeClickBound = true;
  notice.addEventListener("click", () => {
    void onAnytypeConnectionNoticeClick();
  });
}

function shakeNoticeIfBusy() {
  const notice = getNotice();
  if (!notice) {
    return;
  }

  notice.classList.remove("anytype-connection-notice--shaking");
  // Restart animation if already shaking.
  void notice.offsetWidth;
  notice.classList.add("anytype-connection-notice--shaking");
}

/**
 * Click: retry now, or shake if a retry is already running.
 */
async function onAnytypeConnectionNoticeClick() {
  if (!isAnytypeConnectionNoticeVisible()) {
    return;
  }

  if (recoveryProbeInFlight) {
    shakeNoticeIfBusy();
    return;
  }

  clearAnytypeReconnectCountdown();
  clearRecoveryTimer();
  recoveryProbeActive = true;
  void runRecoveryProbe({ fromUserClick: true });
}

/**
 * @param {{ onRecovered?: () => void | Promise<void> }} [options]
 */
export function showAnytypeConnectionNotice(options = {}) {
  ensureNoticeClickBound();

  if (typeof options.onRecovered === "function") {
    onRecoveredCallback = options.onRecovered;
  }

  const notice = getNotice();
  if (notice) {
    notice.hidden = false;
  }

  startAnytypeRecoveryProbe();
}

/**
 * Hide the global Anytype-down notice (call when Anytype is reachable again).
 * @param {{ clearRetry?: boolean }} [options]
 */
export function hideAnytypeConnectionNotice(options = {}) {
  const clearRetry = options.clearRetry !== false;
  stopAnytypeRecoveryProbe();
  if (clearRetry) {
    clearAnytypeReconnectCountdown();
    const retry = getRetryRow();
    if (retry) {
      retry.hidden = true;
    }
  }

  const notice = getNotice();
  if (notice) {
    notice.classList.remove("anytype-connection-notice--shaking");
    notice.hidden = true;
  }
}

export function clearAnytypeReconnectCountdown() {
  if (countdownTimer !== null) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
}

/**
 * @param {string} text
 * @param {{ showSpinner?: boolean }} [options]
 */
export function setAnytypeReconnectRetryText(text, options = {}) {
  const showSpinner = options.showSpinner === true;
  const retry = getRetryRow();
  const textEl = getRetryText();
  const spinner = document.getElementById("anytype-connection-notice-spinner");
  if (!retry || !textEl) {
    return;
  }
  retry.hidden = false;
  textEl.textContent = text;
  if (spinner) {
    spinner.hidden = !showSpinner;
  }
}

/**
 * @param {number} delayMs
 */
export function startAnytypeReconnectCountdown(delayMs) {
  clearAnytypeReconnectCountdown();

  let secondsLeft = Math.max(1, Math.ceil(delayMs / 1000));
  setAnytypeReconnectRetryText(formatRetryInSeconds(secondsLeft), {
    showSpinner: false,
  });

  countdownTimer = setInterval(() => {
    secondsLeft -= 1;
    if (secondsLeft <= 0) {
      clearAnytypeReconnectCountdown();
      setAnytypeReconnectRetryText("Trying again...", { showSpinner: true });
      return;
    }
    setAnytypeReconnectRetryText(formatRetryInSeconds(secondsLeft), {
      showSpinner: false,
    });
  }, 1000);
}

/**
 * @param {number} seconds
 */
function formatRetryInSeconds(seconds) {
  return `Trying again in ${seconds} seconds`;
}

function clearRecoveryTimer() {
  if (recoveryTimer !== null) {
    clearTimeout(recoveryTimer);
    recoveryTimer = null;
  }
}

function stopAnytypeRecoveryProbe() {
  clearRecoveryTimer();
  recoveryProbeActive = false;
  recoveryProbeInFlight = false;
  recoveryBackoffMs = RECOVERY_BACKOFF_MS_MIN;
}

/**
 * Background probe so startup / REST failures recover after Anytype is opened.
 * Safe to call repeatedly; only one probe loop runs (backoff is not reset).
 */
function startAnytypeRecoveryProbe() {
  if (recoveryProbeActive) {
    return;
  }

  recoveryProbeActive = true;
  recoveryBackoffMs = RECOVERY_BACKOFF_MS_MIN;
  scheduleRecoveryProbe(recoveryBackoffMs);
}

/**
 * @param {number} delayMs
 */
function scheduleRecoveryProbe(delayMs) {
  clearRecoveryTimer();
  startAnytypeReconnectCountdown(delayMs);

  recoveryTimer = setTimeout(() => {
    recoveryTimer = null;
    void runRecoveryProbe();
  }, delayMs);
}

/**
 * @param {{ fromUserClick?: boolean }} [options]
 */
async function runRecoveryProbe(options = {}) {
  if (!isAnytypeConnectionNoticeVisible()) {
    stopAnytypeRecoveryProbe();
    return;
  }

  if (recoveryProbeInFlight) {
    if (options.fromUserClick) {
      shakeNoticeIfBusy();
    }
    return;
  }

  recoveryProbeInFlight = true;
  setAnytypeReconnectRetryText("Trying again...", { showSpinner: true });

  try {
    const response = await fetch(probeSpacesUrl());
    if (response.ok) {
      const recovered = onRecoveredCallback;
      noteAnytypeReachable();
      if (recovered) {
        try {
          await recovered();
        } catch (error) {
          console.error("Anytype recovery reload failed:", error);
        }
      }
      return;
    }
    // Stay on the existing notice; do not re-enter showAnytypeConnectionNotice
    // (that would reset backoff).
  } catch (error) {
    console.error("Anytype recovery probe failed:", error);
  } finally {
    recoveryProbeInFlight = false;
  }

  if (!isAnytypeConnectionNoticeVisible()) {
    stopAnytypeRecoveryProbe();
    return;
  }

  // Manual click keeps current backoff step; scheduled failures still grow.
  if (!options.fromUserClick) {
    recoveryBackoffMs = Math.min(recoveryBackoffMs * 2, RECOVERY_BACKOFF_MS_MAX);
  }
  scheduleRecoveryProbe(recoveryBackoffMs);
}

/**
 * Inspect a failed API response: if Anytype is down, show the global notice.
 * @param {Response} response
 * @returns {Promise<boolean>} true when the body reported anytype_unavailable
 */
export async function noteAnytypeUnavailableFromResponse(response) {
  if (response.status !== 503) {
    return false;
  }

  try {
    const body = await response.clone().json();
    if (body?.error === "anytype_unavailable") {
      showAnytypeConnectionNotice();
      return true;
    }
  } catch {
    // Non-JSON 503 — ignore.
  }

  return false;
}

/** Successful Anytype-backed API call — clear the global notice. */
export function noteAnytypeReachable() {
  if (isAnytypeConnectionNoticeVisible()) {
    hideAnytypeConnectionNotice();
  }
}

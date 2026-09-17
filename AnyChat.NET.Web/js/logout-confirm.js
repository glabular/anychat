/**
 * Confirm before clearing the local Anytype API key and identity.
 */

let modalBound = false;
/** @type {HTMLElement | null} */
let focusBeforeOpen = null;
let logoutInFlight = false;

function getRoot() {
  return document.getElementById("logout-confirm-modal");
}

function getCancelButton() {
  return document.getElementById("logout-confirm-cancel");
}

function getConfirmButton() {
  return /** @type {HTMLButtonElement | null} */ (
    document.getElementById("logout-confirm-submit")
  );
}

function getErrorEl() {
  return document.getElementById("logout-confirm-error");
}

export function isLogoutConfirmOpen() {
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
 * @param {unknown} error
 */
function describeLogoutError(error) {
  const status = error && typeof error === "object" ? error.status : undefined;

  if (typeof status === "number") {
    return `Could not log out (HTTP ${status}).`;
  }

  if (error instanceof TypeError) {
    return "Cannot reach the API.";
  }

  return "Could not log out.";
}

/**
 * @param {boolean} inFlight
 */
function setLogoutInFlight(inFlight) {
  logoutInFlight = inFlight;
  const cancel = getCancelButton();
  const confirm = getConfirmButton();
  if (cancel instanceof HTMLButtonElement) {
    cancel.disabled = inFlight;
  }
  if (confirm) {
    confirm.disabled = inFlight;
  }
}

/**
 * @param {{ restoreFocus?: boolean }} [options]
 * @returns {boolean}
 */
export function closeLogoutConfirm({ restoreFocus = true } = {}) {
  const root = getRoot();
  if (!root || root.hidden) {
    return false;
  }

  if (logoutInFlight) {
    return true;
  }

  root.hidden = true;
  clearError();
  setLogoutInFlight(false);

  if (restoreFocus && focusBeforeOpen instanceof HTMLElement) {
    focusBeforeOpen.focus({ preventScroll: true });
  }
  focusBeforeOpen = null;
  return true;
}

export function openLogoutConfirm() {
  const root = getRoot();
  const cancel = getCancelButton();
  if (!root || !(cancel instanceof HTMLButtonElement)) {
    return;
  }

  focusBeforeOpen =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

  clearError();
  setLogoutInFlight(false);
  root.hidden = false;
  // Safer default: focus Cancel so Enter does not log out by accident.
  cancel.focus({ preventScroll: true });
}

async function handleConfirmLogout() {
  if (logoutInFlight) {
    return;
  }

  clearError();
  setLogoutInFlight(true);

  try {
    const { performLogout } = await import("./settings.js");
    await performLogout();
    setLogoutInFlight(false);
    closeLogoutConfirm({ restoreFocus: false });
  } catch (error) {
    console.error("Could not log out:", error);
    showError(describeLogoutError(error));
    setLogoutInFlight(false);
  }
}

export function initLogoutConfirm() {
  if (modalBound) {
    return;
  }

  const root = getRoot();
  const cancel = getCancelButton();
  const confirm = getConfirmButton();
  if (!root || !cancel || !confirm) {
    return;
  }

  modalBound = true;

  cancel.addEventListener("click", () => {
    closeLogoutConfirm({ restoreFocus: true });
  });

  confirm.addEventListener("click", () => {
    void handleConfirmLogout();
  });

  root.addEventListener("mousedown", (event) => {
    if (event.target === root) {
      event.preventDefault();
    }
  });
}

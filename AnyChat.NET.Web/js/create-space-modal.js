import { createSpace } from "./api.js";

/**
 * Create-space modal: open/close via + / Esc / X; submit creates via API.
 */

let modalBound = false;
/** @type {HTMLElement | null} */
let focusBeforeOpen = null;
let submitInFlight = false;

function getRoot() {
  return document.getElementById("create-space-modal");
}

function getDialog() {
  return document.getElementById("create-space-dialog");
}

function getNameInput() {
  return /** @type {HTMLInputElement | null} */ (
    document.getElementById("create-space-name")
  );
}

function getDescriptionInput() {
  return /** @type {HTMLTextAreaElement | null} */ (
    document.getElementById("create-space-description")
  );
}

function getCloseButton() {
  return document.getElementById("create-space-close");
}

function getForm() {
  return /** @type {HTMLFormElement | null} */ (
    document.getElementById("create-space-form")
  );
}

function getSubmitButton() {
  return /** @type {HTMLButtonElement | null} */ (
    document.getElementById("create-space-submit")
  );
}

function getErrorEl() {
  return document.getElementById("create-space-error");
}

export function isCreateSpaceModalOpen() {
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
function describeCreateSpaceError(error) {
  const status = error && typeof error === "object" ? error.status : undefined;

  if (status === 503) {
    return "Lost connection to Anytype. Open the official Anytype app and try again.";
  }

  if (status === 400) {
    return "Space name is required.";
  }

  if (typeof status === "number") {
    return `Could not create space (HTTP ${status}).`;
  }

  if (error instanceof TypeError) {
    return "Cannot reach the API.";
  }

  return "Could not create space.";
}

/**
 * @param {boolean} inFlight
 */
function setSubmitInFlight(inFlight) {
  submitInFlight = inFlight;
  const submit = getSubmitButton();
  const nameInput = getNameInput();
  const descriptionInput = getDescriptionInput();
  if (submit) {
    submit.disabled = inFlight;
  }
  if (nameInput) {
    nameInput.disabled = inFlight;
  }
  if (descriptionInput) {
    descriptionInput.disabled = inFlight;
  }
}

/**
 * @param {{ restoreFocus?: boolean }} [options]
 * @returns {boolean} true if the modal was open and is now closed
 */
export function closeCreateSpaceModal({ restoreFocus = true } = {}) {
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

  const nameInput = getNameInput();
  if (nameInput) {
    nameInput.value = "";
    nameInput.disabled = false;
  }

  const descriptionInput = getDescriptionInput();
  if (descriptionInput) {
    descriptionInput.value = "";
    descriptionInput.disabled = false;
  }

  if (restoreFocus && focusBeforeOpen instanceof HTMLElement) {
    focusBeforeOpen.focus({ preventScroll: true });
  }
  focusBeforeOpen = null;
  return true;
}

export function openCreateSpaceModal() {
  const root = getRoot();
  const dialog = getDialog();
  const nameInput = getNameInput();
  const descriptionInput = getDescriptionInput();
  if (!root || !dialog || !nameInput || !descriptionInput) {
    return;
  }

  if (!root.hidden) {
    nameInput.focus({ preventScroll: true });
    return;
  }

  focusBeforeOpen =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

  clearError();
  setSubmitInFlight(false);
  nameInput.value = "";
  nameInput.disabled = false;
  descriptionInput.value = "";
  descriptionInput.disabled = false;
  root.hidden = false;
  nameInput.focus({ preventScroll: true });
}

async function handleCreateSpaceSubmit() {
  if (submitInFlight) {
    return;
  }

  const nameInput = getNameInput();
  const descriptionInput = getDescriptionInput();
  if (!nameInput || !descriptionInput) {
    return;
  }

  const name = nameInput.value.trim();
  if (name.length === 0) {
    showError("Enter a space name.");
    nameInput.focus({ preventScroll: true });
    return;
  }

  const description = descriptionInput.value.trim();

  clearError();
  setSubmitInFlight(true);

  try {
    const space = await createSpace(name, description);
    if (!space?.id) {
      showError("Space was created but no id was returned.");
      return;
    }

    setSubmitInFlight(false);
    closeCreateSpaceModal({ restoreFocus: false });

    // Dynamic import avoids spaces.js ↔ create-space-modal.js cycle.
    const { reloadSpacesAndSelect } = await import("./spaces.js");
    await reloadSpacesAndSelect(space.id);
  } catch (error) {
    console.error("Could not create space:", error);
    showError(describeCreateSpaceError(error));
  } finally {
    if (isCreateSpaceModalOpen()) {
      setSubmitInFlight(false);
      nameInput.focus({ preventScroll: true });
    }
  }
}

export function initCreateSpaceModal() {
  if (modalBound) {
    return;
  }

  const root = getRoot();
  const form = getForm();
  const closeButton = getCloseButton();
  if (!root || !form || !closeButton) {
    return;
  }

  modalBound = true;

  closeButton.addEventListener("click", () => {
    if (submitInFlight) {
      return;
    }
    closeCreateSpaceModal({ restoreFocus: true });
  });

  // Backdrop clicks must not close (product rule). Swallow only.
  root.addEventListener("mousedown", (event) => {
    if (event.target === root) {
      event.preventDefault();
    }
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void handleCreateSpaceSubmit();
  });
}

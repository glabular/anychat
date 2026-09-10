/**
 * Create-chat modal shell: open/close only via + / Esc / X.
 * Submit wiring lands in a later step.
 */

let modalBound = false;
/** @type {HTMLElement | null} */
let focusBeforeOpen = null;

function getRoot() {
  return document.getElementById("create-chat-modal");
}

function getDialog() {
  return document.getElementById("create-chat-dialog");
}

function getNameInput() {
  return /** @type {HTMLInputElement | null} */ (
    document.getElementById("create-chat-name")
  );
}

function getCloseButton() {
  return document.getElementById("create-chat-close");
}

function getForm() {
  return /** @type {HTMLFormElement | null} */ (
    document.getElementById("create-chat-form")
  );
}

function getErrorEl() {
  return document.getElementById("create-chat-error");
}

export function isCreateChatModalOpen() {
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
 * @param {{ restoreFocus?: boolean }} [options]
 * @returns {boolean} true if the modal was open and is now closed
 */
export function closeCreateChatModal({ restoreFocus = true } = {}) {
  const root = getRoot();
  if (!root || root.hidden) {
    return false;
  }

  root.hidden = true;
  clearError();

  const nameInput = getNameInput();
  if (nameInput) {
    nameInput.value = "";
  }

  if (restoreFocus && focusBeforeOpen instanceof HTMLElement) {
    focusBeforeOpen.focus({ preventScroll: true });
  }
  focusBeforeOpen = null;
  return true;
}

export function openCreateChatModal() {
  const root = getRoot();
  const dialog = getDialog();
  const nameInput = getNameInput();
  if (!root || !dialog || !nameInput) {
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
  nameInput.value = "";
  root.hidden = false;
  nameInput.focus({ preventScroll: true });
}

export function initCreateChatModal() {
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
    closeCreateChatModal({ restoreFocus: true });
  });

  // Backdrop clicks must not close (product rule). Swallow only.
  root.addEventListener("mousedown", (event) => {
    if (event.target === root) {
      event.preventDefault();
    }
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    // Step 5 wires createChat + refresh/open.
  });
}

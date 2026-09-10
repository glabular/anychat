import { createChat } from "./api.js";

/**
 * Create-chat modal: open/close via + / Esc / X; submit creates via API.
 */

let modalBound = false;
/** @type {HTMLElement | null} */
let focusBeforeOpen = null;
let submitInFlight = false;

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

function getSubmitButton() {
  return /** @type {HTMLButtonElement | null} */ (
    document.getElementById("create-chat-submit")
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
function describeCreateChatError(error) {
  const status = error && typeof error === "object" ? error.status : undefined;

  if (status === 503) {
    return "Lost connection to Anytype. Open the official Anytype app and try again.";
  }

  if (status === 400) {
    return "Could not create chat.";
  }

  if (typeof status === "number") {
    return `Could not create chat (HTTP ${status}).`;
  }

  if (error instanceof TypeError) {
    return "Cannot reach the API.";
  }

  return "Could not create chat.";
}

/**
 * @param {boolean} inFlight
 */
function setSubmitInFlight(inFlight) {
  submitInFlight = inFlight;
  const submit = getSubmitButton();
  const nameInput = getNameInput();
  if (submit) {
    submit.disabled = inFlight;
  }
  if (nameInput) {
    nameInput.disabled = inFlight;
  }
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
  setSubmitInFlight(false);
  nameInput.value = "";
  nameInput.disabled = false;
  root.hidden = false;
  nameInput.focus({ preventScroll: true });
}

async function handleCreateChatSubmit() {
  if (submitInFlight) {
    return;
  }

  const nameInput = getNameInput();
  if (!nameInput) {
    return;
  }

  const selectedSpace = document.querySelector('input[name="space"]:checked');
  if (!selectedSpace) {
    showError("Select a space first.");
    return;
  }

  const name = nameInput.value.trim();

  clearError();
  setSubmitInFlight(true);

  try {
    const chat = await createChat(selectedSpace.value, name);
    if (!chat?.id) {
      showError("Chat was created but no id was returned.");
      return;
    }

    setSubmitInFlight(false);
    closeCreateChatModal({ restoreFocus: false });

    // Dynamic import avoids chats.js ↔ create-chat-modal.js cycle.
    const { loadChatsForSelectedSpace, seedChatActivityCreatedAt } = await import(
      "./chats.js"
    );
    seedChatActivityCreatedAt(selectedSpace.value, chat.id);
    await loadChatsForSelectedSpace({ openChatId: chat.id });
  } catch (error) {
    console.error("Could not create chat:", error);
    showError(describeCreateChatError(error));
  } finally {
    if (isCreateChatModalOpen()) {
      setSubmitInFlight(false);
      nameInput.focus({ preventScroll: true });
    }
  }
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
    if (submitInFlight) {
      return;
    }
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
    void handleCreateChatSubmit();
  });
}

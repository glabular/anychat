import { deleteChat } from "./api.js";

/**
 * Confirm + archive the open chat via DELETE / objects delete.
 */

let modalBound = false;
/** @type {HTMLElement | null} */
let focusBeforeOpen = null;
let deleteInFlight = false;

function getRoot() {
  return document.getElementById("delete-chat-modal");
}

function getCancelButton() {
  return document.getElementById("delete-chat-cancel");
}

function getConfirmButton() {
  return /** @type {HTMLButtonElement | null} */ (
    document.getElementById("delete-chat-confirm")
  );
}

function getErrorEl() {
  return document.getElementById("delete-chat-error");
}

export function isDeleteChatConfirmOpen() {
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
function describeDeleteChatError(error) {
  const status = error && typeof error === "object" ? error.status : undefined;

  if (status === 503) {
    return "Lost connection to Anytype. Open the official Anytype app and try again.";
  }

  if (typeof status === "number") {
    return `Could not delete chat (HTTP ${status}).`;
  }

  if (error instanceof TypeError) {
    return "Cannot reach the API.";
  }

  return "Could not delete chat.";
}

/**
 * @param {boolean} inFlight
 */
function setDeleteInFlight(inFlight) {
  deleteInFlight = inFlight;
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
export function closeDeleteChatConfirm({ restoreFocus = true } = {}) {
  const root = getRoot();
  if (!root || root.hidden) {
    return false;
  }

  if (deleteInFlight) {
    return true;
  }

  root.hidden = true;
  clearError();
  setDeleteInFlight(false);

  if (restoreFocus && focusBeforeOpen instanceof HTMLElement) {
    focusBeforeOpen.focus({ preventScroll: true });
  }
  focusBeforeOpen = null;
  return true;
}

export async function openDeleteChatConfirm() {
  const root = getRoot();
  const confirm = getConfirmButton();
  if (!root || !confirm) {
    return;
  }

  // Dynamic import avoids chat-view ↔ this module cycle.
  const { getOpenChat } = await import("./chat-view.js");
  const open = getOpenChat();
  if (!open?.spaceId || !open?.chatId) {
    return;
  }

  focusBeforeOpen =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

  clearError();
  setDeleteInFlight(false);
  root.hidden = false;
  confirm.focus({ preventScroll: true });
}

async function handleConfirmDelete() {
  if (deleteInFlight) {
    return;
  }

  const { getOpenChat, hideChatPanel } = await import("./chat-view.js");
  const open = getOpenChat();
  if (!open?.spaceId || !open?.chatId) {
    showError("No chat is open.");
    return;
  }

  const { spaceId, chatId } = open;
  clearError();
  setDeleteInFlight(true);

  try {
    await deleteChat(spaceId, chatId);

    const { clearChatActivitySeed, loadChatsForSelectedSpace } = await import(
      "./chats.js"
    );
    clearChatActivitySeed(spaceId, chatId);

    setDeleteInFlight(false);
    closeDeleteChatConfirm({ restoreFocus: false });
    hideChatPanel();
    await loadChatsForSelectedSpace();
  } catch (error) {
    console.error("Could not delete chat:", error);
    showError(describeDeleteChatError(error));
    setDeleteInFlight(false);
  }
}

export function initDeleteChatConfirm() {
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
    closeDeleteChatConfirm({ restoreFocus: true });
  });

  confirm.addEventListener("click", () => {
    void handleConfirmDelete();
  });

  root.addEventListener("mousedown", (event) => {
    if (event.target === root) {
      event.preventDefault();
    }
  });
}

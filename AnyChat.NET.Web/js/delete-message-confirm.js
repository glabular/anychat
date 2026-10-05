import { deleteChatMessage } from "./api.js";

/**
 * Confirm + delete an owned open-chat message via DELETE messages API.
 */

let modalBound = false;
/** @type {HTMLElement | null} */
let focusBeforeOpen = null;
let deleteInFlight = false;

/** @type {{ spaceId: string, chatId: string, messageId: string } | null} */
let pendingDelete = null;

function getRoot() {
  return document.getElementById("delete-message-modal");
}

function getCancelButton() {
  return document.getElementById("delete-message-cancel");
}

function getConfirmButton() {
  return /** @type {HTMLButtonElement | null} */ (
    document.getElementById("delete-message-confirm")
  );
}

function getErrorEl() {
  return document.getElementById("delete-message-error");
}

export function isDeleteMessageConfirmOpen() {
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
function describeDeleteMessageError(error) {
  const status = error && typeof error === "object" ? error.status : undefined;

  if (status === 403) {
    return "You can only delete your own messages.";
  }

  if (status === 404) {
    return "That message is no longer available.";
  }

  if (status === 503) {
    return "Lost connection to Anytype. Open the official Anytype app and try again.";
  }

  if (typeof status === "number") {
    return `Could not delete message (HTTP ${status}).`;
  }

  if (error instanceof TypeError) {
    return "Cannot reach the API.";
  }

  return "Could not delete message.";
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
export function closeDeleteMessageConfirm({ restoreFocus = true } = {}) {
  const root = getRoot();
  if (!root || root.hidden) {
    return false;
  }

  if (deleteInFlight) {
    return true;
  }

  root.hidden = true;
  pendingDelete = null;
  clearError();
  setDeleteInFlight(false);

  if (restoreFocus && focusBeforeOpen instanceof HTMLElement) {
    focusBeforeOpen.focus({ preventScroll: true });
  }
  focusBeforeOpen = null;
  return true;
}

/**
 * @param {{ spaceId: string, chatId: string, messageId: string }} target
 */
export function openDeleteMessageConfirm(target) {
  const root = getRoot();
  const confirm = getConfirmButton();
  if (!root || !confirm) {
    return;
  }

  if (
    typeof target?.spaceId !== "string"
    || !target.spaceId
    || typeof target?.chatId !== "string"
    || !target.chatId
    || typeof target?.messageId !== "string"
    || !target.messageId
  ) {
    return;
  }

  pendingDelete = {
    spaceId: target.spaceId,
    chatId: target.chatId,
    messageId: target.messageId,
  };

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
  if (deleteInFlight || !pendingDelete) {
    return;
  }

  const { spaceId, chatId, messageId } = pendingDelete;
  clearError();
  setDeleteInFlight(true);

  try {
    const { getOpenChatDeletableMessage } = await import("./chats.js");
    const deletable = getOpenChatDeletableMessage(messageId);
    if (
      !deletable
      || deletable.spaceId !== spaceId
      || deletable.chatId !== chatId
    ) {
      showError("You can only delete your own messages.");
      setDeleteInFlight(false);
      return;
    }

    await deleteChatMessage(spaceId, chatId, messageId);

    const { getMessageEditSession, cancelMessageEdit } = await import(
      "./message-edit.js"
    );
    const editSession = getMessageEditSession();
    if (editSession?.messageId === messageId) {
      cancelMessageEdit({ restoreFocus: false });
    }

    const { removeOpenChatMessageById } = await import("./chats.js");
    removeOpenChatMessageById(messageId);

    setDeleteInFlight(false);
    closeDeleteMessageConfirm({ restoreFocus: false });
  } catch (error) {
    console.error("Could not delete message:", error);
    showError(describeDeleteMessageError(error));
    setDeleteInFlight(false);
  }
}

export function initDeleteMessageConfirm() {
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
    closeDeleteMessageConfirm({ restoreFocus: true });
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

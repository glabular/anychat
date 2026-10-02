/**
 * Edit-mode session for correcting an own message in the composer.
 * Save uses PATCH via the composer submit path in chat-view.
 */

/** @type {{
 *   messageId: string,
 *   spaceId: string,
 *   chatId: string,
 *   originalText: string,
 *   preEditDraft: string,
 * } | null} */
let session = null;

let cancelButtonBound = false;

function getChatMessageInput() {
  const input = document.getElementById("chat-message-input");
  return input instanceof HTMLTextAreaElement ? input : null;
}

function getComposer() {
  return document.getElementById("chat-composer");
}

function getEditBanner() {
  return document.getElementById("message-edit-banner");
}

function setComposerEditingClass(editing) {
  getComposer()?.classList.toggle("chat-composer--editing", editing);
}

function setEditBannerVisible(visible) {
  const banner = getEditBanner();
  if (banner) {
    banner.hidden = !visible;
  }
}

function syncInputAfterProgrammaticChange() {
  const input = getChatMessageInput();
  if (!input) {
    return;
  }
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

/**
 * @param {string | null | undefined} messageId
 * @param {boolean} editing
 */
function setMessageBubbleEditing(messageId, editing) {
  if (typeof messageId !== "string" || !messageId) {
    return;
  }

  const list = document.getElementById("chat-message-list");
  const row = list?.querySelector(
    `.message-row[data-message-id="${CSS.escape(messageId)}"]`
  );
  const bubble = row?.querySelector(".message-bubble");
  bubble?.classList.toggle("message-bubble--editing", editing);
}

function clearEditingUi(previousMessageId) {
  setComposerEditingClass(false);
  setEditBannerVisible(false);
  setMessageBubbleEditing(previousMessageId, false);
}

function showEditingUi(messageId) {
  setComposerEditingClass(true);
  setEditBannerVisible(true);
  setMessageBubbleEditing(messageId, true);
}

export function isMessageEditOpen() {
  return session !== null;
}

/** @returns {typeof session} */
export function getMessageEditSession() {
  return session;
}

/**
 * Enter edit mode for a message. Loads text into the composer and keeps the
 * prior draft for cancel. Switching to another message keeps the first
 * pre-edit draft.
 *
 * @param {{
 *   messageId: string,
 *   text: string,
 *   spaceId: string,
 *   chatId: string,
 * }} options
 * @returns {boolean}
 */
export function enterMessageEdit({ messageId, text, spaceId, chatId }) {
  const input = getChatMessageInput();
  if (
    !input
    || typeof messageId !== "string"
    || !messageId
    || typeof spaceId !== "string"
    || !spaceId
    || typeof chatId !== "string"
    || !chatId
    || typeof text !== "string"
  ) {
    return false;
  }

  const previousMessageId = session?.messageId ?? null;

  if (!session) {
    session = {
      messageId,
      spaceId,
      chatId,
      originalText: text,
      preEditDraft: input.value,
    };
  } else {
    session = {
      messageId,
      spaceId,
      chatId,
      originalText: text,
      preEditDraft: session.preEditDraft,
    };
  }

  if (previousMessageId && previousMessageId !== messageId) {
    setMessageBubbleEditing(previousMessageId, false);
  }

  input.value = text;
  const end = text.length;
  input.setSelectionRange(end, end);
  showEditingUi(messageId);
  syncInputAfterProgrammaticChange();
  input.focus({ preventScroll: true });
  return true;
}

/**
 * Exit edit mode without calling the API. Restores the pre-edit composer draft.
 * @param {{ restoreFocus?: boolean }} [options]
 * @returns {boolean} true if an edit session was active
 */
export function cancelMessageEdit({ restoreFocus = false } = {}) {
  if (!session) {
    return false;
  }

  const { preEditDraft, messageId } = session;
  session = null;
  clearEditingUi(messageId);

  const input = getChatMessageInput();
  if (input) {
    input.value = preEditDraft;
    syncInputAfterProgrammaticChange();
    if (restoreFocus) {
      input.focus({ preventScroll: true });
    }
  }

  return true;
}

/** Wire the banner Cancel control once. */
export function initMessageEditUi() {
  if (cancelButtonBound) {
    return;
  }

  const cancelButton = document.getElementById("message-edit-cancel");
  if (!(cancelButton instanceof HTMLButtonElement)) {
    return;
  }

  cancelButtonBound = true;
  cancelButton.addEventListener("click", () => {
    cancelMessageEdit({ restoreFocus: true });
  });
}

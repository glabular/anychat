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

function getChatMessageInput() {
  const input = document.getElementById("chat-message-input");
  return input instanceof HTMLTextAreaElement ? input : null;
}

function getComposer() {
  return document.getElementById("chat-composer");
}

function setComposerEditingClass(editing) {
  getComposer()?.classList.toggle("chat-composer--editing", editing);
}

function syncInputAfterProgrammaticChange() {
  const input = getChatMessageInput();
  if (!input) {
    return;
  }
  input.dispatchEvent(new Event("input", { bubbles: true }));
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

  input.value = text;
  const end = text.length;
  input.setSelectionRange(end, end);
  setComposerEditingClass(true);
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

  const { preEditDraft } = session;
  session = null;
  setComposerEditingClass(false);

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

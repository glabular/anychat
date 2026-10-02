/**
 * Edit-mode session for correcting an own message in the composer.
 * Save uses PATCH via the composer submit path in chat-view.
 *
 * Active edits can be parked per chat when switching chats/spaces (session
 * memory only). Parked edit text is NOT a sidebar "Draft:" compose draft.
 */

/** @type {{
 *   messageId: string,
 *   spaceId: string,
 *   chatId: string,
 *   originalText: string,
 *   preEditDraft: string,
 * } | null} */
let session = null;

/**
 * Parked edits keyed by spaceId+chatId.
 * @type {Map<string, {
 *   messageId: string,
 *   spaceId: string,
 *   chatId: string,
 *   originalText: string,
 *   preEditDraft: string,
 *   editedDraftText: string,
 * }>}
 */
const parkedEdits = new Map();

let cancelButtonBound = false;

function editSessionKey(spaceId, chatId) {
  return JSON.stringify([spaceId, chatId]);
}

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
 * Drop a parked edit for a chat (after save/cancel). Does not touch the
 * active session.
 * @param {string} spaceId
 * @param {string} chatId
 */
export function clearParkedMessageEdit(spaceId, chatId) {
  if (typeof spaceId !== "string" || typeof chatId !== "string") {
    return;
  }
  parkedEdits.delete(editSessionKey(spaceId, chatId));
}

/** Drop all parked edits (e.g. logout). Does not touch the active session. */
export function clearAllParkedMessageEdits() {
  parkedEdits.clear();
}

/**
 * Park the active edit (including current composer text) for this chat, then
 * put the pre-edit compose draft back in the input so normal draft persist
 * does not store edit text or show a list Draft indicator for it.
 * @returns {boolean} true if an active edit was parked
 */
export function parkActiveMessageEdit() {
  if (!session) {
    return false;
  }

  const input = getChatMessageInput();
  const editedDraftText = input?.value ?? session.originalText;
  const key = editSessionKey(session.spaceId, session.chatId);

  parkedEdits.set(key, {
    messageId: session.messageId,
    spaceId: session.spaceId,
    chatId: session.chatId,
    originalText: session.originalText,
    preEditDraft: session.preEditDraft,
    editedDraftText,
  });

  const { messageId, preEditDraft } = session;
  session = null;
  clearEditingUi(messageId);

  if (input) {
    input.value = preEditDraft;
    syncInputAfterProgrammaticChange();
  }

  return true;
}

/**
 * Resume a parked edit for the given chat (composer text + editing chrome).
 * @param {string} spaceId
 * @param {string} chatId
 * @returns {boolean}
 */
export function restoreParkedMessageEdit(spaceId, chatId) {
  if (typeof spaceId !== "string" || typeof chatId !== "string") {
    return false;
  }

  const key = editSessionKey(spaceId, chatId);
  const parked = parkedEdits.get(key);
  if (!parked) {
    return false;
  }

  parkedEdits.delete(key);

  const input = getChatMessageInput();
  if (!input) {
    // Keep parked if we cannot restore into the composer yet.
    parkedEdits.set(key, parked);
    return false;
  }

  if (session) {
    clearEditingUi(session.messageId);
  }

  session = {
    messageId: parked.messageId,
    spaceId: parked.spaceId,
    chatId: parked.chatId,
    originalText: parked.originalText,
    preEditDraft: parked.preEditDraft,
  };

  input.value = parked.editedDraftText;
  const end = parked.editedDraftText.length;
  input.setSelectionRange(end, end);
  showEditingUi(parked.messageId);
  syncInputAfterProgrammaticChange();
  return true;
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

  clearParkedMessageEdit(spaceId, chatId);

  if (
    session
    && (session.spaceId !== spaceId || session.chatId !== chatId)
  ) {
    parkActiveMessageEdit();
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
 * Exit edit mode without calling the API. Restores the pre-edit composer draft
 * and drops any parked edit for that chat.
 * @param {{ restoreFocus?: boolean }} [options]
 * @returns {boolean} true if an edit session was active
 */
export function cancelMessageEdit({ restoreFocus = false } = {}) {
  if (!session) {
    return false;
  }

  const { preEditDraft, messageId, spaceId, chatId } = session;
  clearParkedMessageEdit(spaceId, chatId);
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

import { isChatMessagesAtLatest } from "./chat-messages-scroll.js";

/**
 * Session-only scroll memory for the messages feed.
 * Keyed like drafts/previews: JSON.stringify([spaceId, chatId]).
 *
 * @typedef {{ atLatest: true }} ChatScrollAtLatest
 * @typedef {{ messageId: string, offsetPx: number }} ChatScrollMessageAnchor
 * @typedef {ChatScrollAtLatest | ChatScrollMessageAnchor} ChatScrollAnchor
 */

/** @type {Map<string, ChatScrollAnchor>} */
const chatScrollMemory = new Map();

/**
 * @param {string} spaceId
 * @param {string} chatId
 * @returns {string}
 */
export function chatScrollKey(spaceId, chatId) {
  return JSON.stringify([spaceId, chatId]);
}

/**
 * @param {HTMLElement | null | undefined} container
 * @returns {HTMLElement[]}
 */
function getMessageRows(container) {
  if (!container) {
    return [];
  }

  const list =
    container.querySelector("#chat-message-list") ?? container;
  return Array.from(
    list.querySelectorAll(
      ".message-row[data-message-id], .message-row[data-client-temp-id]"
    )
  );
}

/**
 * Topmost row that intersects the scrollport (or the first below the top).
 * @param {HTMLElement} container
 * @param {HTMLElement[]} rows
 * @returns {HTMLElement | null}
 */
function findTopVisibleRow(container, rows) {
  const containerTop = container.getBoundingClientRect().top;

  for (const row of rows) {
    const rect = row.getBoundingClientRect();
    if (rect.bottom > containerTop) {
      return row;
    }
  }

  return rows.length > 0 ? rows[rows.length - 1] : null;
}

/**
 * Prefer data-message-id on the row; else walk previous message rows.
 * @param {HTMLElement} row
 * @param {HTMLElement[]} rows
 * @returns {string | null}
 */
function resolveStableMessageId(row, rows) {
  const ownId = row.dataset.messageId;
  if (typeof ownId === "string" && ownId.length > 0) {
    return ownId;
  }

  const index = rows.indexOf(row);
  for (let i = index - 1; i >= 0; i -= 1) {
    const id = rows[i].dataset.messageId;
    if (typeof id === "string" && id.length > 0) {
      return id;
    }
  }

  return null;
}

/**
 * Snapshot the current reading place in `#chat-messages`.
 * @param {HTMLElement | null | undefined} container
 * @returns {ChatScrollAnchor | null}
 */
export function captureChatScrollAnchor(container) {
  if (!container) {
    return null;
  }

  if (isChatMessagesAtLatest(container)) {
    return { atLatest: true };
  }

  const rows = getMessageRows(container);
  const topRow = findTopVisibleRow(container, rows);
  if (!topRow) {
    return null;
  }

  const messageId = resolveStableMessageId(topRow, rows);
  if (!messageId) {
    return { atLatest: true };
  }

  const offsetPx =
    topRow.getBoundingClientRect().top
    - container.getBoundingClientRect().top;

  return { messageId, offsetPx };
}

/**
 * @param {string} spaceId
 * @param {string} chatId
 * @param {ChatScrollAnchor} anchor
 */
export function rememberChatScroll(spaceId, chatId, anchor) {
  if (!spaceId || !chatId || !anchor) {
    return;
  }

  chatScrollMemory.set(chatScrollKey(spaceId, chatId), anchor);
}

/**
 * Read and remove the saved anchor for this chat.
 * @param {string} spaceId
 * @param {string} chatId
 * @returns {ChatScrollAnchor | null}
 */
export function takeChatScroll(spaceId, chatId) {
  const key = chatScrollKey(spaceId, chatId);
  const anchor = chatScrollMemory.get(key) ?? null;
  chatScrollMemory.delete(key);
  return anchor;
}

/**
 * @param {string} spaceId
 * @param {string} chatId
 * @returns {ChatScrollAnchor | null}
 */
export function peekChatScroll(spaceId, chatId) {
  return chatScrollMemory.get(chatScrollKey(spaceId, chatId)) ?? null;
}

/**
 * @param {string} spaceId
 * @param {string} chatId
 */
export function clearChatScroll(spaceId, chatId) {
  chatScrollMemory.delete(chatScrollKey(spaceId, chatId));
}

/**
 * Apply a message-id anchor. `atLatest` is a no-op (caller scrolls to latest).
 * @param {HTMLElement | null | undefined} container
 * @param {ChatScrollAnchor | null | undefined} anchor
 * @returns {boolean} true when a message anchor was applied
 */
export function restoreChatScrollAnchor(container, anchor) {
  if (!container || !anchor || anchor.atLatest === true) {
    return false;
  }

  if (typeof anchor.messageId !== "string" || anchor.messageId.length === 0) {
    return false;
  }

  const row = container.querySelector(
    `.message-row[data-message-id="${CSS.escape(anchor.messageId)}"]`
  );
  if (!row) {
    return false;
  }

  void container.offsetHeight;

  const currentOffset =
    row.getBoundingClientRect().top
    - container.getBoundingClientRect().top;
  const offsetPx =
    typeof anchor.offsetPx === "number" && Number.isFinite(anchor.offsetPx)
      ? anchor.offsetPx
      : 0;

  container.scrollTop += currentOffset - offsetPx;
  return true;
}

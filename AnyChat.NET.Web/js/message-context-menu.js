/**
 * Message bubble context menu (shell; actions enabled per feature).
 */

import { enterMessageEdit } from "./message-edit.js";
import { openDeleteMessageConfirm } from "./delete-message-confirm.js";

/** Quick-react emojis shown above the action list. */
const CONTEXT_MENU_QUICK_REACTIONS = ["❤️", "😂", "😮", "😢", "😡", "👍"];

let menuBound = false;

/** @type {string | null} */
let targetMessageId = null;

/** @type {string | null} Plain text to copy for the open menu target. */
let targetCopyText = null;

/** @type {string | null} Deep-link URL for Copy message link. */
let targetCopyLink = null;

/**
 * Per-action enablement. Most stay false until their feature ships.
 * `edit` / `copyText` / `copyLink` / `delete` are set dynamically when the menu opens.
 * @type {Record<string, { enabled: boolean }>}
 */
const MESSAGE_CONTEXT_MENU_ACTIONS = {
  reply: { enabled: false },
  copyText: { enabled: false },
  pin: { enabled: false },
  edit: { enabled: false },
  copyLink: { enabled: false },
  delete: { enabled: false },
};

function getMenu() {
  return document.getElementById("message-context-menu");
}

/**
 * Apply MESSAGE_CONTEXT_MENU_ACTIONS to each [data-action] item.
 */
function syncMessageContextMenuActions() {
  const menu = getMenu();
  if (!menu) {
    return;
  }

  for (const button of menu.querySelectorAll("[data-action]")) {
    if (!(button instanceof HTMLButtonElement)) {
      continue;
    }
    const actionId = button.dataset.action;
    const enabled = Boolean(
      actionId && MESSAGE_CONTEXT_MENU_ACTIONS[actionId]?.enabled
    );
    button.disabled = !enabled;
    button.setAttribute("aria-disabled", enabled ? "false" : "true");
  }
}

/**
 * Enable quick-react buttons when the target has a server message id.
 * Marks emojis the current user already reacted with.
 * @param {string | null} messageId
 * @param {object[] | null} reactions
 */
function syncMessageContextMenuReactions(messageId, reactions) {
  const menu = getMenu();
  if (!menu) {
    return;
  }

  const canReact =
    typeof messageId === "string" && messageId.length > 0;
  /** @type {Set<string>} */
  const mine = new Set();
  if (Array.isArray(reactions)) {
    for (const entry of reactions) {
      if (entry?.reactedByMe === true && typeof entry.emoji === "string") {
        mine.add(entry.emoji);
      }
    }
  }

  for (const button of menu.querySelectorAll(".message-context-menu-reaction")) {
    if (!(button instanceof HTMLButtonElement)) {
      continue;
    }
    const emoji = button.dataset.emoji ?? "";
    button.disabled = !canReact;
    const pressed = canReact && mine.has(emoji);
    button.classList.toggle("message-context-menu-reaction--mine", pressed);
    button.setAttribute("aria-pressed", pressed ? "true" : "false");
  }
}

/**
 * Show Edit / Delete only for own bubbles (with a server message id).
 * Others never see those controls.
 * @param {boolean} visible
 */
function setOwnMessageMenuItemsVisible(visible) {
  const editItem = document.getElementById("message-context-menu-edit-item");
  const editSeparator = document.getElementById(
    "message-context-menu-edit-separator"
  );
  const deleteItem = document.getElementById("message-context-menu-delete-item");
  if (editItem) {
    editItem.hidden = !visible;
  }
  if (editSeparator) {
    editSeparator.hidden = !visible;
  }
  if (deleteItem) {
    deleteItem.hidden = !visible;
  }
}

/**
 * Turn a menu action on or off and refresh the shell.
 * @param {string} actionId
 * @param {boolean} enabled
 */
export function setMessageContextMenuActionEnabled(actionId, enabled) {
  const entry = MESSAGE_CONTEXT_MENU_ACTIONS[actionId];
  if (!entry) {
    return;
  }
  entry.enabled = Boolean(enabled);
  syncMessageContextMenuActions();
}

export function isMessageContextMenuOpen() {
  const menu = getMenu();
  return Boolean(menu && !menu.hidden);
}

/** Message id for the bubble that opened the menu (null if none / unknown). */
export function getMessageContextMenuTargetId() {
  return targetMessageId;
}

/**
 * @returns {boolean} true if the menu was open and is now closed
 */
export function closeMessageContextMenu() {
  const menu = getMenu();
  if (!menu || menu.hidden) {
    return false;
  }

  menu.hidden = true;
  targetMessageId = null;
  targetCopyText = null;
  targetCopyLink = null;
  return true;
}

/**
 * Anytype-compatible message deep link (same shape as the official client).
 * `anytype://object?objectId={chatId}&spaceId={spaceId}&messageId={messageId}`
 * @param {string} spaceId
 * @param {string} chatId
 * @param {string} messageId
 * @returns {string}
 */
export function buildMessageDeepLink(spaceId, chatId, messageId) {
  const params = new URLSearchParams();
  // Parameter order matches Anytype Desktop’s “Copy link”.
  params.set("objectId", chatId);
  params.set("spaceId", spaceId);
  params.set("messageId", messageId);
  return `anytype://object?${params.toString()}`;
}

/**
 * Visible bubble body text suitable for Copy text (not reply-quote lines).
 * @param {HTMLElement} bubble
 * @returns {string | null}
 */
function getCopyableTextFromBubble(bubble) {
  const textEl = bubble.querySelector(":scope > .message-bubble-text");
  const text = textEl?.textContent ?? "";
  if (typeof text !== "string" || text.trim().length === 0) {
    return null;
  }
  return text;
}

/**
 * @param {string} text
 * @returns {Promise<boolean>}
 */
async function copyTextToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fall through to execCommand for older WebView2 cases.
  }

  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return Boolean(ok);
  } catch {
    return false;
  }
}

/**
 * Place the fixed menu at the cursor, flipping and clamping to the viewport.
 * Prefer open to the right and below; flip left/above when near an edge.
 *
 * @param {HTMLElement} menu
 * @param {number} clientX
 * @param {number} clientY
 */
function positionMenuAtCursor(menu, clientX, clientY) {
  const margin = 8;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  // Must be visible to measure; start at cursor then adjust.
  menu.style.left = `${clientX}px`;
  menu.style.top = `${clientY}px`;

  const rect = menu.getBoundingClientRect();
  const width = rect.width;
  const height = rect.height;

  let left = clientX;
  if (clientX + width > viewportWidth - margin) {
    left = clientX - width;
  }

  let top = clientY;
  if (clientY + height > viewportHeight - margin) {
    top = clientY - height;
  }

  const maxLeft = Math.max(margin, viewportWidth - width - margin);
  const maxTop = Math.max(margin, viewportHeight - height - margin);
  left = Math.min(Math.max(left, margin), maxLeft);
  top = Math.min(Math.max(top, margin), maxTop);

  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

/**
 * @param {string | null} messageId
 * @returns {Promise<{
 *   editable: { message: object, spaceId: string, chatId: string } | null,
 *   deletable: { message: object, spaceId: string, chatId: string } | null,
 * }>}
 */
async function loadOwnMessageActions(messageId) {
  const {
    getOpenChatEditableMessage,
    getOpenChatDeletableMessage,
  } = await import("./chats.js");
  return {
    editable: getOpenChatEditableMessage(messageId),
    deletable: getOpenChatDeletableMessage(messageId),
  };
}

/**
 * @param {MouseEvent} event
 * @param {HTMLElement} bubble
 */
async function openMessageContextMenu(event, bubble) {
  const menu = getMenu();
  if (!menu) {
    return;
  }

  const row = bubble.closest(".message-row");
  targetMessageId = row?.dataset.messageId ?? null;
  const requestMessageId = targetMessageId;
  targetCopyText = getCopyableTextFromBubble(bubble);
  MESSAGE_CONTEXT_MENU_ACTIONS.copyText.enabled = targetCopyText !== null;

  targetCopyLink = null;
  MESSAGE_CONTEXT_MENU_ACTIONS.copyLink.enabled = false;
  if (
    typeof requestMessageId === "string"
    && requestMessageId.length > 0
  ) {
    const { getOpenChat } = await import("./chat-view.js");
    // Dismissed or another bubble opened while the lookup was in flight.
    if (targetMessageId !== requestMessageId) {
      return;
    }
    const open = getOpenChat();
    if (
      open?.spaceId
      && open?.chatId
    ) {
      targetCopyLink = buildMessageDeepLink(
        open.spaceId,
        open.chatId,
        requestMessageId
      );
      MESSAGE_CONTEXT_MENU_ACTIONS.copyLink.enabled = true;
    }
  }

  // Own rows only (never show Edit / Delete on others’ bubbles).
  const isOwnBubble =
    Boolean(row?.classList.contains("message-row--mine"))
    && typeof requestMessageId === "string"
    && requestMessageId.length > 0;

  setOwnMessageMenuItemsVisible(isOwnBubble);

  const ownActions = isOwnBubble
    ? await loadOwnMessageActions(requestMessageId)
    : { editable: null, deletable: null };
  // Dismissed or another bubble opened while the lookup was in flight.
  if (targetMessageId !== requestMessageId) {
    return;
  }
  MESSAGE_CONTEXT_MENU_ACTIONS.edit.enabled = Boolean(ownActions.editable);
  MESSAGE_CONTEXT_MENU_ACTIONS.delete.enabled = Boolean(ownActions.deletable);

  const { getOpenChatMessageReactions } = await import("./chats.js");
  if (targetMessageId !== requestMessageId) {
    return;
  }
  syncMessageContextMenuReactions(
    requestMessageId,
    getOpenChatMessageReactions(requestMessageId)
  );

  syncMessageContextMenuActions();
  menu.hidden = false;
  positionMenuAtCursor(menu, event.clientX, event.clientY);
}

async function handleQuickReactionClick(event, emoji) {
  event.preventDefault();
  event.stopPropagation();

  const messageId = targetMessageId;
  if (typeof messageId !== "string" || messageId.length === 0) {
    return;
  }
  if (!CONTEXT_MENU_QUICK_REACTIONS.includes(emoji)) {
    return;
  }

  closeMessageContextMenu();
  const { toggleOpenChatReaction } = await import("./chats.js");
  await toggleOpenChatReaction(messageId, emoji, { allowAdd: true });
}

async function handleCopyTextAction(event) {
  event.preventDefault();
  event.stopPropagation();

  if (!MESSAGE_CONTEXT_MENU_ACTIONS.copyText.enabled || targetCopyText === null) {
    return;
  }

  const text = targetCopyText;
  closeMessageContextMenu();
  await copyTextToClipboard(text);
}

async function handleCopyLinkAction(event) {
  event.preventDefault();
  event.stopPropagation();

  if (!MESSAGE_CONTEXT_MENU_ACTIONS.copyLink.enabled || targetCopyLink === null) {
    return;
  }

  const link = targetCopyLink;
  closeMessageContextMenu();
  await copyTextToClipboard(link);
}

async function handleEditAction(event) {
  event.preventDefault();
  event.stopPropagation();

  if (!MESSAGE_CONTEXT_MENU_ACTIONS.edit.enabled) {
    return;
  }

  const messageId = targetMessageId;
  const { editable } = await loadOwnMessageActions(messageId);
  closeMessageContextMenu();
  if (!editable) {
    return;
  }

  enterMessageEdit({
    messageId: editable.message.id,
    text: editable.message.content.text,
    spaceId: editable.spaceId,
    chatId: editable.chatId,
  });
}

async function handleDeleteAction(event) {
  event.preventDefault();
  event.stopPropagation();

  if (!MESSAGE_CONTEXT_MENU_ACTIONS.delete.enabled) {
    return;
  }

  const messageId = targetMessageId;
  const { deletable } = await loadOwnMessageActions(messageId);
  closeMessageContextMenu();
  if (!deletable) {
    return;
  }

  openDeleteMessageConfirm({
    spaceId: deletable.spaceId,
    chatId: deletable.chatId,
    messageId: deletable.message.id,
  });
}

export function initMessageContextMenu() {
  if (menuBound) {
    return;
  }

  const list = document.getElementById("chat-messages");
  const menu = getMenu();
  const editItem = document.getElementById("message-context-menu-edit");
  const copyTextItem = document.getElementById("message-context-menu-copy-text");
  const copyLinkItem = document.getElementById("message-context-menu-copy-link");
  const deleteItem = document.getElementById("message-context-menu-delete");
  if (!list || !menu) {
    return;
  }

  menuBound = true;
  syncMessageContextMenuActions();
  syncMessageContextMenuReactions(null, null);

  list.addEventListener("contextmenu", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    const bubble = target.closest(".message-bubble");
    if (!bubble || !list.contains(bubble)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    void openMessageContextMenu(event, bubble);
  });

  menu.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    if (target.closest(".message-context-menu-reaction-more")) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    const reactionBtn = target.closest(".message-context-menu-reaction");
    if (
      reactionBtn instanceof HTMLButtonElement
      && menu.contains(reactionBtn)
      && !reactionBtn.disabled
    ) {
      const emoji = reactionBtn.dataset.emoji ?? "";
      void handleQuickReactionClick(event, emoji);
    }
  });

  copyTextItem?.addEventListener("click", (event) => {
    void handleCopyTextAction(event);
  });

  copyLinkItem?.addEventListener("click", (event) => {
    void handleCopyLinkAction(event);
  });

  editItem?.addEventListener("click", (event) => {
    void handleEditAction(event);
  });

  deleteItem?.addEventListener("click", (event) => {
    void handleDeleteAction(event);
  });

  document.addEventListener("mousedown", (event) => {
    if (!isMessageContextMenuOpen()) {
      return;
    }
    if (event.target instanceof Node && menu.contains(event.target)) {
      return;
    }
    closeMessageContextMenu();
  });

  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key !== "Escape") {
        return;
      }
      if (!closeMessageContextMenu()) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    },
    true
  );

  list.addEventListener(
    "scroll",
    () => {
      closeMessageContextMenu();
    },
    { passive: true }
  );

  window.addEventListener("resize", () => {
    closeMessageContextMenu();
  });
}

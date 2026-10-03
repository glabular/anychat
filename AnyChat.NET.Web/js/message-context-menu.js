/**
 * Message bubble context menu (shell; actions enabled per feature).
 */

import { enterMessageEdit } from "./message-edit.js";

let menuBound = false;

/** @type {string | null} */
let targetMessageId = null;

/**
 * Per-action enablement. Most stay false until their feature ships.
 * `edit` is set dynamically when the menu opens for an eligible message.
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
 * Show Edit only for own bubbles (with a server message id). Others never see it.
 * @param {boolean} visible
 */
function setEditMenuItemVisible(visible) {
  const editItem = document.getElementById("message-context-menu-edit-item");
  const editSeparator = document.getElementById(
    "message-context-menu-edit-separator"
  );
  if (editItem) {
    editItem.hidden = !visible;
  }
  if (editSeparator) {
    editSeparator.hidden = !visible;
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
  return true;
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
 * @returns {Promise<{ message: object, spaceId: string, chatId: string } | null>}
 */
async function loadEditableMessage(messageId) {
  const { getOpenChatEditableMessage } = await import("./chats.js");
  return getOpenChatEditableMessage(messageId);
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

  // Own rows only (never show Edit on others’ bubbles).
  const isOwnBubble =
    Boolean(row?.classList.contains("message-row--mine"))
    && typeof requestMessageId === "string"
    && requestMessageId.length > 0;

  setEditMenuItemVisible(isOwnBubble);

  const editable = isOwnBubble
    ? await loadEditableMessage(requestMessageId)
    : null;
  // Dismissed or another bubble opened while the lookup was in flight.
  if (targetMessageId !== requestMessageId) {
    return;
  }
  MESSAGE_CONTEXT_MENU_ACTIONS.edit.enabled = Boolean(editable);

  syncMessageContextMenuActions();
  menu.hidden = false;
  positionMenuAtCursor(menu, event.clientX, event.clientY);
}

async function handleEditAction(event) {
  event.preventDefault();
  event.stopPropagation();

  if (!MESSAGE_CONTEXT_MENU_ACTIONS.edit.enabled) {
    return;
  }

  const messageId = targetMessageId;
  const editable = await loadEditableMessage(messageId);
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

export function initMessageContextMenu() {
  if (menuBound) {
    return;
  }

  const list = document.getElementById("chat-messages");
  const menu = getMenu();
  const editItem = document.getElementById("message-context-menu-edit");
  if (!list || !menu) {
    return;
  }

  menuBound = true;
  syncMessageContextMenuActions();

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

  editItem?.addEventListener("click", (event) => {
    void handleEditAction(event);
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

/**
 * Message bubble context menu (shell open; actions stay disabled until later).
 */

let menuBound = false;

/** @type {string | null} */
let targetMessageId = null;

function getMenu() {
  return document.getElementById("message-context-menu");
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
 * @param {MouseEvent} event
 * @param {HTMLElement} bubble
 */
function openMessageContextMenu(event, bubble) {
  const menu = getMenu();
  if (!menu) {
    return;
  }

  const row = bubble.closest(".message-row");
  targetMessageId = row?.dataset.messageId ?? null;

  menu.hidden = false;
  positionMenuAtCursor(menu, event.clientX, event.clientY);
}

export function initMessageContextMenu() {
  if (menuBound) {
    return;
  }

  const list = document.getElementById("chat-messages");
  const menu = getMenu();
  if (!list || !menu) {
    return;
  }

  menuBound = true;

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
    openMessageContextMenu(event, bubble);
  });
}

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
  menu.style.left = `${event.clientX}px`;
  menu.style.top = `${event.clientY}px`;
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

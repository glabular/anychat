/**
 * Open-chat header ⋮ menu (Delete → confirm modal).
 */

let menuBound = false;

function getMenuRoot() {
  return document.querySelector(".chat-panel-menu");
}

function getMenuButton() {
  return document.getElementById("chat-panel-menu-button");
}

function getMenuDropdown() {
  return document.getElementById("chat-panel-menu-dropdown");
}

export function isChatPanelMenuOpen() {
  const dropdown = getMenuDropdown();
  return Boolean(dropdown && !dropdown.hidden);
}

/**
 * @param {{ restoreFocus?: boolean }} [options]
 * @returns {boolean} true if the menu was open and is now closed
 */
export function closeChatPanelMenu({ restoreFocus = false } = {}) {
  const button = getMenuButton();
  const dropdown = getMenuDropdown();
  if (!dropdown || dropdown.hidden) {
    return false;
  }

  dropdown.hidden = true;
  if (button) {
    button.setAttribute("aria-expanded", "false");
    if (restoreFocus) {
      button.focus({ preventScroll: true });
    }
  }
  return true;
}

export function openChatPanelMenu() {
  const button = getMenuButton();
  const dropdown = getMenuDropdown();
  if (!button || !dropdown) {
    return;
  }

  dropdown.hidden = false;
  button.setAttribute("aria-expanded", "true");
}

function toggleChatPanelMenu() {
  if (isChatPanelMenuOpen()) {
    closeChatPanelMenu();
  } else {
    openChatPanelMenu();
  }
}

export function initChatPanelMenu() {
  if (menuBound) {
    return;
  }

  const root = getMenuRoot();
  const button = getMenuButton();
  const dropdown = getMenuDropdown();
  const deleteItem = document.getElementById("chat-panel-menu-delete");
  if (!root || !button || !dropdown) {
    return;
  }

  menuBound = true;

  button.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleChatPanelMenu();
  });

  deleteItem?.addEventListener("click", (event) => {
    event.stopPropagation();
    closeChatPanelMenu();
    void import("./delete-chat-confirm.js").then(({ openDeleteChatConfirm }) => {
      void openDeleteChatConfirm();
    });
  });

  document.addEventListener("mousedown", (event) => {
    if (!isChatPanelMenuOpen()) {
      return;
    }
    if (event.target instanceof Node && root.contains(event.target)) {
      return;
    }
    closeChatPanelMenu();
  });
}

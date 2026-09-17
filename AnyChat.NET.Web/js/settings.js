import { hideChatPanel } from "./chat-view.js";
import { setMainPlaceholderVisible } from "./chats.js";

let settingsOpen = false;
/** Space selected when settings opened; restored by the back control. */
let spaceIdBeforeSettings = null;

export function isSettingsOpen() {
  return settingsOpen;
}

/**
 * If settings opened before any space was selected, remember one for Back.
 * @param {string} spaceId
 */
export function ensureReturnSpaceId(spaceId) {
  if (settingsOpen && spaceId && !spaceIdBeforeSettings) {
    spaceIdBeforeSettings = spaceId;
  }
}

function getSettingsButton() {
  return document.getElementById("settings-button");
}

function getSettingsBackButton() {
  return document.getElementById("settings-back");
}

function getChatsSidebarView() {
  return document.getElementById("chats-sidebar-view");
}

function getSettingsNav() {
  return document.getElementById("settings-nav");
}

function getSettingsPanel() {
  return document.getElementById("settings-panel");
}

function clearSettingsSelection() {
  document
    .querySelector(".settings-nav-item--selected")
    ?.classList.remove("settings-nav-item--selected");

  document.querySelectorAll(".settings-detail").forEach((detail) => {
    detail.hidden = true;
  });
}

function uncheckAllSpaces() {
  document.querySelectorAll('input[name="space"]').forEach((input) => {
    input.checked = false;
  });
}

function rememberSpaceBeforeSettings() {
  const checked = document.querySelector('input[name="space"]:checked');
  spaceIdBeforeSettings =
    checked instanceof HTMLInputElement ? checked.value : null;
}

async function restoreSpaceBeforeSettings() {
  const spaceId = spaceIdBeforeSettings;
  spaceIdBeforeSettings = null;

  exitSettings();

  if (!spaceId) {
    setMainPlaceholderVisible(true);
    return;
  }

  const { selectSpace } = await import("./spaces.js");
  const { loadChatsForSelectedSpace } = await import("./chats.js");
  selectSpace(spaceId);
  loadChatsForSelectedSpace();
}

export function enterSettings() {
  if (settingsOpen) {
    clearSettingsSelection();
    return;
  }

  rememberSpaceBeforeSettings();
  settingsOpen = true;
  document.body.classList.add("is-settings");

  hideChatPanel();
  setMainPlaceholderVisible(false);

  const chatsView = getChatsSidebarView();
  const settingsNav = getSettingsNav();
  const settingsPanel = getSettingsPanel();
  const settingsButton = getSettingsButton();

  if (chatsView) {
    chatsView.hidden = true;
  }
  if (settingsNav) {
    settingsNav.hidden = false;
  }
  if (settingsPanel) {
    settingsPanel.hidden = false;
  }
  if (settingsButton) {
    settingsButton.setAttribute("aria-pressed", "true");
  }

  clearSettingsSelection();
  uncheckAllSpaces();
}

/**
 * Leave settings chrome. Caller restores a space / chats list when needed.
 */
export function exitSettings() {
  if (!settingsOpen) {
    return;
  }

  settingsOpen = false;
  spaceIdBeforeSettings = null;
  document.body.classList.remove("is-settings");

  const chatsView = getChatsSidebarView();
  const settingsNav = getSettingsNav();
  const settingsPanel = getSettingsPanel();
  const settingsButton = getSettingsButton();

  clearSettingsSelection();

  if (settingsPanel) {
    settingsPanel.hidden = true;
  }
  if (settingsNav) {
    settingsNav.hidden = true;
  }
  if (chatsView) {
    chatsView.hidden = false;
  }
  if (settingsButton) {
    settingsButton.setAttribute("aria-pressed", "false");
  }
}

function selectSetting(settingId) {
  clearSettingsSelection();

  const item = document.querySelector(
    `.settings-nav-item[data-setting="${settingId}"]`
  );
  item?.classList.add("settings-nav-item--selected");

  const detail = document.querySelector(
    `.settings-detail[data-setting="${settingId}"]`
  );
  if (detail) {
    detail.hidden = false;
  }
}

export function initSettings() {
  getSettingsButton()?.addEventListener("click", () => {
    enterSettings();
  });

  getSettingsBackButton()?.addEventListener("click", () => {
    void restoreSpaceBeforeSettings();
  });

  getSettingsNav()?.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const item = target.closest(".settings-nav-item");
    if (!item || !getSettingsNav()?.contains(item)) {
      return;
    }
    const settingId = item.getAttribute("data-setting");
    if (settingId) {
      selectSetting(settingId);
    }
  });
}

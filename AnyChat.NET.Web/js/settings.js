import { deleteApiKey, fetchAppVersion } from "./api.js";
import { openApiKeySetupModal } from "./api-key-setup-modal.js";
import {
  clearComposerSessionState,
  hideChatPanel,
} from "./chat-view.js";
import {
  clearAccountChatState,
  setMainPlaceholderVisible,
} from "./chats.js";
import { setChatsCreateButtonReady } from "./chats-create-button.js";
import { applyIdentityNoticeStatus } from "./identity-notice.js";
import { openLogoutConfirm } from "./logout-confirm.js";
import { clearSpaceMembersCache } from "./space-members.js";

const SELECTED_SPACE_STORAGE_KEY = "anychat.selectedSpaceId";

let settingsOpen = false;
/** Space selected when settings opened; restored by the back control. */
let spaceIdBeforeSettings = null;
/** @type {string | null} */
let cachedAppVersion = null;
/** @type {Promise<string> | null} */
let appVersionLoadPromise = null;

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

function getSettingsLogoutButton() {
  return /** @type {HTMLButtonElement | null} */ (
    document.getElementById("settings-logout")
  );
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

function getAboutVersionValue() {
  return document.getElementById("settings-about-version-value");
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

function setAboutVersionLabel(text) {
  const el = getAboutVersionValue();
  if (el) {
    el.textContent = text;
  }
}

async function loadAboutVersion() {
  if (cachedAppVersion) {
    setAboutVersionLabel(cachedAppVersion);
    return;
  }

  setAboutVersionLabel("…");

  if (!appVersionLoadPromise) {
    appVersionLoadPromise = fetchAppVersion()
      .then((version) => {
        cachedAppVersion = version;
        return version;
      })
      .catch((error) => {
        console.error("Could not load app version:", error);
        appVersionLoadPromise = null;
        throw error;
      });
  }

  try {
    const version = await appVersionLoadPromise;
    setAboutVersionLabel(version);
  } catch {
    setAboutVersionLabel("unavailable");
  }
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

  if (settingId === "about") {
    void loadAboutVersion();
  }
}

function clearLoggedOutUi() {
  hideChatPanel();
  clearComposerSessionState();
  clearAccountChatState();
  clearSpaceMembersCache();
  setMainPlaceholderVisible(false);
  setChatsCreateButtonReady(false);

  try {
    localStorage.removeItem(SELECTED_SPACE_STORAGE_KEY);
  } catch {
    // non-fatal
  }

  const spacesSidebar = document.getElementById("spaces-sidebar");
  spacesSidebar?.querySelectorAll("label").forEach((el) => el.remove());
  spacesSidebar?.setAttribute("aria-busy", "false");

  const chatsList = document.getElementById("chats-list");
  if (chatsList) {
    chatsList.replaceChildren();
    chatsList.hidden = false;
  }

  const chatsEmpty = document.getElementById("chats-empty");
  if (chatsEmpty) {
    chatsEmpty.hidden = true;
    chatsEmpty.replaceChildren();
  }

  const chatsLoading = document.getElementById("chats-loading");
  if (chatsLoading) {
    chatsLoading.hidden = true;
  }

  applyIdentityNoticeStatus({ configured: false, identityKnown: false });
}

async function handleLogout() {
  const logoutButton = getSettingsLogoutButton();
  if (logoutButton?.disabled) {
    return;
  }

  if (logoutButton) {
    logoutButton.disabled = true;
  }

  try {
    await deleteApiKey();
  } catch (error) {
    console.error("Could not log out / clear API key:", error);
    if (logoutButton) {
      logoutButton.disabled = false;
    }
    throw error;
  }

  exitSettings();
  clearLoggedOutUi();

  const { reloadSpacesAfterAnytypeRecovery } = await import("./spaces.js");
  void openApiKeySetupModal({
    reason: "missing",
    onSaved: () => reloadSpacesAfterAnytypeRecovery(),
  });

  if (logoutButton) {
    logoutButton.disabled = false;
  }
}

/** Clears stored credentials and returns the UI to the connect flow. */
export async function performLogout() {
  await handleLogout();
}

export function initSettings() {
  getSettingsButton()?.addEventListener("click", () => {
    enterSettings();
  });

  getSettingsBackButton()?.addEventListener("click", () => {
    void restoreSpaceBeforeSettings();
  });

  getSettingsLogoutButton()?.addEventListener("click", () => {
    openLogoutConfirm();
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

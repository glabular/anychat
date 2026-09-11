import { renameChat } from "./api.js";

/** @type {string} */
let initialInputValue = "";
/** @type {string} */
let previousDisplayName = "";
let saveInFlight = false;
let saveToken = 0;
let renameBound = false;

/**
 * Empty Anytype titles are allowed; show a stable label in the UI.
 * @param {unknown} name
 * @returns {string}
 */
function displayName(name) {
  const trimmed = typeof name === "string" ? name.trim() : "";
  return trimmed || "Untitled";
}

function getHeader() {
  return document.querySelector(".chat-panel-header");
}

function getTitle() {
  return document.getElementById("chat-panel-title");
}

function getTitleWrap() {
  return document.getElementById("chat-panel-title-wrap");
}

function getInput() {
  return /** @type {HTMLInputElement | null} */ (
    document.getElementById("chat-panel-title-input")
  );
}

function getDim() {
  return document.getElementById("chat-rename-dim");
}

function getErrorEl() {
  return document.getElementById("chat-rename-error");
}

/**
 * @returns {{ spaceId: string, chatId: string } | null}
 */
function getRenameTarget() {
  const space = /** @type {HTMLInputElement | null} */ (
    document.querySelector('input[name="space"]:checked')
  );
  const li = document
    .querySelector("#chats-list .chat-item--selected")
    ?.closest("li[data-chat-id]");
  const chatId = li instanceof HTMLElement ? li.dataset.chatId : "";
  if (!space?.value || !chatId) {
    return null;
  }
  return { spaceId: space.value, chatId };
}

export function isChatRenameOpen() {
  const wrap = getTitleWrap();
  return Boolean(wrap?.classList.contains("chat-panel-title-wrap--editing"));
}

function clearError() {
  const errorEl = getErrorEl();
  if (!errorEl) {
    return;
  }
  errorEl.hidden = true;
  errorEl.textContent = "";
}

/**
 * @param {string} message
 */
function showError(message) {
  const errorEl = getErrorEl();
  if (!errorEl) {
    return;
  }
  errorEl.textContent = message;
  errorEl.hidden = false;
}

/**
 * @param {unknown} error
 */
function describeRenameError(error) {
  const status = error && typeof error === "object" ? error.status : undefined;

  if (status === 503) {
    return "Lost connection to Anytype. Open the official Anytype app and try again.";
  }

  if (typeof status === "number") {
    return `Could not rename chat (HTTP ${status}).`;
  }

  if (error instanceof TypeError) {
    return "Cannot reach the API.";
  }

  return "Could not rename chat.";
}

/**
 * Update the selected chats-list row title in place.
 * @param {string} nextDisplayName
 */
function updateSelectedChatListTitle(nextDisplayName) {
  const selected = document.querySelector("#chats-list .chat-item--selected");
  const li = selected?.closest("li[data-chat-id]");
  if (!li) {
    return;
  }

  li.dataset.chatName = nextDisplayName;
  const nameEl = li.querySelector(".chat-name");
  if (nameEl) {
    nameEl.textContent = nextDisplayName;
  }
}

/**
 * @param {{ restoreFocus?: boolean }} [options]
 * @returns {boolean} true if rename mode was open and is now closed
 */
export function cancelChatRename({ restoreFocus = true } = {}) {
  if (!isChatRenameOpen()) {
    return false;
  }

  saveInFlight = false;
  saveToken += 1;
  clearError();

  const title = getTitle();
  const input = getInput();
  const wrap = getTitleWrap();
  const dim = getDim();

  if (input) {
    input.hidden = true;
    input.disabled = false;
    input.value = "";
  }
  if (title) {
    title.textContent = previousDisplayName;
  }
  wrap?.classList.remove("chat-panel-title-wrap--editing");
  getHeader()?.classList.remove("chat-panel-header--renaming");
  if (dim) {
    dim.hidden = true;
  }

  if (restoreFocus && title instanceof HTMLElement) {
    title.focus();
  }

  return true;
}

function beginChatRename() {
  if (isChatRenameOpen() || saveInFlight) {
    return;
  }

  const target = getRenameTarget();
  const title = getTitle();
  const input = getInput();
  const wrap = getTitleWrap();
  const dim = getDim();
  const header = getHeader();
  if (!target || !title || !input || !wrap || !dim || !header) {
    return;
  }

  previousDisplayName = title.textContent?.trim() || "Untitled";
  initialInputValue =
    previousDisplayName === "Untitled" ? "" : previousDisplayName;

  clearError();
  input.hidden = false;
  input.disabled = false;
  input.value = initialInputValue;
  wrap.classList.add("chat-panel-title-wrap--editing");
  header.classList.add("chat-panel-header--renaming");
  dim.hidden = false;
  input.focus();
  input.select();
}

async function saveChatRename() {
  if (!isChatRenameOpen() || saveInFlight) {
    return;
  }

  const target = getRenameTarget();
  const input = getInput();
  if (!target || !input) {
    cancelChatRename({ restoreFocus: false });
    return;
  }

  const nextRaw = input.value;
  if (nextRaw.trim() === initialInputValue.trim()) {
    cancelChatRename({ restoreFocus: true });
    return;
  }

  saveInFlight = true;
  clearError();
  input.disabled = true;
  const token = ++saveToken;

  try {
    await renameChat(target.spaceId, target.chatId, nextRaw);
    if (token !== saveToken) {
      return;
    }
    const nextDisplayName = displayName(nextRaw);
    previousDisplayName = nextDisplayName;

    saveInFlight = false;
    clearError();
    input.hidden = true;
    input.disabled = false;
    input.value = "";
    getTitleWrap()?.classList.remove("chat-panel-title-wrap--editing");
    getHeader()?.classList.remove("chat-panel-header--renaming");
    const dim = getDim();
    if (dim) {
      dim.hidden = true;
    }

    const title = getTitle();
    if (title) {
      title.textContent = nextDisplayName;
    }
    updateSelectedChatListTitle(nextDisplayName);
  } catch (error) {
    if (token !== saveToken) {
      return;
    }
    console.error("Could not rename chat:", error);
    saveInFlight = false;
    input.disabled = false;
    showError(describeRenameError(error));
    if (isChatRenameOpen()) {
      input.focus();
      input.select();
    }
  }
}

/** One-time wiring for panel-title rename. */
export function initChatRenameTitle() {
  if (renameBound) {
    return;
  }

  const title = getTitle();
  const input = getInput();
  const dim = getDim();
  if (!title || !input || !dim) {
    return;
  }

  renameBound = true;

  title.tabIndex = 0;
  title.setAttribute("role", "button");
  title.setAttribute("aria-label", "Rename chat");

  title.addEventListener("click", () => {
    beginChatRename();
  });

  title.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      beginChatRename();
    }
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void saveChatRename();
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      cancelChatRename({ restoreFocus: true });
    }
  });

  dim.addEventListener("click", () => {
    if (saveInFlight) {
      return;
    }
    cancelChatRename({ restoreFocus: true });
  });
}

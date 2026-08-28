import { fetchChats, postChatMessage, spacesUrl } from "./api.js";
import {
  beginOpenChatMessages,
  hideChatPanel,
  initChatComposer,
  initChatHistoryRetry,
  isOpenChatMessagesCurrent,
  prependOlderChatMessages,
  appendNewerChatMessages,
  renderOpenChatMessages,
  renderOpenChatMessagesError,
  resetChatHistoryStatus,
  setChatHistoryStatus,
  setOnChatPanelHidden,
  setOpenChat,
  setOpenChatMessagesReload,
  showChatHeader,
} from "./chat-view.js";

/** Messages fetched per open-chat request and per older-history page. */
const MESSAGE_PAGE_SIZE = 10;

/** Load older history when the reader scrolls within this distance of the top. */
const SCROLL_TOP_THRESHOLD_PX = 80;

/** Cap automatic fill requests when the first page does not overflow. */
const MAX_AUTO_FILL_PAGES = 5;

/** Wait this long before showing the spinner (avoids flash on fast loads). */
const SPINNER_SHOW_DELAY_MS = 200;

let loadToken = 0;
let showSpinnerTimer = null;

/** @type {ChatHistoryState | null} */
let chatHistoryState = null;

/**
 * @typedef {object} ChatHistoryState
 * @property {string} spaceId
 * @property {string} chatId
 * @property {number} token
 * @property {object[]} messages
 * @property {Set<string>} messageIds
 * @property {string | null} oldestOrderId
 * @property {boolean} mayHaveMore
 * @property {boolean} isLoadingOlder
 * @property {boolean} olderLoadError
 */

let historyScrollBound = false;

function resetChatHistoryState() {
  chatHistoryState = null;
  resetChatHistoryStatus();
}

/**
 * @param {string} spaceId
 * @param {string} chatId
 * @param {number} token
 * @returns {ChatHistoryState}
 */
function beginChatHistoryState(spaceId, chatId, token) {
  chatHistoryState = {
    spaceId,
    chatId,
    token,
    messages: [],
    messageIds: new Set(),
    oldestOrderId: null,
    mayHaveMore: false,
    isLoadingOlder: false,
    olderLoadError: false,
  };
  return chatHistoryState;
}

/**
 * @param {ChatHistoryState} state
 * @param {unknown} messages
 */
function applyInitialPage(state, messages) {
  if (!Array.isArray(messages)) {
    state.messages = [];
    state.messageIds = new Set();
    state.oldestOrderId = null;
    state.mayHaveMore = false;
    return;
  }

  state.messages = [...messages];
  state.messageIds = new Set();
  for (const message of messages) {
    if (message?.id) {
      state.messageIds.add(message.id);
    }
  }

  state.oldestOrderId = oldestOrderIdFromPage(messages);
  state.mayHaveMore = messages.length === MESSAGE_PAGE_SIZE;
  state.olderLoadError = false;
}

/**
 * @param {ChatHistoryState} state
 * @param {object[]} messages
 * @returns {object[]}
 */
function filterUnseenMessages(state, messages) {
  return messages.filter(
    (message) =>
      typeof message?.id === "string"
      && message.id.length > 0
      && !state.messageIds.has(message.id)
  );
}

/**
 * @param {ChatHistoryState} state
 * @param {object[]} page
 * @returns {object[]}
 */
function dedupeOlderMessages(state, page) {
  return filterUnseenMessages(state, page);
}

/**
 * Merge the latest API window after send without discarding older loaded pages.
 * @param {ChatHistoryState} state
 * @param {unknown} latestMessages
 * @returns {number} newly inserted row count
 */
function applyLatestPageAfterSend(state, latestMessages) {
  const page = Array.isArray(latestMessages) ? latestMessages : [];
  const newMessages = filterUnseenMessages(state, page);
  if (newMessages.length === 0) {
    return 0;
  }

  state.messages = [...state.messages, ...newMessages];
  for (const message of newMessages) {
    state.messageIds.add(message.id);
  }

  return appendNewerChatMessages(newMessages);
}

/**
 * @param {ChatHistoryState} state
 * @param {unknown} olderMessages
 * @returns {number} newly inserted row count
 */
function applyOlderPage(state, olderMessages) {
  const page = Array.isArray(olderMessages) ? olderMessages : [];

  if (page.length < MESSAGE_PAGE_SIZE) {
    state.mayHaveMore = false;
  }

  if (page.length === 0) {
    state.mayHaveMore = false;
    return 0;
  }

  const pageOldestOrderId = oldestOrderIdFromPage(page);
  if (pageOldestOrderId) {
    state.oldestOrderId = pageOldestOrderId;
  }

  const newMessages = dedupeOlderMessages(state, page);
  if (newMessages.length === 0) {
    return 0;
  }

  state.messages = [...newMessages, ...state.messages];
  for (const message of newMessages) {
    state.messageIds.add(message.id);
  }

  prependOlderChatMessages(newMessages);
  return newMessages.length;
}

/**
 * @param {ChatHistoryState | null} state
 */
function updateHistoryStatus(state) {
  if (!state) {
    resetChatHistoryStatus();
    return;
  }

  if (state.isLoadingOlder) {
    setChatHistoryStatus("loading");
    return;
  }

  if (state.olderLoadError) {
    setChatHistoryStatus("error");
    return;
  }

  if (!state.mayHaveMore && state.messages.length > 0) {
    setChatHistoryStatus("end");
    return;
  }

  setChatHistoryStatus("hidden");
}

function getChatMessagesContainer() {
  return document.getElementById("chat-messages");
}

function isNearTop(container) {
  return container.scrollTop < SCROLL_TOP_THRESHOLD_PX;
}

function isContainerOverflowing(container) {
  return container.scrollHeight > container.clientHeight;
}

function initChatHistoryScroll() {
  const container = getChatMessagesContainer();
  if (!container || historyScrollBound) {
    return;
  }

  container.addEventListener("scroll", onChatMessagesScroll, { passive: true });
  historyScrollBound = true;
}

function onChatMessagesScroll() {
  maybeLoadOlderMessages();
}

function maybeLoadOlderMessages() {
  const state = chatHistoryState;
  const container = getChatMessagesContainer();
  if (!state || !container || state.isLoadingOlder || state.olderLoadError) {
    return;
  }

  if (!state.mayHaveMore || !state.oldestOrderId) {
    return;
  }

  if (!isNearTop(container)) {
    return;
  }

  void loadOlderMessages();
}

/**
 * @param {{ retry?: boolean }} [options]
 */
async function loadOlderMessages({ retry = false } = {}) {
  const state = chatHistoryState;
  if (!state || state.isLoadingOlder) {
    return;
  }

  if (!state.mayHaveMore && !retry) {
    updateHistoryStatus(state);
    return;
  }

  if (!state.oldestOrderId) {
    state.mayHaveMore = false;
    updateHistoryStatus(state);
    return;
  }

  if (retry) {
    state.olderLoadError = false;
  }

  const { spaceId, chatId, token, oldestOrderId } = state;
  state.isLoadingOlder = true;
  updateHistoryStatus(state);

  try {
    const olderMessages = await fetchChatMessages(
      spaceId,
      chatId,
      MESSAGE_PAGE_SIZE,
      oldestOrderId
    );

    if (!isOpenChatMessagesCurrent(token) || chatHistoryState !== state) {
      return;
    }

    const previousOldestOrderId = oldestOrderId;
    applyOlderPage(state, olderMessages);

    if (
      Array.isArray(olderMessages)
      && olderMessages.length > 0
      && state.oldestOrderId === previousOldestOrderId
    ) {
      state.mayHaveMore = false;
    }

    state.olderLoadError = false;
  } catch (error) {
    console.error(
      `Could not load older messages for chat ${chatId}:`,
      error
    );
    if (!isOpenChatMessagesCurrent(token) || chatHistoryState !== state) {
      return;
    }
    state.olderLoadError = true;
  } finally {
    if (chatHistoryState === state) {
      state.isLoadingOlder = false;
      updateHistoryStatus(state);
    }
  }

  if (chatHistoryState !== state || !isOpenChatMessagesCurrent(token)) {
    return;
  }

  const container = getChatMessagesContainer();
  if (
    container
    && !state.olderLoadError
    && state.mayHaveMore
    && isNearTop(container)
  ) {
    void loadOlderMessages();
  }
}

async function ensureHistoryFillsViewport() {
  const state = chatHistoryState;
  const container = getChatMessagesContainer();
  if (!state || !container || state.isLoadingOlder || state.olderLoadError) {
    return;
  }

  let pagesLoaded = 0;
  while (
    state.mayHaveMore
    && state.oldestOrderId
    && !isContainerOverflowing(container)
    && pagesLoaded < MAX_AUTO_FILL_PAGES
  ) {
    pagesLoaded += 1;
    await loadOlderMessages();
    if (state.olderLoadError || state.isLoadingOlder) {
      break;
    }
  }
}

/**
 * Oldest cursor in an API page (oldest → newest). Uses the first row with
 * orderId, including non-text messages the UI may skip when rendering.
 * @param {object[]} messages
 * @returns {string | null}
 */
function oldestOrderIdFromPage(messages) {
  for (const message of messages) {
    const orderId = message?.orderId;
    if (typeof orderId === "string" && orderId.length > 0) {
      return orderId;
    }
  }

  return null;
}

function setSpinnerVisible(visible) {
  const chatsLoading = document.getElementById("chats-loading");
  if (chatsLoading) {
    chatsLoading.hidden = !visible;
  }
}

/** Visible when spaces/chats are available; hide only on load errors. */
export function setMainPlaceholderVisible(visible) {
  const mainPlaceholder = document.getElementById("main-placeholder");
  if (mainPlaceholder) {
    mainPlaceholder.hidden = !visible;
  }
}

function restoreChatsEmptyContent(chatsEmpty) {
  const selected = document.querySelector('input[name="space"]:checked');
  const spaceName = selected?.dataset.spaceName?.trim() || "this space";

  chatsEmpty.replaceChildren();
  chatsEmpty.append("No chats in this space yet");
  const detail = document.createElement("span");
  detail.className = "chats-empty-detail";
  detail.textContent = spaceName;
  chatsEmpty.appendChild(detail);
}

function clearChatsContent() {
  const chatsEmpty = document.getElementById("chats-empty");
  const chatsList = document.getElementById("chats-list");

  if (chatsEmpty) {
    chatsEmpty.hidden = true;
  }
  chatsList?.replaceChildren();
}

function beginChatsLoad() {
  const chatsList = document.getElementById("chats-list");

  if (showSpinnerTimer !== null) {
    clearTimeout(showSpinnerTimer);
    showSpinnerTimer = null;
  }

  // Keep previous empty/list until data arrives (or until the delayed
  // spinner fires). Avoids empty→empty flicker on fast switches.
  // Do not toggle #main-placeholder here — that caused a flash.
  setSpinnerVisible(false);
  chatsList?.setAttribute("aria-busy", "true");

  showSpinnerTimer = setTimeout(() => {
    showSpinnerTimer = null;
    clearChatsContent();
    setSpinnerVisible(true);
  }, SPINNER_SHOW_DELAY_MS);
}

function endChatsLoad(token) {
  if (showSpinnerTimer !== null) {
    clearTimeout(showSpinnerTimer);
    showSpinnerTimer = null;
  }

  if (token !== loadToken) {
    return false;
  }

  setSpinnerVisible(false);
  document.getElementById("chats-list")?.setAttribute("aria-busy", "false");
  return true;
}

export async function loadChatsForSelectedSpace() {
  const selectedSpaceInput = document.querySelector(
    'input[name="space"]:checked'
  );

  if (!selectedSpaceInput) {
    console.warn("No space selected.");
    return;
  }

  const spaceId = selectedSpaceInput.value;
  const token = ++loadToken;
  resetChatHistoryState();
  hideChatPanel();
  beginChatsLoad();

  let chats;
  try {
    chats = await fetchChats(spaceId);
  } catch (error) {
    console.error(`Could not load chats for space ${spaceId}:`, error);
    if (token !== loadToken) {
      return;
    }
    endChatsLoad(token);
    clearChatsContent();
    hideChatPanel();
    setMainPlaceholderVisible(false);

    const chatsEmpty = document.getElementById("chats-empty");
    if (chatsEmpty) {
      chatsEmpty.hidden = false;
      chatsEmpty.replaceChildren();
      chatsEmpty.textContent = "Could not load chats.";
    }
    return;
  }

  if (token !== loadToken) {
    return;
  }

  const stillSelected = document.querySelector('input[name="space"]:checked');
  if (!stillSelected || stillSelected.value !== spaceId) {
    return;
  }

  if (!endChatsLoad(token)) {
    return;
  }

  const rows = populateChatsList(chats);
  setMainPlaceholderVisible(true);
  void loadChatPreviews(spaceId, rows, token);
}

/**
 * Builds one chat list row. Preview starts empty; Step 4 fills it from messages.
 * @returns {{ li: HTMLLIElement, previewEl: HTMLParagraphElement, chatId: string }}
 */
function createChatListItem(chat) {
  const li = document.createElement("li");
  if (chat.id) {
    li.dataset.chatId = chat.id;
  }

  const chatButton = document.createElement("button");
  chatButton.type = "button";
  chatButton.className = "chat-item";
  const chatName = chat.name ?? "-no name-";
  const chatId = chat.id ?? "";
  chatButton.addEventListener("click", () => {
    if (chatButton.classList.contains("chat-item--selected")) {
      return;
    }

    const previouslySelected = document.querySelector(
      "#chats-list .chat-item--selected"
    );
    previouslySelected?.classList.remove("chat-item--selected");
    chatButton.classList.add("chat-item--selected");
    showChatHeader(chatName);
    const selectedSpaceInput = document.querySelector(
      'input[name="space"]:checked'
    );
    if (selectedSpaceInput) {
      setOpenChat(selectedSpaceInput.value, chatId);
    }
    void openChatMessages(chatId);
  });

  const avatarDiv = document.createElement("div");
  avatarDiv.className = "avatar";
  chatButton.appendChild(avatarDiv);

  const divTextBlock = document.createElement("div");
  divTextBlock.className = "text-block";

  const chatHeaderDiv = document.createElement("div");
  chatHeaderDiv.className = "chat-header";

  const chatNameP = document.createElement("p");
  chatNameP.className = "chat-name";
  chatNameP.textContent = chatName;
  chatHeaderDiv.appendChild(chatNameP);

  divTextBlock.appendChild(chatHeaderDiv);

  const previewEl = document.createElement("p");
  previewEl.className = "chat-preview";
  previewEl.textContent = "";
  divTextBlock.appendChild(previewEl);

  chatButton.appendChild(divTextBlock);
  li.appendChild(chatButton);

  return { li, previewEl, chatId };
}

async function reloadMessagesAfterSend(spaceId, chatId) {
  const state = chatHistoryState;
  if (
    !state
    || state.spaceId !== spaceId
    || state.chatId !== chatId
  ) {
    return;
  }

  const { token } = state;

  try {
    const latestMessages = await fetchChatMessages(
      spaceId,
      chatId,
      MESSAGE_PAGE_SIZE
    );

    if (!isOpenChatMessagesCurrent(token) || chatHistoryState !== state) {
      return;
    }

    if (state.spaceId !== spaceId || state.chatId !== chatId) {
      return;
    }

    applyLatestPageAfterSend(state, latestMessages);
  } catch (error) {
    console.error(
      `Could not refresh messages after send for chat ${chatId}:`,
      error
    );
  }
}

async function openChatMessages(chatId) {
  const selectedSpaceInput = document.querySelector(
    'input[name="space"]:checked'
  );
  if (!selectedSpaceInput || !chatId) {
    return;
  }

  const spaceId = selectedSpaceInput.value;
  const token = beginOpenChatMessages();
  beginChatHistoryState(spaceId, chatId, token);

  try {
    const messages = await fetchChatMessages(
      spaceId,
      chatId,
      MESSAGE_PAGE_SIZE
    );
    if (!isOpenChatMessagesCurrent(token)) {
      return;
    }
    if (chatHistoryState?.token === token) {
      applyInitialPage(chatHistoryState, messages);
      renderOpenChatMessages(chatHistoryState.messages);
      updateHistoryStatus(chatHistoryState);
      await ensureHistoryFillsViewport();
      maybeLoadOlderMessages();
    } else {
      renderOpenChatMessages(messages);
    }
  } catch (error) {
    console.error(`Could not load messages for chat ${chatId}:`, error);
    if (!isOpenChatMessagesCurrent(token)) {
      return;
    }
    resetChatHistoryState();
    renderOpenChatMessagesError("Could not load messages.");
  }
}

setOnChatPanelHidden(resetChatHistoryState);

initChatHistoryScroll();
initChatHistoryRetry(() => {
  void loadOlderMessages({ retry: true });
});

setOpenChatMessagesReload(async (spaceId, chatId) => {
  const selectedSpaceInput = document.querySelector(
    'input[name="space"]:checked'
  );
  if (!selectedSpaceInput || selectedSpaceInput.value !== spaceId) {
    return;
  }

  await reloadMessagesAfterSend(spaceId, chatId);
});

initChatComposer(postChatMessage);

export function populateChatsList(chats) {
  const chatsList = document.getElementById("chats-list");
  const chatsEmpty = document.getElementById("chats-empty");
  if (!chatsList) {
    console.warn("Chats list element not found.");
    return [];
  }

  chatsList.replaceChildren();

  if (chats.length === 0) {
    if (chatsEmpty) {
      restoreChatsEmptyContent(chatsEmpty);
      chatsEmpty.hidden = false;
    }
    return [];
  }

  if (chatsEmpty) {
    chatsEmpty.hidden = true;
  }

  const rows = chats.map((chat) => {
    const row = createChatListItem(chat);
    const { li } = row;
    chatsList.appendChild(li);
    return row;
  });

  return rows;
}

function isStillCurrentSpace(spaceId, token) {
  if (token !== loadToken) {
    return false;
  }

  const stillSelected = document.querySelector('input[name="space"]:checked');
  
  return Boolean(stillSelected && stillSelected.value === spaceId);
}

async function loadChatPreviews(spaceId, rows, token) {
  for (const row of rows) {
    if (!isStillCurrentSpace(spaceId, token)) {
      return;
    }

    if (!row.chatId) {
      continue;
    }

    try {
      const messages = await fetchChatMessages(spaceId, row.chatId, 1);
      if (!isStillCurrentSpace(spaceId, token)) {
        return;
      }

      const latestMessage =
        Array.isArray(messages) && messages.length > 0 ? messages[0] : null;
      row.previewEl.textContent = latestMessage
        ? formatMessagePreview(latestMessage)
        : "";
    } catch (error) {
      console.error(`Could not load latest message for chat ${row.chatId}:`, error);
      row.previewEl.textContent = "";
    }
  }
}

export async function fetchChatMessages(
  spaceId,
  chatId,
  limit = 1,
  beforeOrderId = null
) {
  const params = new URLSearchParams();
  params.set("limit", String(limit));
  if (beforeOrderId) {
    params.set("beforeOrderId", beforeOrderId);
  }

  const response = await fetch(
    `${spacesUrl()}/${spaceId}/chats/${chatId}/messages?${params}`
  );

  if (!response.ok) {
    throw new Error(`Response status: ${response.status}`);
  }

  return await response.json();
}

function formatMessagePreview(message) {
  const text = message.content?.text?.trim() ?? "";

  if (!text) {
    return "";
  }

  return text;
}

/** Bumps when opening a chat or clearing the panel so stale fetches are ignored. */
let openChatToken = 0;
let openChat = null;
let sendPending = false;
let reloadOpenChatMessages = null;
let onChatPanelHidden = null;
let onListDraftIndicatorChanged = null;

/** Unsent composer text keyed by spaceId + chatId for the current session. */
const composerDrafts = new Map();

/** Chats whose sidebar preview should show "Draft:" for this session. */
const listDraftIndicators = new Set();

/** Fast loads finish without showing a spinner. */
const MESSAGES_SPINNER_SHOW_DELAY_MS = 300;
/** Once shown, keep the spinner visible long enough to avoid a brief flash. */
const MESSAGES_SPINNER_MIN_VISIBLE_MS = 400;
let showMessagesSpinnerTimer = null;
let messagesSpinnerShownAt = null;

function cancelMessagesSpinnerTimer() {
  if (showMessagesSpinnerTimer !== null) {
    clearTimeout(showMessagesSpinnerTimer);
    showMessagesSpinnerTimer = null;
  }
}

function getChatMessageList() {
  return document.getElementById("chat-message-list");
}

function setEmptyMessagesVisible(visible) {
  const empty = document.getElementById("chat-messages-empty");
  if (empty) {
    empty.hidden = !visible;
  }
}

function setSendErrorVisible(visible) {
  const error = document.getElementById("chat-send-error");
  if (error) {
    error.hidden = !visible;
  }
}

function composerDraftKey(spaceId, chatId) {
  return JSON.stringify([spaceId, chatId]);
}

/** True when the composer has sendable draft text (matches submit trim semantics). */
function hasDraftContent(text) {
  return text.trim().length > 0;
}

function getChatMessageInput() {
  const input = document.getElementById("chat-message-input");
  return input instanceof HTMLTextAreaElement ? input : null;
}

export function getComposerDraft(target) {
  if (!target) {
    return "";
  }
  return composerDrafts.get(composerDraftKey(target.spaceId, target.chatId)) ?? "";
}

function persistOutgoingDraft(target, { markInList = false, text } = {}) {
  const none = { stored: false, markable: false };
  if (!target) {
    return none;
  }

  const value = text ?? getChatMessageInput()?.value ?? "";
  const key = composerDraftKey(target.spaceId, target.chatId);
  const markable = hasDraftContent(value);
  if (!markable) {
    composerDrafts.delete(key);
    clearListDraftIndicator(target);
    return none;
  }

  composerDrafts.set(key, value);
  if (markInList) {
    markListDraftIndicator(target);
  }
  return { stored: true, markable: true };
}

function saveComposerDraft(target, text) {
  return persistOutgoingDraft(target, { text });
}

function clearComposerDraft(target) {
  if (!target) {
    return;
  }
  composerDrafts.delete(composerDraftKey(target.spaceId, target.chatId));
  clearListDraftIndicator(target);
}

function notifyListDraftIndicatorChanged(target) {
  if (!target || !onListDraftIndicatorChanged) {
    return;
  }
  onListDraftIndicatorChanged(target.spaceId, target.chatId);
}

function markListDraftIndicator(target) {
  if (!target) {
    return;
  }

  const key = composerDraftKey(target.spaceId, target.chatId);
  // Only saveComposerDraft writes composerDrafts; it never stores whitespace-only text.
  if (!composerDrafts.has(key)) {
    return;
  }

  listDraftIndicators.add(key);
  notifyListDraftIndicatorChanged(target);
}

function clearListDraftIndicator(target) {
  if (!target) {
    return;
  }

  const key = composerDraftKey(target.spaceId, target.chatId);
  if (!listDraftIndicators.delete(key)) {
    return;
  }

  notifyListDraftIndicatorChanged(target);
}

export function hasListDraftIndicator(spaceId, chatId) {
  return listDraftIndicators.has(composerDraftKey(spaceId, chatId));
}

function restoreComposerDraftToInput(target) {
  const input = getChatMessageInput();
  if (!input) {
    return;
  }

  const draft = getComposerDraft(target);
  input.value = draft;
  const end = draft.length;
  input.setSelectionRange(end, end);
  input.focus();
}

function setMessagesLoadingVisible(visible) {
  const loading = document.getElementById("chat-messages-loading");
  if (loading) {
    const wasVisible = !loading.hidden;
    loading.hidden = !visible;
    if (visible && !wasVisible) {
      messagesSpinnerShownAt = performance.now();
    } else if (!visible) {
      messagesSpinnerShownAt = null;
    }
  }
}

function setMessagesBusy(busy) {
  document
    .getElementById("chat-messages")
    ?.setAttribute("aria-busy", busy ? "true" : "false");
}

function endMessagesLoad() {
  cancelMessagesSpinnerTimer();
  setMessagesLoadingVisible(false);
  setMessagesBusy(false);
}

/**
 * Hide the initial spinner without flashing it for only a few milliseconds.
 * Returns false if another chat was opened while waiting.
 */
export async function finishOpenChatMessagesLoad(token) {
  cancelMessagesSpinnerTimer();

  if (messagesSpinnerShownAt !== null) {
    const elapsed = performance.now() - messagesSpinnerShownAt;
    const remaining = MESSAGES_SPINNER_MIN_VISIBLE_MS - elapsed;
    if (remaining > 0) {
      await new Promise((resolve) => setTimeout(resolve, remaining));
    }
  }

  if (token !== openChatToken) {
    return false;
  }

  setMessagesLoadingVisible(false);
  setMessagesBusy(false);
  return true;
}

function clearChatMessages() {
  endMessagesLoad();
  const container = document.getElementById("chat-messages");
  if (container) {
    setMessagesPreparing(container, false);
  }
  getChatMessageList()?.replaceChildren();
  setEmptyMessagesVisible(false);
}

function isChatPanelOpen() {
  const panel = document.getElementById("chat-panel");
  return Boolean(panel && !panel.hidden);
}

function clearChatListSelection() {
  document
    .querySelector("#chats-list .chat-item--selected")
    ?.classList.remove("chat-item--selected");
}

/** Show the main chat panel header with the given chat name. */
export function showChatHeader(name) {
  const main = document.querySelector(".main");
  const panel = document.getElementById("chat-panel");
  const title = document.getElementById("chat-panel-title");
  const placeholder = document.getElementById("main-placeholder");

  if (title) {
    title.textContent = name;
  }
  if (panel) {
    panel.hidden = false;
  }
  if (placeholder) {
    placeholder.hidden = true;
  }
  main?.classList.add("main--chat-open");
}

/** Hide the chat panel and clear the title (e.g. when the space changes). */
export function hideChatPanel(options = {}) {
  const { markListDraft = false } = options;
  const main = document.querySelector(".main");
  const panel = document.getElementById("chat-panel");
  const title = document.getElementById("chat-panel-title");
  const placeholder = document.getElementById("main-placeholder");

  persistOutgoingDraft(openChat, { markInList: markListDraft });
  const input = getChatMessageInput();
  if (input) {
    input.value = "";
  }

  openChatToken += 1;
  openChat = null;
  clearChatMessages();
  resetChatHistoryStatus();
  setSendErrorVisible(false);
  onChatPanelHidden?.();

  if (title) {
    title.textContent = "";
  }
  if (panel) {
    panel.hidden = true;
  }
  if (placeholder) {
    placeholder.hidden = false;
  }
  main?.classList.remove("main--chat-open");
}

/**
 * Close the open chat panel and clear list selection.
 * @returns {boolean} true if a chat was open and is now closed
 */
export function closeOpenChat() {
  if (!isChatPanelOpen()) {
    return false;
  }

  hideChatPanel({ markListDraft: true });
  clearChatListSelection();

  // Escape switches Chromium to keyboard modality, so :focus-visible would
  // draw a ring on the still-focused chat button (WebView2). Firefox often
  // does not. Blur removes that ring after close.
  const active = document.activeElement;
  if (active instanceof HTMLElement && active.classList.contains("chat-item")) {
    active.blur();
  }

  return true;
}

/** Escape and mouse Back (button 3) close the open chat. */
export function initChatViewCloseBindings() {
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") {
      return;
    }

    if (closeOpenChat()) {
      event.preventDefault();
    }
  });

  // Mouse X1 ("Back") is button 3. Prevent the browser from navigating away.
  document.addEventListener("mousedown", (event) => {
    if (event.button !== 3) {
      return;
    }

    if (!isChatPanelOpen()) {
      return;
    }

    event.preventDefault();
    closeOpenChat();
  });
}

/**
 * Clears the messages area and returns a token for this open.
 * Ignore fetch results when the token no longer matches.
 */
export function beginOpenChatMessages() {
  const loadingEl = document.getElementById("chat-messages-loading");
  const wasLoadingVisible = Boolean(loadingEl && !loadingEl.hidden);
  const emptyEl = document.getElementById("chat-messages-empty");
  const keepStaleContent =
    (getChatMessageList()?.childElementCount ?? 0) > 0 ||
    Boolean(emptyEl && !emptyEl.hidden);

  cancelMessagesSpinnerTimer();
  const token = ++openChatToken;
  setMessagesBusy(true);

  if (wasLoadingVisible) {
    setEmptyMessagesVisible(false);
    getChatMessageList()?.replaceChildren();
    setMessagesLoadingVisible(true);
    return token;
  }

  if (!keepStaleContent) {
    getChatMessageList()?.replaceChildren();
    setEmptyMessagesVisible(false);
  }

  setMessagesLoadingVisible(false);

  showMessagesSpinnerTimer = setTimeout(() => {
    showMessagesSpinnerTimer = null;
    if (token !== openChatToken) {
      return;
    }
    getChatMessageList()?.replaceChildren();
    setEmptyMessagesVisible(false);
    setMessagesLoadingVisible(true);
  }, MESSAGES_SPINNER_SHOW_DELAY_MS);

  return token;
}

export function setOpenChat(spaceId, chatId) {
  const outgoing = openChat;
  persistOutgoingDraft(outgoing, { markInList: true });
  openChat = { spaceId, chatId };
  restoreComposerDraftToInput(openChat);
  setSendErrorVisible(false);
}

export function setOpenChatMessagesReload(callback) {
  reloadOpenChatMessages = callback;
}

export function setOnChatPanelHidden(callback) {
  onChatPanelHidden = callback;
}

export function setOnListDraftIndicatorChanged(callback) {
  onListDraftIndicatorChanged = callback;
}

export function isOpenChatMessagesCurrent(token) {
  return token === openChatToken;
}

/** @typedef {'hidden' | 'loading' | 'error' | 'end'} ChatHistoryStatusMode */

/**
 * @param {ChatHistoryStatusMode} mode
 */
export function setChatHistoryStatus(mode) {
  const root = document.getElementById("chat-messages-history");
  const loading = document.getElementById("chat-messages-history-loading");
  const error = document.getElementById("chat-messages-history-error");
  const end = document.getElementById("chat-messages-history-end");
  if (!root || !loading || !error || !end) {
    return;
  }

  if (mode === "hidden") {
    root.hidden = true;
    loading.hidden = true;
    error.hidden = true;
    end.hidden = true;
    return;
  }

  root.hidden = false;
  loading.hidden = mode !== "loading";
  error.hidden = mode !== "error";
  end.hidden = mode !== "end";
}

export function resetChatHistoryStatus() {
  setChatHistoryStatus("hidden");
}

export function initChatHistoryRetry(onRetry) {
  const retryButton = document.getElementById("chat-messages-history-retry");
  if (!(retryButton instanceof HTMLButtonElement)) {
    return;
  }

  retryButton.addEventListener("click", () => {
    onRetry();
  });
}

function isRenderableTextMessage(message) {
  const text = message?.content?.text;
  return typeof text === "string" && text.trim().length > 0;
}

function rowModifierClass(isMine) {
  if (isMine === true) {
    return "message-row--mine";
  }

  if (isMine === false) {
    return "message-row--other";
  }

  return "message-row--neutral";
}

/**
 * @param {object} message
 * @returns {HTMLDivElement | null}
 */
function createMessageRow(message) {
  if (!isRenderableTextMessage(message)) {
    return null;
  }

  const row = document.createElement("div");
  row.className = `message-row ${rowModifierClass(message.isMine)}`;
  if (message.id) {
    row.dataset.messageId = message.id;
  }

  const bubble = document.createElement("div");
  bubble.className = "message-bubble";
  bubble.textContent = message.content.text;
  row.appendChild(bubble);

  return row;
}

/**
 * @param {object[]} messages
 * @returns {{ fragment: DocumentFragment, renderedCount: number }}
 */
function buildMessageFragment(messages) {
  const fragment = document.createDocumentFragment();
  let renderedCount = 0;

  // Anytype already returns each window oldest → newest. Do not reverse.
  for (const message of messages) {
    const row = createMessageRow(message);
    if (!row) {
      continue;
    }

    fragment.appendChild(row);
    renderedCount += 1;
  }

  return { fragment, renderedCount };
}

function setMessagesPreparing(container, preparing) {
  container.classList.toggle("chat-messages--preparing", preparing);
}

/** Pin the scroll container to the newest message after layout. */
function scrollMessagesToBottom(container) {
  // Force layout so scrollHeight reflects the rows just inserted.
  void container.offsetHeight;
  container.scrollTop = container.scrollHeight;
}

/** Clear the list, render the latest page, and scroll to the bottom. */
export function renderOpenChatMessages(messages) {
  const list = getChatMessageList();
  const container = document.getElementById("chat-messages");
  if (!list || !container) {
    return;
  }

  endMessagesLoad();
  // Hide before clearing/appending so the browser never paints scrollTop=0.
  setMessagesPreparing(container, true);
  list.replaceChildren();
  setEmptyMessagesVisible(false);

  if (!Array.isArray(messages)) {
    setEmptyMessagesVisible(true);
    setMessagesPreparing(container, false);
    return;
  }

  const { fragment, renderedCount } = buildMessageFragment(messages);
  if (renderedCount === 0) {
    setEmptyMessagesVisible(true);
    setMessagesPreparing(container, false);
    return;
  }

  list.appendChild(fragment);
  scrollMessagesToBottom(container);
  setMessagesPreparing(container, false);
}

/**
 * Prepend older messages without moving the reader's viewport.
 * @param {object[]} messages deduplicated batch, oldest → newest
 * @returns {number} rows actually inserted
 */
export function prependOlderChatMessages(messages) {
  const list = getChatMessageList();
  const container = document.getElementById("chat-messages");
  if (!list || !container || !Array.isArray(messages) || messages.length === 0) {
    return 0;
  }

  const { fragment, renderedCount } = buildMessageFragment(messages);
  if (renderedCount === 0) {
    return 0;
  }

  const previousScrollHeight = container.scrollHeight;
  const previousScrollTop = container.scrollTop;

  list.insertBefore(fragment, list.firstChild);
  container.scrollTop =
    previousScrollTop + (container.scrollHeight - previousScrollHeight);

  return renderedCount;
}

/**
 * Append newer messages and scroll to the bottom.
 * @param {object[]} messages deduplicated batch, oldest → newest
 * @returns {number} rows actually inserted
 */
export function appendNewerChatMessages(messages) {
  const list = getChatMessageList();
  const container = document.getElementById("chat-messages");
  if (!list || !container || !Array.isArray(messages) || messages.length === 0) {
    return 0;
  }

  const { fragment, renderedCount } = buildMessageFragment(messages);
  if (renderedCount === 0) {
    return 0;
  }

  setEmptyMessagesVisible(false);
  list.appendChild(fragment);
  scrollMessagesToBottom(container);
  return renderedCount;
}

export function renderOpenChatMessagesError(text) {
  const list = getChatMessageList();
  const container = document.getElementById("chat-messages");
  if (!list) {
    return;
  }

  endMessagesLoad();
  if (container) {
    setMessagesPreparing(container, false);
  }
  setEmptyMessagesVisible(false);
  list.replaceChildren();

  const line = document.createElement("div");
  line.className = "chat-messages-error";
  line.setAttribute("role", "alert");
  line.textContent = text;
  list.appendChild(line);
}

export function initChatComposer(postChatMessage) {
  const composer = document.getElementById("chat-composer");
  const input = document.getElementById("chat-message-input");
  const sendButton = document.getElementById("chat-send-button");
  if (!(composer instanceof HTMLFormElement)
      || !(input instanceof HTMLTextAreaElement)
      || !(sendButton instanceof HTMLButtonElement)) {
    return;
  }

  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) {
      return;
    }

    event.preventDefault();
    composer.requestSubmit();
  });

  composer.addEventListener("submit", async (event) => {
    event.preventDefault();

    const text = input.value.trim();
    const target = openChat;
    if (!text || !target || sendPending) {
      return;
    }

    setSendErrorVisible(false);
    sendPending = true;
    input.disabled = true;
    sendButton.disabled = true;

    try {
      try {
        await postChatMessage(target.spaceId, target.chatId, text);
      } catch (error) {
        console.error("Could not send message:", error);
        if (
          openChat?.spaceId === target.spaceId
          && openChat?.chatId === target.chatId
        ) {
          setSendErrorVisible(true);
        }
        return;
      }

      clearComposerDraft(target);

      if (
        openChat?.spaceId !== target.spaceId
        || openChat?.chatId !== target.chatId
      ) {
        return;
      }

      input.value = "";
      await reloadOpenChatMessages?.(target.spaceId, target.chatId);
    } finally {
      sendPending = false;
      input.disabled = false;
      sendButton.disabled = false;
      if (
        openChat?.spaceId === target.spaceId
        && openChat?.chatId === target.chatId
      ) {
        input.focus();
      }
    }
  });
}

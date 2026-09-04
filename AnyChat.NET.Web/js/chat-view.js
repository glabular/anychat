import {
  formatDateDdMmYyyy,
  formatTimeHhMm,
  localDayKey,
} from "./date-format.js";
import {
  createSendStatusElement,
  resolveOutgoingSendStatus,
} from "./message-send-status.js";
import {
  hideScrollToLatestButton,
  isChatMessagesAtLatest,
  scrollChatToLatest,
  syncScrollToLatestButton,
} from "./chat-messages-scroll.js";
import {
  buildMemberFileAvatarUrl,
  getSpaceMember,
  initialsFromDisplayName,
} from "./space-members.js";

/** Bumps when opening a chat or clearing the panel so stale fetches are ignored. */
let openChatToken = 0;
let openChat = null;
let sendPending = false;
let reloadOpenChatMessages = null;
let onChatPanelHidden = null;
let onListDraftIndicatorChanged = null;
let onOutgoingPreviewChanged = null;

/**
 * When set, message rows render author avatars and names (regular spaces only).
 * @type {{
 *   spaceId: string,
 *   gatewayUrl: string,
 *   enabled: boolean,
 *   selfParticipantId: string | null,
 * } | null}
 */
let messageProfiles = null;

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

  if (value === "") {
    composerDrafts.delete(key);
    clearListDraftIndicator(target);
    return none;
  }

  composerDrafts.set(key, value);
  const markable = hasDraftContent(value);
  if (markInList && markable) {
    markListDraftIndicator(target);
  } else if (!markable) {
    clearListDraftIndicator(target);
  }
  return { stored: true, markable };
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
  if (!hasDraftContent(getComposerDraft(target))) {
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

function getChatSendButton() {
  const sendButton = document.getElementById("chat-send-button");
  return sendButton instanceof HTMLButtonElement ? sendButton : null;
}

/**
 * Sync send-button visibility and textarea height to the current draft.
 * Call after any user or programmatic change to the input value.
 */
function syncComposerUi() {
  const input = getChatMessageInput();
  const sendButton = getChatSendButton();
  if (!input || !sendButton) {
    return;
  }

  const canSend = hasDraftContent(input.value);
  sendButton.classList.toggle("chat-send-button--ready", canSend);
  sendButton.disabled = !canSend || sendPending;
  sendButton.tabIndex = canSend ? 0 : -1;
  sendButton.setAttribute("aria-hidden", canSend ? "false" : "true");

  const messages = document.getElementById("chat-messages");
  const pinLatest = isChatMessagesAtLatest(messages);

  // Collapse first so scrollHeight reflects content, then grow up to CSS max-height.
  // Keep overflow hidden until the cap so an empty/short field never shows a scrollbar.
  input.style.height = "auto";
  const contentHeight = input.scrollHeight;
  const maxHeight = Number.parseFloat(getComputedStyle(input).maxHeight);
  const atCap = Number.isFinite(maxHeight) && contentHeight > maxHeight;
  input.style.height = `${contentHeight}px`;
  input.style.overflowY = atCap ? "auto" : "hidden";

  // When capped, keep the caret line in view while appending (typing/newlines at the end).
  if (atCap && input.selectionStart === input.value.length) {
    input.scrollTop = input.scrollHeight;
  }

  // Composer growth shrinks the message pane; re-pin so latest messages stay above the pill.
  if (pinLatest) {
    scrollChatToLatest();
  }
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
  syncComposerUi();
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
  hideScrollToLatestButton();
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
  syncComposerUi();

  openChatToken += 1;
  openChat = null;
  clearMessageProfilesContext();
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
  hideScrollToLatestButton();

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
    hideScrollToLatestButton();
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

/**
 * Enable or clear author-profile rendering for the open chat.
 * Pass null / disabled outside anytype.space so profile markup is absent.
 * @param {{
 *   spaceId: string,
 *   gatewayUrl?: string,
 *   enabled: boolean,
 * } | null} context
 */
export function setMessageProfilesContext(context) {
  if (!context || !context.enabled || !context.spaceId) {
    messageProfiles = null;
    return;
  }

  messageProfiles = {
    spaceId: context.spaceId,
    gatewayUrl:
      typeof context.gatewayUrl === "string" ? context.gatewayUrl : "",
    enabled: true,
    selfParticipantId: messageProfiles?.spaceId === context.spaceId
      ? messageProfiles.selfParticipantId
      : null,
  };
}

export function clearMessageProfilesContext() {
  messageProfiles = null;
}

/**
 * Remember the current user's participant id from isMine messages.
 * @param {object[] | null | undefined} messages
 */
function rememberSelfParticipantFromMessages(messages) {
  if (!messageProfiles?.enabled || !Array.isArray(messages)) {
    return;
  }

  for (const message of messages) {
    if (
      message?.isMine === true
      && typeof message.creator === "string"
      && message.creator.trim()
    ) {
      messageProfiles.selfParticipantId = message.creator.trim();
      return;
    }
  }
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

export function setOnOutgoingPreviewChanged(callback) {
  onOutgoingPreviewChanged = callback;
}

/**
 * @param {{ spaceId: string, chatId: string }} target
 * @param {object} parts
 */
function notifyOutgoingPreviewChanged(target, parts) {
  onOutgoingPreviewChanged?.(target, parts);
}

export function isOpenChatMessagesCurrent(token) {
  return token === openChatToken;
}

/** @typedef {'hidden' | 'loading' | 'error' | 'end'} ChatHistoryStatusMode */

function isInitialLoadErrorVisible() {
  const initialError = document.getElementById("chat-messages-initial-error");
  return initialError instanceof HTMLElement && !initialError.hidden;
}

function isChatHistoryStatusActive() {
  const loading = document.getElementById("chat-messages-history-loading");
  const error = document.getElementById("chat-messages-history-error");
  const end = document.getElementById("chat-messages-history-end");
  return (
    (loading instanceof HTMLElement && !loading.hidden)
    || (error instanceof HTMLElement && !error.hidden)
    || (end instanceof HTMLElement && !end.hidden)
  );
}

function syncChatMessagesHistoryRoot() {
  const root = document.getElementById("chat-messages-history");
  if (!(root instanceof HTMLElement)) {
    return;
  }

  root.hidden = !isInitialLoadErrorVisible() && !isChatHistoryStatusActive();
}

/**
 * @param {boolean} visible
 * @param {string} [text]
 */
function setInitialLoadErrorVisible(visible, text) {
  const initialError = document.getElementById("chat-messages-initial-error");
  const initialErrorText = document.getElementById("chat-messages-initial-error-text");
  if (!(initialError instanceof HTMLElement)) {
    return;
  }

  if (text && initialErrorText) {
    initialErrorText.textContent = text;
  }

  initialError.hidden = !visible;
  syncChatMessagesHistoryRoot();
}

export function clearInitialLoadError() {
  setInitialLoadErrorVisible(false);
}

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
    loading.hidden = true;
    error.hidden = true;
    end.hidden = true;
    syncChatMessagesHistoryRoot();
    return;
  }

  root.hidden = false;
  loading.hidden = mode !== "loading";
  error.hidden = mode !== "error";
  end.hidden = mode !== "end";
}

export function resetChatHistoryStatus() {
  clearInitialLoadError();
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

export function initInitialLoadRetry(onRetry) {
  const retryButton = document.getElementById("chat-messages-initial-retry");
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
 * @param {string} dayKey
 * @param {unknown} unixSeconds
 * @returns {HTMLDivElement | null}
 */
function createMessageDateSeparator(dayKey, unixSeconds) {
  const label = formatDateDdMmYyyy(unixSeconds);
  if (!label) {
    return null;
  }

  const separator = document.createElement("div");
  separator.className = "message-date-separator";
  separator.dataset.dayKey = dayKey;
  separator.setAttribute("role", "separator");
  separator.textContent = label;
  return separator;
}

/**
 * @param {Element | null | undefined} node
 * @returns {string | null}
 */
function dayKeyFromNode(node) {
  if (!(node instanceof HTMLElement)) {
    return null;
  }

  const dayKey = node.dataset.dayKey;
  return typeof dayKey === "string" && dayKey.length > 0 ? dayKey : null;
}

/**
 * @param {HTMLElement} list
 * @returns {string | null}
 */
function getFirstDayKey(list) {
  for (const child of list.children) {
    const dayKey = dayKeyFromNode(child);
    if (dayKey) {
      return dayKey;
    }
  }

  return null;
}

/**
 * @param {HTMLElement} list
 * @returns {string | null}
 */
function getLastDayKey(list) {
  for (let index = list.children.length - 1; index >= 0; index -= 1) {
    const dayKey = dayKeyFromNode(list.children[index]);
    if (dayKey) {
      return dayKey;
    }
  }

  return null;
}

/**
 * @param {object} message
 * @returns {{
 *   participantId: string | null,
 *   displayName: string,
 *   member: object | null,
 * } | null}
 */
function resolveMessageAuthor(message) {
  if (!messageProfiles?.enabled) {
    return null;
  }

  // Own bubbles stay right-aligned without avatar/name.
  if (message.isMine === true) {
    if (typeof message.creator === "string" && message.creator.trim()) {
      messageProfiles.selfParticipantId = message.creator.trim();
    }
    return null;
  }

  const participantId =
    typeof message.creator === "string" && message.creator.trim()
      ? message.creator.trim()
      : null;

  const member = participantId
    ? getSpaceMember(messageProfiles.spaceId, participantId)
    : null;

  const displayName =
    member?.name?.trim()
    || (typeof message.creatorName === "string" ? message.creatorName.trim() : "")
    || "Unknown";

  return { participantId, displayName, member };
}

/**
 * @param {{
 *   displayName: string,
 *   member: object | null,
 *   participantId: string | null,
 * }} author
 * @returns {HTMLButtonElement}
 */
function createAuthorAvatarButton(author) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "message-author-avatar";
  button.setAttribute("aria-label", `Profile: ${author.displayName}`);
  if (author.participantId) {
    button.dataset.participantId = author.participantId;
  }

  const avatar = author.member?.avatar;
  const kind = typeof avatar?.kind === "string" ? avatar.kind : "";

  if (kind === "emoji" && typeof avatar.emoji === "string" && avatar.emoji.trim()) {
    button.classList.add("message-author-avatar--emoji");
    button.textContent = avatar.emoji.trim();
    return button;
  }

  if (kind === "file" && typeof avatar.fileId === "string") {
    const url = buildMemberFileAvatarUrl(
      messageProfiles?.gatewayUrl,
      avatar.fileId
    );
    if (url) {
      const img = document.createElement("img");
      img.className = "message-author-avatar-image";
      img.src = url;
      img.alt = "";
      img.decoding = "async";
      img.addEventListener("error", () => {
        button.replaceChildren();
        button.classList.remove("message-author-avatar--image");
        button.classList.add("message-author-avatar--initials");
        button.textContent = initialsFromDisplayName(author.displayName);
      });
      button.classList.add("message-author-avatar--image");
      button.appendChild(img);
      return button;
    }
  }

  if (kind === "named" && typeof avatar.name === "string" && avatar.name.trim()) {
    button.classList.add("message-author-avatar--named");
    button.textContent = initialsFromDisplayName(
      avatar.name.trim() || author.displayName
    );
    const color =
      typeof avatar.color === "string" ? avatar.color.trim() : "";
    if (color) {
      button.style.backgroundColor = color;
    }
    return button;
  }

  button.classList.add("message-author-avatar--initials");
  button.textContent = initialsFromDisplayName(author.displayName);
  return button;
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
  if (message.clientTempId) {
    row.dataset.clientTempId = message.clientTempId;
  }

  const dayKey = localDayKey(message.createdAt);
  if (dayKey) {
    row.dataset.dayKey = dayKey;
  }

  const bubble = document.createElement("div");
  bubble.className = "message-bubble";

  const author = resolveMessageAuthor(message);
  if (author) {
    row.classList.add("message-row--with-profile");
    row.appendChild(createAuthorAvatarButton(author));

    const nameEl = document.createElement("div");
    nameEl.className = "message-author-name";
    nameEl.textContent = author.displayName;
    bubble.appendChild(nameEl);
  }

  const textEl = document.createElement("div");
  textEl.className = "message-bubble-text";
  textEl.textContent = message.content.text;
  bubble.appendChild(textEl);

  const timeLabel = formatTimeHhMm(message.createdAt);
  const sendStatus = resolveOutgoingSendStatus(message);

  if (timeLabel || sendStatus) {
    // Invisible end-of-text reserve so absolute meta can sit on the last line.
    const spacer = document.createElement("span");
    spacer.className = "message-bubble-meta-spacer";
    spacer.setAttribute("aria-hidden", "true");
    bubble.appendChild(spacer);

    const meta = document.createElement("div");
    meta.className = "message-bubble-meta";

    if (timeLabel) {
      const timeEl = document.createElement("time");
      timeEl.className = "message-bubble-time";
      timeEl.textContent = timeLabel;
      if (typeof message.createdAt === "number") {
        timeEl.dateTime = new Date(message.createdAt * 1000).toISOString();
      }
      meta.appendChild(timeEl);
    }

    if (sendStatus) {
      bubble.classList.add("message-bubble--has-status");
      const statusSlot = document.createElement("div");
      statusSlot.className = "message-bubble-status";
      statusSlot.appendChild(createSendStatusElement(sendStatus));
      meta.appendChild(statusSlot);
    }

    bubble.appendChild(meta);
  }

  if (author) {
    const body = document.createElement("div");
    body.className = "message-body";
    body.appendChild(bubble);
    row.appendChild(body);
  } else {
    row.appendChild(bubble);
  }

  return row;
}

/**
 * @param {{ clientTempId?: string, messageId?: string, status: import("./message-send-status.js").SendStatus }} options
 */
export function updateMessageRowSendStatus({ clientTempId, messageId, status }) {
  const list = getChatMessageList();
  if (!list || !status) {
    return;
  }

  const selector = clientTempId
    ? `[data-client-temp-id="${CSS.escape(clientTempId)}"]`
    : messageId
      ? `[data-message-id="${CSS.escape(messageId)}"]`
      : null;
  if (!selector) {
    return;
  }

  const row = list.querySelector(selector);
  const bubble = row?.querySelector(".message-bubble");
  if (!bubble) {
    return;
  }

  let meta = bubble.querySelector(".message-bubble-meta");
  if (!meta) {
    if (!bubble.querySelector(".message-bubble-meta-spacer")) {
      const spacer = document.createElement("span");
      spacer.className = "message-bubble-meta-spacer";
      spacer.setAttribute("aria-hidden", "true");
      bubble.appendChild(spacer);
    }
    meta = document.createElement("div");
    meta.className = "message-bubble-meta";
    bubble.appendChild(meta);
  }

  let statusSlot = meta.querySelector(".message-bubble-status");
  if (!statusSlot) {
    bubble.classList.add("message-bubble--has-status");
    statusSlot = document.createElement("div");
    statusSlot.className = "message-bubble-status";
    meta.appendChild(statusSlot);
  }
  statusSlot.replaceChildren(createSendStatusElement(status));

  if (messageId) {
    row.dataset.messageId = messageId;
  }
}

/**
 * @param {object[]} messages
 * @param {{ previousDayKey?: string | null }} [options]
 * @returns {{
 *   fragment: DocumentFragment,
 *   renderedCount: number,
 *   trailingDayKey: string | null,
 * }}
 */
function buildMessageFragment(messages, { previousDayKey = null } = {}) {
  const fragment = document.createDocumentFragment();
  let renderedCount = 0;
  let lastDayKey = previousDayKey;
  /** @type {string | null} */
  let trailingDayKey = null;

  rememberSelfParticipantFromMessages(messages);

  // Anytype already returns each window oldest → newest. Do not reverse.
  for (const message of messages) {
    const row = createMessageRow(message);
    if (!row) {
      continue;
    }

    const dayKey = dayKeyFromNode(row);
    if (dayKey && dayKey !== lastDayKey) {
      const separator = createMessageDateSeparator(dayKey, message.createdAt);
      if (separator) {
        fragment.appendChild(separator);
      }
      lastDayKey = dayKey;
    }
    if (dayKey) {
      trailingDayKey = dayKey;
    }

    fragment.appendChild(row);
    renderedCount += 1;
  }

  return { fragment, renderedCount, trailingDayKey };
}

function setMessagesPreparing(container, preparing) {
  container.classList.toggle("chat-messages--preparing", preparing);
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
    syncScrollToLatestButton();
    return;
  }

  const { fragment, renderedCount } = buildMessageFragment(messages);
  if (renderedCount === 0) {
    setEmptyMessagesVisible(true);
    setMessagesPreparing(container, false);
    syncScrollToLatestButton();
    return;
  }

  list.appendChild(fragment);
  scrollChatToLatest();
  setMessagesPreparing(container, false);
  syncScrollToLatestButton();
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

  const existingFirstDayKey = getFirstDayKey(list);
  const { fragment, renderedCount, trailingDayKey } =
    buildMessageFragment(messages);
  if (renderedCount === 0) {
    return 0;
  }

  const previousScrollHeight = container.scrollHeight;
  const previousScrollTop = container.scrollTop;

  if (
    trailingDayKey
    && trailingDayKey === existingFirstDayKey
    && list.firstElementChild?.classList.contains("message-date-separator")
  ) {
    list.firstElementChild.remove();
  }

  list.insertBefore(fragment, list.firstChild);
  container.scrollTop =
    previousScrollTop + (container.scrollHeight - previousScrollHeight);
  syncScrollToLatestButton();

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

  const { fragment, renderedCount } = buildMessageFragment(messages, {
    previousDayKey: getLastDayKey(list),
  });
  if (renderedCount === 0) {
    return 0;
  }

  setEmptyMessagesVisible(false);
  list.appendChild(fragment);
  scrollChatToLatest();
  return renderedCount;
}

export function renderOpenChatMessagesError(text) {
  const list = getChatMessageList();
  const container = document.getElementById("chat-messages");
  if (!list) {
    return;
  }

  endMessagesLoad();
  hideScrollToLatestButton();
  if (container) {
    setMessagesPreparing(container, false);
  }
  setEmptyMessagesVisible(false);
  list.replaceChildren();
  setInitialLoadErrorVisible(true, text);
  syncScrollToLatestButton();
}

export function initChatComposer(
  postChatMessage,
  pushOptimisticMessage,
  markOptimisticMessageSent,
  markOptimisticMessageFailed
) {
  const composer = document.getElementById("chat-composer");
  const input = document.getElementById("chat-message-input");
  const sendButton = document.getElementById("chat-send-button");
  if (!(composer instanceof HTMLFormElement)
      || !(input instanceof HTMLTextAreaElement)
      || !(sendButton instanceof HTMLButtonElement)) {
    return;
  }

  syncComposerUi();

  input.addEventListener("input", () => {
    syncComposerUi();
  });

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

    const clientTempId = crypto.randomUUID?.() ?? `temp-${Date.now()}`;
    const createdAt = Math.floor(Date.now() / 1000);
    const optimisticMessage = {
      clientTempId,
      createdAt,
      isMine: true,
      clientSendStatus: "sending",
      content: { text },
    };

    const optimisticPushed = pushOptimisticMessage?.(
      target.spaceId,
      target.chatId,
      optimisticMessage
    ) ?? false;
    clearComposerDraft(target);
    if (
      openChat?.spaceId === target.spaceId
      && openChat?.chatId === target.chatId
    ) {
      input.value = "";
      syncComposerUi();
    }
    if (optimisticPushed) {
      notifyOutgoingPreviewChanged(target, {
        text,
        isMine: true,
        sendStatus: "sending",
        createdAt,
      });
    }

    try {
      try {
        const response = await postChatMessage(target.spaceId, target.chatId, text);
        const messageId = typeof response?.messageId === "string"
          ? response.messageId
          : null;

        if (messageId) {
          markOptimisticMessageSent?.(
            target.spaceId,
            target.chatId,
            clientTempId,
            messageId
          );
          if (
            openChat?.spaceId === target.spaceId
            && openChat?.chatId === target.chatId
          ) {
            updateMessageRowSendStatus({
              clientTempId,
              messageId,
              status: "sent",
            });
          }
        }

        if (optimisticPushed) {
          notifyOutgoingPreviewChanged(target, {
            text,
            isMine: true,
            sendStatus: "sent",
            createdAt,
          });
        }

        if (
          openChat?.spaceId === target.spaceId
          && openChat?.chatId === target.chatId
        ) {
          await reloadOpenChatMessages?.(target.spaceId, target.chatId);
        }
      } catch (error) {
        console.error("Could not send message:", error);
        markOptimisticMessageFailed?.(
          target.spaceId,
          target.chatId,
          clientTempId
        );
        if (
          openChat?.spaceId === target.spaceId
          && openChat?.chatId === target.chatId
        ) {
          updateMessageRowSendStatus({
            clientTempId,
            status: "failed",
          });
        }
        if (optimisticPushed) {
          notifyOutgoingPreviewChanged(target, {
            text,
            isMine: true,
            sendStatus: "failed",
            createdAt,
          });
        }
        return;
      }
    } finally {
      sendPending = false;
      input.disabled = false;
      sendButton.disabled = false;
      syncComposerUi();
      if (
        openChat?.spaceId === target.spaceId
        && openChat?.chatId === target.chatId
      ) {
        input.focus();
      }
    }
  });
}

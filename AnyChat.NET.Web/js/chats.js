import {
  chatMessagesStreamUrl,
  fetchChats,
  postChatMessage,
  spacesUrl,
} from "./api.js";
import { formatChatListTimestamp } from "./date-format.js";
import { createSendStatusElement, resolveOutgoingSendStatus } from "./message-send-status.js";
import { initChatMessagesScroll } from "./chat-messages-scroll.js";
import {
  hideChatsScrollToTopButton,
  syncChatsScrollToTopButton,
} from "./chats-scroll-to-top.js";
import {
  beginOpenChatMessages,
  clearMessageProfilesContext,
  finishOpenChatMessagesLoad,
  hideChatPanel,
  initChatComposer,
  initChatHistoryRetry,
  initInitialLoadRetry,
  isOpenChatMessagesCurrent,
  prependOlderChatMessages,
  appendNewerChatMessages,
  renderOpenChatMessages,
  renderOpenChatMessagesError,
  rerenderOpenChatMessagesPreservingViewport,
  updateMessageRowSendStatus,
  clearInitialLoadError,
  resetChatHistoryStatus,
  setChatHistoryStatus,
  setMessageProfilesContext,
  setOnChatPanelHidden,
  setOnListDraftIndicatorChanged,
  setOnOutgoingPreviewChanged,
  setOpenChat,
  setOpenChatMessagesReload,
  showChatHeader,
  hasListDraftIndicator,
  getComposerDraft,
} from "./chat-view.js";
import {
  clearSpaceMembersCache,
  ensureMembersForParticipantIds,
  getSpaceMember,
  isRegularSpaceObject,
} from "./space-members.js";

/** Messages fetched per open-chat request and per older-history page. */
const MESSAGE_PAGE_SIZE = 50;

/** Load older history when the reader scrolls within this distance of the top. */
const SCROLL_TOP_THRESHOLD_PX = 80;

/** Cap automatic fill requests when the first page does not overflow. */
const MAX_AUTO_FILL_PAGES = 5;

/** Avoid flashing the older-history spinner for fast cursor requests. */
const HISTORY_SPINNER_SHOW_DELAY_MS = 300;
const HISTORY_SPINNER_MIN_VISIBLE_MS = 400;

/** Wait this long before showing the spinner (avoids flash on fast loads). */
const SPINNER_SHOW_DELAY_MS = 200;

/** Active-chat SSE reconnect backoff (close EventSource on error; no browser tight loop). */
const STREAM_BACKOFF_MS_MIN = 1000;
const STREAM_BACKOFF_MS_MAX = 30000;

/** @type {ReturnType<typeof setInterval> | null} */
let anytypeNoticeCountdownTimer = null;

let loadToken = 0;
let showSpinnerTimer = null;

/** @typedef {{ senderLabel: string | null, text: string, createdAt?: number | null, isMine?: boolean, sendStatus?: import("./message-send-status.js").SendStatus }} ChatPreviewParts */

const ONE_TO_ONE_SPACE_OBJECT = "anytype.onetoone";
const DEFAULT_CHAT_AVATAR_EMOJI = "💬";

function resolveChatAvatarEmoji(chat) {
  const emoji = chat?.iconEmoji?.trim();
  return emoji || DEFAULT_CHAT_AVATAR_EMOJI;
}

function createChatAvatar(chat) {
  const emoji = resolveChatAvatarEmoji(chat);
  const avatarDiv = document.createElement("div");
  avatarDiv.className = "avatar";
  avatarDiv.textContent = emoji;
  avatarDiv.setAttribute("role", "img");
  avatarDiv.setAttribute("aria-label", `Chat icon: ${emoji}`);
  return avatarDiv;
}

/** Latest message preview per chat, keyed by spaceId + chatId. */
const chatMessagePreviews = new Map();

function chatMessagePreviewKey(spaceId, chatId) {
  return JSON.stringify([spaceId, chatId]);
}

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
 * @property {boolean} initialLoadError
 */

/**
 * @typedef {object} ChatMessageStreamSubscription
 * @property {string} spaceId
 * @property {string} chatId
 * @property {number} token
 * @property {EventSource | null} eventSource
 * @property {ReturnType<typeof setTimeout> | null} reconnectTimer
 * @property {number} backoffMs
 */

/** @type {ChatMessageStreamSubscription | null} */
let messageStream = null;

let historySpinnerShowTimer = null;
let historySpinnerHideTimer = null;
let historySpinnerShownAt = null;

function clearHistorySpinnerTimers() {
  if (historySpinnerShowTimer !== null) {
    clearTimeout(historySpinnerShowTimer);
    historySpinnerShowTimer = null;
  }
  if (historySpinnerHideTimer !== null) {
    clearTimeout(historySpinnerHideTimer);
    historySpinnerHideTimer = null;
  }
}

function resetChatHistoryState() {
  stopChatMessageStream();
  clearHistorySpinnerTimers();
  historySpinnerShownAt = null;
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
  stopChatMessageStream();
  clearHistorySpinnerTimers();
  historySpinnerShownAt = null;
  resetChatHistoryStatus();
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
    initialLoadError: false,
  };
  return chatHistoryState;
}

/**
 * Tear down the active-chat EventSource and any pending reconnect.
 */
function stopChatMessageStream() {
  const sub = messageStream;
  messageStream = null;
  if (!sub) {
    hideAnytypeConnectionNotice();
    return;
  }

  if (sub.reconnectTimer !== null) {
    clearTimeout(sub.reconnectTimer);
    sub.reconnectTimer = null;
  }

  if (sub.eventSource) {
    sub.eventSource.onmessage = null;
    sub.eventSource.onerror = null;
    sub.eventSource.onopen = null;
    sub.eventSource.close();
    sub.eventSource = null;
  }

  hideAnytypeConnectionNotice();
}

/**
 * @param {string} spaceId
 * @param {string} chatId
 * @param {number} token
 */
function startChatMessageStream(spaceId, chatId, token) {
  stopChatMessageStream();
  messageStream = {
    spaceId,
    chatId,
    token,
    eventSource: null,
    reconnectTimer: null,
    backoffMs: STREAM_BACKOFF_MS_MIN,
  };
  openChatMessageStreamConnection();
}

/**
 * @param {ChatMessageStreamSubscription} sub
 * @returns {boolean}
 */
function isChatMessageStreamCurrent(sub) {
  return (
    messageStream === sub
    && chatHistoryState !== null
    && chatHistoryState.spaceId === sub.spaceId
    && chatHistoryState.chatId === sub.chatId
    && chatHistoryState.token === sub.token
  );
}

function openChatMessageStreamConnection() {
  const sub = messageStream;
  if (!sub || !isChatMessageStreamCurrent(sub)) {
    return;
  }

  if (sub.eventSource) {
    sub.eventSource.onmessage = null;
    sub.eventSource.onerror = null;
    sub.eventSource.onopen = null;
    sub.eventSource.close();
    sub.eventSource = null;
  }

  const url = chatMessagesStreamUrl(sub.spaceId, sub.chatId, MESSAGE_PAGE_SIZE);
  const eventSource = new EventSource(url);
  sub.eventSource = eventSource;

  eventSource.onopen = () => {
    if (!isChatMessageStreamCurrent(sub)) {
      return;
    }
    hideAnytypeConnectionNotice();
  };

  eventSource.onmessage = (event) => {
    if (!isChatMessageStreamCurrent(sub)) {
      stopChatMessageStream();
      return;
    }
    handleChatMessageStreamPayload(sub, event.data);
  };

  eventSource.onerror = () => {
    // Close so the browser does not auto-reconnect on a tight loop; we back off.
    eventSource.onmessage = null;
    eventSource.onerror = null;
    eventSource.onopen = null;
    eventSource.close();
    if (sub.eventSource === eventSource) {
      sub.eventSource = null;
    }

    if (!isChatMessageStreamCurrent(sub)) {
      stopChatMessageStream();
      return;
    }

    scheduleChatMessageStreamReconnect(sub);
  };
}

/**
 * @param {ChatMessageStreamSubscription} sub
 */
function scheduleChatMessageStreamReconnect(sub) {
  if (sub.reconnectTimer !== null) {
    clearTimeout(sub.reconnectTimer);
  }

  const delayMs = sub.backoffMs;
  sub.backoffMs = Math.min(sub.backoffMs * 2, STREAM_BACKOFF_MS_MAX);

  if (isAnytypeConnectionNoticeVisible()) {
    startAnytypeReconnectCountdown(delayMs);
  }

  sub.reconnectTimer = setTimeout(() => {
    sub.reconnectTimer = null;
    if (!isChatMessageStreamCurrent(sub)) {
      stopChatMessageStream();
      return;
    }
    if (isAnytypeConnectionNoticeVisible()) {
      setAnytypeReconnectRetryText("Trying again…");
    }
    openChatMessageStreamConnection();
  }, delayMs);
}

/**
 * Parse one SSE `data:` payload and merge `message_added` into the open chat.
 * @param {ChatMessageStreamSubscription} sub
 * @param {string} raw
 */
function handleChatMessageStreamPayload(sub, raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    console.error("Invalid chat message stream payload:", error);
    return;
  }

  if (!isChatMessageStreamCurrent(sub)) {
    return;
  }

  if (parsed?.type === "anytype_unavailable") {
    showAnytypeConnectionNotice();
    return;
  }

  // Any other valid event means the stream is healthy — reset reconnect backoff.
  sub.backoffMs = STREAM_BACKOFF_MS_MIN;
  hideAnytypeConnectionNotice();

  if (parsed?.type !== "message_added") {
    return;
  }

  const message = parsed.message;
  if (!message || typeof message !== "object") {
    return;
  }

  const state = chatHistoryState;
  if (!state || !isChatMessageStreamCurrent(sub)) {
    return;
  }

  const result = mergeIncomingMessageIntoState(state, message);
  applyMergeResultToDom(state, result, { scrollMode: "ifAtLatest" });
  if (result.kind === "insert") {
    maybeResolveIncomingAuthor(sub, state, message);
  }
}

function showAnytypeConnectionNotice() {
  const notice = document.getElementById("anytype-connection-notice");
  if (notice) {
    notice.hidden = false;
  }
}

function hideAnytypeConnectionNotice() {
  clearAnytypeReconnectCountdown();
  const notice = document.getElementById("anytype-connection-notice");
  if (notice) {
    notice.hidden = true;
  }
  const retry = document.getElementById("anytype-connection-notice-retry");
  if (retry) {
    retry.hidden = true;
  }
}

function isAnytypeConnectionNoticeVisible() {
  const notice = document.getElementById("anytype-connection-notice");
  return Boolean(notice && !notice.hidden);
}

function clearAnytypeReconnectCountdown() {
  if (anytypeNoticeCountdownTimer !== null) {
    clearInterval(anytypeNoticeCountdownTimer);
    anytypeNoticeCountdownTimer = null;
  }
}

/**
 * @param {string} text
 */
function setAnytypeReconnectRetryText(text) {
  const retry = document.getElementById("anytype-connection-notice-retry");
  const textEl = document.getElementById("anytype-connection-notice-retry-text");
  if (!retry || !textEl) {
    return;
  }
  retry.hidden = false;
  textEl.textContent = text;
}

/**
 * @param {number} delayMs
 */
function startAnytypeReconnectCountdown(delayMs) {
  clearAnytypeReconnectCountdown();

  let secondsLeft = Math.max(1, Math.ceil(delayMs / 1000));
  setAnytypeReconnectRetryText(
    `AnyChat will try again in ${secondsLeft} second${secondsLeft === 1 ? "" : "s"}.`
  );

  anytypeNoticeCountdownTimer = setInterval(() => {
    secondsLeft -= 1;
    if (secondsLeft <= 0) {
      clearAnytypeReconnectCountdown();
      setAnytypeReconnectRetryText("Trying again…");
      return;
    }
    setAnytypeReconnectRetryText(
      `AnyChat will try again in ${secondsLeft} second${secondsLeft === 1 ? "" : "s"}.`
    );
  }, 1000);
}

/**
 * Best-effort author profile fetch for a newly streamed message (non-blocking).
 * @param {ChatMessageStreamSubscription} sub
 * @param {ChatHistoryState} state
 * @param {object} message
 */
function maybeResolveIncomingAuthor(sub, state, message) {
  if (message?.isMine === true) {
    return;
  }

  const creator = message?.creator;
  if (typeof creator !== "string" || creator.length === 0) {
    return;
  }

  const selectedSpaceInput = document.querySelector(
    'input[name="space"]:checked'
  );
  if (
    !selectedSpaceInput
    || selectedSpaceInput.value !== state.spaceId
    || !isRegularSpaceObject(selectedSpaceInput.dataset.spaceObject ?? "")
  ) {
    return;
  }

  if (getSpaceMember(state.spaceId, creator)) {
    return;
  }

  void ensureMembersForParticipantIds(state.spaceId, [creator])
    .then(() => {
      if (!isChatMessageStreamCurrent(sub) || chatHistoryState !== state) {
        return;
      }
      if (!getSpaceMember(state.spaceId, creator)) {
        return;
      }
      rerenderOpenChatMessagesPreservingViewport(state.messages);
    })
    .catch((error) => {
      console.error(
        `Could not resolve author profile for streamed message in chat ${state.chatId}:`,
        error
      );
    });
}

/**
 * Lexicographic Anytype orderId compare. Missing orderId sorts after known ids
 * (optimistic tip rows stay at the end until confirmed).
 * @param {unknown} a
 * @param {unknown} b
 * @returns {number}
 */
function compareOrderId(a, b) {
  const aOk = typeof a === "string" && a.length > 0;
  const bOk = typeof b === "string" && b.length > 0;
  if (!aOk && !bOk) {
    return 0;
  }
  if (!aOk) {
    return 1;
  }
  if (!bOk) {
    return -1;
  }
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
}

/**
 * @param {object[]} messages
 * @param {object} message
 * @returns {number}
 */
function findMessageInsertIndex(messages, message) {
  for (let index = 0; index < messages.length; index += 1) {
    if (compareOrderId(messages[index]?.orderId, message?.orderId) > 0) {
      return index;
    }
  }
  return messages.length;
}

/**
 * @param {ChatHistoryState} state
 * @param {object} incoming
 * @returns {number} index of matching optimistic row, or -1
 */
function findMatchingOptimisticIndex(state, incoming) {
  const incomingText = incoming?.content?.text;
  if (typeof incomingText !== "string") {
    return -1;
  }

  return state.messages.findIndex(
    (entry) =>
      typeof entry?.clientTempId === "string"
      && entry.clientTempId.length > 0
      && (typeof entry.id !== "string" || entry.id.length === 0)
      && entry.isMine === true
      && incoming?.isMine === true
      && entry?.content?.text === incomingText
  );
}

/**
 * Patch server fields onto a local message row (confirm / hydrate).
 * @param {object} target
 * @param {object} incoming
 */
function hydrateMessageFromServer(target, incoming) {
  if (typeof incoming.id === "string" && incoming.id.length > 0) {
    target.id = incoming.id;
  }
  if (typeof incoming.orderId === "string" && incoming.orderId.length > 0) {
    target.orderId = incoming.orderId;
  }
  if (typeof incoming.createdAt === "number") {
    target.createdAt = incoming.createdAt;
  }
  if (incoming.content && typeof incoming.content === "object") {
    target.content = {
      ...target.content,
      ...incoming.content,
    };
  }
  if (typeof incoming.creator === "string") {
    target.creator = incoming.creator;
  }
  if (typeof incoming.creatorName === "string") {
    target.creatorName = incoming.creatorName;
  }
  if (typeof incoming.isMine === "boolean") {
    target.isMine = incoming.isMine;
  }
  if (
    target.clientSendStatus === "sending"
    || target.clientSendStatus === "sent"
  ) {
    target.clientSendStatus = "sent";
  }
}

/**
 * Merge one server message into open-chat state by id + orderId.
 * @param {ChatHistoryState} state
 * @param {object} incoming
 * @returns {{
 *   kind: "noop" | "confirm" | "insert",
 *   message?: object,
 *   index?: number,
 *   reordered?: boolean,
 * }}
 */
function mergeIncomingMessageIntoState(state, incoming) {
  const id = incoming?.id;
  if (typeof id !== "string" || id.length === 0) {
    return { kind: "noop" };
  }

  const oldest = state.oldestOrderId;
  const incomingOrderId = incoming?.orderId;
  if (
    typeof oldest === "string"
    && oldest.length > 0
    && typeof incomingOrderId === "string"
    && incomingOrderId.length > 0
    && compareOrderId(incomingOrderId, oldest) < 0
    && !state.messageIds.has(id)
  ) {
    // Older than the loaded window; history pagination covers it.
    return { kind: "noop" };
  }

  const existingIndex = state.messages.findIndex((entry) => entry?.id === id);
  if (existingIndex >= 0) {
    const existing = state.messages[existingIndex];
    hydrateMessageFromServer(existing, incoming);
    state.messageIds.add(id);

    state.messages.splice(existingIndex, 1);
    const newIndex = findMessageInsertIndex(state.messages, existing);
    state.messages.splice(newIndex, 0, existing);

    return {
      kind: "confirm",
      message: existing,
      index: newIndex,
      reordered: newIndex !== existingIndex,
    };
  }

  const optimisticIndex = findMatchingOptimisticIndex(state, incoming);
  if (optimisticIndex >= 0) {
    const optimistic = state.messages[optimisticIndex];
    hydrateMessageFromServer(optimistic, incoming);
    state.messageIds.add(id);

    state.messages.splice(optimisticIndex, 1);
    const newIndex = findMessageInsertIndex(state.messages, optimistic);
    state.messages.splice(newIndex, 0, optimistic);

    return {
      kind: "confirm",
      message: optimistic,
      index: newIndex,
      reordered: newIndex !== optimisticIndex,
    };
  }

  const inserted = { ...incoming };
  const index = findMessageInsertIndex(state.messages, inserted);
  state.messages.splice(index, 0, inserted);
  state.messageIds.add(id);

  return {
    kind: "insert",
    message: inserted,
    index,
    reordered: false,
  };
}

/**
 * Apply merge result to the message list DOM.
 * @param {ChatHistoryState} state
 * @param {{
 *   kind: "noop" | "confirm" | "insert",
 *   message?: object,
 *   index?: number,
 *   reordered?: boolean,
 * }} result
 * @param {{ scrollMode?: "always" | "ifAtLatest" }} [options]
 * @returns {number} newly inserted visible row count
 */
function applyMergeResultToDom(state, result, options = {}) {
  const scrollMode = options.scrollMode ?? "ifAtLatest";

  if (result.kind === "noop" || !result.message) {
    return 0;
  }

  if (result.kind === "confirm") {
    if (result.reordered) {
      rerenderOpenChatMessagesPreservingViewport(state.messages);
    } else {
      const status = resolveOutgoingSendStatus(result.message);
      if (status) {
        updateMessageRowSendStatus({
          clientTempId: result.message.clientTempId,
          messageId: result.message.id,
          status,
        });
      }
    }
    return 0;
  }

  // insert
  const atTip = result.index === state.messages.length - 1;
  if (atTip) {
    return appendNewerChatMessages([result.message], { scrollMode });
  }

  rerenderOpenChatMessagesPreservingViewport(state.messages);
  return 1;
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
  state.initialLoadError = false;
  clearInitialLoadError();
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
 * Inserts by orderId (not append-only) so concurrent external messages stay sorted.
 * @param {ChatHistoryState} state
 * @param {unknown} latestMessages
 * @returns {number} newly inserted row count
 */
function applyLatestPageAfterSend(state, latestMessages) {
  const page = Array.isArray(latestMessages) ? latestMessages : [];
  if (page.length === 0) {
    return 0;
  }

  let insertedCount = 0;
  let needsRerender = false;
  /** @type {object[]} */
  const tipInsertBatch = [];

  for (const message of page) {
    if (typeof message?.id !== "string" || message.id.length === 0) {
      continue;
    }

    const result = mergeIncomingMessageIntoState(state, message);
    if (result.kind === "insert" && result.message) {
      insertedCount += 1;
      if (result.index === state.messages.length - 1) {
        tipInsertBatch.push(result.message);
      } else {
        needsRerender = true;
      }
    } else if (result.kind === "confirm" && result.reordered) {
      needsRerender = true;
    } else if (result.kind === "confirm" && result.message) {
      const status = resolveOutgoingSendStatus(result.message);
      if (status) {
        updateMessageRowSendStatus({
          clientTempId: result.message.clientTempId,
          messageId: result.message.id,
          status,
        });
      }
    }
  }

  if (needsRerender || tipInsertBatch.length !== insertedCount) {
    rerenderOpenChatMessagesPreservingViewport(state.messages);
    return insertedCount;
  }

  if (tipInsertBatch.length === 0) {
    return 0;
  }

  return appendNewerChatMessages(tipInsertBatch, { scrollMode: "always" });
}

/**
 * @param {string} spaceId
 * @param {string} chatId
 * @param {object} message
 * @returns {boolean}
 */
export function pushOptimisticMessage(spaceId, chatId, message) {
  const state = chatHistoryState;
  if (
    !state
    || state.spaceId !== spaceId
    || state.chatId !== chatId
  ) {
    return false;
  }

  state.messages = [...state.messages, message];
  return appendNewerChatMessages([message]) > 0;
}

/**
 * @param {string} spaceId
 * @param {string} chatId
 * @param {string} clientTempId
 * @param {string} messageId
 * @returns {boolean}
 */
export function markOptimisticMessageSent(spaceId, chatId, clientTempId, messageId) {
  const state = chatHistoryState;
  if (
    !state
    || state.spaceId !== spaceId
    || state.chatId !== chatId
  ) {
    return false;
  }

  const message = state.messages.find(
    (entry) => entry?.clientTempId === clientTempId
  );
  if (!message) {
    return false;
  }

  message.id = messageId;
  message.clientSendStatus = "sent";
  state.messageIds.add(messageId);
  return true;
}

/**
 * @param {string} spaceId
 * @param {string} chatId
 * @param {string} clientTempId
 * @returns {boolean}
 */
export function markOptimisticMessageFailed(spaceId, chatId, clientTempId) {
  const state = chatHistoryState;
  if (
    !state
    || state.spaceId !== spaceId
    || state.chatId !== chatId
  ) {
    return false;
  }

  const message = state.messages.find(
    (entry) => entry?.clientTempId === clientTempId
  );
  if (!message) {
    return false;
  }

  message.clientSendStatus = "failed";
  return true;
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
    clearHistorySpinnerTimers();
    historySpinnerShownAt = null;
    resetChatHistoryStatus();
    return;
  }

  if (state.isLoadingOlder) {
    showHistorySpinnerAfterDelay(state);
    return;
  }

  settleHistoryStatus(state);
}

function showHistorySpinnerAfterDelay(state) {
  if (historySpinnerHideTimer !== null) {
    clearTimeout(historySpinnerHideTimer);
    historySpinnerHideTimer = null;
  }

  if (historySpinnerShownAt !== null || historySpinnerShowTimer !== null) {
    return;
  }

  setChatHistoryStatus("hidden");
  historySpinnerShowTimer = setTimeout(() => {
    historySpinnerShowTimer = null;
    if (chatHistoryState !== state || !state.isLoadingOlder) {
      return;
    }

    setChatHistoryStatus("loading");
    historySpinnerShownAt = performance.now();
  }, HISTORY_SPINNER_SHOW_DELAY_MS);
}

/**
 * @returns {'hidden' | 'error' | 'end'}
 */
function settledHistoryMode(state) {
  if (state.olderLoadError) {
    return "error";
  }

  if (!state.mayHaveMore && state.messages.length > 0) {
    return "end";
  }

  return "hidden";
}

function settleHistoryStatus(state) {
  if (historySpinnerShowTimer !== null) {
    clearTimeout(historySpinnerShowTimer);
    historySpinnerShowTimer = null;
  }

  const applyStatus = () => {
    historySpinnerHideTimer = null;
    if (chatHistoryState !== state || state.isLoadingOlder) {
      return;
    }

    historySpinnerShownAt = null;
    setChatHistoryStatus(settledHistoryMode(state));
  };

  if (historySpinnerShownAt === null) {
    applyStatus();
    return;
  }

  const elapsed = performance.now() - historySpinnerShownAt;
  const remaining = HISTORY_SPINNER_MIN_VISIBLE_MS - elapsed;
  if (remaining <= 0) {
    applyStatus();
    return;
  }

  if (historySpinnerHideTimer !== null) {
    clearTimeout(historySpinnerHideTimer);
  }
  historySpinnerHideTimer = setTimeout(applyStatus, remaining);
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

    const selectedSpaceInput = document.querySelector(
      'input[name="space"]:checked'
    );
    if (
      selectedSpaceInput
      && isRegularSpaceObject(selectedSpaceInput.dataset.spaceObject ?? "")
      && Array.isArray(olderMessages)
    ) {
      try {
        await ensureMembersForParticipantIds(
          spaceId,
          olderMessages.map((message) => message?.creator)
        );
      } catch (error) {
        console.error(
          `Could not resolve author profiles for older messages in chat ${chatId}:`,
          error
        );
      }
      if (!isOpenChatMessagesCurrent(token) || chatHistoryState !== state) {
        return;
      }
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
  const spaceName = selected?.dataset.spaceName?.trim() || "Untitled space";

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
  hideChatsScrollToTopButton();
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
  // Member profiles are cached per space; drop all so a prior space cannot
  // leak authors/avatars into the newly selected space.
  clearSpaceMembersCache();
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
 * @returns {{
 *   li: HTMLLIElement,
 *   previewEl: HTMLParagraphElement,
 *   timestampEl: HTMLSpanElement,
 *   chatId: string,
 * }}
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

  chatButton.appendChild(createChatAvatar(chat));

  const divTextBlock = document.createElement("div");
  divTextBlock.className = "text-block";

  const chatHeaderDiv = document.createElement("div");
  chatHeaderDiv.className = "chat-header";

  const chatNameP = document.createElement("p");
  chatNameP.className = "chat-name";
  chatNameP.textContent = chatName;
  chatHeaderDiv.appendChild(chatNameP);

  const headerMetaEl = document.createElement("div");
  headerMetaEl.className = "chat-header-meta";

  const headerStatusEl = document.createElement("div");
  headerStatusEl.className = "chat-header-status";
  headerMetaEl.appendChild(headerStatusEl);

  const timestampEl = document.createElement("span");
  timestampEl.className = "chat-timestamp";
  headerMetaEl.appendChild(timestampEl);

  chatHeaderDiv.appendChild(headerMetaEl);

  divTextBlock.appendChild(chatHeaderDiv);

  const previewEl = document.createElement("p");
  previewEl.className = "chat-preview";
  previewEl.textContent = "";
  divTextBlock.appendChild(previewEl);

  chatButton.appendChild(divTextBlock);
  li.appendChild(chatButton);

  return { li, previewEl, timestampEl, chatId };
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
  const spaceObject = selectedSpaceInput.dataset.spaceObject ?? "";
  const gatewayUrl = selectedSpaceInput.dataset.gatewayUrl ?? "";
  const profilesEnabled = isRegularSpaceObject(spaceObject);

  if (profilesEnabled) {
    setMessageProfilesContext({
      spaceId,
      gatewayUrl,
      enabled: true,
    });
  } else {
    clearMessageProfilesContext();
  }

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

    if (profilesEnabled && Array.isArray(messages)) {
      try {
        await ensureMembersForParticipantIds(
          spaceId,
          messages.map((message) => message?.creator)
        );
      } catch (error) {
        // Profiles are best-effort; messages must still render with name/initials.
        console.error(
          `Could not resolve author profiles for chat ${chatId}:`,
          error
        );
      }
      if (!isOpenChatMessagesCurrent(token)) {
        return;
      }
    }

    if (!await finishOpenChatMessagesLoad(token)) {
      return;
    }
    if (chatHistoryState?.token === token) {
      applyInitialPage(chatHistoryState, messages);
      renderOpenChatMessages(chatHistoryState.messages);
      updateHistoryStatus(chatHistoryState);
      startChatMessageStream(spaceId, chatId, token);
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
    if (!await finishOpenChatMessagesLoad(token)) {
      return;
    }
    if (chatHistoryState?.token === token) {
      chatHistoryState.initialLoadError = true;
      chatHistoryState.messages = [];
      chatHistoryState.messageIds = new Set();
      chatHistoryState.oldestOrderId = null;
      chatHistoryState.mayHaveMore = false;
      chatHistoryState.isLoadingOlder = false;
      chatHistoryState.olderLoadError = false;
    }
    renderOpenChatMessagesError("Could not load messages.");
  }
}

setOnChatPanelHidden(resetChatHistoryState);

setOnListDraftIndicatorChanged((spaceId, chatId) => {
  updateChatListPreview(spaceId, chatId);
});

setOnOutgoingPreviewChanged((target, parts) => {
  const key = chatMessagePreviewKey(target.spaceId, target.chatId);
  const cached = chatMessagePreviews.get(key);
  const createdAt =
    typeof parts.createdAt === "number"
      ? parts.createdAt
      : (cached?.createdAt ?? null);

  updateChatListPreview(target.spaceId, target.chatId, {
    senderLabel: null,
    text: parts.text,
    createdAt,
    isMine: parts.isMine,
    sendStatus: parts.sendStatus,
  });
});

initChatMessagesScroll(onChatMessagesScroll);
initChatHistoryRetry(() => {
  void loadOlderMessages({ retry: true });
});

initInitialLoadRetry(() => {
  const chatId = chatHistoryState?.chatId;
  if (!chatId) {
    return;
  }

  void openChatMessages(chatId);
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

initChatComposer(
  postChatMessage,
  pushOptimisticMessage,
  markOptimisticMessageSent,
  markOptimisticMessageFailed
);

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
    hideChatsScrollToTopButton();
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

  chatsList.scrollTop = 0;
  syncChatsScrollToTopButton();
  return rows;
}

function isStillCurrentSpace(spaceId, token) {
  if (token !== loadToken) {
    return false;
  }

  const stillSelected = document.querySelector('input[name="space"]:checked');
  
  return Boolean(stillSelected && stillSelected.value === spaceId);
}

function isOneToOneSpace() {
  const selected = document.querySelector('input[name="space"]:checked');
  return selected?.dataset.spaceObject === ONE_TO_ONE_SPACE_OBJECT;
}

async function loadChatPreviews(spaceId, rows, token) {
  const isOneToOne = isOneToOneSpace();

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
      renderChatPreview(
        row.previewEl,
        spaceId,
        row.chatId,
        latestMessage
          ? formatMessagePreview(latestMessage, { isOneToOne })
          : null,
        row.timestampEl
      );
    } catch (error) {
      console.error(`Could not load latest message for chat ${row.chatId}:`, error);
      renderChatPreview(row.previewEl, spaceId, row.chatId, null, row.timestampEl);
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

/**
 * @param {object} message
 * @param {{ isOneToOne: boolean }} options
 * @returns {ChatPreviewParts | null}
 */
function formatMessagePreview(message, { isOneToOne }) {
  const text = message.content?.text?.trim() ?? "";

  if (!text) {
    return null;
  }

  let senderLabel = null;
  if (!isOneToOne && message.isMine !== true) {
    const creatorName = message.creatorName?.trim();
    if (creatorName) {
      senderLabel = creatorName;
    }
  }

  const createdAt =
    typeof message.createdAt === "number" ? message.createdAt : null;

  const sendStatus = resolveOutgoingSendStatus(message);
  if (sendStatus) {
    return { senderLabel, text, createdAt, isMine: true, sendStatus };
  }

  return { senderLabel, text, createdAt };
}

function showDraftChatPreview(previewEl, draftText) {
  previewEl.className = "chat-preview chat-preview--draft";
  previewEl.replaceChildren();

  const label = document.createElement("span");
  label.className = "chat-preview-draft-label";
  label.textContent = "Draft: ";

  const text = document.createElement("span");
  text.className = "chat-preview-draft-text";
  text.textContent = draftText;

  previewEl.append(label, text);
}

/**
 * @param {string} chatId
 * @param {ChatPreviewParts | null | undefined} parts
 */
function updateChatHeaderStatus(chatId, parts) {
  const statusEl = document.querySelector(
    `#chats-list li[data-chat-id="${CSS.escape(chatId)}"] .chat-header-status`
  );
  if (!(statusEl instanceof HTMLElement)) {
    return;
  }

  if (parts?.isMine && parts.sendStatus) {
    statusEl.replaceChildren(createSendStatusElement(parts.sendStatus));
    return;
  }

  statusEl.replaceChildren();
}

/**
 * @param {HTMLElement | null | undefined} timestampEl
 * @param {number | null | undefined} createdAt
 */
function renderChatTimestamp(timestampEl, createdAt) {
  if (!(timestampEl instanceof HTMLElement)) {
    return;
  }

  timestampEl.textContent = formatChatListTimestamp(createdAt) ?? "";
}

/**
 * @param {string} chatId
 * @returns {HTMLElement | null}
 */
function getChatTimestampEl(chatId) {
  const timestampEl = document.querySelector(
    `#chats-list li[data-chat-id="${CSS.escape(chatId)}"] .chat-timestamp`
  );
  return timestampEl instanceof HTMLElement ? timestampEl : null;
}

/**
 * @param {HTMLParagraphElement} previewEl
 * @param {ChatPreviewParts | null} parts
 */
function showMessageChatPreview(previewEl, parts) {
  previewEl.className = "chat-preview";
  previewEl.replaceChildren();

  if (!parts?.text) {
    return;
  }

  if (parts.senderLabel) {
    const group = document.createElement("span");
    group.className = "chat-preview-sender-group";

    const sender = document.createElement("span");
    sender.className = "chat-preview-sender";
    sender.textContent = parts.senderLabel;

    const colon = document.createElement("span");
    colon.className = "chat-preview-colon";
    colon.textContent = ": ";

    group.append(sender, colon);
    previewEl.appendChild(group);
  }

  const text = document.createElement("span");
  text.className = "chat-preview-text";
  text.textContent = parts.text;
  previewEl.appendChild(text);
}

/**
 * @param {HTMLParagraphElement} previewEl
 * @param {string} spaceId
 * @param {string} chatId
 * @param {ChatPreviewParts | null | undefined} messagePreviewParts When provided, updates the cache.
 * @param {HTMLElement | null | undefined} [timestampEl]
 */
function renderChatPreview(
  previewEl,
  spaceId,
  chatId,
  messagePreviewParts,
  timestampEl
) {
  const key = chatMessagePreviewKey(spaceId, chatId);
  if (messagePreviewParts !== undefined) {
    chatMessagePreviews.set(key, messagePreviewParts);
  }

  const stampEl =
    timestampEl instanceof HTMLElement
      ? timestampEl
      : getChatTimestampEl(chatId);
  const parts = chatMessagePreviews.get(key) ?? null;

  if (hasListDraftIndicator(spaceId, chatId)) {
    updateChatHeaderStatus(chatId, null);
    showDraftChatPreview(
      previewEl,
      getComposerDraft({ spaceId, chatId })
    );
    renderChatTimestamp(stampEl, parts?.createdAt);
    return;
  }

  updateChatHeaderStatus(chatId, parts);
  showMessageChatPreview(previewEl, parts);
  renderChatTimestamp(stampEl, parts?.createdAt);
}

function updateChatListPreview(spaceId, chatId, messagePreviewParts) {
  const previewEl = document.querySelector(
    `#chats-list li[data-chat-id="${CSS.escape(chatId)}"] .chat-preview`
  );
  if (!(previewEl instanceof HTMLParagraphElement)) {
    return;
  }

  renderChatPreview(
    previewEl,
    spaceId,
    chatId,
    messagePreviewParts,
    getChatTimestampEl(chatId)
  );
}

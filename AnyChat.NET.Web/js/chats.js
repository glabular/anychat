import {
  chatMessagesStreamUrl,
  fetchChats,
  postChatMessage,
  spacesUrl,
} from "./api.js";
import {
  noteAnytypeReachable,
  noteAnytypeUnavailableFromResponse,
  showAnytypeConnectionNotice,
} from "./anytype-connection-notice.js";
import { initChatMessagesScroll, scrollChatToMessage, setOnChatScrolledToLatest } from "./chat-messages-scroll.js";
import {
  peekChatScroll,
  rememberChatScroll,
  takeChatScroll,
} from "./chat-scroll-memory.js";
import { formatChatListTimestamp } from "./date-format.js";
import { createSendStatusElement, resolveOutgoingSendStatus } from "./message-send-status.js";
import {
  hideChatsScrollToTopButton,
  syncChatsScrollToTopButton,
} from "./chats-scroll-to-top.js";
import { setChatsCreateButtonReady } from "./chats-create-button.js";
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
  closeOpenChat,
  getOpenChat,
  rememberOpenChatScrollAtLatest,
  renderOpenChatMessages,
  renderOpenChatMessagesError,
  rerenderOpenChatMessagesPreservingViewport,
  scheduleRememberOpenChatScrollPosition,
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
  setRemountOpenChatOnIdentityLearned,
  showChatHeader,
  hasListDraftIndicator,
  getComposerDraft,
} from "./chat-view.js";
import {
  clearSpaceMembersCache,
  ensureMembersForParticipantIds,
  getSpaceMember,
  isRegularSpaceObject,
  isOneToOneSpaceObject,
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

let loadToken = 0;
let showSpinnerTimer = null;

/** @typedef {{ senderLabel: string | null, text: string, createdAt?: number | null, isMine?: boolean, sendStatus?: import("./message-send-status.js").SendStatus }} ChatPreviewParts */

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

/**
 * Empty Anytype titles are allowed; show a stable label in the UI.
 * @param {unknown} name
 * @returns {string}
 */
export function chatDisplayName(name) {
  const trimmed = typeof name === "string" ? name.trim() : "";
  return trimmed || "Untitled";
}

/**
 * Title for chat list rows and the panel header. In a one-to-one space, prefer
 * the selected space's display name (peer label from the API) over chat.name
 * (often "General"). Falls back to {@link chatDisplayName} when not 1:1 or the
 * space label is missing.
 * @param {{ name?: string } | null | undefined} chat
 * @returns {string}
 */
function chatTitleForUi(chat) {
  if (isOneToOneSpace()) {
    const selected = document.querySelector('input[name="space"]:checked');
    const spaceLabel =
      typeof selected?.dataset.spaceName === "string"
        ? selected.dataset.spaceName.trim()
        : "";
    if (spaceLabel) {
      return spaceLabel;
    }
  }
  return chatDisplayName(chat?.name);
}

/** Latest message preview per chat, keyed by spaceId + chatId. */
const chatMessagePreviews = new Map();

/** localStorage: `{ [JSON.stringify([spaceId, chatId])]: unixSeconds }` */
const CHAT_ACTIVITY_SEEDS_STORAGE_KEY = "anychat.chatActivitySeeds";

function chatMessagePreviewKey(spaceId, chatId) {
  return JSON.stringify([spaceId, chatId]);
}

/**
 * @returns {Record<string, number>}
 */
function readPersistedActivitySeeds() {
  try {
    const raw = localStorage.getItem(CHAT_ACTIVITY_SEEDS_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return /** @type {Record<string, number>} */ (parsed);
  } catch {
    return {};
  }
}

/**
 * @param {Record<string, number>} seeds
 */
function writePersistedActivitySeeds(seeds) {
  try {
    localStorage.setItem(CHAT_ACTIVITY_SEEDS_STORAGE_KEY, JSON.stringify(seeds));
  } catch {
    // non-fatal; sort still works for the current session
  }
}

/**
 * @param {string} spaceId
 * @param {string} chatId
 * @param {number} unixSeconds
 */
function persistActivitySeed(spaceId, chatId, unixSeconds) {
  const seeds = readPersistedActivitySeeds();
  seeds[chatMessagePreviewKey(spaceId, chatId)] = unixSeconds;
  writePersistedActivitySeeds(seeds);
}

/**
 * @param {string} spaceId
 * @param {string} chatId
 */
function clearPersistedActivitySeed(spaceId, chatId) {
  const seeds = readPersistedActivitySeeds();
  const key = chatMessagePreviewKey(spaceId, chatId);
  if (!(key in seeds)) {
    return;
  }
  delete seeds[key];
  writePersistedActivitySeeds(seeds);
}

/**
 * Drop in-memory preview and localStorage activity seed for a chat (e.g. after delete).
 * @param {string} spaceId
 * @param {string} chatId
 */
export function clearChatActivitySeed(spaceId, chatId) {
  if (!spaceId || !chatId) {
    return;
  }
  chatMessagePreviews.delete(chatMessagePreviewKey(spaceId, chatId));
  clearPersistedActivitySeed(spaceId, chatId);
}

/** Drop chat preview/activity state after logout (memory + localStorage). */
export function clearAccountChatState() {
  chatMessagePreviews.clear();
  try {
    localStorage.removeItem(CHAT_ACTIVITY_SEEDS_STORAGE_KEY);
  } catch {
    // non-fatal
  }
}

/**
 * Apply stored create-activity seeds into memory for this space; drop orphans.
 * @param {string} spaceId
 * @param {string[]} chatIds
 */
function hydratePersistedActivitySeeds(spaceId, chatIds) {
  const idSet = new Set(chatIds.filter(Boolean));
  const seeds = readPersistedActivitySeeds();
  let changed = false;

  for (const [key, value] of Object.entries(seeds)) {
    let parsed;
    try {
      parsed = JSON.parse(key);
    } catch {
      delete seeds[key];
      changed = true;
      continue;
    }

    if (!Array.isArray(parsed) || parsed.length < 2 || parsed[0] !== spaceId) {
      continue;
    }

    const chatId = parsed[1];
    if (typeof chatId !== "string" || !idSet.has(chatId)) {
      delete seeds[key];
      changed = true;
      continue;
    }

    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      seedChatActivityCreatedAt(spaceId, chatId, value, { persist: false });
    } else {
      delete seeds[key];
      changed = true;
    }
  }

  if (changed) {
    writePersistedActivitySeeds(seeds);
  }
}

/**
 * Client-only activity seed so a just-created empty chat sorts near the top.
 * Does not post a message. Uses Unix seconds (same units as message `createdAt`).
 * Persists in localStorage so order survives app restart on this device.
 * @param {string} spaceId
 * @param {string} chatId
 * @param {number} [unixSeconds=Math.floor(Date.now() / 1000)]
 * @param {{ persist?: boolean }} [options]
 */
export function seedChatActivityCreatedAt(
  spaceId,
  chatId,
  unixSeconds = Math.floor(Date.now() / 1000),
  options = {}
) {
  if (!spaceId || !chatId || typeof unixSeconds !== "number") {
    return;
  }

  const persist = options.persist !== false;

  const key = chatMessagePreviewKey(spaceId, chatId);
  const existing = chatMessagePreviews.get(key);
  chatMessagePreviews.set(key, {
    senderLabel: null,
    text: typeof existing?.text === "string" ? existing.text : "",
    createdAt: unixSeconds,
    ...(existing?.isMine === true ? { isMine: true } : {}),
    ...(existing?.sendStatus ? { sendStatus: existing.sendStatus } : {}),
  });

  if (persist) {
    persistActivitySeed(spaceId, chatId, unixSeconds);
  }
}

/**
 * Keep a prior activity seed when the latest-message fetch returns empty.
 * @param {string} spaceId
 * @param {string} chatId
 * @returns {ChatPreviewParts | null}
 */
function previewPartsAfterEmptyFetch(spaceId, chatId) {
  const existing = chatMessagePreviews.get(chatMessagePreviewKey(spaceId, chatId));
  if (existing && typeof existing.createdAt === "number") {
    return {
      senderLabel: null,
      text: typeof existing.text === "string" ? existing.text : "",
      createdAt: existing.createdAt,
    };
  }
  return null;
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
  clearReplyJumpUnavailableTip();
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
  clearReplyJumpUnavailableTip();
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
 * The global recovery probe exclusively owns the Anytype notice and countdown.
 */
function stopChatMessageStream() {
  const sub = messageStream;
  messageStream = null;
  if (!sub) {
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

  sub.reconnectTimer = setTimeout(() => {
    sub.reconnectTimer = null;
    if (!isChatMessageStreamCurrent(sub)) {
      stopChatMessageStream();
      return;
    }
    openChatMessageStreamConnection();
  }, delayMs);
}

/**
 * Parse one SSE `data:` payload and apply live message events to the open chat.
 * Handles message_added, message_updated, and message_deleted.
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

  if (
    parsed?.type === "anytype_auth_missing" ||
    parsed?.type === "anytype_auth_invalid"
  ) {
    void import("./api-key-setup-modal.js").then(({ openApiKeySetupModal }) => {
      openApiKeySetupModal({
        reason:
          parsed.type === "anytype_auth_missing" ? "missing" : "invalid",
      });
    });
    return;
  }

  // Any other valid event means the stream is healthy — reset reconnect backoff.
  sub.backoffMs = STREAM_BACKOFF_MS_MIN;
  noteAnytypeReachable();

  const state = chatHistoryState;
  if (!state || !isChatMessageStreamCurrent(sub)) {
    return;
  }

  if (parsed?.type === "message_deleted") {
    applyMessageDeletedFromStream(state, parsed.id);
    return;
  }

  if (
    parsed?.type !== "message_added"
    && parsed?.type !== "message_updated"
  ) {
    return;
  }

  const message = parsed.message;
  if (!message || typeof message !== "object") {
    return;
  }

  const result = mergeIncomingMessageIntoState(state, message);
  applyMergeResultToDom(state, result, {
    scrollMode: "ifAtLatest",
    // Updates change bubble text; confirm-without-reorder only patches send status.
    refreshContent: parsed.type === "message_updated",
  });
  if (result.kind === "insert") {
    maybeResolveIncomingAuthor(sub, state, message);
  }

  if (
    (result.kind === "insert" || result.kind === "confirm")
    && isOpenChatTipMessage(state, message.id)
  ) {
    updateChatListPreview(
      state.spaceId,
      state.chatId,
      formatMessagePreview(message, { isOneToOne: isOneToOneSpace() })
    );
  }
}

/**
 * @param {ChatHistoryState} state
 * @param {string | null | undefined} messageId
 * @returns {boolean}
 */
function isOpenChatTipMessage(state, messageId) {
  if (typeof messageId !== "string" || messageId.length === 0) {
    return false;
  }
  const tip = state.messages[state.messages.length - 1];
  return tip?.id === messageId;
}

/**
 * Remove a message deleted upstream from open-chat state + DOM; refresh list
 * preview when the deleted row was the tip.
 * @param {ChatHistoryState} state
 * @param {unknown} messageId
 */
function applyMessageDeletedFromStream(state, messageId) {
  if (typeof messageId !== "string" || messageId.length === 0) {
    return;
  }

  const wasTip = isOpenChatTipMessage(state, messageId);
  const existingIndex = state.messages.findIndex(
    (entry) => entry?.id === messageId
  );
  if (existingIndex < 0) {
    state.messageIds.delete(messageId);
    return;
  }

  state.messages.splice(existingIndex, 1);
  state.messageIds.delete(messageId);
  rerenderOpenChatMessagesPreservingViewport(state.messages);

  if (!wasTip) {
    return;
  }

  const tip = state.messages[state.messages.length - 1];
  updateChatListPreview(
    state.spaceId,
    state.chatId,
    tip
      ? formatMessagePreview(tip, { isOneToOne: isOneToOneSpace() })
      : { senderLabel: null, text: "", createdAt: null }
  );
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
 * @param {{
 *   scrollMode?: "always" | "ifAtLatest",
 *   refreshContent?: boolean,
 * }} [options]
 * @returns {number} newly inserted visible row count
 */
function applyMergeResultToDom(state, result, options = {}) {
  const scrollMode = options.scrollMode ?? "ifAtLatest";
  const refreshContent = options.refreshContent === true;

  if (result.kind === "noop" || !result.message) {
    return 0;
  }

  if (result.kind === "confirm") {
    if (result.reordered || refreshContent) {
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
 * Merge an older API page into history state without touching the DOM.
 * @param {ChatHistoryState} state
 * @param {unknown} olderMessages
 * @param {number} [pageSize] request limit; a short page means history ended
 * @returns {object[]} newly inserted messages (oldest → newest among new)
 */
function mergeOlderPageIntoState(
  state,
  olderMessages,
  pageSize = MESSAGE_PAGE_SIZE
) {
  const page = Array.isArray(olderMessages) ? olderMessages : [];

  if (page.length < pageSize) {
    state.mayHaveMore = false;
  }

  if (page.length === 0) {
    state.mayHaveMore = false;
    return [];
  }

  const pageOldestOrderId = oldestOrderIdFromPage(page);
  if (pageOldestOrderId) {
    state.oldestOrderId = pageOldestOrderId;
  }

  const newMessages = dedupeOlderMessages(state, page);
  if (newMessages.length === 0) {
    return [];
  }

  state.messages = [...newMessages, ...state.messages];
  for (const message of newMessages) {
    state.messageIds.add(message.id);
  }

  return newMessages;
}

/**
 * @param {ChatHistoryState} state
 * @param {unknown} olderMessages
 * @returns {number} newly inserted row count
 */
function applyOlderPage(state, olderMessages) {
  const newMessages = mergeOlderPageIntoState(state, olderMessages);
  if (newMessages.length === 0) {
    return 0;
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
  scheduleRememberOpenChatScrollPosition();
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

/** Visible when spaces/chats are available and no chat is open; hide on errors. */
export function setMainPlaceholderVisible(visible) {
  const mainPlaceholder = document.getElementById("main-placeholder");
  if (!mainPlaceholder) {
    return;
  }
  // Settings owns the main pane; never flash the chats empty hint over it.
  if (visible && document.body.classList.contains("is-settings")) {
    mainPlaceholder.hidden = true;
    return;
  }
  // Open chat owns the main pane — reconcile/list refresh must not resurface
  // the empty hint above the panel (seen on window focus).
  if (visible && document.querySelector(".main")?.classList.contains("main--chat-open")) {
    mainPlaceholder.hidden = true;
    return;
  }
  mainPlaceholder.hidden = !visible;
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
  if (chatsList) {
    chatsList.replaceChildren();
    chatsList.hidden = false;
  }
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
  setChatsCreateButtonReady(false);
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

export async function loadChatsForSelectedSpace(options = {}) {
  const openChatId =
    typeof options.openChatId === "string" && options.openChatId
      ? options.openChatId
      : null;

  const selectedSpaceInput = document.querySelector(
    'input[name="space"]:checked'
  );

  if (!selectedSpaceInput) {
    console.warn("No space selected.");
    setChatsCreateButtonReady(false);
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
    setChatsCreateButtonReady(false);

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

  // Empty space: nothing to preview/sort — show empty state immediately.
  if (!Array.isArray(chats) || chats.length === 0) {
    hydratePersistedActivitySeeds(spaceId, []);
    if (!endChatsLoad(token)) {
      return;
    }
    populateChatsList(chats ?? []);
    setMainPlaceholderVisible(true);
    setChatsCreateButtonReady(true);
    return;
  }

  // Build rows off-DOM, fetch previews, sort, then paint once — no API-order
  // flash. Keep the delayed spinner (do not force it on) so fast loads skip
  // the dots flicker and may keep the previous list until replace.
  if (showSpinnerTimer !== null) {
    clearTimeout(showSpinnerTimer);
    showSpinnerTimer = null;
  }

  const loadingEl = document.getElementById("chats-loading");
  const spinnerAlreadyVisible = Boolean(loadingEl && !loadingEl.hidden);
  if (!spinnerAlreadyVisible) {
    showSpinnerTimer = setTimeout(() => {
      showSpinnerTimer = null;
      clearChatsContent();
      setSpinnerVisible(true);
    }, SPINNER_SHOW_DELAY_MS);
  }

  document.getElementById("chats-list")?.setAttribute("aria-busy", "true");

  hydratePersistedActivitySeeds(
    spaceId,
    chats.map((chat) => chat.id).filter((id) => typeof id === "string" && id)
  );

  const rows = chats.map((chat) => createChatListItem(chat));
  await loadChatPreviews(spaceId, rows, token);

  if (!isStillCurrentSpace(spaceId, token)) {
    return;
  }

  sortChatRowsByActivity(spaceId, rows);

  if (!endChatsLoad(token)) {
    return;
  }

  paintChatRows(rows);
  setMainPlaceholderVisible(true);
  setChatsCreateButtonReady(true);

  if (openChatId) {
    selectChatInList(openChatId);
  }
}

/**
 * Tear down chats UI when no space is selected (e.g. remote space delete).
 * Bumps loadToken so in-flight full loads / reconciles bail out.
 */
export function clearChatsUiWhenNoSpaceSelected() {
  loadToken += 1;
  resetChatHistoryState();
  hideChatPanel();
  clearChatsContent();

  const chatsEmpty = document.getElementById("chats-empty");
  if (chatsEmpty) {
    chatsEmpty.hidden = true;
    chatsEmpty.replaceChildren();
  }

  setMainPlaceholderVisible(true);
  setChatsCreateButtonReady(false);
}

/**
 * Soft-refresh the chats list for the selected space without resetting the
 * open thread. Removes archived/missing chats, appends new ones, updates
 * titles. No-op while a full load is in progress or settings owns the column.
 * @returns {Promise<void>}
 */
export async function reconcileChatsForSelectedSpace() {
  if (document.body.classList.contains("is-settings")) {
    return;
  }

  const chatsList = document.getElementById("chats-list");
  if (chatsList?.getAttribute("aria-busy") === "true") {
    return;
  }

  const selectedSpaceInput = document.querySelector(
    'input[name="space"]:checked'
  );
  if (!selectedSpaceInput) {
    return;
  }

  const spaceId = selectedSpaceInput.value;
  const tokenAtStart = loadToken;

  let chats;
  try {
    chats = await fetchChats(spaceId);
  } catch (error) {
    console.error(`Could not reconcile chats for space ${spaceId}:`, error);
    void import("./anytype-auth-notice.js").then(({ authKindFromError }) => {
      const authKind = authKindFromError(error);
      if (!authKind) {
        return;
      }
      void import("./api-key-setup-modal.js").then(
        ({ isApiKeySetupModalOpen, openApiKeySetupModal }) => {
          if (!isApiKeySetupModalOpen()) {
            openApiKeySetupModal({ reason: authKind });
          }
        }
      );
    });
    return;
  }

  if (tokenAtStart !== loadToken) {
    return;
  }

  const stillSelected = document.querySelector('input[name="space"]:checked');
  if (!stillSelected || stillSelected.value !== spaceId) {
    return;
  }

  if (chatsList?.getAttribute("aria-busy") === "true") {
    return;
  }

  noteAnytypeReachable();

  const serverChats = Array.isArray(chats) ? chats : [];
  const serverById = new Map();
  for (const chat of serverChats) {
    if (typeof chat?.id === "string" && chat.id.length > 0) {
      serverById.set(chat.id, chat);
    }
  }

  const list = document.getElementById("chats-list");
  if (!list) {
    return;
  }

  const open = getOpenChat();
  const openChatId =
    open && open.spaceId === spaceId && typeof open.chatId === "string"
      ? open.chatId
      : null;

  for (const li of [...list.querySelectorAll("li[data-chat-id]")]) {
    const chatId = li.dataset.chatId;
    if (!chatId || serverById.has(chatId)) {
      continue;
    }
    li.remove();
    clearChatActivitySeed(spaceId, chatId);
    if (openChatId && chatId === openChatId) {
      closeOpenChat();
    }
  }

  hydratePersistedActivitySeeds(spaceId, [...serverById.keys()]);

  /** @type {Array<{ li: HTMLLIElement, previewEl: HTMLParagraphElement, timestampEl: HTMLSpanElement, statusEl: HTMLElement, chatId: string }>} */
  const newRows = [];

  for (const chat of serverById.values()) {
    const existing = list.querySelector(
      `li[data-chat-id="${CSS.escape(chat.id)}"]`
    );
    if (existing instanceof HTMLLIElement) {
      const title = chatTitleForUi(chat);
      if (existing.dataset.chatName !== title) {
        existing.dataset.chatName = title;
        const nameEl = existing.querySelector(".chat-name");
        if (nameEl) {
          nameEl.textContent = title;
        }
        if (openChatId && chat.id === openChatId) {
          showChatHeader(title);
        }
      }
      continue;
    }

    newRows.push(createChatListItem(chat));
  }

  if (newRows.length > 0) {
    await loadChatPreviews(spaceId, newRows, tokenAtStart);
    if (tokenAtStart !== loadToken) {
      return;
    }
    const still = document.querySelector('input[name="space"]:checked');
    if (!still || still.value !== spaceId) {
      return;
    }

    for (const row of newRows) {
      list.appendChild(row.li);
    }
  }

  const remaining = [...list.querySelectorAll("li[data-chat-id]")];
  const chatsEmpty = document.getElementById("chats-empty");

  if (remaining.length === 0) {
    list.replaceChildren();
    if (chatsEmpty) {
      restoreChatsEmptyContent(chatsEmpty);
      chatsEmpty.hidden = false;
    }
    hideChatsScrollToTopButton();
    setMainPlaceholderVisible(true);
    setChatsCreateButtonReady(true);
    return;
  }

  if (chatsEmpty) {
    chatsEmpty.hidden = true;
  }

  const rowsForSort = remaining.map((li) => ({
    li,
    chatId: li.dataset.chatId ?? "",
  }));
  sortChatRowsByActivity(spaceId, rowsForSort);
  for (const row of rowsForSort) {
    list.appendChild(row.li);
  }
  syncChatsScrollToTopButton();
  // Keep empty hint only when nothing is open; do not flash it over an open chat
  // (focus → reconcile used to force this visible).
  setMainPlaceholderVisible(!getOpenChat());
  setChatsCreateButtonReady(true);
}

/**
 * Programmatically select a chat row (same path as a user click).
 * @param {string} chatId
 * @returns {boolean}
 */
function selectChatInList(chatId) {
  const list = document.getElementById("chats-list");
  if (!list || !chatId) {
    return false;
  }

  for (const li of list.querySelectorAll("li[data-chat-id]")) {
    if (li.dataset.chatId !== chatId) {
      continue;
    }
    const button = li.querySelector(".chat-item");
    if (!(button instanceof HTMLElement)) {
      return false;
    }
    button.click();
    return true;
  }

  console.warn(`Could not select chat ${chatId} after refresh.`);
  return false;
}

/**
 * Builds one chat list row. Preview starts empty; Step 4 fills it from messages.
 * @returns {{
 *   li: HTMLLIElement,
 *   previewEl: HTMLParagraphElement,
 *   timestampEl: HTMLSpanElement,
 *   statusEl: HTMLElement,
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
  const chatName = chatTitleForUi(chat);
  const chatId = chat.id ?? "";
  li.dataset.chatName = chatName;
  chatButton.addEventListener("click", () => {
    if (chatButton.classList.contains("chat-item--selected")) {
      return;
    }

    const previouslySelected = document.querySelector(
      "#chats-list .chat-item--selected"
    );
    previouslySelected?.classList.remove("chat-item--selected");
    chatButton.classList.add("chat-item--selected");
    showChatHeader(li.dataset.chatName || chatName);
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

  return { li, previewEl, timestampEl, statusEl: headerStatusEl, chatId };
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

/**
 * Restore nearby anchors with normal history pages so a shallow reopen does
 * not pull 1,000 messages. Escalate only when the anchor is genuinely deep.
 * The large-page fallback still reaches up to 20k older messages.
 */
const SCROLL_ANCHOR_NORMAL_PAGE_CAP = 5;
const SCROLL_ANCHOR_DEEP_PAGE_SIZE = 1000;
const SCROLL_ANCHOR_DEEP_PAGE_CAP = 20;

/** Reply-quote jump: small older-page budget only (no deep 1000-page seek). */
const REPLY_JUMP_PAGE_CAP = 5;

/** How long the “Can’t open this message” tip stays visible. */
const REPLY_JUMP_TIP_MS = 2000;

/** True while a quote click is seeking/scrolling to a parent message. */
let replyJumpInProgress = false;

/** @type {ReturnType<typeof setTimeout> | null} */
let replyJumpTipHideTimer = null;

/**
 * @param {HTMLElement} container
 * @param {string} messageId
 * @returns {Element | null}
 */
function findMessageRow(container, messageId) {
  return container.querySelector(
    `.message-row[data-message-id="${CSS.escape(messageId)}"]`
  );
}

function clearReplyJumpUnavailableTip() {
  if (replyJumpTipHideTimer !== null) {
    clearTimeout(replyJumpTipHideTimer);
    replyJumpTipHideTimer = null;
  }

  document
    .querySelectorAll(".message-reply-jump-tip")
    .forEach((el) => el.remove());
}

/**
 * Short tip anchored to the quote. Replaces any existing tip.
 * @param {HTMLElement | null | undefined} quoteButton
 */
function showReplyJumpUnavailableTip(quoteButton) {
  clearReplyJumpUnavailableTip();
  if (!(quoteButton instanceof HTMLElement)) {
    return;
  }

  const tip = document.createElement("div");
  tip.className = "message-reply-jump-tip";
  tip.setAttribute("role", "status");
  tip.textContent = "Can't open this message";
  quoteButton.appendChild(tip);

  replyJumpTipHideTimer = setTimeout(() => {
    replyJumpTipHideTimer = null;
    tip.remove();
  }, REPLY_JUMP_TIP_MS);
}

/**
 * Load older pages into history state until `messageId` is present,
 * history ends, the page cap is hit, or the open is cancelled.
 * @param {ChatHistoryState} state
 * @param {string} messageId
 * @param {number} token
 * @param {{
 *   profilesEnabled: boolean,
 *   mode?: "scrollRestore" | "replyJump",
 *   onOlderPage?: (newMessages: object[]) => void,
 * }} options
 * @returns {Promise<boolean>} false when the open is no longer current
 */
async function seekOlderPagesForMessageId(
  state,
  messageId,
  token,
  { profilesEnabled, mode = "scrollRestore", onOlderPage }
) {
  let normalPagesFetched = 0;
  let deepPagesFetched = 0;
  const allowDeep = mode !== "replyJump";
  const normalPageCap =
    mode === "replyJump" ? REPLY_JUMP_PAGE_CAP : SCROLL_ANCHOR_NORMAL_PAGE_CAP;

  while (
    !state.messageIds.has(messageId)
    && state.mayHaveMore
    && state.oldestOrderId
    && (
      normalPagesFetched < normalPageCap
      || (allowDeep && deepPagesFetched < SCROLL_ANCHOR_DEEP_PAGE_CAP)
    )
  ) {
    const previousOldestOrderId = state.oldestOrderId;
    const pageSize =
      normalPagesFetched < normalPageCap
        ? MESSAGE_PAGE_SIZE
        : SCROLL_ANCHOR_DEEP_PAGE_SIZE;
    if (pageSize === MESSAGE_PAGE_SIZE) {
      normalPagesFetched += 1;
    } else {
      deepPagesFetched += 1;
    }

    let olderMessages;
    try {
      olderMessages = await fetchChatMessages(
        state.spaceId,
        state.chatId,
        pageSize,
        previousOldestOrderId
      );
    } catch (error) {
      console.error(
        `Could not seek older messages for scroll restore in chat ${state.chatId}:`,
        error
      );
      return isOpenChatMessagesCurrent(token) && chatHistoryState === state;
    }

    if (!isOpenChatMessagesCurrent(token) || chatHistoryState !== state) {
      return false;
    }

    if (profilesEnabled && Array.isArray(olderMessages)) {
      try {
        await ensureMembersForParticipantIds(
          state.spaceId,
          olderMessages.map((message) => message?.creator)
        );
      } catch (error) {
        console.error(
          `Could not resolve author profiles while seeking scroll in chat ${state.chatId}:`,
          error
        );
      }
      if (!isOpenChatMessagesCurrent(token) || chatHistoryState !== state) {
        return false;
      }
    }

    const newMessages = mergeOlderPageIntoState(
      state,
      olderMessages,
      pageSize
    );
    if (typeof onOlderPage === "function" && newMessages.length > 0) {
      onOlderPage(newMessages);
    }

    if (
      Array.isArray(olderMessages)
      && olderMessages.length > 0
      && state.oldestOrderId === previousOldestOrderId
    ) {
      state.mayHaveMore = false;
    }
  }

  return true;
}

/**
 * Scroll to a replied-to message, seeking a few older pages when needed.
 * Unreachable parents (attachment-only / deleted / beyond budget): stay put
 * and show a short tip on the quote — never fall through to latest.
 * @param {string} messageId
 * @param {HTMLButtonElement | null} [quoteButton]
 */
async function jumpToRepliedMessage(messageId, quoteButton = null) {
  const trimmedId =
    typeof messageId === "string" ? messageId.trim() : "";
  if (!trimmedId || replyJumpInProgress) {
    return;
  }

  const state = chatHistoryState;
  const container = getChatMessagesContainer();
  if (!state || !container || state.isLoadingOlder) {
    return;
  }

  const scrollToParent = () => {
    const applied = scrollChatToMessage(container, trimmedId);
    if (applied) {
      scheduleRememberOpenChatScrollPosition();
    }
    return applied;
  };

  if (scrollToParent()) {
    return;
  }

  // In state but not painted (e.g. attachment-only) — do not rebuild the list
  // (that used to miss the row and fall through to scrollChatToLatest).
  if (state.messageIds.has(trimmedId)) {
    showReplyJumpUnavailableTip(quoteButton);
    return;
  }

  if (!state.mayHaveMore || !state.oldestOrderId) {
    showReplyJumpUnavailableTip(quoteButton);
    return;
  }

  const selectedSpaceInput = document.querySelector(
    'input[name="space"]:checked'
  );
  const profilesEnabled = Boolean(
    selectedSpaceInput
    && isRegularSpaceObject(selectedSpaceInput.dataset.spaceObject ?? "")
  );

  replyJumpInProgress = true;
  state.isLoadingOlder = true;
  updateHistoryStatus(state);
  if (quoteButton) {
    quoteButton.disabled = true;
    quoteButton.setAttribute("aria-busy", "true");
  }

  try {
    const stillCurrent = await seekOlderPagesForMessageId(
      state,
      trimmedId,
      state.token,
      {
        profilesEnabled,
        mode: "replyJump",
        onOlderPage: (newMessages) => {
          prependOlderChatMessages(newMessages);
        },
      }
    );

    if (
      !stillCurrent
      || chatHistoryState !== state
      || !isOpenChatMessagesCurrent(state.token)
    ) {
      return;
    }

    // Deleted / beyond budget / non-text (in state but no row) → tip, stay put.
    if (
      !state.messageIds.has(trimmedId)
      || !findMessageRow(container, trimmedId)
    ) {
      showReplyJumpUnavailableTip(quoteButton);
      return;
    }

    if (!scrollToParent()) {
      showReplyJumpUnavailableTip(quoteButton);
    }
  } finally {
    if (chatHistoryState === state) {
      state.isLoadingOlder = false;
      updateHistoryStatus(state);
    }
    if (quoteButton) {
      quoteButton.disabled = false;
      quoteButton.removeAttribute("aria-busy");
    }
    replyJumpInProgress = false;
  }
}

function initReplyQuoteJump() {
  const list = document.getElementById("chat-message-list");
  if (!list) {
    return;
  }

  list.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    const quote = target.closest(".message-reply-quote");
    if (!(quote instanceof HTMLButtonElement) || !list.contains(quote)) {
      return;
    }

    event.preventDefault();
    void jumpToRepliedMessage(quote.dataset.replyToMessageId ?? "", quote);
  });
}

/**
 * Consume session scroll memory for this open, seeking older pages when needed.
 * @param {string} spaceId
 * @param {string} chatId
 * @param {ChatHistoryState} state
 * @param {number} token
 * @param {{ profilesEnabled: boolean }} options
 * @returns {Promise<
 *   | { ok: false }
 *   | { ok: true, scrollAnchor: import("./chat-scroll-memory.js").ChatScrollAnchor | null }
 * >}
 */
async function resolveScrollAnchorForOpen(
  spaceId,
  chatId,
  state,
  token,
  { profilesEnabled }
) {
  const saved = peekChatScroll(spaceId, chatId);
  if (!saved) {
    return { ok: true, scrollAnchor: null };
  }

  if (saved.atLatest === true) {
    return { ok: true, scrollAnchor: takeChatScroll(spaceId, chatId) };
  }

  if (typeof saved.messageId !== "string" || saved.messageId.length === 0) {
    takeChatScroll(spaceId, chatId);
    return { ok: true, scrollAnchor: null };
  }

  if (!state.messageIds.has(saved.messageId)) {
    const stillCurrent = await seekOlderPagesForMessageId(
      state,
      saved.messageId,
      token,
      { profilesEnabled }
    );
    if (!stillCurrent) {
      return { ok: false };
    }
  }

  if (state.messageIds.has(saved.messageId)) {
    return { ok: true, scrollAnchor: takeChatScroll(spaceId, chatId) };
  }

  // Deleted, beyond cap, or otherwise missing — pin latest so we do not reseek.
  takeChatScroll(spaceId, chatId);
  rememberChatScroll(spaceId, chatId, { atLatest: true });
  return { ok: true, scrollAnchor: null };
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

    if (!isOpenChatMessagesCurrent(token)) {
      return;
    }

    if (chatHistoryState?.token !== token) {
      if (!await finishOpenChatMessagesLoad(token)) {
        return;
      }
      renderOpenChatMessages(messages);
      return;
    }

    applyInitialPage(chatHistoryState, messages);
    const resolved = await resolveScrollAnchorForOpen(
      spaceId,
      chatId,
      chatHistoryState,
      token,
      { profilesEnabled }
    );
    if (
      !resolved.ok
      || !isOpenChatMessagesCurrent(token)
      || chatHistoryState?.token !== token
    ) {
      return;
    }

    if (!await finishOpenChatMessagesLoad(token)) {
      return;
    }

    renderOpenChatMessages(chatHistoryState.messages, {
      scrollAnchor: resolved.scrollAnchor,
    });
    updateHistoryStatus(chatHistoryState);
    startChatMessageStream(spaceId, chatId, token);
    await ensureHistoryFillsViewport();
    maybeLoadOlderMessages();
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
initReplyQuoteJump();
setOnChatScrolledToLatest(rememberOpenChatScrollAtLatest);
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

setRemountOpenChatOnIdentityLearned(async (chatId) => {
  await openChatMessages(chatId);
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

  chatsList.hidden = false;
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

/**
 * Paint already-built (and preferably sorted) rows in one shot.
 * @param {Array<{ li: HTMLLIElement, previewEl: HTMLParagraphElement, timestampEl: HTMLSpanElement, chatId: string }>} rows
 */
function paintChatRows(rows) {
  const chatsList = document.getElementById("chats-list");
  const chatsEmpty = document.getElementById("chats-empty");
  if (!chatsList) {
    console.warn("Chats list element not found.");
    return;
  }

  if (chatsEmpty) {
    chatsEmpty.hidden = true;
  }

  chatsList.hidden = false;
  chatsList.replaceChildren();
  for (const row of rows) {
    chatsList.appendChild(row.li);
  }
  chatsList.scrollTop = 0;
  syncChatsScrollToTopButton();
}

/**
 * @param {string} spaceId
 * @param {Array<{ li: HTMLLIElement, chatId: string }>} rows
 */
function sortChatRowsByActivity(spaceId, rows) {
  rows.sort((a, b) =>
    compareChatsByActivity(
      {
        spaceId,
        chatId: a.chatId,
        name: a.li.dataset.chatName ?? "",
      },
      {
        spaceId,
        chatId: b.chatId,
        name: b.li.dataset.chatName ?? "",
      }
    )
  );
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
  return isOneToOneSpaceObject(selected?.dataset.spaceObject ?? "");
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
      if (latestMessage) {
        clearPersistedActivitySeed(spaceId, row.chatId);
        renderChatPreview(
          row.previewEl,
          spaceId,
          row.chatId,
          formatMessagePreview(latestMessage, { isOneToOne }),
          row.timestampEl,
          row.statusEl
        );
      } else {
        renderChatPreview(
          row.previewEl,
          spaceId,
          row.chatId,
          previewPartsAfterEmptyFetch(spaceId, row.chatId),
          row.timestampEl,
          row.statusEl
        );
      }
    } catch (error) {
      console.error(`Could not load latest message for chat ${row.chatId}:`, error);
      renderChatPreview(
        row.previewEl,
        spaceId,
        row.chatId,
        previewPartsAfterEmptyFetch(spaceId, row.chatId),
        row.timestampEl,
        row.statusEl
      );
    }
  }

  if (!isStillCurrentSpace(spaceId, token)) {
    return;
  }

  // Caller sorts rows and paints once (list may still be off-DOM).
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
    await noteAnytypeUnavailableFromResponse(response);
    const error = new Error(`Response status: ${response.status}`);
    error.status = response.status;
    throw error;
  }

  noteAnytypeReachable();
  return await response.json();
}

/**
 * Always returns parts when a latest message exists so `createdAt` is cached
 * even for non-text messages (empty preview text is fine).
 * @param {object} message
 * @param {{ isOneToOne: boolean }} options
 * @returns {ChatPreviewParts}
 */
function formatMessagePreview(message, { isOneToOne }) {
  const text = message.content?.text?.trim() ?? "";

  let senderLabel = null;
  if (text && !isOneToOne && message.isMine !== true) {
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

/**
 * @param {string} spaceId
 * @param {string} chatId
 * @returns {number | null}
 */
function getChatActivityCreatedAt(spaceId, chatId) {
  const parts = chatMessagePreviews.get(chatMessagePreviewKey(spaceId, chatId));
  if (parts && typeof parts.createdAt === "number") {
    return parts.createdAt;
  }
  return null;
}

/**
 * @param {string} spaceId
 * @param {HTMLLIElement} li
 * @returns {{ spaceId: string, chatId: string, name: string }}
 */
function chatSortKeyFromLi(spaceId, li) {
  return {
    spaceId,
    chatId: li.dataset.chatId ?? "",
    name: li.dataset.chatName ?? "",
  };
}

/**
 * Dated chats before empty; newer `createdAt` first; then name; then id.
 * @param {{ spaceId: string, chatId: string, name: string }} a
 * @param {{ spaceId: string, chatId: string, name: string }} b
 * @returns {number}
 */
function compareChatsByActivity(a, b) {
  const aAt = getChatActivityCreatedAt(a.spaceId, a.chatId);
  const bAt = getChatActivityCreatedAt(b.spaceId, b.chatId);
  const aDated = aAt !== null;
  const bDated = bAt !== null;

  if (aDated !== bDated) {
    return aDated ? -1 : 1;
  }

  if (aDated && bDated && aAt !== bAt) {
    return bAt - aAt;
  }

  const nameCmp = a.name.localeCompare(b.name, undefined, {
    sensitivity: "base",
  });
  if (nameCmp !== 0) {
    return nameCmp;
  }

  return a.chatId.localeCompare(b.chatId);
}

/**
 * Move one chat row to its activity-sorted position without resetting scroll.
 * @param {string} spaceId
 * @param {string} chatId
 */
function reorderChatListItem(spaceId, chatId) {
  const chatsList = document.getElementById("chats-list");
  if (!chatsList) {
    return;
  }

  const li = chatsList.querySelector(
    `li[data-chat-id="${CSS.escape(chatId)}"]`
  );
  if (!(li instanceof HTMLLIElement)) {
    return;
  }

  const key = chatSortKeyFromLi(spaceId, li);
  const others = Array.from(chatsList.children).filter(
    (el) => el instanceof HTMLLIElement && el !== li
  );

  let insertBefore = null;
  for (const other of others) {
    if (compareChatsByActivity(key, chatSortKeyFromLi(spaceId, other)) < 0) {
      insertBefore = other;
      break;
    }
  }

  if (insertBefore) {
    chatsList.insertBefore(li, insertBefore);
  } else {
    chatsList.appendChild(li);
  }
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
 * @param {HTMLElement | null | undefined} [statusEl]
 */
function updateChatHeaderStatus(chatId, parts, statusEl) {
  const el =
    statusEl instanceof HTMLElement
      ? statusEl
      : document.querySelector(
          `#chats-list li[data-chat-id="${CSS.escape(chatId)}"] .chat-header-status`
        );
  if (!(el instanceof HTMLElement)) {
    return;
  }

  if (parts?.isMine && parts.sendStatus) {
    el.replaceChildren(createSendStatusElement(parts.sendStatus));
    return;
  }

  el.replaceChildren();
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
 * @param {HTMLElement | null | undefined} [statusEl]
 */
function renderChatPreview(
  previewEl,
  spaceId,
  chatId,
  messagePreviewParts,
  timestampEl,
  statusEl
) {
  const key = chatMessagePreviewKey(spaceId, chatId);
  if (messagePreviewParts !== undefined) {
    chatMessagePreviews.set(key, messagePreviewParts);
  }

  const stampEl =
    timestampEl instanceof HTMLElement
      ? timestampEl
      : getChatTimestampEl(chatId);
  const headerStatusEl =
    statusEl instanceof HTMLElement
      ? statusEl
      : getChatHeaderStatusEl(chatId);
  const parts = chatMessagePreviews.get(key) ?? null;

  if (hasListDraftIndicator(spaceId, chatId)) {
    updateChatHeaderStatus(chatId, null, headerStatusEl);
    showDraftChatPreview(
      previewEl,
      getComposerDraft({ spaceId, chatId })
    );
    renderChatTimestamp(stampEl, parts?.createdAt);
    return;
  }

  updateChatHeaderStatus(chatId, parts, headerStatusEl);
  showMessageChatPreview(previewEl, parts);
  renderChatTimestamp(stampEl, parts?.createdAt);
}

/**
 * @param {string} chatId
 * @returns {HTMLElement | null}
 */
function getChatHeaderStatusEl(chatId) {
  const statusEl = document.querySelector(
    `#chats-list li[data-chat-id="${CSS.escape(chatId)}"] .chat-header-status`
  );
  return statusEl instanceof HTMLElement ? statusEl : null;
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
    getChatTimestampEl(chatId),
    getChatHeaderStatusEl(chatId)
  );
  reorderChatListItem(spaceId, chatId);
}

/** Distance from the bottom that still counts as “at latest”. */
const CHAT_LATEST_THRESHOLD_PX = 24;

function getChatMessagesContainer() {
  return document.getElementById("chat-messages");
}

function getScrollToLatestButton() {
  return document.getElementById("chat-scroll-to-latest");
}

/**
 * True when the viewport has no overflow, or remaining bottom distance
 * is within the latest threshold (subpixel-safe).
 * @param {HTMLElement | null | undefined} container
 */
export function isChatMessagesAtLatest(container) {
  if (!container) {
    return true;
  }

  const remaining =
    container.scrollHeight - container.clientHeight - container.scrollTop;
  return remaining <= CHAT_LATEST_THRESHOLD_PX;
}

function shouldShowScrollToLatestButton(container) {
  const panel = document.getElementById("chat-panel");
  if (!panel || panel.hidden) {
    return false;
  }

  if (container.classList.contains("chat-messages--preparing")) {
    return false;
  }

  const loading = document.getElementById("chat-messages-loading");
  if (loading && !loading.hidden) {
    return false;
  }

  if (container.scrollHeight <= container.clientHeight) {
    return false;
  }

  return !isChatMessagesAtLatest(container);
}

/** Hide immediately (chat switches / clear paths). */
export function hideScrollToLatestButton() {
  const button = getScrollToLatestButton();
  if (button) {
    button.hidden = true;
  }
}

/** Refresh button visibility from current scroll / panel state. */
export function syncScrollToLatestButton() {
  const button = getScrollToLatestButton();
  if (!button) {
    return;
  }

  const container = getChatMessagesContainer();
  if (!container) {
    button.hidden = true;
    return;
  }

  button.hidden = !shouldShowScrollToLatestButton(container);
}

/**
 * Jump the message viewport to the newest content.
 * @param {{ behavior?: ScrollBehavior }} [options]
 */
export function scrollChatToLatest({ behavior = "auto" } = {}) {
  const container = getChatMessagesContainer();
  if (!container) {
    return;
  }

  // Force layout so scrollHeight reflects any DOM just inserted.
  void container.offsetHeight;

  if (behavior === "smooth") {
    container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
  } else {
    container.scrollTop = container.scrollHeight;
  }

  syncScrollToLatestButton();
}

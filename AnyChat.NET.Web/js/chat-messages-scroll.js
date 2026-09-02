/** Distance from the bottom that still counts as “at latest”. */
const CHAT_LATEST_THRESHOLD_PX = 24;

const VISIBLE_CLASS = "chat-scroll-to-latest--visible";

let chatMessagesScrollBound = false;
/** @type {((event: TransitionEvent) => void) | null} */
let pendingHideTransitionEnd = null;

function getChatMessagesContainer() {
  return document.getElementById("chat-messages");
}

function getScrollToLatestButton() {
  return document.getElementById("chat-scroll-to-latest");
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function onScrollToLatestClick() {
  const behavior = prefersReducedMotion() ? "auto" : "smooth";
  scrollChatToLatest({ behavior });
}

function cancelPendingHide(button) {
  if (pendingHideTransitionEnd) {
    button.removeEventListener("transitionend", pendingHideTransitionEnd);
    pendingHideTransitionEnd = null;
  }
}

function isScrollToLatestButtonShown(button) {
  return !button.hidden && button.classList.contains(VISIBLE_CLASS);
}

/**
 * @param {boolean} visible
 * @param {{ immediate?: boolean }} [options]
 */
function setScrollToLatestButtonVisible(visible, { immediate = false } = {}) {
  const button = getScrollToLatestButton();
  if (!button) {
    return;
  }

  const skipMotion = immediate || prefersReducedMotion();

  if (visible) {
    cancelPendingHide(button);

    if (isScrollToLatestButtonShown(button)) {
      return;
    }

    if (button.hidden) {
      button.hidden = false;
      if (!skipMotion) {
        button.classList.remove(VISIBLE_CLASS);
        // Force layout so the off-screen start state paints before sliding in.
        void button.offsetWidth;
      }
    }

    button.classList.add(VISIBLE_CLASS);
    return;
  }

  cancelPendingHide(button);

  if (button.hidden && !button.classList.contains(VISIBLE_CLASS)) {
    return;
  }

  if (skipMotion || !button.classList.contains(VISIBLE_CLASS)) {
    button.classList.remove(VISIBLE_CLASS);
    button.hidden = true;
    return;
  }

  button.classList.remove(VISIBLE_CLASS);

  pendingHideTransitionEnd = (event) => {
    if (event.target !== button) {
      return;
    }
    if (event.propertyName !== "transform" && event.propertyName !== "opacity") {
      return;
    }

    cancelPendingHide(button);
    if (!button.classList.contains(VISIBLE_CLASS)) {
      button.hidden = true;
    }
  };

  button.addEventListener("transitionend", pendingHideTransitionEnd);
}

/**
 * One-time wiring for button visibility, reduced-motion jump, and history scroll.
 * @param {() => void} [onScroll] existing history callback (e.g. load older)
 */
export function initChatMessagesScroll(onScroll) {
  if (chatMessagesScrollBound) {
    return;
  }

  const container = getChatMessagesContainer();
  const button = getScrollToLatestButton();
  if (!container) {
    return;
  }

  chatMessagesScrollBound = true;

  container.addEventListener(
    "scroll",
    () => {
      syncScrollToLatestButton();
      onScroll?.();
    },
    { passive: true }
  );

  button?.addEventListener("click", onScrollToLatestClick);
  window.addEventListener("resize", syncScrollToLatestButton);
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
  setScrollToLatestButtonVisible(false, { immediate: true });
}

/** Refresh button visibility from current scroll / panel state. */
export function syncScrollToLatestButton() {
  const button = getScrollToLatestButton();
  if (!button) {
    return;
  }

  const container = getChatMessagesContainer();
  if (!container) {
    setScrollToLatestButtonVisible(false, { immediate: true });
    return;
  }

  setScrollToLatestButtonVisible(shouldShowScrollToLatestButton(container));
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

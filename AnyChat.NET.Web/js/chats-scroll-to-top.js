/** Distance from the top that still counts as “at top”. */
const CHATS_TOP_THRESHOLD_PX = 180;

const VISIBLE_CLASS = "chats-scroll-to-top--visible";
/** Must cover the CSS hide transition (transform + opacity). */
const HIDE_TRANSITION_MS = 220;

let chatsScrollBound = false;
/** @type {((event: TransitionEvent) => void) | null} */
let pendingHideTransitionEnd = null;
/** @type {ReturnType<typeof setTimeout> | null} */
let pendingHideTimeoutId = null;

function getChatsList() {
  return document.getElementById("chats-list");
}

function getScrollToTopButton() {
  return document.getElementById("chats-scroll-to-top");
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function cancelPendingHide(button) {
  if (pendingHideTransitionEnd) {
    button.removeEventListener("transitionend", pendingHideTransitionEnd);
    pendingHideTransitionEnd = null;
  }
  if (pendingHideTimeoutId !== null) {
    clearTimeout(pendingHideTimeoutId);
    pendingHideTimeoutId = null;
  }
}

function finishHideScrollToTopButton(button) {
  cancelPendingHide(button);
  if (!button.classList.contains(VISIBLE_CLASS)) {
    button.hidden = true;
  }
}

function isScrollToTopButtonShown(button) {
  return !button.hidden && button.classList.contains(VISIBLE_CLASS);
}

function isScrollToTopButtonExiting(button) {
  return (
    !button.hidden &&
    !button.classList.contains(VISIBLE_CLASS) &&
    pendingHideTransitionEnd !== null
  );
}

/**
 * @param {boolean} visible
 * @param {{ immediate?: boolean }} [options]
 */
function setScrollToTopButtonVisible(visible, { immediate = false } = {}) {
  const button = getScrollToTopButton();
  if (!button) {
    return;
  }

  const skipMotion = immediate || prefersReducedMotion();

  if (visible) {
    cancelPendingHide(button);

    if (isScrollToTopButtonShown(button)) {
      return;
    }

    if (button.hidden) {
      button.hidden = false;
      if (!skipMotion) {
        button.classList.remove(VISIBLE_CLASS);
        void button.offsetWidth;
      }
    }

    button.classList.add(VISIBLE_CLASS);
    return;
  }

  if (button.hidden) {
    return;
  }

  if (isScrollToTopButtonExiting(button)) {
    return;
  }

  if (skipMotion || !button.classList.contains(VISIBLE_CLASS)) {
    cancelPendingHide(button);
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
    finishHideScrollToTopButton(button);
  };

  button.addEventListener("transitionend", pendingHideTransitionEnd);
  pendingHideTimeoutId = setTimeout(() => {
    finishHideScrollToTopButton(button);
  }, HIDE_TRANSITION_MS);
}

function isChatsListAtTop(list) {
  if (!list) {
    return true;
  }
  return list.scrollTop <= CHATS_TOP_THRESHOLD_PX;
}

function shouldShowScrollToTopButton(list) {
  const loading = document.getElementById("chats-loading");
  if (loading && !loading.hidden) {
    return false;
  }

  if (list.hidden || list.childElementCount === 0) {
    return false;
  }

  if (list.scrollHeight <= list.clientHeight) {
    return false;
  }

  return !isChatsListAtTop(list);
}

/** Hide immediately (space switch / clear). */
export function hideChatsScrollToTopButton() {
  setScrollToTopButtonVisible(false, { immediate: true });
}

/** Refresh button visibility from current scroll / list state. */
export function syncChatsScrollToTopButton() {
  const button = getScrollToTopButton();
  if (!button) {
    return;
  }

  const list = getChatsList();
  if (!list) {
    setScrollToTopButtonVisible(false, { immediate: true });
    return;
  }

  setScrollToTopButtonVisible(shouldShowScrollToTopButton(list));
}

/**
 * Button click: hop instantly toward the top when far away, then
 * smooth-scroll only that final screen. Reduced motion stays fully instant.
 */
function scrollChatsToTopFromButton() {
  const list = getChatsList();
  if (!list) {
    return;
  }

  void list.offsetHeight;

  if (prefersReducedMotion()) {
    list.scrollTop = 0;
    syncChatsScrollToTopButton();
    return;
  }

  const scrolled = list.scrollTop;
  const firstPage = list.clientHeight;

  if (scrolled > firstPage) {
    list.scrollTop = firstPage;
    void list.offsetHeight;
  }

  list.scrollTo({ top: 0, behavior: "smooth" });
  syncChatsScrollToTopButton();
}

/** One-time wiring for chats list scroll-to-top. */
export function initChatsScrollToTop() {
  if (chatsScrollBound) {
    return;
  }

  const list = getChatsList();
  const button = getScrollToTopButton();
  if (!list) {
    return;
  }

  chatsScrollBound = true;

  list.addEventListener(
    "scroll",
    () => {
      syncChatsScrollToTopButton();
    },
    { passive: true },
  );

  button?.addEventListener("click", scrollChatsToTopFromButton);
  window.addEventListener("resize", syncChatsScrollToTopButton);
}

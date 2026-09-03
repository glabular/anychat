/** Hide floating day pill after this long with no scroll/pointer activity. */
const IDLE_MS = 1500;

/**
 * Top band (px from the scrollport top) where a sticky day pill sits while floating.
 * Wider than the CSS sticky `top` so padding/subpixel differences still match.
 */
const FLOATING_BAND_PX = 48;

const STUCK_CLASS = "message-date-separator--stuck";
const VISIBLE_CLASS = "is-floating-date-visible";

let bound = false;
/** @type {ReturnType<typeof setTimeout> | null} */
let idleTimer = null;
/** @type {number | null} */
let rafId = null;

/**
 * Fade the stuck (floating) day pill after idle; reveal on scroll/pointer.
 * Targets `#chat-messages` and its `.message-date-separator` children.
 */
export function initFloatingDateIdle() {
  if (bound) {
    return;
  }

  const list = document.getElementById("chat-messages");
  if (!list) {
    return;
  }

  bound = true;

  function clearIdleTimer() {
    if (idleTimer !== null) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  }

  function hide() {
    list.classList.remove(VISIBLE_CLASS);
  }

  function show() {
    list.classList.add(VISIBLE_CLASS);
    clearIdleTimer();
    idleTimer = setTimeout(hide, IDLE_MS);
  }

  /**
   * A day pill is "floating" when it sits in the top band of the scrollport
   * (sticky pin or natural position at the top edge). Mid-feed pills are lower.
   * @param {HTMLElement} separator
   * @param {DOMRect} listRect
   */
  function isSeparatorFloating(separator, listRect) {
    const sepRect = separator.getBoundingClientRect();
    if (sepRect.height <= 0) {
      return false;
    }

    return (
      sepRect.top >= listRect.top - 2
      && sepRect.top <= listRect.top + FLOATING_BAND_PX
      && sepRect.bottom > listRect.top
    );
  }

  /**
   * @param {{ reveal?: boolean }} [options]
   * @returns {boolean} whether any separator is currently floating
   */
  function updateFloatingSeparators({ reveal = false } = {}) {
    const listRect = list.getBoundingClientRect();
    if (listRect.height <= 0) {
      return false;
    }

    let anyFloating = false;
    for (const separator of list.querySelectorAll(".message-date-separator")) {
      if (!(separator instanceof HTMLElement)) {
        continue;
      }
      const floating = isSeparatorFloating(separator, listRect);
      separator.classList.toggle(STUCK_CLASS, floating);
      if (floating) {
        anyFloating = true;
      }
    }

    if (reveal && anyFloating) {
      show();
    }

    return anyFloating;
  }

  let pendingReveal = false;

  function scheduleFloatingUpdate(reveal = false) {
    if (rafId !== null) {
      // Coalesce: if a reveal was requested while a frame is pending, keep it.
      if (reveal) {
        pendingReveal = true;
      }
      return;
    }
    rafId = requestAnimationFrame(() => {
      rafId = null;
      const shouldReveal = reveal || pendingReveal;
      pendingReveal = false;
      updateFloatingSeparators({ reveal: shouldReveal });
    });
  }

  function onActivity() {
    scheduleFloatingUpdate(true);
  }

  list.addEventListener("scroll", onActivity, { passive: true });
  list.addEventListener("pointerenter", onActivity);
  list.addEventListener("pointermove", onActivity);

  // Only recompute floating state on DOM changes — do not restart the idle
  // timer (status icon updates etc. would otherwise prevent fade forever).
  const mutationObserver = new MutationObserver(() => {
    scheduleFloatingUpdate(false);
  });
  mutationObserver.observe(list, { childList: true, subtree: true });

  updateFloatingSeparators({ reveal: true });
}

/** Hide after this long with no pointer movement over the area. */
const IDLE_MS = 1500;

/** How close to the right edge counts as grabbing the native scrollbar. */
const SCROLLBAR_HIT_PX = 12;

const ACTIVE_CLASS = "is-scrollbar-visible";

/**
 * Reveal thin native scrollbars on pointer activity; hide after idle.
 * Targets elements with class `.idle-scrollbar`.
 */
export function initIdleScrollbars(root = document) {
  root.querySelectorAll(".idle-scrollbar").forEach(attachIdleScrollbar);
}

function attachIdleScrollbar(el) {
  let idleTimer = null;
  let dragging = false;
  let hovered = false;

  function clearIdleTimer() {
    if (idleTimer !== null) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  }

  function hide() {
    if (dragging) {
      return;
    }
    el.classList.remove(ACTIVE_CLASS);
  }

  function show() {
    el.classList.add(ACTIVE_CLASS);
    clearIdleTimer();
    if (!dragging) {
      idleTimer = setTimeout(hide, IDLE_MS);
    }
  }

  function onPointerEnter() {
    hovered = true;
    show();
  }

  function onPointerMove() {
    show();
  }

  function onPointerLeave() {
    hovered = false;
    if (dragging) {
      return;
    }
    clearIdleTimer();
    hide();
  }

  function onPointerDown(event) {
    const rect = el.getBoundingClientRect();
    const nearScrollbar = event.clientX >= rect.right - SCROLLBAR_HIT_PX;
    if (!nearScrollbar) {
      return;
    }
    dragging = true;
    show();
  }

  function onPointerUp() {
    if (!dragging) {
      return;
    }
    dragging = false;
    if (hovered) {
      show();
    } else {
      clearIdleTimer();
      hide();
    }
  }

  el.addEventListener("pointerenter", onPointerEnter);
  el.addEventListener("pointermove", onPointerMove);
  el.addEventListener("pointerleave", onPointerLeave);
  el.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointerup", onPointerUp);
}

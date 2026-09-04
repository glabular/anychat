const DEFAULT_WIDTH_PX = 340;
const SOFT_MIN_PX = 305;
const MAX_PX = 480;
const MAX_LAYOUT_FRACTION = 0.45;

const RESIZING_CLASS = "is-chats-sidebar-resizing";
const WIDTH_STORAGE_KEY = "anychat.chatsSidebarWidth";

/**
 * Drag the chats/main boundary to resize the chats list.
 * Width is clamped to [soft min, min(480px, 45% of layout)], soft min is
 * never undercut by window resize, and the last choice is restored from
 * localStorage on launch.
 */
export function initChatsSidebarResize() {
  const layout = document.querySelector(".layout");
  const sidebar = document.querySelector(".chat-sidebar");
  const splitter = document.getElementById("chats-sidebar-splitter");

  if (!layout || !sidebar || !splitter) {
    return;
  }

  /** Preferred width from the last drag (or default); may exceed current max. */
  let preferredWidthPx =
    readPersistedWidthPx() ??
    readWidthPx(sidebar) ??
    DEFAULT_WIDTH_PX;

  let currentWidthPx = clampToLayout(preferredWidthPx, layout);
  applyWidth(layout, splitter, currentWidthPx, maxWidthPx(layout));

  let drag = null;

  function onPointerDown(event) {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    currentWidthPx = clampToLayout(
      readWidthPx(sidebar) ?? currentWidthPx,
      layout,
    );

    drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: currentWidthPx,
    };

    splitter.setPointerCapture(event.pointerId);
    document.body.classList.add(RESIZING_CLASS);
  }

  function onPointerMove(event) {
    if (!drag || event.pointerId !== drag.pointerId) {
      return;
    }

    const maxPx = maxWidthPx(layout);
    const next = clampToLayout(
      drag.startWidth + (event.clientX - drag.startX),
      layout,
    );
    currentWidthPx = next;
    applyWidth(layout, splitter, next, maxPx);
  }

  function endDrag(event) {
    if (!drag || event.pointerId !== drag.pointerId) {
      return;
    }

    drag = null;
    document.body.classList.remove(RESIZING_CLASS);

    if (splitter.hasPointerCapture(event.pointerId)) {
      splitter.releasePointerCapture(event.pointerId);
    }

    preferredWidthPx = currentWidthPx;
    persistWidthPx(preferredWidthPx);
  }

  function onWindowResize() {
    const maxPx = maxWidthPx(layout);
    currentWidthPx = clampToLayout(preferredWidthPx, layout);
    applyWidth(layout, splitter, currentWidthPx, maxPx);
  }

  splitter.addEventListener("pointerdown", onPointerDown);
  splitter.addEventListener("pointermove", onPointerMove);
  splitter.addEventListener("pointerup", endDrag);
  splitter.addEventListener("pointercancel", endDrag);
  window.addEventListener("resize", onWindowResize);
}

function maxWidthPx(layout) {
  return Math.min(MAX_PX, layout.clientWidth * MAX_LAYOUT_FRACTION);
}

/**
 * Soft min is a hard floor: window resize must not crush the list below it.
 * Effective max is never below soft min, so a narrow window keeps the list
 * at soft min and lets the message pane shrink/clip instead.
 */
function clampToLayout(value, layout) {
  const maxPx = Math.max(maxWidthPx(layout), SOFT_MIN_PX);
  return Math.min(maxPx, Math.max(SOFT_MIN_PX, value));
}

function readWidthPx(sidebar) {
  const raw = getComputedStyle(sidebar).width;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function readPersistedWidthPx() {
  try {
    const raw = localStorage.getItem(WIDTH_STORAGE_KEY);
    if (raw === null) {
      return null;
    }
    const parsed = Number.parseFloat(raw);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function persistWidthPx(widthPx) {
  try {
    localStorage.setItem(WIDTH_STORAGE_KEY, String(Math.round(widthPx)));
  } catch {
    // non-fatal; app still works without persistence
  }
}

function applyWidth(layout, splitter, widthPx, maxPx) {
  const rounded = Math.round(widthPx);
  const effectiveMax = Math.round(Math.max(maxPx, SOFT_MIN_PX));
  layout.style.setProperty("--chats-sidebar-width", `${rounded}px`);
  splitter.setAttribute("aria-valuemin", String(SOFT_MIN_PX));
  splitter.setAttribute("aria-valuemax", String(effectiveMax));
  splitter.setAttribute("aria-valuenow", String(rounded));
}

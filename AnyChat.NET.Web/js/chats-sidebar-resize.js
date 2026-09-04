const DEFAULT_WIDTH_PX = 340;
const SOFT_MIN_PX = 220;
const MAX_PX = 480;
const MAX_LAYOUT_FRACTION = 0.45;

const RESIZING_CLASS = "is-chats-sidebar-resizing";

/**
 * Drag the chats/main boundary to resize the chats list.
 * Width is clamped to [soft min, min(480px, 45% of layout)].
 */
export function initChatsSidebarResize() {
  const layout = document.querySelector(".layout");
  const sidebar = document.querySelector(".chat-sidebar");
  const splitter = document.getElementById("chats-sidebar-splitter");

  if (!layout || !sidebar || !splitter) {
    return;
  }

  let currentWidthPx = clampToLayout(
    readWidthPx(sidebar) ?? DEFAULT_WIDTH_PX,
    layout,
  );
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
  }

  function onWindowResize() {
    const maxPx = maxWidthPx(layout);
    currentWidthPx = clampToLayout(currentWidthPx, layout);
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

function clampToLayout(value, layout) {
  const maxPx = maxWidthPx(layout);
  const minPx = Math.min(SOFT_MIN_PX, maxPx);
  return Math.min(maxPx, Math.max(minPx, value));
}

function readWidthPx(sidebar) {
  const raw = getComputedStyle(sidebar).width;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function applyWidth(layout, splitter, widthPx, maxPx) {
  const rounded = Math.round(widthPx);
  const minPx = Math.round(Math.min(SOFT_MIN_PX, maxPx));
  layout.style.setProperty("--chats-sidebar-width", `${rounded}px`);
  splitter.setAttribute("aria-valuemin", String(minPx));
  splitter.setAttribute("aria-valuemax", String(Math.round(maxPx)));
  splitter.setAttribute("aria-valuenow", String(rounded));
}

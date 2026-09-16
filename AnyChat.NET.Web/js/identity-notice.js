import { fetchAuthStatus } from "./api.js";

const SCROLL_VISIBLE_CLASS = "chat-scroll-to-latest--visible";
/** Gap between the ! tip and the scroll-to-latest button when both show. */
const TIP_ABOVE_SCROLL_GAP_PX = 12;
/** Matches .chat-scroll-to-latest bottom offset inside the messages area. */
const SCROLL_BOTTOM_OFFSET_PX = 16;
/** Matches .chat-scroll-to-latest width/height. */
const SCROLL_BUTTON_SIZE_PX = 40;

let noticeBound = false;
/** @type {ResizeObserver | null} */
let composerResizeObserver = null;
/** @type {MutationObserver | null} */
let placementMutationObserver = null;

function getRoot() {
  return document.getElementById("identity-notice");
}

function getButton() {
  return /** @type {HTMLButtonElement | null} */ (
    document.getElementById("identity-notice-button")
  );
}

function getPopover() {
  return document.getElementById("identity-notice-popover");
}

export function isIdentityNoticeVisible() {
  const root = getRoot();
  return Boolean(root && !root.hidden);
}

export function isIdentityNoticePopoverOpen() {
  const popover = getPopover();
  return Boolean(popover && !popover.hidden);
}

/**
 * @param {boolean} open
 */
function setPopoverOpen(open) {
  const popover = getPopover();
  const button = getButton();
  if (!popover || !button) {
    return;
  }

  popover.hidden = !open;
  button.setAttribute("aria-expanded", open ? "true" : "false");
}

export function closeIdentityNoticePopover() {
  if (!isIdentityNoticePopoverOpen()) {
    return false;
  }

  setPopoverOpen(false);
  return true;
}

function isScrollToLatestShown() {
  const scrollBtn = document.getElementById("chat-scroll-to-latest");
  return Boolean(
    scrollBtn
    && !scrollBtn.hidden
    && scrollBtn.classList.contains(SCROLL_VISIBLE_CLASS)
  );
}

function syncPlacement() {
  const root = getRoot();
  if (!root || root.hidden) {
    return;
  }

  const chatPanel = document.getElementById("chat-panel");
  const chatOpen = Boolean(chatPanel && !chatPanel.hidden);
  if (!chatOpen) {
    root.style.bottom = "";
    return;
  }

  const composer = document.getElementById("chat-composer");
  const composerHeight = composer?.getBoundingClientRect().height ?? 0;
  // Same slot as the ↓ when it is hidden; slide up when ↓ is visible.
  let bottom =
    composerHeight + SCROLL_BOTTOM_OFFSET_PX;
  if (isScrollToLatestShown()) {
    bottom += SCROLL_BUTTON_SIZE_PX + TIP_ABOVE_SCROLL_GAP_PX;
  }

  root.style.bottom = `${bottom}px`;
}

function ensurePlacementObservers() {
  if (!composerResizeObserver) {
    composerResizeObserver = new ResizeObserver(() => {
      syncPlacement();
    });
    const composer = document.getElementById("chat-composer");
    if (composer) {
      composerResizeObserver.observe(composer);
    }
  }

  if (!placementMutationObserver) {
    placementMutationObserver = new MutationObserver(() => {
      syncPlacement();
    });

    const chatPanel = document.getElementById("chat-panel");
    if (chatPanel) {
      placementMutationObserver.observe(chatPanel, {
        attributes: true,
        attributeFilter: ["hidden"],
      });
    }

    const scrollBtn = document.getElementById("chat-scroll-to-latest");
    if (scrollBtn) {
      placementMutationObserver.observe(scrollBtn, {
        attributes: true,
        attributeFilter: ["hidden", "class"],
      });
    }
  }
}

/**
 * @param {{ configured?: boolean, identityKnown?: boolean }} status
 */
export function applyIdentityNoticeStatus(status) {
  const configured = status?.configured === true;
  const known = status?.identityKnown === true;

  const root = getRoot();
  if (!root) {
    return;
  }

  const show = configured && !known;
  root.hidden = !show;
  if (!show) {
    setPopoverOpen(false);
    root.style.bottom = "";
    return;
  }

  ensurePlacementObservers();
  syncPlacement();
}

/**
 * Marks identity as known and hides the tip.
 * @returns {boolean} true when the tip was visible (unknown → known transition)
 */
export function markIdentityKnown() {
  const wasVisible = isIdentityNoticeVisible();
  applyIdentityNoticeStatus({ configured: true, identityKnown: true });
  return wasVisible;
}

export async function refreshIdentityNoticeFromAuth() {
  try {
    const status = await fetchAuthStatus();
    applyIdentityNoticeStatus({
      configured: status?.configured === true,
      identityKnown: status?.identityKnown === true,
    });
  } catch (error) {
    console.error("Could not refresh identity notice status:", error);
  }
}

export function initIdentityNotice() {
  if (noticeBound) {
    return;
  }

  const root = getRoot();
  const button = getButton();
  const popover = getPopover();
  if (!root || !button || !popover) {
    return;
  }

  noticeBound = true;

  button.addEventListener("click", (event) => {
    event.stopPropagation();
    setPopoverOpen(popover.hidden);
  });

  document.addEventListener(
    "mousedown",
    (event) => {
      if (!isIdentityNoticePopoverOpen()) {
        return;
      }

      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      if (root.contains(target)) {
        return;
      }

      setPopoverOpen(false);
    },
    true
  );

  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key !== "Escape") {
        return;
      }

      if (closeIdentityNoticePopover()) {
        event.preventDefault();
        event.stopPropagation();
        button.focus({ preventScroll: true });
      }
    },
    true
  );

  window.addEventListener("resize", () => {
    syncPlacement();
  });

  void refreshIdentityNoticeFromAuth();
}

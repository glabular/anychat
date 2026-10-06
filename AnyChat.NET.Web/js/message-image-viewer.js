/**
 * In-window (webview-sized) viewer for message images.
 * Fullscreen control is a later step.
 */

let viewerBound = false;
/** @type {HTMLElement | null} */
let focusBeforeOpen = null;

function getRoot() {
  return document.getElementById("message-image-viewer");
}

function getImageEl() {
  return /** @type {HTMLImageElement | null} */ (
    document.getElementById("message-image-viewer-image")
  );
}

function getCloseButton() {
  return /** @type {HTMLButtonElement | null} */ (
    document.getElementById("message-image-viewer-close")
  );
}

export function isMessageImageViewerOpen() {
  const root = getRoot();
  return Boolean(root && !root.hidden);
}

/**
 * @param {{ restoreFocus?: boolean }} [options]
 * @returns {boolean} true when the viewer was open and is now closed
 */
export function closeMessageImageViewer({ restoreFocus = false } = {}) {
  const root = getRoot();
  if (!root || root.hidden) {
    return false;
  }

  root.hidden = true;
  const img = getImageEl();
  if (img) {
    img.removeAttribute("src");
    img.alt = "";
  }

  if (restoreFocus && focusBeforeOpen instanceof HTMLElement) {
    focusBeforeOpen.focus({ preventScroll: true });
  }
  focusBeforeOpen = null;
  return true;
}

/**
 * @param {string} url
 * @param {{ alt?: string }} [options]
 */
export function openMessageImageViewer(url, { alt = "" } = {}) {
  const root = getRoot();
  const img = getImageEl();
  if (!root || !img || typeof url !== "string" || !url) {
    return;
  }

  const active = document.activeElement;
  focusBeforeOpen = active instanceof HTMLElement ? active : null;

  img.alt = typeof alt === "string" ? alt : "";
  img.src = url;
  root.hidden = false;

  const closeBtn = getCloseButton();
  closeBtn?.focus({ preventScroll: true });
}

export function initMessageImageViewer() {
  if (viewerBound) {
    return;
  }
  viewerBound = true;

  const root = getRoot();
  if (!root) {
    return;
  }

  root.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    if (target.closest("[data-message-image-viewer-close]")) {
      closeMessageImageViewer({ restoreFocus: true });
      return;
    }

    // Dimmed chrome closes; clicks on the photo itself stay put.
    if (target === root) {
      closeMessageImageViewer({ restoreFocus: true });
    }
  });
}

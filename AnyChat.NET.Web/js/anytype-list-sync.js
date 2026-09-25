/**
 * Soft-reconcile spaces and chats while the window is visible.
 * Anytype has no space/chat event stream; list APIs are the only signal.
 */
import { reconcileChatsForSelectedSpace } from "./chats.js";
import {
  isSpacesRailReady,
  reconcileSpaces,
} from "./spaces.js";

const RECONCILE_INTERVAL_MS = 15_000;

/** @type {ReturnType<typeof setInterval> | null} */
let intervalId = null;

/** @type {boolean} */
let enabled = false;

/** @type {boolean} */
let reconcileInFlight = false;

/** @type {boolean} */
let listenersBound = false;

/**
 * Start the visible-window sync loop (idempotent). Call after the spaces rail
 * has been populated at least once.
 */
export function enableAnytypeListSync() {
  if (enabled) {
    return;
  }
  enabled = true;
  bindVisibilityListeners();
  syncTimerWithVisibility();
}

function bindVisibilityListeners() {
  if (listenersBound) {
    return;
  }
  listenersBound = true;

  document.addEventListener("visibilitychange", () => {
    syncTimerWithVisibility();
    if (document.visibilityState === "visible") {
      void runListReconcile();
    }
  });

  window.addEventListener("focus", () => {
    if (document.visibilityState === "visible") {
      void runListReconcile();
    }
  });
}

function syncTimerWithVisibility() {
  if (!enabled) {
    return;
  }

  if (document.visibilityState === "hidden") {
    stopInterval();
    return;
  }

  startInterval();
}

function startInterval() {
  if (intervalId !== null) {
    return;
  }
  intervalId = setInterval(() => {
    void runListReconcile();
  }, RECONCILE_INTERVAL_MS);
}

function stopInterval() {
  if (intervalId === null) {
    return;
  }
  clearInterval(intervalId);
  intervalId = null;
}

/**
 * One soft reconcile pass: spaces first, then chats for the selected space.
 */
export async function runListReconcile() {
  if (!enabled || !isSpacesRailReady()) {
    return;
  }

  if (document.visibilityState === "hidden") {
    return;
  }

  if (reconcileInFlight) {
    return;
  }

  reconcileInFlight = true;
  try {
    await reconcileSpaces();
    await reconcileChatsForSelectedSpace();
  } catch (error) {
    console.error("List reconcile failed:", error);
  } finally {
    reconcileInFlight = false;
  }
}

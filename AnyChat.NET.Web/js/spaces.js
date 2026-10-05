import { describeSpacesLoadError, fetchSpaces } from "./api.js";
import { noteAnytypeReachable, showAnytypeConnectionNotice } from "./anytype-connection-notice.js";
import {
  authKindFromError,
} from "./anytype-auth-notice.js";
import { openApiKeySetupModal } from "./api-key-setup-modal.js";
import {
  clearChatsUiWhenNoSpaceSelected,
  loadChatsForSelectedSpace,
  setMainPlaceholderVisible,
} from "./chats.js";
import { setChatsCreateButtonReady } from "./chats-create-button.js";
import { setSpacesCreateButtonReady } from "./spaces-create-button.js";
import { orderSpaces } from "./space-order.js";
import {
  ensureReturnSpaceId,
  exitSettings,
  isSettingsOpen,
} from "./settings.js";

const SELECTED_SPACE_STORAGE_KEY = "anychat.selectedSpaceId";

/** True after the first successful spaces populate (enables soft reconcile). */
let spacesRailReady = false;

export function isSpacesRailReady() {
  return spacesRailReady;
}

function markSpacesRailReady() {
  if (spacesRailReady) {
    return;
  }
  spacesRailReady = true;
  void import("./anytype-list-sync.js").then((mod) => {
    mod.enableAnytypeListSync();
  });
}
function readPersistedSpaceId() {
  try {
    return localStorage.getItem(SELECTED_SPACE_STORAGE_KEY);
  } catch {
    return null;
  }
}

function persistSelectedSpaceId(spaceId) {
  try {
    localStorage.setItem(SELECTED_SPACE_STORAGE_KEY, spaceId);
  } catch {
    // non-fatal; app still works without persistence
  }
}

function resolveInitialSpaceId(spaces) {
  const savedId = readPersistedSpaceId();
  if (savedId && spaces.some((space) => space.id === savedId)) {
    return savedId;
  }
  return spaces[0]?.id ?? null;
}

/**
 * Remove only space radios; keep legend, loading, and create +.
 * @param {HTMLElement} spacesSidebar
 */
function clearSpaceLabels(spacesSidebar) {
  for (const label of [
    ...spacesSidebar.querySelectorAll('label:has(input[name="space"])'),
  ]) {
    label.remove();
  }
}

/**
 * @param {unknown[]} spaces
 * @param {{ selectSpaceId?: string | null }} [options]
 */
export function populateSpacesSidebar(spaces, options = {}) {
  const spacesSidebar = document.getElementById("spaces-sidebar");
  if (!spacesSidebar) {
    return;
  }

  const createButton = document.getElementById("spaces-create");
  clearSpaceLabels(spacesSidebar);

  const ordered = orderSpaces(spaces);
  ordered.forEach((space, index) => {
    const spaceButton = getSpaceButton(space, index + 1);
    if (createButton) {
      spacesSidebar.insertBefore(spaceButton, createButton);
    } else {
      spacesSidebar.appendChild(spaceButton);
    }
  });

  setSpacesCreateButtonReady(true);

  if (ordered.length > 0) {
    const preferredId = options.selectSpaceId;
    const spaceId =
      preferredId && ordered.some((space) => space.id === preferredId)
        ? preferredId
        : resolveInitialSpaceId(ordered);
    if (isSettingsOpen()) {
      // User opened settings before spaces arrived — keep settings UI, remember
      // the space for Back, and do not flash the main chats placeholder.
      persistSelectedSpaceId(spaceId);
      ensureReturnSpaceId(spaceId);
    } else {
      selectSpace(spaceId);
      loadChatsForSelectedSpace();
    }
  } else {
    setChatsCreateButtonReady(false);
  }

  markSpacesRailReady();
}

export function selectSpace(spaceId) {
  const spaceInput = document.querySelector(
    `input[name="space"][value="${spaceId}"]`
  );

  if (spaceInput) {
    spaceInput.checked = true;
    persistSelectedSpaceId(spaceId);
  }
}

export function bindSpaceChangeToChats() {
  const spacesSidebar = document.getElementById("spaces-sidebar");
  spacesSidebar?.addEventListener("change", (event) => {
    if (event.target.matches('input[name="space"]')) {
      exitSettings();
      persistSelectedSpaceId(event.target.value);
      loadChatsForSelectedSpace();
    }
  });
}

export function bindSpaceKeyboardShortcuts() {
  document.addEventListener("keydown", (event) => {
    if (!event.ctrlKey || event.altKey || event.metaKey) {
      return;
    }

    if (!/^[1-9]$/.test(event.key)) {
      return;
    }

    const target = event.target;
    if (
      target instanceof HTMLElement &&
      (target.closest("input, textarea, [contenteditable='true']") ||
        target.isContentEditable)
    ) {
      return;
    }

    const index = Number(event.key) - 1;
    const spaceInputs = document.querySelectorAll('input[name="space"]');
    const spaceInput = spaceInputs[index];
    if (!spaceInput) {
      return;
    }

    event.preventDefault();

    const currentlySelected = document.querySelector(
      'input[name="space"]:checked'
    );
    if (currentlySelected && currentlySelected.value === spaceInput.value) {
      return;
    }

    selectSpace(spaceInput.value);
    exitSettings();
    loadChatsForSelectedSpace();
  });
}

export function getSpaceDisplayName(space) {
  const fromApi = space?.displayName?.trim() || space?.name?.trim();
  return fromApi || "Untitled space";
}

function getSpaceDisplayLetter(space, shortcutNumber) {
  const label = space?.displayName?.trim() || space?.name?.trim();
  if (label) {
    return label[0].toLocaleUpperCase();
  }
  if (shortcutNumber >= 1 && shortcutNumber <= 9) {
    return String(shortcutNumber);
  }
  return "#";
}

function getSpaceButton(space, shortcutNumber) {
  const label = document.createElement("label");
  const input = document.createElement("input");
  const displayName = getSpaceDisplayName(space);
  const letter = getSpaceDisplayLetter(space, shortcutNumber);
  const resolvedFromApi = !!(
    space?.displayName?.trim() || space?.name?.trim()
  );

  input.type = "radio";
  input.name = "space";
  input.value = space.id;
  input.dataset.spaceName = displayName;
  input.dataset.spaceObject = space.object ?? "";
  input.dataset.gatewayUrl =
    typeof space.gatewayUrl === "string" ? space.gatewayUrl : "";

  const spaceLetterSpan = document.createElement("span");
  spaceLetterSpan.textContent = letter;
  if (!resolvedFromApi) {
    spaceLetterSpan.className = "space-letter--fallback";
  }

  const tooltipSpan = document.createElement("span");
  tooltipSpan.className = "space-tooltip";

  const nameSpan = document.createElement("span");
  nameSpan.className = "space-tooltip__name";
  nameSpan.textContent = displayName;
  tooltipSpan.appendChild(nameSpan);

  // Digits only go 1–9;
  if (shortcutNumber >= 1 && shortcutNumber <= 9) {
    const shortcutSpan = document.createElement("span");
    shortcutSpan.className = "space-tooltip__shortcut";
    shortcutSpan.textContent = `Ctrl + ${shortcutNumber}`;
    tooltipSpan.appendChild(shortcutSpan);
  }

  label.setAttribute("aria-label", displayName);

  label.appendChild(input);
  label.appendChild(spaceLetterSpan);
  label.appendChild(tooltipSpan);

  return label;
}

export async function initializeSpaces() {
  const loadingStartedAt = performance.now();
  console.log("Please, wait. Loading Spaces.");

  bindSpaceChangeToChats();
  bindSpaceKeyboardShortcuts();

  try {
    const spaces = await fetchSpaces();
    const loading = document.getElementById("spaces-loading");
    if (loading) {
      loading.hidden = true;
    }
    populateSpacesSidebar(spaces);
    setMainPlaceholderVisible(true);

    const loadingTimeMs = performance.now() - loadingStartedAt;
    console.log(
      `Spaces loaded in ${loadingTimeMs.toFixed(2)} ms (${(loadingTimeMs / 1000).toFixed(2)} s).`
    );
  } catch (error) {
    const loadingTimeMs = performance.now() - loadingStartedAt;
    console.error(
      `Failed to load spaces after ${loadingTimeMs.toFixed(2)} ms:`,
      error
    );

    const chatsEmpty = document.getElementById("chats-empty");
    if (chatsEmpty) {
      chatsEmpty.hidden = false;
      chatsEmpty.replaceChildren();
      chatsEmpty.textContent = describeSpacesLoadError(error);
    }

    setMainPlaceholderVisible(false);
    setChatsCreateButtonReady(false);
    setSpacesCreateButtonReady(false);

    if (error?.status === 503) {
      showAnytypeConnectionNotice({
        onRecovered: () => reloadSpacesAfterAnytypeRecovery(),
      });
    } else {
      const authKind = authKindFromError(error);
      if (authKind) {
        void openApiKeySetupModal({
          reason: authKind,
          onSaved: () => reloadSpacesAfterAnytypeRecovery(),
        });
      }
    }
  } finally {
    const loading = document.getElementById("spaces-loading");
    if (loading) {
      loading.hidden = true;
    }
    document.getElementById("spaces-sidebar")?.setAttribute("aria-busy", "false");
  }
}

export async function reloadSpacesAfterAnytypeRecovery() {
  const spaces = await fetchSpaces();
  const spacesSidebar = document.getElementById("spaces-sidebar");
  if (spacesSidebar) {
    clearSpaceLabels(spacesSidebar);
  }

  const chatsEmpty = document.getElementById("chats-empty");
  if (chatsEmpty) {
    chatsEmpty.hidden = true;
    chatsEmpty.replaceChildren();
  }

  populateSpacesSidebar(spaces);
  setMainPlaceholderVisible(true);
}

/**
 * Soft-refresh the spaces rail without wiping selection when it still exists.
 * Removes spaces deleted/left elsewhere; appends new ones. If the selected
 * space vanished, clears chats UI (no auto-select).
 * @returns {Promise<void>}
 */
export async function reconcileSpaces() {
  if (!spacesRailReady) {
    return;
  }

  const loading = document.getElementById("spaces-loading");
  if (loading && !loading.hidden) {
    return;
  }

  const spacesSidebar = document.getElementById("spaces-sidebar");
  if (!spacesSidebar) {
    return;
  }

  let spaces;
  try {
    spaces = await fetchSpaces();
  } catch (error) {
    console.error("Could not reconcile spaces:", error);
    const authKind = authKindFromError(error);
    if (authKind) {
      void import("./api-key-setup-modal.js").then(
        ({ isApiKeySetupModalOpen, openApiKeySetupModal: openAuth }) => {
          if (!isApiKeySetupModalOpen()) {
            openAuth({ reason: authKind });
          }
        }
      );
    }
    return;
  }

  if (!Array.isArray(spaces)) {
    return;
  }

  noteAnytypeReachable();

  const serverById = new Map();
  for (const space of spaces) {
    if (typeof space?.id === "string" && space.id.length > 0) {
      serverById.set(space.id, space);
    }
  }

  const selected = document.querySelector('input[name="space"]:checked');
  const selectedId = selected?.value ?? null;
  const selectedLost = Boolean(selectedId && !serverById.has(selectedId));

  for (const label of [
    ...spacesSidebar.querySelectorAll('label:has(input[name="space"])'),
  ]) {
    const input = label.querySelector('input[name="space"]');
    const id = input instanceof HTMLInputElement ? input.value : "";
    if (!id || serverById.has(id)) {
      continue;
    }
    label.remove();
  }

  const createButton = document.getElementById("spaces-create");
  const existingIds = new Set(
    [...spacesSidebar.querySelectorAll('input[name="space"]')].map(
      (input) => input.value
    )
  );

  for (const space of serverById.values()) {
    if (existingIds.has(space.id)) {
      updateSpaceLabel(space);
      continue;
    }

    const nextIndex =
      spacesSidebar.querySelectorAll('input[name="space"]').length + 1;
    const spaceButton = getSpaceButton(space, nextIndex);
    if (createButton) {
      spacesSidebar.insertBefore(spaceButton, createButton);
    } else {
      spacesSidebar.appendChild(spaceButton);
    }
  }

  renumberSpaceShortcuts(spacesSidebar);
  setSpacesCreateButtonReady(true);

  if (selectedLost) {
    if (isSettingsOpen()) {
      exitSettings();
    }
    clearChatsUiWhenNoSpaceSelected();
    try {
      localStorage.removeItem(SELECTED_SPACE_STORAGE_KEY);
    } catch {
      // non-fatal
    }
  }

  if (serverById.size === 0) {
    setChatsCreateButtonReady(false);
  }
}

/**
 * Refresh label metadata for an existing space radio without reselecting.
 * @param {object} space
 */
export function updateSpaceLabel(space) {
  const input = document.querySelector(
    `input[name="space"][value="${CSS.escape(space.id)}"]`
  );
  if (!(input instanceof HTMLInputElement)) {
    return;
  }

  const displayName = getSpaceDisplayName(space);
  input.dataset.spaceName = displayName;
  input.dataset.spaceObject = space.object ?? "";
  input.dataset.gatewayUrl =
    typeof space.gatewayUrl === "string" ? space.gatewayUrl : "";

  const label = input.closest("label");
  if (label) {
    label.setAttribute("aria-label", displayName);
  }

  const nameSpan = label?.querySelector(".space-tooltip__name");
  if (nameSpan) {
    nameSpan.textContent = displayName;
  }

  const letterEl = label
    ? [...label.children].find(
        (el) =>
          el instanceof HTMLElement
          && el.tagName === "SPAN"
          && !el.classList.contains("space-tooltip")
      )
    : null;
  if (letterEl instanceof HTMLElement) {
    const resolvedFromApi = !!(
      space?.displayName?.trim() || space?.name?.trim()
    );
    if (resolvedFromApi) {
      letterEl.textContent = getSpaceDisplayLetter(space, 1);
      letterEl.className = "";
    } else {
      letterEl.className = "space-letter--fallback";
    }
  }
}

/**
 * Keep Ctrl+1–9 order and fallback letters aligned with DOM order.
 * @param {HTMLElement} spacesSidebar
 */
function renumberSpaceShortcuts(spacesSidebar) {
  const labels = [
    ...spacesSidebar.querySelectorAll('label:has(input[name="space"])'),
  ];
  labels.forEach((label, index) => {
    const shortcutNumber = index + 1;
    const letterSpan = [...label.children].find(
      (el) =>
        el instanceof HTMLElement
        && el.tagName === "SPAN"
        && !el.classList.contains("space-tooltip")
    );
    if (
      letterSpan instanceof HTMLElement
      && letterSpan.classList.contains("space-letter--fallback")
    ) {
      letterSpan.textContent =
        shortcutNumber >= 1 && shortcutNumber <= 9
          ? String(shortcutNumber)
          : "#";
    }

    const shortcutSpan = label.querySelector(".space-tooltip__shortcut");
    if (shortcutNumber >= 1 && shortcutNumber <= 9) {
      if (shortcutSpan) {
        shortcutSpan.textContent = `Ctrl + ${shortcutNumber}`;
      } else {
        const tooltip = label.querySelector(".space-tooltip");
        if (tooltip) {
          const created = document.createElement("span");
          created.className = "space-tooltip__shortcut";
          created.textContent = `Ctrl + ${shortcutNumber}`;
          tooltip.appendChild(created);
        }
      }
    } else if (shortcutSpan) {
      shortcutSpan.remove();
    }
  });
}

/**
 * Reload the spaces rail and select a specific space (e.g. after create).
 * @param {string} spaceId
 */
export async function reloadSpacesAndSelect(spaceId) {
  const spaces = await fetchSpaces();
  const spacesSidebar = document.getElementById("spaces-sidebar");
  if (spacesSidebar) {
    clearSpaceLabels(spacesSidebar);
  }

  const chatsEmpty = document.getElementById("chats-empty");
  if (chatsEmpty) {
    chatsEmpty.hidden = true;
    chatsEmpty.replaceChildren();
  }

  exitSettings();
  populateSpacesSidebar(spaces, { selectSpaceId: spaceId });
  setMainPlaceholderVisible(true);
}

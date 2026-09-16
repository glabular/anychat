import { describeSpacesLoadError, fetchSpaces } from "./api.js";
import { showAnytypeConnectionNotice } from "./anytype-connection-notice.js";
import {
  authKindFromError,
} from "./anytype-auth-notice.js";
import { openApiKeySetupModal } from "./api-key-setup-modal.js";
import {
  loadChatsForSelectedSpace,
  setMainPlaceholderVisible,
} from "./chats.js";
import { setChatsCreateButtonReady } from "./chats-create-button.js";

const SELECTED_SPACE_STORAGE_KEY = "anychat.selectedSpaceId";

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

export function populateSpacesSidebar(spaces) {
  const spacesSidebar = document.getElementById("spaces-sidebar");

  spaces.forEach((space, index) => {
    const spaceButton = getSpaceButton(space, index + 1);
    spacesSidebar.appendChild(spaceButton);
  });

  if (spaces.length > 0) {
    const spaceId = resolveInitialSpaceId(spaces);
    selectSpace(spaceId);
    loadChatsForSelectedSpace();
  } else {
    setChatsCreateButtonReady(false);
  }
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

  const shortcutSpan = document.createElement("span");
  shortcutSpan.className = "space-tooltip__shortcut";
  shortcutSpan.textContent = `Ctrl + ${shortcutNumber}`;

  tooltipSpan.appendChild(nameSpan);
  tooltipSpan.appendChild(shortcutSpan);

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
  spacesSidebar?.replaceChildren();

  const chatsEmpty = document.getElementById("chats-empty");
  if (chatsEmpty) {
    chatsEmpty.hidden = true;
    chatsEmpty.replaceChildren();
  }

  populateSpacesSidebar(spaces);
  setMainPlaceholderVisible(true);
}

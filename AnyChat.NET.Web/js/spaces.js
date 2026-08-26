import { describeSpacesLoadError, fetchSpaces } from "./api.js";
import {
  loadChatsForSelectedSpace,
  setMainPlaceholderVisible,
} from "./chats.js";

export function populateSpacesSidebar(spaces) {
  const spacesSidebar = document.getElementById("spaces-sidebar");

  spaces.forEach((space) => {
    const spaceButton = getSpaceButton(space);
    spacesSidebar.appendChild(spaceButton);
  });

  // TODO: Read previously selected space instead of taking the first.
  if (spaces.length > 0) {
    selectSpace(spaces[0].id);
    loadChatsForSelectedSpace();
  }
}

export function selectSpace(spaceId) {
  const spaceInput = document.querySelector(
    `input[name="space"][value="${spaceId}"]`
  );

  if (spaceInput) {
    spaceInput.checked = true;
  }
}

export function bindSpaceChangeToChats() {
  const spacesSidebar = document.getElementById("spaces-sidebar");
  spacesSidebar?.addEventListener("change", (event) => {
    if (event.target.matches('input[name="space"]')) {
      loadChatsForSelectedSpace();
    }
  });
}

function getSpaceButton(space) {
  const label = document.createElement("label");
  const input = document.createElement("input");

  input.type = "radio";
  input.name = "space";
  input.value = space.id;

  const spaceLetterSpan = document.createElement("span");
  spaceLetterSpan.textContent = space.name?.[0] ?? "";

  const tooltipSpan = document.createElement("span");
  tooltipSpan.className = "space-tooltip";
  tooltipSpan.textContent = space.name ?? "";

  label.appendChild(input);
  label.appendChild(spaceLetterSpan);
  label.appendChild(tooltipSpan);

  return label;
}

export async function initializeSpaces() {
  const loadingStartedAt = performance.now();
  console.log("Please, wait. Loading Spaces.");

  bindSpaceChangeToChats();

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
  } finally {
    const loading = document.getElementById("spaces-loading");
    if (loading) {
      loading.hidden = true;
    }
    document.getElementById("spaces-sidebar")?.setAttribute("aria-busy", "false");
  }
}

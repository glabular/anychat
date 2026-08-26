import { fetchChats } from "./api.js";
import { spacesUrl } from "./api.js";

/** Wait this long before showing the spinner (avoids flash on fast loads). */
const SPINNER_SHOW_DELAY_MS = 200;
/** Once shown, keep the spinner at least this long (avoids a brief blink). */
const SPINNER_MIN_VISIBLE_MS = 300;

let loadToken = 0;
let showSpinnerTimer = null;
let spinnerShownAt = null;

function setSpinnerVisible(visible) {
  const chatsLoading = document.getElementById("chats-loading");
  if (chatsLoading) {
    chatsLoading.hidden = !visible;
  }
}

/** Visible when spaces/chats are available; hide only on load errors. */
export function setMainPlaceholderVisible(visible) {
  const mainPlaceholder = document.getElementById("main-placeholder");
  if (mainPlaceholder) {
    mainPlaceholder.hidden = !visible;
  }
}

function restoreChatsEmptyContent(chatsEmpty) {
  chatsEmpty.replaceChildren();
  chatsEmpty.append("You're all set ✨ ");
  const detail = document.createElement("span");
  detail.className = "chats-empty-detail";
  detail.textContent = "No chats in this space yet.";
  chatsEmpty.appendChild(detail);
}

function clearChatsContent() {
  const chatsEmpty = document.getElementById("chats-empty");
  const chatsList = document.getElementById("chats-list");

  if (chatsEmpty) {
    chatsEmpty.hidden = true;
  }
  chatsList?.replaceChildren();
}

function beginChatsLoad() {
  const chatsList = document.getElementById("chats-list");

  if (showSpinnerTimer !== null) {
    clearTimeout(showSpinnerTimer);
    showSpinnerTimer = null;
  }

  // Keep previous empty/list until data arrives (or until the delayed
  // spinner fires). Avoids empty→empty flicker on fast switches.
  // Do not toggle #main-placeholder here — that caused a flash.
  setSpinnerVisible(false);
  spinnerShownAt = null;
  chatsList?.setAttribute("aria-busy", "true");

  showSpinnerTimer = setTimeout(() => {
    showSpinnerTimer = null;
    clearChatsContent();
    setSpinnerVisible(true);
    spinnerShownAt = performance.now();
  }, SPINNER_SHOW_DELAY_MS);
}

async function endChatsLoad(token) {
  if (showSpinnerTimer !== null) {
    clearTimeout(showSpinnerTimer);
    showSpinnerTimer = null;
  }

  if (spinnerShownAt !== null) {
    const remaining =
      SPINNER_MIN_VISIBLE_MS - (performance.now() - spinnerShownAt);
    if (remaining > 0) {
      await new Promise((resolve) => setTimeout(resolve, remaining));
    }
  }

  if (token !== loadToken) {
    return false;
  }

  setSpinnerVisible(false);
  spinnerShownAt = null;
  document.getElementById("chats-list")?.setAttribute("aria-busy", "false");
  return true;
}

export async function loadChatsForSelectedSpace() {
  const selectedSpaceInput = document.querySelector(
    'input[name="space"]:checked'
  );

  if (!selectedSpaceInput) {
    console.warn("No space selected.");
    return;
  }

  const spaceId = selectedSpaceInput.value;
  const token = ++loadToken;
  beginChatsLoad();

  let chats;
  try {
    chats = await fetchChats(spaceId);
  } catch (error) {
    console.error(`Could not load chats for space ${spaceId}:`, error);
    if (token !== loadToken) {
      return;
    }
    await endChatsLoad(token);
    clearChatsContent();
    setMainPlaceholderVisible(false);

    const chatsEmpty = document.getElementById("chats-empty");
    if (chatsEmpty) {
      chatsEmpty.hidden = false;
      chatsEmpty.replaceChildren();
      chatsEmpty.textContent = "Could not load chats.";
    }
    return;
  }

  if (token !== loadToken) {
    return;
  }

  const stillSelected = document.querySelector('input[name="space"]:checked');
  if (!stillSelected || stillSelected.value !== spaceId) {
    return;
  }

  const stillCurrent = await endChatsLoad(token);
  if (!stillCurrent) {
    return;
  }

  populateChatsList(chats);
  setMainPlaceholderVisible(true);
}

export function populateChatsList(chats) {
  const chatsList = document.getElementById("chats-list");
  const chatsEmpty = document.getElementById("chats-empty");
  if (!chatsList) {
    console.warn("Chats list element not found.");
    return;
  }

  chatsList.replaceChildren();

  if (chats.length === 0) {
    if (chatsEmpty) {
      restoreChatsEmptyContent(chatsEmpty);
      chatsEmpty.hidden = false;
    }
    return;
  }

  if (chatsEmpty) {
    chatsEmpty.hidden = true;
  }

  chats.forEach((chat) => {
    const chatListItem = document.createElement("li");

    const chatButton = document.createElement("button");
    chatButton.type = "button";
    chatButton.className = "chat-item";

    const avatarDiv = document.createElement("div");
    avatarDiv.className = "avatar";
    chatButton.appendChild(avatarDiv);

    const divTextBlock = document.createElement("div");
    divTextBlock.className = "text-block";

    const chatHeaderDiv = document.createElement("div");
    chatHeaderDiv.className = "chat-header";

    const chatNameP = document.createElement("p");
    chatNameP.className = "chat-name";
    chatNameP.textContent = chat.name ?? "-no name-";
    chatHeaderDiv.appendChild(chatNameP);

    divTextBlock.appendChild(chatHeaderDiv);

    const chatPreviewP = document.createElement("p");
    chatPreviewP.className = "chat-preview";
    // API field is `snippet` (not lastMessagePreview).
    chatPreviewP.textContent = chat.snippet ?? "";
    divTextBlock.appendChild(chatPreviewP);

    chatButton.appendChild(divTextBlock);
    chatListItem.appendChild(chatButton);
    chatsList.appendChild(chatListItem);
  });
}

export async function fetchChatMessages(spaceId, chatId, limit = 1) {
  const response = await fetch(`${spacesUrl()}/${spaceId}/chats/${chatId}/messages?limit=${limit}`);

  if (!response.ok) {
    throw new Error(`Response status: ${response.status}`);
  }

  return await response.json();
}

function formatMessagePreview(message) {
  const text = message.content?.text?.trim() ?? "";

  if (!text) {
    return "";
  }

  return text;
}

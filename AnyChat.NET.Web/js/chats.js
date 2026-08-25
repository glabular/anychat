import { fetchChats } from "./api.js";

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

  const chats = await fetchChats(spaceId);

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

import { fetchChats } from "./api.js";
import { spacesUrl } from "./api.js";
import {
  beginOpenChatMessages,
  hideChatPanel,
  isOpenChatMessagesCurrent,
  renderOpenChatMessages,
  renderOpenChatMessagesError,
  showChatHeader,
} from "./chat-view.js";

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
  hideChatPanel();
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
    hideChatPanel();
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

  const rows = populateChatsList(chats);
  setMainPlaceholderVisible(true);
  void loadChatPreviews(spaceId, rows, token);
}

/**
 * Builds one chat list row. Preview starts empty; Step 4 fills it from messages.
 * @returns {{ li: HTMLLIElement, previewEl: HTMLParagraphElement, chatId: string }}
 */
function createChatListItem(chat) {
  const li = document.createElement("li");
  if (chat.id) {
    li.dataset.chatId = chat.id;
  }

  const chatButton = document.createElement("button");
  chatButton.type = "button";
  chatButton.className = "chat-item";
  const chatName = chat.name ?? "-no name-";
  const chatId = chat.id ?? "";
  chatButton.addEventListener("click", () => {
    const previouslySelected = document.querySelector(
      "#chats-list .chat-item--selected"
    );
    previouslySelected?.classList.remove("chat-item--selected");
    chatButton.classList.add("chat-item--selected");
    showChatHeader(chatName);
    void openChatMessages(chatId);
  });

  const avatarDiv = document.createElement("div");
  avatarDiv.className = "avatar";
  chatButton.appendChild(avatarDiv);

  const divTextBlock = document.createElement("div");
  divTextBlock.className = "text-block";

  const chatHeaderDiv = document.createElement("div");
  chatHeaderDiv.className = "chat-header";

  const chatNameP = document.createElement("p");
  chatNameP.className = "chat-name";
  chatNameP.textContent = chatName;
  chatHeaderDiv.appendChild(chatNameP);

  divTextBlock.appendChild(chatHeaderDiv);

  const previewEl = document.createElement("p");
  previewEl.className = "chat-preview";
  previewEl.textContent = "";
  divTextBlock.appendChild(previewEl);

  chatButton.appendChild(divTextBlock);
  li.appendChild(chatButton);

  return { li, previewEl, chatId };
}

async function openChatMessages(chatId) {
  const selectedSpaceInput = document.querySelector(
    'input[name="space"]:checked'
  );
  if (!selectedSpaceInput || !chatId) {
    return;
  }

  const spaceId = selectedSpaceInput.value;
  const token = beginOpenChatMessages();

  try {
    const messages = await fetchChatMessages(spaceId, chatId, 10);
    if (!isOpenChatMessagesCurrent(token)) {
      return;
    }
    renderOpenChatMessages(messages);
  } catch (error) {
    console.error(`Could not load messages for chat ${chatId}:`, error);
    if (!isOpenChatMessagesCurrent(token)) {
      return;
    }
    renderOpenChatMessagesError("Could not load messages.");
  }
}

export function populateChatsList(chats) {
  const chatsList = document.getElementById("chats-list");
  const chatsEmpty = document.getElementById("chats-empty");
  if (!chatsList) {
    console.warn("Chats list element not found.");
    return [];
  }

  chatsList.replaceChildren();

  if (chats.length === 0) {
    if (chatsEmpty) {
      restoreChatsEmptyContent(chatsEmpty);
      chatsEmpty.hidden = false;
    }
    return [];
  }

  if (chatsEmpty) {
    chatsEmpty.hidden = true;
  }

  const rows = chats.map((chat) => {
    const row = createChatListItem(chat);
    const { li } = row;
    chatsList.appendChild(li);
    return row;
  });

  return rows;
}

function isStillCurrentSpace(spaceId, token) {
  if (token !== loadToken) {
    return false;
  }

  const stillSelected = document.querySelector('input[name="space"]:checked');
  
  return Boolean(stillSelected && stillSelected.value === spaceId);
}

async function loadChatPreviews(spaceId, rows, token) {
  for (const row of rows) {
    if (!isStillCurrentSpace(spaceId, token)) {
      return;
    }

    if (!row.chatId) {
      continue;
    }

    try {
      const messages = await fetchChatMessages(spaceId, row.chatId, 1);
      if (!isStillCurrentSpace(spaceId, token)) {
        return;
      }

      const latestMessage =
        Array.isArray(messages) && messages.length > 0 ? messages[0] : null;
      row.previewEl.textContent = latestMessage
        ? formatMessagePreview(latestMessage)
        : "";
    } catch (error) {
      console.error(`Could not load latest message for chat ${row.chatId}:`, error);
      row.previewEl.textContent = "";
    }
  }
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

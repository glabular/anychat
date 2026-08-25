import { fetchChats } from "./api.js";

function setChatsLoading(isLoading) {
  const chatsLoading = document.getElementById("chats-loading");
  const chatsEmpty = document.getElementById("chats-empty");
  const chatsList = document.getElementById("chats-list");

  if (chatsLoading) {
    chatsLoading.hidden = !isLoading;
  }

  if (isLoading) {
    if (chatsEmpty) {
      chatsEmpty.hidden = true;
    }
    chatsList?.replaceChildren();
  }

  chatsList?.setAttribute("aria-busy", isLoading ? "true" : "false");
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
  setChatsLoading(true);

  const chats = await fetchChats(spaceId);

  // Debug: artificial delay to make the loading indicator visible.
  await new Promise((resolve) => setTimeout(resolve, 2000));

  const stillSelected = document.querySelector('input[name="space"]:checked');
  if (!stillSelected || stillSelected.value !== spaceId) {
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

  setChatsLoading(false);
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

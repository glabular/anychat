import {
  closeCreateChatModal,
  initCreateChatModal,
  isCreateChatModalOpen,
  openCreateChatModal,
} from "./create-chat-modal.js";

function getCreateChatButton() {
  return document.getElementById("chats-create");
}

function hasSelectedSpace() {
  return Boolean(document.querySelector('input[name="space"]:checked'));
}

/** Enable the + FAB only while a space is selected. */
export function syncChatsCreateButton() {
  const button = getCreateChatButton();
  if (!button) {
    return;
  }

  button.disabled = !hasSelectedSpace();
}

/** One-time wiring for the create-chat FAB. */
export function initChatsCreateButton() {
  const button = getCreateChatButton();
  if (!button) {
    return;
  }

  initCreateChatModal();

  button.addEventListener("click", () => {
    if (button.disabled) {
      return;
    }
    openCreateChatModal();
  });

  syncChatsCreateButton();
}

export { closeCreateChatModal, isCreateChatModalOpen };

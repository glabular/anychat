import {
  closeCreateChatModal,
  initCreateChatModal,
  isCreateChatModalOpen,
  openCreateChatModal,
} from "./create-chat-modal.js";
import { isOneToOneSpaceObject } from "./space-members.js";

const ONE_TO_ONE_CREATE_TOOLTIP =
  "You can’t create a new chat in a personal one-to-one space.";

function getCreateChatButton() {
  return document.getElementById("chats-create");
}

function getCreateChatWrap() {
  return document.getElementById("chats-create-wrap");
}

function getSelectedSpaceInput() {
  return /** @type {HTMLInputElement | null} */ (
    document.querySelector('input[name="space"]:checked')
  );
}

/**
 * @returns {{ allowed: boolean, reason: "none" | "oneToOne" }}
 */
function getCreateChatAvailability() {
  const selected = getSelectedSpaceInput();
  if (!selected) {
    return { allowed: false, reason: "none" };
  }

  if (isOneToOneSpaceObject(selected.dataset.spaceObject ?? "")) {
    return { allowed: false, reason: "oneToOne" };
  }

  return { allowed: true, reason: "none" };
}

/** Enable the + FAB only while a non-1:1 space is selected. */
export function syncChatsCreateButton() {
  const button = getCreateChatButton();
  const wrap = getCreateChatWrap();
  if (!button) {
    return;
  }

  const { allowed, reason } = getCreateChatAvailability();
  button.disabled = !allowed;

  if (wrap) {
    if (reason === "oneToOne") {
      wrap.title = ONE_TO_ONE_CREATE_TOOLTIP;
      wrap.setAttribute("aria-label", ONE_TO_ONE_CREATE_TOOLTIP);
    } else {
      wrap.removeAttribute("title");
      wrap.removeAttribute("aria-label");
    }
  }

  if (reason === "oneToOne") {
    button.setAttribute("aria-label", ONE_TO_ONE_CREATE_TOOLTIP);
  } else {
    button.setAttribute("aria-label", "Create chat");
  }
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

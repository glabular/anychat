import {
  closeCreateChatModal,
  initCreateChatModal,
  isCreateChatModalOpen,
  openCreateChatModal,
} from "./create-chat-modal.js";
import { isOneToOneSpaceObject } from "./space-members.js";

const ONE_TO_ONE_CREATE_TOOLTIP =
  "You can’t create a new chat in a personal one-to-one space.";

/** True only after chats for the selected space have finished loading. */
let chatsCreateButtonReady = false;

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

/**
 * Show the + FAB only after chats load completes for a selected space.
 * @param {boolean} ready
 */
export function setChatsCreateButtonReady(ready) {
  chatsCreateButtonReady = ready;
  syncChatsCreateButton();
}

/**
 * Show/enable the + FAB: visible once chats are ready for a selected space;
 * enabled only while that space is non–1:1.
 */
export function syncChatsCreateButton() {
  const button = getCreateChatButton();
  const wrap = getCreateChatWrap();
  if (!button || !wrap) {
    return;
  }

  const selected = getSelectedSpaceInput();
  const { allowed, reason } = getCreateChatAvailability();
  const show = chatsCreateButtonReady && Boolean(selected);

  wrap.hidden = !show;
  button.disabled = !allowed;

  if (reason === "oneToOne") {
    wrap.title = ONE_TO_ONE_CREATE_TOOLTIP;
    wrap.setAttribute("aria-label", ONE_TO_ONE_CREATE_TOOLTIP);
    button.setAttribute("aria-label", ONE_TO_ONE_CREATE_TOOLTIP);
  } else {
    wrap.removeAttribute("title");
    wrap.removeAttribute("aria-label");
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
    if (button.disabled || wrapIsHidden()) {
      return;
    }
    openCreateChatModal();
  });

  syncChatsCreateButton();
}

function wrapIsHidden() {
  const wrap = getCreateChatWrap();
  return Boolean(wrap?.hidden);
}

export { closeCreateChatModal, isCreateChatModalOpen };

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
 * Mark whether chats for the selected space have finished loading.
 * Ready gates clicks only — never hide/dim the FAB across space switches.
 * @param {boolean} ready
 */
export function setChatsCreateButtonReady(ready) {
  chatsCreateButtonReady = ready;
  syncChatsCreateButton();
}

/**
 * Show/enable the + FAB: visible while a space is selected (stable across reloads).
 * While chats load, block interaction without dimming. Dim/disable only for 1:1.
 */
export function syncChatsCreateButton() {
  const button = getCreateChatButton();
  const wrap = getCreateChatWrap();
  if (!button || !wrap) {
    return;
  }

  const selected = getSelectedSpaceInput();
  const { allowed, reason } = getCreateChatAvailability();
  const show = Boolean(selected);
  const pending = show && !chatsCreateButtonReady;
  const oneToOne = reason === "oneToOne";

  wrap.hidden = !show;
  // Dimmed :disabled look is reserved for 1:1 — not for mid-reload pending.
  button.disabled = oneToOne;
  button.classList.toggle("chats-create--pending", pending);
  button.setAttribute(
    "aria-disabled",
    chatsCreateButtonReady && allowed ? "false" : "true"
  );

  if (oneToOne) {
    wrap.title = ONE_TO_ONE_CREATE_TOOLTIP;
    wrap.setAttribute("aria-label", ONE_TO_ONE_CREATE_TOOLTIP);
    button.setAttribute("aria-label", ONE_TO_ONE_CREATE_TOOLTIP);
  } else {
    wrap.removeAttribute("title");
    wrap.removeAttribute("aria-label");
    button.setAttribute("aria-label", "Create chat");
  }
}

function isCreateChatInteractive() {
  if (!chatsCreateButtonReady || wrapIsHidden()) {
    return false;
  }
  return getCreateChatAvailability().allowed;
}

/** One-time wiring for the create-chat FAB. */
export function initChatsCreateButton() {
  const button = getCreateChatButton();
  if (!button) {
    return;
  }

  initCreateChatModal();

  button.addEventListener("click", () => {
    if (!isCreateChatInteractive()) {
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

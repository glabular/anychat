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

/** One-time wiring for the create-chat FAB (modal in a later step). */
export function initChatsCreateButton() {
  const button = getCreateChatButton();
  if (!button) {
    return;
  }

  button.addEventListener("click", () => {
    if (button.disabled) {
      return;
    }
    // Step 4 wires the modal; stub keeps the control clickable for self-check.
    console.info("Create chat: modal not wired yet.");
  });

  syncChatsCreateButton();
}

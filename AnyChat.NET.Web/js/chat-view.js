/** Bumps when opening a chat or clearing the panel so stale fetches are ignored. */
let openChatToken = 0;

function clearChatMessages() {
  document.getElementById("chat-messages")?.replaceChildren();
}

/** Show the main chat panel header with the given chat name. */
export function showChatHeader(name) {
  const main = document.querySelector(".main");
  const panel = document.getElementById("chat-panel");
  const title = document.getElementById("chat-panel-title");
  const placeholder = document.getElementById("main-placeholder");

  if (title) {
    title.textContent = name;
  }
  if (panel) {
    panel.hidden = false;
  }
  if (placeholder) {
    placeholder.hidden = true;
  }
  main?.classList.add("main--chat-open");
}

/** Hide the chat panel and clear the title (e.g. when the space changes). */
export function hideChatPanel() {
  const main = document.querySelector(".main");
  const panel = document.getElementById("chat-panel");
  const title = document.getElementById("chat-panel-title");
  const placeholder = document.getElementById("main-placeholder");

  openChatToken += 1;
  clearChatMessages();

  if (title) {
    title.textContent = "";
  }
  if (panel) {
    panel.hidden = true;
  }
  if (placeholder) {
    placeholder.hidden = false;
  }
  main?.classList.remove("main--chat-open");
}

/**
 * Clears the messages area and returns a token for this open.
 * Ignore fetch results when the token no longer matches.
 */
export function beginOpenChatMessages() {
  const token = ++openChatToken;
  clearChatMessages();
  return token;
}

export function isOpenChatMessagesCurrent(token) {
  return token === openChatToken;
}

/** Primitive dump: one text node per message, API order, no styling. */
export function renderOpenChatMessages(messages) {
  const container = document.getElementById("chat-messages");
  if (!container) {
    return;
  }

  container.replaceChildren();

  if (!Array.isArray(messages) || messages.length === 0) {
    return;
  }

  for (const message of messages) {
    const line = document.createElement("div");
    line.textContent = message.content?.text ?? "";
    container.appendChild(line);
  }
}

export function renderOpenChatMessagesError(text) {
  const container = document.getElementById("chat-messages");
  if (!container) {
    return;
  }

  container.replaceChildren();
  const line = document.createElement("div");
  line.textContent = text;
  container.appendChild(line);
}

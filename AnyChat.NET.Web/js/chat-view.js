/** Bumps when opening a chat or clearing the panel so stale fetches are ignored. */
let openChatToken = 0;

function clearChatMessages() {
  document.getElementById("chat-messages")?.replaceChildren();
}

function isChatPanelOpen() {
  const panel = document.getElementById("chat-panel");
  return Boolean(panel && !panel.hidden);
}

function clearChatListSelection() {
  document
    .querySelector("#chats-list .chat-item--selected")
    ?.classList.remove("chat-item--selected");
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
 * Close the open chat panel and clear list selection.
 * @returns {boolean} true if a chat was open and is now closed
 */
export function closeOpenChat() {
  if (!isChatPanelOpen()) {
    return false;
  }

  hideChatPanel();
  clearChatListSelection();

  // Escape switches Chromium to keyboard modality, so :focus-visible would
  // draw a ring on the still-focused chat button (WebView2). Firefox often
  // does not. Blur removes that ring after close.
  const active = document.activeElement;
  if (active instanceof HTMLElement && active.classList.contains("chat-item")) {
    active.blur();
  }

  return true;
}

/** Escape and mouse Back (button 3) close the open chat. */
export function initChatViewCloseBindings() {
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") {
      return;
    }

    if (closeOpenChat()) {
      event.preventDefault();
    }
  });

  // Mouse X1 ("Back") is button 3. Prevent the browser from navigating away.
  document.addEventListener("mousedown", (event) => {
    if (event.button !== 3) {
      return;
    }

    if (!isChatPanelOpen()) {
      return;
    }

    event.preventDefault();
    closeOpenChat();
  });
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

/** Render text messages chronologically; align by isMine when known. */
export function renderOpenChatMessages(messages) {
  const container = document.getElementById("chat-messages");
  if (!container) {
    return;
  }

  container.replaceChildren();

  if (!Array.isArray(messages) || messages.length === 0) {
    return;
  }

  // Anytype already returns this window oldest → newest. Do not reverse.
  for (const message of messages) {
    const text = message.content?.text;
    if (typeof text !== "string" || text.length === 0) {
      continue;
    }

    const row = document.createElement("div");
    row.className = `message-row ${rowModifierClass(message.isMine)}`;

    const bubble = document.createElement("div");
    bubble.className = "message-bubble";
    bubble.textContent = text;

    row.appendChild(bubble);
    container.appendChild(row);
  }

  container.scrollTop = container.scrollHeight;
}

function rowModifierClass(isMine) {
  if (isMine === true) {
    return "message-row--mine";
  }

  if (isMine === false) {
    return "message-row--other";
  }

  return "message-row--neutral";
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

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

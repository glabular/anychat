const statusEl = document.getElementById("status");
const listEl = document.getElementById("chat-list");

async function loadChats() {
  try {
    // Relative URLs: page and API share the same origin (the ASP.NET host).
    const spacesRes = await fetch("/api/spaces");
    if (!spacesRes.ok) {
      throw new Error(`Spaces request failed (${spacesRes.status})`);
    }

    const spaces = await spacesRes.json();
    if (!spaces.length) {
      statusEl.textContent = "No spaces found.";
      return;
    }

    const space = spaces[0];
    const chatsRes = await fetch(`/api/spaces/${space.id}/chats`);
    if (!chatsRes.ok) {
      throw new Error(`Chats request failed (${chatsRes.status})`);
    }

    const chats = await chatsRes.json();
    statusEl.textContent = `${space.name}: ${chats.length} chat(s)`;

    listEl.replaceChildren();
    for (const chat of chats) {
      const li = document.createElement("li");
      li.textContent = chat.name || "(unnamed)";
      listEl.appendChild(li);
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    statusEl.textContent = `Could not load chats (${detail}).`;
    console.error(err);
  }
}

loadChats();

const statusEl = document.getElementById("status");
const listEl = document.getElementById("chat-list");
const spaceSelect = document.getElementById("space-select");

async function loadSpaces() {
  try {
    const spacesRes = await fetch("/api/spaces");
    if (!spacesRes.ok) {
      throw new Error(`Spaces request failed (${spacesRes.status})`);
    }

    const spaces = await spacesRes.json();
    spaceSelect.replaceChildren();

    if (!spaces.length) {
      const empty = document.createElement("option");
      empty.value = "";
      empty.textContent = "No spaces found";
      spaceSelect.appendChild(empty);
      statusEl.textContent = "No spaces found.";
      return;
    }

    for (const space of spaces) {
      const option = document.createElement("option");
      option.value = space.id;
      option.textContent = space.name || "(unnamed)";
      spaceSelect.appendChild(option);
    }

    spaceSelect.disabled = false;
    spaceSelect.selectedIndex = 0;
    await loadChats(spaceSelect.value);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    statusEl.textContent = `Could not load spaces (${detail}).`;
    console.error(err);
  }
}

async function loadChats(spaceId) {
  listEl.replaceChildren();

  if (!spaceId) {
    statusEl.textContent = "Select a space.";
    return;
  }

  try {
    statusEl.textContent = "Loading chats…";
    const chatsRes = await fetch(`/api/spaces/${spaceId}/chats`);
    if (!chatsRes.ok) {
      throw new Error(`Chats request failed (${chatsRes.status})`);
    }

    const chats = await chatsRes.json();
    const spaceName =
      spaceSelect.selectedOptions[0]?.textContent || "Space";
    statusEl.textContent = `${spaceName}: ${chats.length} chat(s)`;

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

spaceSelect.addEventListener("change", () => {
  loadChats(spaceSelect.value);
});

loadSpaces();

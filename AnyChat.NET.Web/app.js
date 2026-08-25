const SPACE_ROW_HEIGHT = 72;

const scrollEl = document.querySelector(".spaces-sidebar");
const upBtn = document.querySelector(".spaces-scroll--up");
const downBtn = document.querySelector(".spaces-scroll--down");

function updateScrollHints() {
  if (!scrollEl || !upBtn || !downBtn) {
    return;
  }

  const { scrollTop, clientHeight, scrollHeight } = scrollEl;
  upBtn.hidden = scrollTop <= 0;
  downBtn.hidden = scrollTop + clientHeight >= scrollHeight - 1;
}

scrollEl?.addEventListener("scroll", updateScrollHints);
window.addEventListener("resize", updateScrollHints);

upBtn?.addEventListener("click", () => {
  scrollEl?.scrollBy({ top: -SPACE_ROW_HEIGHT, behavior: "smooth" });
});

downBtn?.addEventListener("click", () => {
  scrollEl?.scrollBy({ top: SPACE_ROW_HEIGHT, behavior: "smooth" });
});

updateScrollHints();

const API_ORIGIN = "http://localhost:5249";

function spacesUrl() {
  // Same host as the API (WPF / browser on :5249): stay relative.
  // Live Server and other origins: call the API by absolute URL.
  const onApiHost =
    (window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1") &&
    window.location.port === "5249";

  return onApiHost ? "/api/spaces" : `${API_ORIGIN}/api/spaces`;
}

async function fetchSpaces() {
  try {
    const response = await fetch(spacesUrl());

    if (!response.ok) {
      throw new Error(`Response status: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error("Could not load spaces:", error);
    return [];
  }
}

function populateSpacesSidebar(spaces) {
  const spacesSidebar = document.getElementById("spaces-sidebar");

  spaces.forEach((space) => {
    const spaceButton = getSpaceButton(space);
    spacesSidebar.appendChild(spaceButton);
  });
  
  const chatsPlaceholder = document.getElementById("chats-placeholder");

  // TODO: Read previously selected space instead of taking the first.
  if (spaces.length > 0) {
    selectSpace(spaces[0].id);
  }
  
  if (chatsPlaceholder) {
    chatsPlaceholder.hidden = spaces.length > 0;
  }
}

function selectSpace(spaceId) {
  const spaceInput = document.querySelector(
    `input[name="space"][value="${spaceId}"]`
  );

  if (spaceInput) {
    spaceInput.checked = true;
  }
}

function getSpaceButton(space) {
  const label = document.createElement("label");
  const input = document.createElement("input");

  input.type = "radio";
  input.name = "space";
  input.value = space.id;

  const span = document.createElement("span");
  span.textContent = space.name?.[0] ?? "";

  label.appendChild(input);
  label.appendChild(span);
  
  return label;
}

async function initializeSpaces() {
  const loadingStartedAt = performance.now();
  console.log("Please, wait. Loading Spaces.");
  
  const spaces = await fetchSpaces();
  populateSpacesSidebar(spaces);

  const loading = document.getElementById("spaces-loading");
  if (loading) {
    loading.hidden = true;
  }
  document.getElementById("spaces-sidebar")?.setAttribute("aria-busy", "false");
  
  const loadingTimeMs = performance.now() - loadingStartedAt;  
  console.log(
    `Spaces loaded in ${loadingTimeMs.toFixed(2)} ms (${(loadingTimeMs / 1000).toFixed(2)} s).`
  );
}

initializeSpaces();

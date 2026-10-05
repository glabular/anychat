import { describeSpacesLoadError, fetchSpaces } from "./api.js";
import { orderSpaces, writeSpaceOrder } from "./space-order.js";
import { getSpaceDisplayName, populateSpacesSidebar } from "./spaces.js";

/** @type {Array<{ id: string, object?: string, icon?: unknown, displayName?: string, name?: string }>} */
let loadedSpaces = [];

function getList() {
  return document.getElementById("settings-sort-spaces-list");
}

function getStatus() {
  return document.getElementById("settings-sort-spaces-status");
}

/**
 * @param {string} text
 * @param {{ error?: boolean }} [options]
 */
function showStatus(text, options = {}) {
  const status = getStatus();
  if (!status) {
    return;
  }

  status.hidden = false;
  status.textContent = text;
  status.classList.toggle("settings-sort-spaces-status--error", !!options.error);
}

function hideStatus() {
  const status = getStatus();
  if (!status) {
    return;
  }

  status.hidden = true;
  status.textContent = "";
  status.classList.remove("settings-sort-spaces-status--error");
}

/**
 * Anytype icon is untyped JSON. Use a short emoji/text mark when it is a string.
 * @param {unknown} icon
 * @returns {string}
 */
function iconMark(icon) {
  if (typeof icon !== "string") {
    return "";
  }

  const trimmed = icon.trim();
  if (!trimmed || trimmed.length > 8 || /^https?:/i.test(trimmed)) {
    return "";
  }

  return trimmed;
}

/**
 * @param {Array<{ displayName?: string, name?: string }>} spaces
 * @param {{ displayName?: string, name?: string }} space
 */
function nameIsAmbiguous(spaces, space) {
  const name = getSpaceDisplayName(space);
  let count = 0;
  for (const item of spaces) {
    if (getSpaceDisplayName(item) === name) {
      count += 1;
      if (count > 1) {
        return true;
      }
    }
  }
  return false;
}

/**
 * @param {Array<{ id?: string, object?: string, icon?: unknown, displayName?: string, name?: string }>} spaces
 */
function renderSpaces(spaces) {
  const list = getList();
  if (!list) {
    return;
  }

  list.replaceChildren();

  for (const space of spaces) {
    if (!space?.id) {
      continue;
    }

    const item = document.createElement("li");
    item.className = "settings-sort-spaces-row";

    const mark = document.createElement("span");
    mark.className = "settings-sort-spaces-mark";
    mark.setAttribute("aria-hidden", "true");
    const icon = iconMark(space.icon);
    mark.textContent = icon || getSpaceDisplayName(space)[0]?.toLocaleUpperCase() || "#";

    const name = document.createElement("span");
    name.className = "settings-sort-spaces-name";
    name.textContent = getSpaceDisplayName(space);

    const actions = document.createElement("div");
    actions.className = "settings-sort-spaces-actions";

    const index = spaces.indexOf(space);
    actions.append(
      moveButton("up", index, spaces.length),
      moveButton("down", index, spaces.length),
    );

    if (nameIsAmbiguous(spaces, space) && space.object) {
      const kind = document.createElement("span");
      kind.className = "settings-sort-spaces-kind";
      kind.textContent = space.object;
      item.append(mark, name, kind, actions);
    } else {
      item.append(mark, name, actions);
    }

    list.append(item);
  }
}

/**
 * @param {"up" | "down"} direction
 * @param {number} index
 * @param {number} count
 */
function moveButton(direction, index, count) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "settings-sort-spaces-move";
  button.dataset.direction = direction;
  button.dataset.index = String(index);
  const up = direction === "up";
  button.textContent = up ? "↑" : "↓";
  button.setAttribute("aria-label", up ? "Move up" : "Move down");
  button.disabled = up ? index === 0 : index === count - 1;
  return button;
}

/**
 * @param {number} index
 * @param {number} delta
 */
function moveSpace(index, delta) {
  const next = index + delta;
  if (next < 0 || next >= loadedSpaces.length) {
    return;
  }

  const spaces = loadedSpaces.slice();
  const [moved] = spaces.splice(index, 1);
  spaces.splice(next, 0, moved);
  loadedSpaces = spaces;
  writeSpaceOrder(spaces.map((space) => space.id));
  renderSpaces(spaces);
  populateSpacesSidebar(spaces);

  const list = getList();
  const button = list?.querySelector(
    `.settings-sort-spaces-move[data-direction="${delta < 0 ? "up" : "down"}"][data-index="${next}"]`
  );
  if (button instanceof HTMLButtonElement && !button.disabled) {
    button.focus();
  }
}

function bindSortSpacesList() {
  const list = getList();
  if (!list || list.dataset.bound === "true") {
    return;
  }

  list.dataset.bound = "true";
  list.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) {
      return;
    }
    if (!target.classList.contains("settings-sort-spaces-move")) {
      return;
    }

    const index = Number(target.dataset.index);
    const delta = target.dataset.direction === "up" ? -1 : 1;
    if (!Number.isInteger(index)) {
      return;
    }

    moveSpace(index, delta);
  });
}

/** Load the current spaces into the Sort spaces pane. */
export async function loadSortSpacesList() {
  bindSortSpacesList();
  const list = getList();
  if (list) {
    list.replaceChildren();
  }

  showStatus("Loading spaces…");

  try {
    const spaces = await fetchSpaces();
    if (!Array.isArray(spaces)) {
      showStatus("Spaces response was invalid.", { error: true });
      return;
    }

    const usable = spaces.filter((space) => space && typeof space.id === "string");
    if (usable.length === 0) {
      showStatus("No spaces yet.");
      return;
    }

    hideStatus();
    loadedSpaces = orderSpaces(usable);
    renderSpaces(loadedSpaces);
  } catch (error) {
    console.error("Could not load spaces for settings:", error);
    showStatus(describeSpacesLoadError(error), { error: true });
  }
}

import {
  describeSpacesLoadError,
  fetchChats,
  fetchSpaces,
  renameSpace,
} from "./api.js";
import { isOneToOneSpaceObject } from "./space-members.js";
import { orderSpaces, writeSpaceOrder } from "./space-order.js";
import {
  filterVisibleSpaces,
  hideSpaceIds,
  isSpaceHidden,
  setSpaceVisible,
  unhideAllSpaces,
} from "./space-visibility.js";
import {
  getSpaceDisplayName,
  populateSpacesSidebar,
  updateSpaceLabel,
} from "./spaces.js";

/** Wait before showing a loading label. */
const LOADING_STATUS_DELAY_MS = 10;

/** Keep the hide-chatless spinner visible at least this long. */
const HIDE_CHATLESS_SPINNER_MIN_MS = 400;

/** Match `.settings-sort-spaces-bulk-spinner` width transition. */
const HIDE_CHATLESS_WIDTH_MS = 230;

const ONE_TO_ONE_RENAME_TOOLTIP =
  "You can’t rename a personal one-to-one space.";

const LAST_VISIBLE_TOOLTIP = "Keep at least one space in the rail.";

/** @type {Array<{ id: string, object?: string, icon?: unknown, displayName?: string, name?: string }>} */
let loadedSpaces = [];

/** @type {ReturnType<typeof setTimeout> | null} */
let loadingStatusTimer = null;

/** Bumps when a new load starts so a late fetch cannot overwrite a newer one. */
let loadGeneration = 0;

/** Bumps when a hide-chatless scan starts so a late scan cannot apply. */
let hideChatlessGeneration = 0;

let hideChatlessInFlight = false;

/** @type {string | null} */
let editingSpaceId = null;
/** @type {string} */
let renameInitialValue = "";
let renameSaveInFlight = false;
let renameSaveToken = 0;

function getList() {
  return document.getElementById("settings-sort-spaces-list");
}

function getStatus() {
  return document.getElementById("settings-sort-spaces-status");
}

function getHideChatlessButton() {
  return document.getElementById("settings-sort-spaces-hide-chatless");
}

function getUnhideAllButton() {
  return document.getElementById("settings-sort-spaces-unhide-all");
}

/**
 * Expand/collapse the spinner slot. Stays disabled until collapse finishes.
 * @param {boolean} busy
 * @returns {Promise<void>}
 */
async function setHideChatlessBusy(busy) {
  const button = getHideChatlessButton();
  if (!(button instanceof HTMLButtonElement)) {
    return;
  }

  if (busy) {
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    button.classList.add("settings-sort-spaces-bulk-button--busy");
    return;
  }

  button.classList.remove("settings-sort-spaces-bulk-button--busy");
  button.setAttribute("aria-busy", "false");

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)")
    .matches;
  if (!reduceMotion && HIDE_CHATLESS_WIDTH_MS > 0) {
    await new Promise((resolve) =>
      setTimeout(resolve, HIDE_CHATLESS_WIDTH_MS)
    );
  }

  button.disabled = false;
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

function clearLoadingStatusTimer() {
  if (loadingStatusTimer !== null) {
    clearTimeout(loadingStatusTimer);
    loadingStatusTimer = null;
  }
}

/**
 * @param {boolean} busy
 */
function setListBusy(busy) {
  getList()?.setAttribute("aria-busy", busy ? "true" : "false");
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
 * @param {unknown} error
 */
function describeRenameError(error) {
  const status = error && typeof error === "object" ? error.status : undefined;

  if (status === 503) {
    return "Lost connection to Anytype. Open the official Anytype app and try again.";
  }

  if (status === 400) {
    return "Space name is required.";
  }

  if (typeof status === "number") {
    return `Could not rename space (HTTP ${status}).`;
  }

  if (error instanceof TypeError) {
    return "Cannot reach the API.";
  }

  return "Could not rename space.";
}

/**
 * @param {HTMLElement} row
 * @param {string} message
 */
function showRowError(row, message) {
  let errorEl = row.querySelector(".settings-sort-spaces-error");
  if (!(errorEl instanceof HTMLElement)) {
    errorEl = document.createElement("p");
    errorEl.className = "settings-sort-spaces-error";
    errorEl.setAttribute("role", "alert");
    row.append(errorEl);
  }
  errorEl.hidden = false;
  errorEl.textContent = message;
}

/**
 * @param {HTMLElement} row
 */
function clearRowError(row) {
  const errorEl = row.querySelector(".settings-sort-spaces-error");
  if (errorEl instanceof HTMLElement) {
    errorEl.hidden = true;
    errorEl.textContent = "";
  }
}

/**
 * @param {string} spaceId
 */
function getRow(spaceId) {
  return /** @type {HTMLElement | null} */ (
    getList()?.querySelector(
      `.settings-sort-spaces-row[data-space-id="${CSS.escape(spaceId)}"]`
    )
  );
}

function cancelRename({ restoreFocus = true } = {}) {
  const spaceId = editingSpaceId;
  editingSpaceId = null;
  renameSaveInFlight = false;
  renameSaveToken += 1;
  renameInitialValue = "";

  if (!spaceId) {
    return;
  }

  renderSpaces(loadedSpaces);

  if (restoreFocus) {
    const button = getRow(spaceId)?.querySelector(
      ".settings-sort-spaces-rename"
    );
    if (button instanceof HTMLButtonElement) {
      button.focus();
    }
  }
}

/**
 * @param {string} spaceId
 */
function beginRename(spaceId) {
  if (renameSaveInFlight) {
    return;
  }

  const space = loadedSpaces.find((item) => item.id === spaceId);
  if (!space || isOneToOneSpaceObject(space.object)) {
    return;
  }

  if (editingSpaceId && editingSpaceId !== spaceId) {
    cancelRename({ restoreFocus: false });
  }

  editingSpaceId = spaceId;
  renameInitialValue =
    typeof space.name === "string" ? space.name.trim() : "";

  renderSpaces(loadedSpaces);

  const row = getRow(spaceId);
  const input = row?.querySelector(".settings-sort-spaces-name-input");
  if (input instanceof HTMLInputElement) {
    input.focus();
    input.select();
  }
}

/**
 * @param {string} spaceId
 */
async function saveRename(spaceId) {
  if (editingSpaceId !== spaceId || renameSaveInFlight) {
    return;
  }

  const row = getRow(spaceId);
  const input = row?.querySelector(".settings-sort-spaces-name-input");
  if (!(row instanceof HTMLElement) || !(input instanceof HTMLInputElement)) {
    cancelRename({ restoreFocus: false });
    return;
  }

  const nextRaw = input.value;
  const trimmed = nextRaw.trim();

  if (trimmed === renameInitialValue.trim()) {
    cancelRename({ restoreFocus: true });
    return;
  }

  if (trimmed.length === 0) {
    showRowError(row, "Space name is required.");
    input.focus();
    return;
  }

  renameSaveInFlight = true;
  clearRowError(row);
  input.disabled = true;
  const token = ++renameSaveToken;

  try {
    const updated = await renameSpace(spaceId, trimmed);
    if (token !== renameSaveToken) {
      return;
    }

    const index = loadedSpaces.findIndex((space) => space.id === spaceId);
    if (index >= 0) {
      loadedSpaces[index] = {
        ...loadedSpaces[index],
        ...updated,
        id: spaceId,
      };
    }

    editingSpaceId = null;
    renameSaveInFlight = false;
    renameInitialValue = "";
    renderSpaces(loadedSpaces);
    updateSpaceLabel(loadedSpaces[index] ?? updated);

    const button = getRow(spaceId)?.querySelector(
      ".settings-sort-spaces-rename"
    );
    if (button instanceof HTMLButtonElement) {
      button.focus();
    }
  } catch (error) {
    if (token !== renameSaveToken) {
      return;
    }

    console.error("Could not rename space:", error);
    renameSaveInFlight = false;
    input.disabled = false;
    showRowError(row, describeRenameError(error));
    input.focus();
  }
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

  const visibleCount = filterVisibleSpaces(spaces).length;

  for (const space of spaces) {
    if (!space?.id) {
      continue;
    }

    const item = document.createElement("li");
    item.className = "settings-sort-spaces-row";
    item.dataset.spaceId = space.id;
    if (editingSpaceId === space.id) {
      item.classList.add("settings-sort-spaces-row--editing");
    }
    if (isSpaceHidden(space.id)) {
      item.classList.add("settings-sort-spaces-row--hidden");
    }

    const spaceIsVisible = !isSpaceHidden(space.id);
    const lastVisible = spaceIsVisible && visibleCount <= 1;

    const visibleWrap = document.createElement("span");
    visibleWrap.className = "settings-sort-spaces-visible-wrap";

    const visible = document.createElement("input");
    visible.type = "checkbox";
    visible.className = "settings-sort-spaces-visible";
    visible.checked = spaceIsVisible;
    visible.dataset.spaceId = space.id;
    visible.setAttribute(
      "aria-label",
      lastVisible ? LAST_VISIBLE_TOOLTIP : "Show in spaces rail"
    );

    const visibleTip = document.createElement("span");
    visibleTip.className = "settings-sort-spaces-visible-tooltip";
    visibleTip.setAttribute("aria-hidden", "true");
    visibleTip.hidden = true;

    if (lastVisible) {
      visible.disabled = true;
      visibleTip.textContent = LAST_VISIBLE_TOOLTIP;
      visibleTip.hidden = false;
    }

    visibleWrap.append(visible, visibleTip);

    const mark = document.createElement("span");
    mark.className = "settings-sort-spaces-mark";
    mark.setAttribute("aria-hidden", "true");
    const icon = iconMark(space.icon);
    mark.textContent = icon || getSpaceDisplayName(space)[0]?.toLocaleUpperCase() || "#";

    const nameWrap = document.createElement("div");
    nameWrap.className = "settings-sort-spaces-name-wrap";

    if (editingSpaceId === space.id) {
      const input = document.createElement("input");
      input.type = "text";
      input.className = "settings-sort-spaces-name-input";
      input.value = renameInitialValue;
      input.maxLength = 200;
      input.autocomplete = "off";
      input.spellcheck = false;
      input.setAttribute("aria-label", "Space name");
      input.disabled = renameSaveInFlight;
      nameWrap.append(input);
    } else {
      const name = document.createElement("span");
      name.className = "settings-sort-spaces-name";
      name.textContent = getSpaceDisplayName(space);
      nameWrap.append(name);
    }

    const actions = document.createElement("div");
    actions.className = "settings-sort-spaces-actions";

    const index = spaces.indexOf(space);
    const up = moveButton("up", index, spaces.length);
    const down = moveButton("down", index, spaces.length);
    const renameWrap = renameControl(space);
    const rename = renameWrap.querySelector(".settings-sort-spaces-rename");
    if (editingSpaceId === space.id && rename instanceof HTMLButtonElement) {
      up.disabled = true;
      down.disabled = true;
      rename.disabled = true;
    }
    actions.append(renameWrap, up, down);

    if (nameIsAmbiguous(spaces, space) && space.object) {
      const kind = document.createElement("span");
      kind.className = "settings-sort-spaces-kind";
      kind.textContent = space.object;
      item.append(visibleWrap, mark, nameWrap, kind, actions);
    } else {
      item.append(visibleWrap, mark, nameWrap, actions);
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
 * Center a tip on its control in viewport coords so pane overflow cannot clip it.
 * @param {HTMLElement} wrap
 * @param {string} controlSelector
 * @param {string} tipSelector
 */
function positionFixedTooltip(wrap, controlSelector, tipSelector) {
  const control = wrap.querySelector(controlSelector);
  const tip = wrap.querySelector(tipSelector);
  if (!(control instanceof HTMLElement) || !(tip instanceof HTMLElement) || tip.hidden) {
    return;
  }

  const rect = control.getBoundingClientRect();
  tip.style.left = `${rect.left + rect.width / 2}px`;
  tip.style.top = `${rect.top}px`;
  tip.style.transform = "translate(-50%, calc(-100% - 0.4rem))";
}

function positionRenameTooltip(wrap) {
  positionFixedTooltip(
    wrap,
    ".settings-sort-spaces-rename",
    ".settings-sort-spaces-rename-tooltip"
  );
}

function positionVisibleTooltip(wrap) {
  positionFixedTooltip(
    wrap,
    ".settings-sort-spaces-visible",
    ".settings-sort-spaces-visible-tooltip"
  );
}

function positionBulkTooltip(wrap) {
  positionFixedTooltip(
    wrap,
    ".settings-sort-spaces-bulk-button",
    ".settings-sort-spaces-bulk-tooltip"
  );
}

function repositionHoveredTooltips() {
  const renameWrap = document.querySelector(
    ".settings-sort-spaces-rename-wrap:hover, .settings-sort-spaces-rename-wrap:focus-within"
  );
  if (renameWrap instanceof HTMLElement) {
    positionRenameTooltip(renameWrap);
  }

  const visibleWrap = document.querySelector(
    ".settings-sort-spaces-visible-wrap:hover, .settings-sort-spaces-visible-wrap:focus-within"
  );
  if (visibleWrap instanceof HTMLElement) {
    positionVisibleTooltip(visibleWrap);
  }

  const bulkWrap = document.querySelector(
    ".settings-sort-spaces-bulk-wrap:hover, .settings-sort-spaces-bulk-wrap:focus-within"
  );
  if (bulkWrap instanceof HTMLElement) {
    positionBulkTooltip(bulkWrap);
  }
}

/**
 * @param {{ id: string, object?: string }} space
 */
function renameControl(space) {
  const wrap = document.createElement("span");
  wrap.className = "settings-sort-spaces-rename-wrap";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "settings-sort-spaces-rename";
  button.dataset.spaceId = space.id;
  button.textContent = "Rename";

  // Never use native title — browser chrome breaks the dark UI.
  const tooltip = document.createElement("span");
  tooltip.className = "settings-sort-spaces-rename-tooltip";
  tooltip.setAttribute("aria-hidden", "true");
  tooltip.hidden = true;

  if (isOneToOneSpaceObject(space.object)) {
    button.disabled = true;
    button.setAttribute("aria-label", ONE_TO_ONE_RENAME_TOOLTIP);
    wrap.setAttribute("aria-label", ONE_TO_ONE_RENAME_TOOLTIP);
    tooltip.textContent = ONE_TO_ONE_RENAME_TOOLTIP;
    tooltip.hidden = false;
  } else {
    button.setAttribute("aria-label", "Rename space");
  }

  wrap.append(button, tooltip);
  return wrap;
}

/**
 * @param {number} index
 * @param {number} delta
 */
function moveSpace(index, delta) {
  if (editingSpaceId || renameSaveInFlight) {
    return;
  }

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

/**
 * Probe visible spaces for empty chat lists, then hide those (floor: ≥1 visible).
 */
async function hideChatlessSpaces() {
  if (hideChatlessInFlight || loadedSpaces.length === 0) {
    return;
  }

  const visible = loadedSpaces.filter(
    (space) => space?.id && !isSpaceHidden(space.id)
  );
  if (visible.length === 0) {
    return;
  }

  const scanGeneration = ++hideChatlessGeneration;
  const loadAtStart = loadGeneration;
  hideChatlessInFlight = true;
  const busyStartedAt = Date.now();
  setHideChatlessBusy(true);
  hideStatus();

  /** @type {string[]} */
  const chatlessIds = [];
  let probeFailures = 0;

  try {
    for (const space of visible) {
      if (
        scanGeneration !== hideChatlessGeneration ||
        loadAtStart !== loadGeneration
      ) {
        return;
      }

      try {
        const chats = await fetchChats(space.id);
        if (!Array.isArray(chats) || chats.length === 0) {
          chatlessIds.push(space.id);
        }
      } catch (error) {
        probeFailures += 1;
        console.error("Could not probe chats for space:", space.id, error);
      }
    }

    if (
      scanGeneration !== hideChatlessGeneration ||
      loadAtStart !== loadGeneration
    ) {
      return;
    }

    // Spaces that stay visible without being in chatlessIds (have chats or probe failed).
    const otherVisible = visible.length - chatlessIds.length;
    let toHide = chatlessIds;
    if (otherVisible < 1 && toHide.length > 0) {
      // Keep one chatless space so the rail is never empty.
      toHide = toHide.slice(0, -1);
    }

    // Hold results until the spinner has been busy at least the minimum time,
    // then apply while still busy so the list updates as work "finishes".
    const remaining =
      HIDE_CHATLESS_SPINNER_MIN_MS - (Date.now() - busyStartedAt);
    if (remaining > 0) {
      await new Promise((resolve) => setTimeout(resolve, remaining));
    }

    if (
      scanGeneration !== hideChatlessGeneration ||
      loadAtStart !== loadGeneration
    ) {
      return;
    }

    if (toHide.length > 0) {
      hideSpaceIds(toHide);
      renderSpaces(loadedSpaces);
      populateSpacesSidebar(loadedSpaces);
    }

    if (probeFailures > 0) {
      showStatus(
        probeFailures === 1
          ? "Could not check chats for 1 space; it was left unchanged."
          : `Could not check chats for ${probeFailures} spaces; they were left unchanged.`,
        { error: true }
      );
    } else {
      hideStatus();
    }
  } finally {
    if (scanGeneration === hideChatlessGeneration) {
      await setHideChatlessBusy(false);
      hideChatlessInFlight = false;
    }
  }
}

function unhideAllVisibleSpaces() {
  if (hideChatlessInFlight) {
    return;
  }

  unhideAllSpaces();
  renderSpaces(loadedSpaces);
  populateSpacesSidebar(loadedSpaces);
  hideStatus();
}

function bindBulkVisibilityActions() {
  const actions = document.querySelector(".settings-sort-spaces-bulk-actions");
  if (actions instanceof HTMLElement && actions.dataset.tooltipsBound !== "true") {
    actions.dataset.tooltipsBound = "true";
    actions.addEventListener("mouseover", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      const wrap = target.closest(".settings-sort-spaces-bulk-wrap");
      if (!(wrap instanceof HTMLElement) || !actions.contains(wrap)) {
        return;
      }
      const related = event.relatedTarget;
      if (!(related instanceof Node && wrap.contains(related))) {
        positionBulkTooltip(wrap);
      }
    });
  }

  const hideButton = getHideChatlessButton();
  if (hideButton instanceof HTMLButtonElement && hideButton.dataset.bound !== "true") {
    hideButton.dataset.bound = "true";
    hideButton.addEventListener("click", () => {
      // Drop focus so :focus-within does not pin the tip after the pointer leaves.
      hideButton.blur();
      void hideChatlessSpaces();
    });
  }

  const unhideButton = getUnhideAllButton();
  if (
    unhideButton instanceof HTMLButtonElement &&
    unhideButton.dataset.bound !== "true"
  ) {
    unhideButton.dataset.bound = "true";
    unhideButton.addEventListener("click", () => {
      unhideAllVisibleSpaces();
      // Drop focus so :focus-within does not pin the tip after the pointer leaves.
      unhideButton.blur();
    });
  }
}

function bindSortSpacesList() {
  bindBulkVisibilityActions();

  const list = getList();
  if (!list || list.dataset.bound === "true") {
    return;
  }

  list.dataset.bound = "true";

  list.addEventListener("mouseover", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const renameWrap = target.closest(".settings-sort-spaces-rename-wrap");
    if (renameWrap instanceof HTMLElement && list.contains(renameWrap)) {
      const related = event.relatedTarget;
      if (!(related instanceof Node && renameWrap.contains(related))) {
        positionRenameTooltip(renameWrap);
      }
    }
    const visibleWrap = target.closest(".settings-sort-spaces-visible-wrap");
    if (visibleWrap instanceof HTMLElement && list.contains(visibleWrap)) {
      const related = event.relatedTarget;
      if (!(related instanceof Node && visibleWrap.contains(related))) {
        positionVisibleTooltip(visibleWrap);
      }
    }
  });

  const detail = document.getElementById("settings-detail-sort-spaces");
  detail?.addEventListener("scroll", repositionHoveredTooltips, {
    passive: true,
  });
  window.addEventListener("resize", repositionHoveredTooltips);

  list.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    const rename = target.closest(".settings-sort-spaces-rename");
    if (rename instanceof HTMLButtonElement && list.contains(rename)) {
      const spaceId = rename.dataset.spaceId;
      if (spaceId) {
        beginRename(spaceId);
      }
      return;
    }

    const move = target.closest(".settings-sort-spaces-move");
    if (move instanceof HTMLButtonElement && list.contains(move)) {
      const index = Number(move.dataset.index);
      const delta = move.dataset.direction === "up" ? -1 : 1;
      if (!Number.isInteger(index)) {
        return;
      }
      moveSpace(index, delta);
    }
  });

  list.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) {
      return;
    }
    if (!target.classList.contains("settings-sort-spaces-visible")) {
      return;
    }
    if (!list.contains(target)) {
      return;
    }

    const spaceId = target.dataset.spaceId;
    if (!spaceId) {
      return;
    }

    if (!target.checked && filterVisibleSpaces(loadedSpaces).length <= 1) {
      target.checked = true;
      return;
    }

    setSpaceVisible(spaceId, target.checked);
    renderSpaces(loadedSpaces);
    populateSpacesSidebar(loadedSpaces);
  });

  list.addEventListener("keydown", (event) => {
    if (!(event.target instanceof HTMLInputElement)) {
      return;
    }
    if (!event.target.classList.contains("settings-sort-spaces-name-input")) {
      return;
    }

    const row = event.target.closest(".settings-sort-spaces-row");
    const spaceId = row instanceof HTMLElement ? row.dataset.spaceId : "";
    if (!spaceId) {
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      void saveRename(spaceId);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      cancelRename({ restoreFocus: true });
    }
  });

  list.addEventListener("focusout", (event) => {
    if (!(event.target instanceof HTMLInputElement)) {
      return;
    }
    if (!event.target.classList.contains("settings-sort-spaces-name-input")) {
      return;
    }

    const row = event.target.closest(".settings-sort-spaces-row");
    const spaceId = row instanceof HTMLElement ? row.dataset.spaceId : "";
    if (!spaceId || editingSpaceId !== spaceId || renameSaveInFlight) {
      return;
    }

    const next = event.relatedTarget;
    if (next instanceof Node && row?.contains(next)) {
      return;
    }

    // Defer so a click on another control can run first.
    queueMicrotask(() => {
      if (editingSpaceId === spaceId && !renameSaveInFlight) {
        void saveRename(spaceId);
      }
    });
  });
}

/** Load the current spaces into the Sort spaces pane. */
export async function loadSortSpacesList() {
  bindSortSpacesList();

  const generation = ++loadGeneration;
  clearLoadingStatusTimer();
  setListBusy(true);

  // Keep any previous rows; only clear when there is nothing to show yet.
  if (loadedSpaces.length === 0) {
    getList()?.replaceChildren();
    hideStatus();
    loadingStatusTimer = setTimeout(() => {
      loadingStatusTimer = null;
      if (generation === loadGeneration) {
        showStatus("Loading spaces…");
      }
    }, LOADING_STATUS_DELAY_MS);
  }

  try {
    const spaces = await fetchSpaces();
    if (generation !== loadGeneration) {
      return;
    }

    clearLoadingStatusTimer();

    if (!Array.isArray(spaces)) {
      showStatus("Spaces response was invalid.", { error: true });
      return;
    }

    const usable = spaces.filter((space) => space && typeof space.id === "string");
    if (usable.length === 0) {
      loadedSpaces = [];
      editingSpaceId = null;
      getList()?.replaceChildren();
      showStatus("No spaces yet.");
      return;
    }

    hideStatus();
    // Drop edit mode on a full reload so the list matches the server.
    editingSpaceId = null;
    renameSaveInFlight = false;
    loadedSpaces = orderSpaces(usable);
    renderSpaces(loadedSpaces);
  } catch (error) {
    if (generation !== loadGeneration) {
      return;
    }

    clearLoadingStatusTimer();
    console.error("Could not load spaces for settings:", error);
    showStatus(describeSpacesLoadError(error), { error: true });
  } finally {
    if (generation === loadGeneration) {
      setListBusy(false);
    }
  }
}

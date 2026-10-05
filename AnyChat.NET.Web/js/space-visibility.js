const HIDDEN_SPACES_STORAGE_KEY = "anychat.hiddenSpaceIds";

/**
 * @returns {string[]}
 */
export function readHiddenSpaceIds() {
  try {
    const raw = localStorage.getItem(HIDDEN_SPACES_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((id) => typeof id === "string" && id.length > 0);
  } catch {
    return [];
  }
}

/**
 * @param {string[]} ids
 */
function writeHiddenSpaceIds(ids) {
  try {
    localStorage.setItem(HIDDEN_SPACES_STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // non-fatal; UI still updates until reload
  }
}

/**
 * @param {string} spaceId
 * @returns {boolean}
 */
export function isSpaceHidden(spaceId) {
  if (!spaceId) {
    return false;
  }
  return readHiddenSpaceIds().includes(spaceId);
}

/**
 * @param {string} spaceId
 * @param {boolean} visible
 */
export function setSpaceVisible(spaceId, visible) {
  if (!spaceId) {
    return;
  }

  const next = new Set(readHiddenSpaceIds());
  if (visible) {
    next.delete(spaceId);
  } else {
    next.add(spaceId);
  }
  writeHiddenSpaceIds([...next]);
}

/**
 * Drop spaces the user hid from the rail. Order is preserved.
 * @param {Array<{ id?: string }>} spaces
 */
export function filterVisibleSpaces(spaces) {
  const hidden = new Set(readHiddenSpaceIds());
  if (hidden.size === 0) {
    return spaces;
  }

  return spaces.filter((space) => space?.id && !hidden.has(space.id));
}

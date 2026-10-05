const SPACE_ORDER_STORAGE_KEY = "anychat.spaceOrder";

/**
 * @returns {string[] | null} Saved ids, or null when the user has not sorted.
 */
export function readSpaceOrder() {
  try {
    const raw = localStorage.getItem(SPACE_ORDER_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return null;
    }

    return parsed.filter((id) => typeof id === "string" && id.length > 0);
  } catch {
    return null;
  }
}

/**
 * @param {string[]} ids
 */
export function writeSpaceOrder(ids) {
  try {
    localStorage.setItem(SPACE_ORDER_STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // non-fatal; the list still shows the move until reload
  }
}

/**
 * Apply a saved id list. Unknown spaces stay in API order at the end.
 * No saved list leaves the array unchanged.
 * @param {Array<{ id?: string }>} spaces
 */
export function orderSpaces(spaces) {
  const stored = readSpaceOrder();
  if (!stored || stored.length === 0) {
    return spaces;
  }

  const byId = new Map();
  for (const space of spaces) {
    if (space?.id && !byId.has(space.id)) {
      byId.set(space.id, space);
    }
  }

  const ordered = [];
  const seen = new Set();
  for (const id of stored) {
    const space = byId.get(id);
    if (space) {
      ordered.push(space);
      seen.add(id);
    }
  }

  for (const space of spaces) {
    if (space?.id && !seen.has(space.id)) {
      ordered.push(space);
      seen.add(space.id);
    }
  }

  return ordered;
}

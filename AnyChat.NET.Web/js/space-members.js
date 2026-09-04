import { fetchSpaceMember } from "./api.js";

/** Space object value that enables message author profiles. */
export const REGULAR_SPACE_OBJECT = "anytype.space";

/**
 * Cached members keyed by spaceId → participantId.
 * A null value means we already looked the id up and it was missing.
 * @type {Map<string, Map<string, object | null>>}
 */
const membersBySpaceId = new Map();

/** @type {Map<string, Promise<object | null>>} */
const inflightMemberFetches = new Map();

/**
 * @param {string | null | undefined} spaceObject
 * @returns {boolean}
 */
export function isRegularSpaceObject(spaceObject) {
  return spaceObject === REGULAR_SPACE_OBJECT;
}

/**
 * @returns {{
 *   spaceId: string,
 *   object: string,
 *   gatewayUrl: string,
 * } | null}
 */
export function getSelectedSpaceMeta() {
  const input = document.querySelector('input[name="space"]:checked');
  if (!(input instanceof HTMLInputElement) || !input.value) {
    return null;
  }

  return {
    spaceId: input.value,
    object: input.dataset.spaceObject ?? "",
    gatewayUrl: input.dataset.gatewayUrl ?? "",
  };
}

/**
 * @param {string} spaceId
 * @returns {Map<string, object | null>}
 */
function getOrCreateMemberMap(spaceId) {
  let map = membersBySpaceId.get(spaceId);
  if (!map) {
    map = new Map();
    membersBySpaceId.set(spaceId, map);
  }
  return map;
}

/**
 * @param {string} spaceId
 * @param {string} memberId
 */
function memberInflightKey(spaceId, memberId) {
  return JSON.stringify([spaceId, memberId]);
}

/**
 * Fetch one member by participant id and store it in the per-space cache.
 * @param {string} spaceId
 * @param {string} memberId
 * @returns {Promise<object | null>}
 */
async function loadMemberById(spaceId, memberId) {
  const map = getOrCreateMemberMap(spaceId);
  if (map.has(memberId)) {
    return map.get(memberId) ?? null;
  }

  const inflightKey = memberInflightKey(spaceId, memberId);
  const inflight = inflightMemberFetches.get(inflightKey);
  if (inflight) {
    return inflight;
  }

  const loadPromise = fetchSpaceMember(spaceId, memberId)
    .then((member) => {
      if (member && typeof member.id === "string" && member.id.trim()) {
        map.set(member.id.trim(), member);
        if (member.id.trim() !== memberId) {
          map.set(memberId, member);
        }
        return member;
      }

      map.set(memberId, null);
      return null;
    })
    .catch((error) => {
      console.error(
        `Could not load member ${memberId} in space ${spaceId}:`,
        error
      );
      map.set(memberId, null);
      return null;
    })
    .finally(() => {
      inflightMemberFetches.delete(inflightKey);
    });

  inflightMemberFetches.set(inflightKey, loadPromise);
  return loadPromise;
}

/**
 * Resolve only the authors present in the current message window.
 * @param {string} spaceId
 * @param {Iterable<string | null | undefined>} participantIds
 * @returns {Promise<void>}
 */
export async function ensureMembersForParticipantIds(spaceId, participantIds) {
  if (!spaceId) {
    return;
  }

  const missing = [];
  const seen = new Set();
  const map = getOrCreateMemberMap(spaceId);

  for (const rawId of participantIds) {
    const id = typeof rawId === "string" ? rawId.trim() : "";
    if (!id || map.has(id) || seen.has(id)) {
      continue;
    }
    seen.add(id);
    missing.push(id);
  }

  if (missing.length === 0) {
    return;
  }

  await Promise.all(missing.map((memberId) => loadMemberById(spaceId, memberId)));
}

/**
 * @param {string} spaceId
 * @param {string | null | undefined} participantId
 * @returns {object | null}
 */
export function getSpaceMember(spaceId, participantId) {
  if (!spaceId || typeof participantId !== "string" || !participantId) {
    return null;
  }

  return membersBySpaceId.get(spaceId)?.get(participantId) ?? null;
}

/**
 * Drop cached members so the next open reloads (e.g. after a space switch).
 * @param {string | null | undefined} [spaceId]
 */
export function clearSpaceMembersCache(spaceId) {
  if (!spaceId) {
    membersBySpaceId.clear();
    inflightMemberFetches.clear();
    return;
  }

  membersBySpaceId.delete(spaceId);
  for (const key of [...inflightMemberFetches.keys()]) {
    try {
      const [cachedSpaceId] = JSON.parse(key);
      if (cachedSpaceId === spaceId) {
        inflightMemberFetches.delete(key);
      }
    } catch {
      // ignore malformed keys
    }
  }
}

/**
 * @param {string} name
 * @returns {string}
 */
export function initialsFromDisplayName(name) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return "?";
  }

  if (parts.length === 1) {
    return parts[0].slice(0, 2).toLocaleUpperCase();
  }

  const first = parts[0][0] ?? "";
  const last = parts[parts.length - 1][0] ?? "";
  const initials = `${first}${last}`.toLocaleUpperCase();
  return initials || "?";
}

/**
 * Build a browser-loadable avatar URL from the space gateway + file id.
 * Anytype may supply either a bare cid or an authenticated
 * `/v1/spaces/.../files/{cid}` URL — only the cid works on the gateway.
 * @param {string | null | undefined} gatewayUrl
 * @param {string | null | undefined} fileId
 * @returns {string | null}
 */
export function buildMemberFileAvatarUrl(gatewayUrl, fileId) {
  const base = typeof gatewayUrl === "string" ? gatewayUrl.trim().replace(/\/$/, "") : "";
  const cid = extractFileCid(fileId);
  if (!base || !cid) {
    return null;
  }

  return `${base}/image/${encodeURIComponent(cid)}`;
}

/**
 * @param {string | null | undefined} fileId
 * @returns {string | null}
 */
export function extractFileCid(fileId) {
  const raw = typeof fileId === "string" ? fileId.trim() : "";
  if (!raw) {
    return null;
  }

  try {
    if (/^https?:\/\//i.test(raw)) {
      const url = new URL(raw);
      const segments = url.pathname.split("/").filter(Boolean);
      const filesIndex = segments.findIndex(
        (segment) => segment.toLowerCase() === "files"
      );
      if (filesIndex >= 0 && filesIndex + 1 < segments.length) {
        return segments[filesIndex + 1] || null;
      }
      return segments.at(-1) || null;
    }
  } catch {
    return null;
  }

  return raw;
}

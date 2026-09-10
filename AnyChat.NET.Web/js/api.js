import {
  noteAnytypeReachable,
  noteAnytypeUnavailableFromResponse,
} from "./anytype-connection-notice.js";

const API_ORIGIN = "http://localhost:5249";

export function spacesUrl() {
  // Same host as the API (WPF / browser on :5249): stay relative.
  // Live Server and other origins: call the API by absolute URL.
  const onApiHost =
    (window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1") &&
    window.location.port === "5249";

  return onApiHost ? "/api/spaces" : `${API_ORIGIN}/api/spaces`;
}

/**
 * @param {Response} response
 * @param {string} fallbackMessage
 */
async function throwIfNotOk(response, fallbackMessage) {
  if (response.ok) {
    noteAnytypeReachable();
    return;
  }

  await noteAnytypeUnavailableFromResponse(response);
  const error = new Error(fallbackMessage);
  error.status = response.status;
  throw error;
}

export async function fetchSpaces() {
  const response = await fetch(spacesUrl());
  await throwIfNotOk(response, `Response status: ${response.status}`);
  return await response.json();
}

/**
 * User-facing message for the three most common spaces-load failures.
 * 1. HTTP error — API ran but returned 4xx/5xx
 * 2. Unreachable — API down / connection refused / CORS-looking network fail
 * 3. Invalid body — response was not usable JSON
 */
export function describeSpacesLoadError(error) {
  if (error?.status === 503) {
    return "Lost connection to Anytype. Open the official Anytype app and try again.";
  }

  if (typeof error?.status === "number") {
    return `API returned HTTP ${error.status}. Check the server logs.`;
  }

  if (error instanceof TypeError) {
    return "Cannot reach the API.";
  }

  return "Spaces response was invalid.";
}

export async function fetchChats(spaceId) {
  const response = await fetch(`${spacesUrl()}/${spaceId}/chats`);
  await throwIfNotOk(response, `Response status: ${response.status}`);
  return await response.json();
}

/**
 * Create a chat in a space.
 * @param {string} spaceId
 * @param {string} name
 * @returns {Promise<{ id?: string, name?: string, object?: string, iconEmoji?: string }>}
 */
export async function createChat(spaceId, name) {
  const response = await fetch(`${spacesUrl()}/${encodeURIComponent(spaceId)}/chats`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });

  await throwIfNotOk(response, `Response status: ${response.status}`);
  return await response.json();
}

/**
 * @param {string} spaceId
 * @param {string} memberId participant id or identity
 */
export async function fetchSpaceMember(spaceId, memberId) {
  const response = await fetch(
    `${spacesUrl()}/${spaceId}/members/${encodeURIComponent(memberId)}`
  );

  if (response.status === 404) {
    return null;
  }

  await throwIfNotOk(response, `Response status: ${response.status}`);
  return await response.json();
}

export async function postChatMessage(spaceId, chatId, text) {
  const response = await fetch(
    `${spacesUrl()}/${spaceId}/chats/${chatId}/messages`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    }
  );

  await throwIfNotOk(response, `Response status: ${response.status}`);
  return await response.json();
}

/**
 * SSE URL for live messages in one chat (proxied by the API).
 * @param {string} spaceId
 * @param {string} chatId
 * @param {number} [limit=50] backlog size on connect
 * @returns {string}
 */
export function chatMessagesStreamUrl(spaceId, chatId, limit = 50) {
  const params = new URLSearchParams({
    limit: String(limit),
  });
  return `${spacesUrl()}/${encodeURIComponent(spaceId)}/chats/${encodeURIComponent(chatId)}/messages/stream?${params}`;
}

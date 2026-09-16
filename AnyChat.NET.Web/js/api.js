import {
  noteAnytypeReachable,
  noteAnytypeUnavailableFromResponse,
} from "./anytype-connection-notice.js";
import { noteAnytypeAuthFromResponse } from "./anytype-auth-notice.js";

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

function apiRoot() {
  const onApiHost =
    (window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1") &&
    window.location.port === "5249";

  return onApiHost ? "/api" : `${API_ORIGIN}/api`;
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

  const authKind = await noteAnytypeAuthFromResponse(response);
  await noteAnytypeUnavailableFromResponse(response);

  let authError;
  if (authKind === "missing") {
    authError = "anytype_auth_missing";
  } else if (authKind === "invalid") {
    authError = "anytype_auth_invalid";
  } else if (response.status === 401) {
    try {
      const body = await response.clone().json();
      if (
        body?.error === "anytype_auth_missing" ||
        body?.error === "anytype_auth_invalid"
      ) {
        authError = body.error;
      }
    } catch {
      // ignore
    }
  }

  const error = new Error(fallbackMessage);
  error.status = response.status;
  if (authError) {
    error.authError = authError;
  }
  throw error;
}

export async function fetchAuthStatus() {
  const response = await fetch(`${apiRoot()}/auth/status`);
  if (!response.ok) {
    const error = new Error(`Response status: ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return await response.json();
}

/**
 * @param {Response} response
 * @returns {Promise<never>}
 */
async function throwAuthSetupFailure(response) {
  const authKind = await noteAnytypeAuthFromResponse(response);
  await noteAnytypeUnavailableFromResponse(response);

  let authError;
  if (authKind === "missing") {
    authError = "anytype_auth_missing";
  } else if (authKind === "invalid") {
    authError = "anytype_auth_invalid";
  } else if (response.status === 400) {
    try {
      const body = await response.clone().json();
      if (
        body?.error === "challenge_failed" ||
        body?.error === "challenge_invalid"
      ) {
        authError = body.error;
      }
    } catch {
      // ignore
    }
  }

  const error = new Error(`Response status: ${response.status}`);
  error.status = response.status;
  if (authError) {
    error.authError = authError;
  }
  throw error;
}

export async function createAuthChallenge() {
  const response = await fetch(`${apiRoot()}/auth/challenge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });

  if (response.ok) {
    noteAnytypeReachable();
    return await response.json();
  }

  return throwAuthSetupFailure(response);
}

/**
 * @param {string} challengeId
 * @param {string} code
 */
export async function putApiKeyFromChallenge(challengeId, code) {
  const response = await fetch(`${apiRoot()}/auth/api-key/from-challenge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ challengeId, code }),
  });

  if (response.ok) {
    noteAnytypeReachable();
    return await response.json();
  }

  return throwAuthSetupFailure(response);
}

/**
 * @param {string} apiKey
 */
export async function putApiKey(apiKey) {
  const response = await fetch(`${apiRoot()}/auth/api-key`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apiKey }),
  });

  if (response.ok) {
    noteAnytypeReachable();
    return await response.json();
  }

  return throwAuthSetupFailure(response);
}

/**
 * @param {unknown} error
 * @param {{ context?: "paste" | "challenge" }} [options]
 */
export function describeAuthSaveError(error, options = {}) {
  const context = options.context === "challenge" ? "challenge" : "paste";
  const authError =
    error && typeof error === "object"
      ? /** @type {{ authError?: string }} */ (error).authError
      : undefined;
  const status =
    error && typeof error === "object"
      ? /** @type {{ status?: number }} */ (error).status
      : undefined;

  if (status === 503) {
    return "Lost connection to Anytype. Open the official Anytype app and try again.";
  }

  if (context === "challenge") {
    if (authError === "challenge_failed") {
      return "Could not start authentication with Anytype. Try again.";
    }

    if (
      authError === "challenge_invalid" ||
      authError === "anytype_auth_invalid" ||
      status === 401 ||
      status === 400
    ) {
      return "That code was rejected. Check it and try again.";
    }

    if (typeof status === "number") {
      return `Could not connect (HTTP ${status}).`;
    }

    if (error instanceof TypeError) {
      return "Cannot reach the API.";
    }

    return "Could not connect with Anytype.";
  }

  if (authError === "anytype_auth_invalid" || status === 401) {
    return "That API key was rejected. Check it and try again.";
  }

  if (typeof status === "number") {
    return `Could not save API key (HTTP ${status}).`;
  }

  if (error instanceof TypeError) {
    return "Cannot reach the API.";
  }

  return "Could not save API key.";
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
  const authError =
    error && typeof error === "object"
      ? /** @type {{ authError?: string }} */ (error).authError
      : undefined;

  if (authError === "anytype_auth_missing") {
    return "API key not set up.";
  }

  if (authError === "anytype_auth_invalid") {
    return "API key is incorrect.";
  }

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
 * Archive (delete) a chat object in a space.
 * @param {string} spaceId
 * @param {string} chatId
 * @returns {Promise<void>}
 */
export async function deleteChat(spaceId, chatId) {
  const response = await fetch(
    `${spacesUrl()}/${encodeURIComponent(spaceId)}/chats/${encodeURIComponent(chatId)}`,
    { method: "DELETE" }
  );

  await throwIfNotOk(response, `Response status: ${response.status}`);
}

/**
 * Rename a chat object in a space (Objects.UpdateAsync via API).
 * @param {string} spaceId
 * @param {string} chatId
 * @param {string} name
 * @returns {Promise<void>}
 */
export async function renameChat(spaceId, chatId, name) {
  const response = await fetch(
    `${spacesUrl()}/${encodeURIComponent(spaceId)}/chats/${encodeURIComponent(chatId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }
  );

  await throwIfNotOk(response, `Response status: ${response.status}`);
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

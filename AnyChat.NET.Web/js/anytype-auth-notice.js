/**
 * Detect Anytype auth missing/invalid from API responses (no corner notice UI).
 */

/**
 * @param {Response} response
 * @returns {Promise<"missing" | "invalid" | null>}
 */
export async function noteAnytypeAuthFromResponse(response) {
  if (response.status !== 401) {
    return null;
  }

  try {
    const body = await response.clone().json();
    if (body?.error === "anytype_auth_missing") {
      return "missing";
    }
    if (body?.error === "anytype_auth_invalid") {
      return "invalid";
    }
  } catch {
    // Non-JSON 401 — ignore.
  }

  return null;
}

/**
 * @param {unknown} error
 * @returns {"missing" | "invalid" | null}
 */
export function authKindFromError(error) {
  if (!error || typeof error !== "object") {
    return null;
  }

  const code = /** @type {{ authError?: string }} */ (error).authError;
  if (code === "anytype_auth_missing") {
    return "missing";
  }
  if (code === "anytype_auth_invalid") {
    return "invalid";
  }

  return null;
}

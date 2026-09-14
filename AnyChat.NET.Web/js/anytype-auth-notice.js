/**
 * Global notice when the Anytype API key is missing or incorrect.
 * Same chrome as the connection notice; opens setup on click (no connectivity probe).
 */

let noticeClickBound = false;

function getNotice() {
  return document.getElementById("anytype-auth-notice");
}

function getTitle() {
  return document.getElementById("anytype-auth-notice-title");
}

function getBody() {
  return document.getElementById("anytype-auth-notice-body");
}

export function isAnytypeAuthNoticeVisible() {
  const notice = getNotice();
  return Boolean(notice && !notice.hidden);
}

/**
 * @param {"missing" | "invalid"} kind
 */
function copyForKind(kind) {
  if (kind === "missing") {
    return {
      title: "API key not set up",
      body: "Add your Anytype API key to connect. Click here to set it up.",
    };
  }

  return {
    title: "API key is incorrect",
    body: "The stored Anytype API key was rejected. Click here to replace it.",
  };
}

function ensureNoticeClickBound() {
  if (noticeClickBound) {
    return;
  }

  const notice = getNotice();
  if (!notice) {
    return;
  }

  noticeClickBound = true;
  notice.addEventListener("click", () => {
    void import("./api-key-setup-modal.js").then(({ openApiKeySetupModal }) =>
      openApiKeySetupModal({ reason: notice.dataset.authKind || "invalid" })
    );
  });
}

/**
 * @param {{ kind?: "missing" | "invalid" }} [options]
 */
export function showAnytypeAuthNotice(options = {}) {
  ensureNoticeClickBound();

  const kind = options.kind === "missing" ? "missing" : "invalid";
  const copy = copyForKind(kind);
  const notice = getNotice();
  const title = getTitle();
  const body = getBody();

  if (notice) {
    notice.dataset.authKind = kind;
    notice.hidden = false;
  }
  if (title) {
    title.textContent = copy.title;
  }
  if (body) {
    body.textContent = copy.body;
  }
}

export function hideAnytypeAuthNotice() {
  const notice = getNotice();
  if (notice) {
    notice.hidden = true;
  }
}

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
      showAnytypeAuthNotice({ kind: "missing" });
      return "missing";
    }
    if (body?.error === "anytype_auth_invalid") {
      showAnytypeAuthNotice({ kind: "invalid" });
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

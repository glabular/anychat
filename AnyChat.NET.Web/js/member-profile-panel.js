import {
  buildMemberFileAvatarUrl,
  initialsFromDisplayName,
} from "./space-members.js";

/** @type {HTMLElement | null} */
let openerButton = null;

/** @type {(() => void) | null} */
let removeOutsideClose = null;

/** @type {(() => void) | null} */
let removeScrollClose = null;

/**
 * @returns {HTMLElement | null}
 */
function getPanelRoot() {
  const root = document.getElementById("member-profile-panel");
  return root instanceof HTMLElement ? root : null;
}

/**
 * @returns {HTMLElement | null}
 */
function getPanelCard() {
  const card = document.getElementById("member-profile-card");
  return card instanceof HTMLElement ? card : null;
}

/**
 * @returns {boolean}
 */
export function isMemberProfilePanelOpen() {
  const root = getPanelRoot();
  return Boolean(root && !root.hidden);
}

/**
 * Fill a container with the same avatar visual used on message rows.
 * @param {HTMLElement} container
 * @param {{
 *   displayName: string,
 *   member: object | null,
 *   gatewayUrl?: string,
 * }} options
 */
export function fillAuthorAvatarVisual(container, { displayName, member, gatewayUrl = "" }) {
  container.replaceChildren();
  container.classList.remove(
    "message-author-avatar--emoji",
    "message-author-avatar--image",
    "message-author-avatar--named",
    "message-author-avatar--initials"
  );
  container.style.backgroundColor = "";

  const avatar = member?.avatar;
  const kind = typeof avatar?.kind === "string" ? avatar.kind : "";

  if (kind === "emoji" && typeof avatar.emoji === "string" && avatar.emoji.trim()) {
    container.classList.add("message-author-avatar--emoji");
    container.textContent = avatar.emoji.trim();
    return;
  }

  if (kind === "file" && typeof avatar.fileId === "string") {
    const url = buildMemberFileAvatarUrl(gatewayUrl, avatar.fileId);
    if (url) {
      const img = document.createElement("img");
      img.className = "message-author-avatar-image";
      img.src = url;
      img.alt = "";
      img.decoding = "async";
      img.draggable = false;
      img.setAttribute("draggable", "false");
      img.addEventListener("error", () => {
        container.replaceChildren();
        container.classList.remove("message-author-avatar--image");
        container.classList.add("message-author-avatar--initials");
        container.textContent = initialsFromDisplayName(displayName);
      });
      container.classList.add("message-author-avatar--image");
      container.appendChild(img);
      return;
    }
  }

  if (kind === "named" && typeof avatar.name === "string" && avatar.name.trim()) {
    container.classList.add("message-author-avatar--named");
    container.textContent = initialsFromDisplayName(
      avatar.name.trim() || displayName
    );
    const color =
      typeof avatar.color === "string" ? avatar.color.trim() : "";
    if (color) {
      container.style.backgroundColor = color;
    }
    return;
  }

  container.classList.add("message-author-avatar--initials");
  container.textContent = initialsFromDisplayName(displayName);
}

/**
 * @param {HTMLElement} anchor
 */
function positionPanelNearAnchor(anchor) {
  const card = getPanelCard();
  if (!card) {
    return;
  }

  const margin = 8;
  const gap = 10;
  const rect = anchor.getBoundingClientRect();
  const width = card.offsetWidth;
  const height = card.offsetHeight;

  let left = rect.right + gap;
  let top = rect.top;

  if (left + width > window.innerWidth - margin) {
    left = rect.left - width - gap;
  }
  if (left < margin) {
    left = margin;
  }

  if (top + height > window.innerHeight - margin) {
    top = window.innerHeight - height - margin;
  }
  if (top < margin) {
    top = margin;
  }

  card.style.left = `${Math.round(left)}px`;
  card.style.top = `${Math.round(top)}px`;
}

function detachTransientListeners() {
  removeOutsideClose?.();
  removeOutsideClose = null;
  removeScrollClose?.();
  removeScrollClose = null;
}

/**
 * @param {{ restoreFocus?: boolean }} [options]
 * @returns {boolean} true if a panel was open and is now closed
 */
export function closeMemberProfilePanel({ restoreFocus = true } = {}) {
  const root = getPanelRoot();
  if (!root || root.hidden) {
    openerButton = null;
    detachTransientListeners();
    return false;
  }

  root.hidden = true;
  detachTransientListeners();

  const opener = openerButton;
  openerButton = null;

  if (restoreFocus && opener instanceof HTMLElement && document.contains(opener)) {
    opener.focus();
  }

  return true;
}

/**
 * @param {{
 *   anchor: HTMLElement,
 *   displayName: string,
 *   member: object | null,
 *   participantId: string | null,
 *   gatewayUrl: string,
 * }} options
 */
export function openMemberProfilePanel({
  anchor,
  displayName,
  member,
  participantId,
  gatewayUrl,
}) {
  const root = getPanelRoot();
  const card = getPanelCard();
  const avatarEl = document.getElementById("member-profile-avatar");
  const nameEl = document.getElementById("member-profile-name");
  const identityEl = document.getElementById("member-profile-identity");
  const dmButton = document.getElementById("member-profile-dm");

  if (
    !root
    || !card
    || !(avatarEl instanceof HTMLElement)
    || !(nameEl instanceof HTMLElement)
    || !(identityEl instanceof HTMLElement)
  ) {
    return;
  }

  if (openerButton === anchor && isMemberProfilePanelOpen()) {
    closeMemberProfilePanel({ restoreFocus: true });
    return;
  }

  closeMemberProfilePanel({ restoreFocus: false });

  const identity =
    (typeof member?.globalName === "string" && member.globalName.trim())
    || (typeof member?.identity === "string" && member.identity.trim())
    || "Not available";

  nameEl.textContent = displayName;
  identityEl.textContent = identity;
  fillAuthorAvatarVisual(avatarEl, {
    displayName,
    member,
    gatewayUrl,
  });

  if (participantId) {
    root.dataset.participantId = participantId;
  } else {
    delete root.dataset.participantId;
  }

  if (dmButton instanceof HTMLButtonElement) {
    dmButton.disabled = true;
    dmButton.setAttribute("aria-disabled", "true");
    dmButton.title = "Direct messaging is not available yet";
    dmButton.setAttribute(
      "aria-description",
      "Direct messaging is not available yet"
    );
  }

  openerButton = anchor;
  root.hidden = false;
  positionPanelNearAnchor(anchor);
  // Reposition after layout in case fonts/images change size.
  requestAnimationFrame(() => {
    if (isMemberProfilePanelOpen() && openerButton === anchor) {
      positionPanelNearAnchor(anchor);
    }
  });

  card.focus({ preventScroll: true });

  const onPointerDown = (event) => {
    const target = event.target;
    if (!(target instanceof Node)) {
      return;
    }
    if (card.contains(target) || anchor.contains(target)) {
      return;
    }
    closeMemberProfilePanel({ restoreFocus: false });
  };
  document.addEventListener("mousedown", onPointerDown, true);
  removeOutsideClose = () => {
    document.removeEventListener("mousedown", onPointerDown, true);
  };

  const messages = document.getElementById("chat-messages");
  const onScrollOrResize = () => {
    closeMemberProfilePanel({ restoreFocus: false });
  };
  messages?.addEventListener("scroll", onScrollOrResize, { passive: true });
  window.addEventListener("resize", onScrollOrResize);
  removeScrollClose = () => {
    messages?.removeEventListener("scroll", onScrollOrResize);
    window.removeEventListener("resize", onScrollOrResize);
  };
}

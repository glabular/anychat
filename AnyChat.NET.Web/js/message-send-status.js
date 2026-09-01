/** @typedef {'sending' | 'sent' | 'failed'} SendStatus */

/**
 * @param {object | null | undefined} message
 * @returns {SendStatus | null}
 */
export function resolveOutgoingSendStatus(message) {
  if (message?.isMine !== true) {
    return null;
  }

  const { clientSendStatus } = message;
  if (
    clientSendStatus === "sending"
    || clientSendStatus === "sent"
    || clientSendStatus === "failed"
  ) {
    return clientSendStatus;
  }

  return "sent";
}

const SEND_STATUS_LABELS = {
  sending: "Sending",
  sent: "Sent",
  failed: "Failed to send",
};

const SEND_STATUS_GLYPHS = {
  sending: "◷",
  sent: "✓",
  failed: "!",
};

/**
 * @param {SendStatus} status
 * @returns {HTMLSpanElement}
 */
export function createSendStatusElement(status) {
  const statusEl = document.createElement("span");
  statusEl.className = `message-send-status message-send-status--${status}`;
  statusEl.setAttribute("aria-label", SEND_STATUS_LABELS[status]);

  const glyph = document.createElement("span");
  glyph.className = "message-send-status-glyph";
  glyph.setAttribute("aria-hidden", "true");
  glyph.textContent = SEND_STATUS_GLYPHS[status];
  if (status === "failed") {
    const failedColor = "#f55522";
    statusEl.style.setProperty("color", failedColor, "important");
    glyph.style.setProperty("color", failedColor, "important");
    glyph.style.setProperty("-webkit-text-fill-color", failedColor, "important");
  }
  statusEl.appendChild(glyph);

  return statusEl;
}

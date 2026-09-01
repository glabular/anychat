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

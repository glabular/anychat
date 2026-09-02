/**
 * Accepts only finite positive Unix timestamps in seconds.
 * @param {unknown} value
 * @returns {number | null}
 */
export function readUnixSeconds(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }

  return value;
}

/**
 * Local calendar day key for grouping (not for display).
 * @param {unknown} unixSeconds
 * @returns {string | null} `YYYY-M-D` in the viewer's local timezone
 */
export function localDayKey(unixSeconds) {
  const seconds = readUnixSeconds(unixSeconds);
  if (seconds === null) {
    return null;
  }

  const date = new Date(seconds * 1000);
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

/**
 * Formats a Unix-seconds timestamp as `DD.MM.YYYY` in local time.
 * @param {unknown} unixSeconds
 * @returns {string | null}
 */
export function formatDateDdMmYyyy(unixSeconds) {
  const seconds = readUnixSeconds(unixSeconds);
  if (seconds === null) {
    return null;
  }

  const date = new Date(seconds * 1000);
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = String(date.getFullYear());
  return `${day}.${month}.${year}`;
}

/**
 * Formats a Unix-seconds timestamp as 24-hour `HH:mm` in local time.
 * @param {unknown} unixSeconds
 * @returns {string | null}
 */
export function formatTimeHhMm(unixSeconds) {
  const seconds = readUnixSeconds(unixSeconds);
  if (seconds === null) {
    return null;
  }

  const date = new Date(seconds * 1000);
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

/**
 * Chat-list metadata: today → `HH:mm`, otherwise → `DD.MM.YYYY`.
 * @param {unknown} unixSeconds
 * @param {unknown} [nowUnixSeconds=Date.now() / 1000]
 * @returns {string | null}
 */
export function formatChatListTimestamp(
  unixSeconds,
  nowUnixSeconds = Date.now() / 1000
) {
  const messageDay = localDayKey(unixSeconds);
  const todayDay = localDayKey(nowUnixSeconds);
  if (messageDay === null || todayDay === null) {
    return null;
  }

  if (messageDay === todayDay) {
    return formatTimeHhMm(unixSeconds);
  }

  return formatDateDdMmYyyy(unixSeconds);
}

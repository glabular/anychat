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

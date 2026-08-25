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

export async function fetchSpaces() {
  try {
    const response = await fetch(spacesUrl());

    if (!response.ok) {
      throw new Error(`Response status: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error("Could not load spaces:", error);
    return [];
  }
}

export async function fetchChats(spaceId) {
  try {
    const response = await fetch(`${spacesUrl()}/${spaceId}/chats`);

    if (!response.ok) {
      throw new Error(`Response status: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error(`Could not load chats for space ${spaceId}:`, error);
    return [];
  }
}

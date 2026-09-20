import {
  closeCreateSpaceModal,
  initCreateSpaceModal,
  openCreateSpaceModal,
} from "./create-space-modal.js";

/**
 * Create-space + at the end of the spaces list.
 */

let createBound = false;

function getSpacesCreateButton() {
  return /** @type {HTMLButtonElement | null} */ (
    document.getElementById("spaces-create")
  );
}

/**
 * Show/enable + after spaces have loaded successfully (including empty list).
 * @param {boolean} ready
 */
export function setSpacesCreateButtonReady(ready) {
  const button = getSpacesCreateButton();
  if (!button) {
    return;
  }

  button.hidden = !ready;
  button.disabled = !ready;
}

export function initSpacesCreateButton() {
  if (createBound) {
    return;
  }

  const button = getSpacesCreateButton();
  if (!button) {
    return;
  }

  createBound = true;
  initCreateSpaceModal();

  button.addEventListener("click", () => {
    if (button.disabled || button.hidden) {
      return;
    }
    openCreateSpaceModal();
  });
}

export { closeCreateSpaceModal };

import { initSpacesScroll } from "./spaces-scroll.js";
import { initializeSpaces } from "./spaces.js";
import { initChatViewCloseBindings } from "./chat-view.js";
import { initIdleScrollbars } from "./idle-scrollbar.js";
import { initFloatingDateIdle } from "./floating-date-idle.js";
import { initChatsSidebarResize } from "./chats-sidebar-resize.js";
import { initChatsScrollToTop } from "./chats-scroll-to-top.js";
import { initChatsCreateButton } from "./chats-create-button.js";
import { initChatPanelMenu } from "./chat-panel-menu.js";
import { initDeleteChatConfirm } from "./delete-chat-confirm.js";
import { initChatRenameTitle } from "./chat-rename-title.js";
import { initApiKeySetupModal } from "./api-key-setup-modal.js";
import { initIdentityNotice } from "./identity-notice.js";
import { initSettings } from "./settings.js";

/** Desktop shell: do not cycle focus with Tab / Shift+Tab. */
document.addEventListener(
  "keydown",
  (event) => {
    if (event.key === "Tab") {
      event.preventDefault();
    }
  },
  true
);

initSpacesScroll();
initChatViewCloseBindings();
initIdleScrollbars();
initFloatingDateIdle();
initChatsSidebarResize();
initChatsScrollToTop();
initChatsCreateButton();
initChatPanelMenu();
initDeleteChatConfirm();
initChatRenameTitle();
initApiKeySetupModal();
initIdentityNotice();
initSettings();
initializeSpaces();

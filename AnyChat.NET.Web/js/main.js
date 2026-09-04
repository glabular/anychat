import { initSpacesScroll } from "./spaces-scroll.js";
import { initializeSpaces } from "./spaces.js";
import { initChatViewCloseBindings } from "./chat-view.js";
import { initIdleScrollbars } from "./idle-scrollbar.js";
import { initFloatingDateIdle } from "./floating-date-idle.js";
import { initChatsSidebarResize } from "./chats-sidebar-resize.js";
import { initChatsScrollToTop } from "./chats-scroll-to-top.js";

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
initializeSpaces();

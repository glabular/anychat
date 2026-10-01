/**
 * In-app FAQ content + accordion UI.
 * Wording mirrors `faq/faq.md` — update both when entries change.
 */

/** @typedef {{ question: string; answers: string[] }} FaqEntry */

/** @type {FaqEntry[]} */
const FAQ_ENTRIES = [
  {
    question: "Is anychat secure?",
    answers: [
      "Yes — anychat runs locally and communicates only with the Anytype instance running on your computer. Your data does not leave your computer, and anychat does not send your chat content or personal data to any external server.",
      "Your data stays in Anytype’s storage. anychat is a local interface to your Anytype data, not a cloud service or relay.",
    ],
  },
  {
    question: "Why can’t I delete a space from anychat?",
    answers: [
      "A **space** in Anytype is a complete workspace — chats plus pages, files, and other objects. Because deleting a space can affect more than what anychat shows, space deletion stays in Anytype. You can still delete individual chats in anychat.",
    ],
  },
  {
    question: "Why doesn’t anychat show unread message counts?",
    answers: [
      "Unread counts are not in anychat yet. They may arrive in a future update once there is a solid way to keep those numbers accurate with your chats in Anytype.",
    ],
  },
];

let mounted = false;

/**
 * Renders `**bold**` segments into a parent without using innerHTML.
 * @param {HTMLElement} parent
 * @param {string} text
 */
function appendInlineEmphasis(parent, text) {
  const parts = text.split("**");
  parts.forEach((part, index) => {
    if (!part) {
      return;
    }
    if (index % 2 === 1) {
      const strong = document.createElement("strong");
      strong.textContent = part;
      parent.append(strong);
      return;
    }
    parent.append(part);
  });
}

/**
 * @param {FaqEntry} entry
 * @param {number} index
 */
function createFaqItem(entry, index) {
  const item = document.createElement("div");
  item.className = "settings-faq-item";

  const panelId = `settings-faq-panel-${index}`;

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "settings-faq-trigger";
  trigger.setAttribute("aria-expanded", "false");
  trigger.setAttribute("aria-controls", panelId);

  const question = document.createElement("span");
  question.className = "settings-faq-question";
  question.textContent = entry.question;

  const chevron = document.createElement("span");
  chevron.className = "settings-faq-chevron";
  chevron.setAttribute("aria-hidden", "true");
  chevron.textContent = ">";

  trigger.append(chevron, question);

  const panel = document.createElement("div");
  panel.id = panelId;
  panel.className = "settings-faq-panel";
  panel.hidden = true;

  for (const answer of entry.answers) {
    const p = document.createElement("p");
    p.className = "settings-faq-answer";
    appendInlineEmphasis(p, answer);
    panel.append(p);
  }

  trigger.addEventListener("click", () => {
    const open = trigger.getAttribute("aria-expanded") === "true";
    const nextOpen = !open;
    trigger.setAttribute("aria-expanded", nextOpen ? "true" : "false");
    panel.hidden = !nextOpen;
    item.classList.toggle("is-open", nextOpen);
  });

  item.append(trigger, panel);
  return item;
}

function collapseAllFaqItems(root) {
  root.querySelectorAll(".settings-faq-item").forEach((item) => {
    item.classList.remove("is-open");
    const trigger = item.querySelector(".settings-faq-trigger");
    const panel = item.querySelector(".settings-faq-panel");
    if (trigger instanceof HTMLElement) {
      trigger.setAttribute("aria-expanded", "false");
    }
    if (panel instanceof HTMLElement) {
      panel.hidden = true;
    }
  });
}

/**
 * Build the FAQ list once into `#settings-detail-faq`.
 * Always collapses rows so revisit starts closed.
 */
export function ensureFaqMounted() {
  const root = document.getElementById("settings-detail-faq");
  if (!root) {
    return;
  }

  if (!mounted) {
    const wrap = document.createElement("div");
    wrap.className = "settings-faq-inner";

    const title = document.createElement("h1");
    title.className = "settings-faq-title";
    title.textContent = "FAQ";

    const list = document.createElement("div");
    list.className = "settings-faq-list";
    list.setAttribute("role", "list");

    FAQ_ENTRIES.forEach((entry, index) => {
      const item = createFaqItem(entry, index);
      item.setAttribute("role", "listitem");
      list.append(item);
    });

    wrap.append(title, list);
    root.replaceChildren(wrap);
    mounted = true;
    return;
  }

  collapseAllFaqItems(root);
}

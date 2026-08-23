const SPACE_ROW_HEIGHT = 72;

const scrollEl = document.querySelector(".spaces-sidebar");
const upBtn = document.querySelector(".spaces-scroll--up");
const downBtn = document.querySelector(".spaces-scroll--down");

function updateScrollHints() {
  if (!scrollEl || !upBtn || !downBtn) {
    return;
  }

  const { scrollTop, clientHeight, scrollHeight } = scrollEl;
  upBtn.hidden = scrollTop <= 0;
  downBtn.hidden = scrollTop + clientHeight >= scrollHeight - 1;
}

scrollEl?.addEventListener("scroll", updateScrollHints);
window.addEventListener("resize", updateScrollHints);

upBtn?.addEventListener("click", () => {
  scrollEl?.scrollBy({ top: -SPACE_ROW_HEIGHT, behavior: "smooth" });
});

downBtn?.addEventListener("click", () => {
  scrollEl?.scrollBy({ top: SPACE_ROW_HEIGHT, behavior: "smooth" });
});

updateScrollHints();

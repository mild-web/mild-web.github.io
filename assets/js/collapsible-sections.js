document.querySelectorAll(".section-toggle").forEach((button) => {
  const contentId = button.getAttribute("aria-controls");
  const content = document.getElementById(contentId);
  const section = button.closest(".section");

  if (!content || !section) {
    return;
  }

  button.addEventListener("click", () => {
    const shouldExpand = button.getAttribute("aria-expanded") !== "true";
    button.setAttribute("aria-expanded", String(shouldExpand));
    button.textContent = shouldExpand ? "Collapse" : "Expand";
    section.classList.toggle("is-collapsed", !shouldExpand);
    content.hidden = !shouldExpand;

    if (!shouldExpand) {
      section.querySelectorAll("video").forEach((video) => video.pause());
    }
  });
});

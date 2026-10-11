(() => {
  "use strict";
  const matrix = document.getElementById("replayMatrix");
  const shell = document.getElementById("replayMatrixShell");
  const content = document.getElementById("event-zooms-content");
  if (!matrix || !shell || !content) return;
  let installed = false;

  function install() {
    const head = matrix.querySelector(".replay-heading-row");
    if (!head || installed) return;
    installed = true;
    const floating = document.createElement("div");
    floating.className = "replay-sticky-header";
    floating.hidden = true;
    // The original column headers remain the accessible table headers.
    // This visual copy sits outside the horizontal scroll container, so it
    // can follow page scrolling without changing that container's height.
    floating.setAttribute("aria-hidden", "true");
    const track = head.cloneNode(true);
    track.className = "replay-sticky-header-track";
    floating.appendChild(track);
    document.body.appendChild(floating);
    const sourceCorner = head.querySelector(".replay-corner");
    const corner = track.querySelector(".replay-corner");
    const sourceMethods = [...head.querySelectorAll(".replay-method-header")];
    const methodLabels = [...track.querySelectorAll(".replay-method-header")].map((cell) => {
      const label = document.createElement("span");
      label.className = "replay-sticky-method-label";
      label.textContent = cell.textContent;
      cell.replaceChildren(label);
      return label;
    });
    let frame = 0;

    function update() {
      frame = 0;
      const headerRect = head.getBoundingClientRect();
      const matrixRect = matrix.getBoundingClientRect();
      const shellRect = shell.getBoundingClientRect();
      if (content.hidden || !head.getClientRects().length || headerRect.top >= 0 || matrixRect.bottom <= 0 || !shell.clientWidth) {
        floating.hidden = true;
        return;
      }
      const style = getComputedStyle(head);
      const left = shellRect.left + shell.clientLeft;
      const cornerOffset = sourceCorner.getBoundingClientRect().left - headerRect.left;
      floating.style.left = `${left}px`;
      floating.style.width = `${shell.clientWidth}px`;
      floating.style.top = `${Math.min(0, matrixRect.bottom - headerRect.height)}px`;
      track.style.width = `${headerRect.width}px`;
      track.style.gridTemplateColumns = style.gridTemplateColumns;
      track.style.gap = style.gap;
      track.style.transform = `translateX(${headerRect.left - left}px)`;
      // Match the existing pinned Task / Method column exactly while all
      // six method columns follow the matrix's horizontal scroll position.
      corner.style.transform = `translateX(${cornerOffset}px)`;
      // Center each label in the visible part of its column. In narrow
      // viewports the pinned task column can cover a method's normal center.
      const pinnedRect = sourceCorner.getBoundingClientRect();
      const visibleLeft = Math.max(left, pinnedRect.right);
      const visibleRight = left + shell.clientWidth;
      methodLabels.forEach((label, i) => {
        const rect = sourceMethods[i].getBoundingClientRect();
        const start = Math.max(visibleLeft, rect.left);
        const end = Math.min(visibleRight, rect.right);
        const width = end - start;
        label.style.visibility = width > 36 ? "visible" : "hidden";
        label.style.maxWidth = `${Math.max(0, width - 12)}px`;
        label.style.transform = `translateX(${(start + end - rect.left - rect.right) / 2}px)`;
      });
      floating.hidden = false;
    }
    function schedule() {
      if (!frame) frame = requestAnimationFrame(update);
    }
    window.addEventListener("scroll", schedule, { passive: true });
    shell.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    window.visualViewport?.addEventListener("resize", schedule, { passive: true });
    const sizeObserver = new ResizeObserver(schedule);
    for (const node of [shell, matrix, head]) sizeObserver.observe(node);
    new MutationObserver(schedule).observe(content, { attributes: true, attributeFilter: ["hidden"] });
    schedule();
  }
  const observer = new MutationObserver(() => {
    install();
    if (installed) observer.disconnect();
  });
  observer.observe(matrix, { childList: true });
  install();
  if (installed) observer.disconnect();
})();

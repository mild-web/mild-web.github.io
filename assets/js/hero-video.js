(() => {
  const hero = document.querySelector(".hero-video");
  if (!hero) return;
  const background = hero.querySelector(".hero-background");
  const toggle = hero.querySelector(".hero-motion");
  const filmLink = hero.querySelector("[data-open-film]");
  const dialog = document.querySelector(".hero-film");
  const film = dialog.querySelector("video");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const connection = navigator.connection;
  let motionEnabled = !reducedMotion.matches && !connection?.saveData;
  let visible = true;

  // Never download the background automatically for reduced-motion/save-data users.
  const loadVideo = (video) => {
    if (!video.getAttribute("src")) video.src = video.dataset.src;
  };

  function updateControl() {
    const playing = !background.paused;
    toggle.setAttribute("aria-label", playing ? "Pause background video" : "Play background video");
    toggle.querySelector("[data-motion-label]").textContent = playing ? "Pause background" : "Play background";
    toggle.querySelector("[data-motion-icon]").textContent = playing ? "Ⅱ" : "▶";
  }

  function syncBackground() {
    if (motionEnabled && visible && !document.hidden && !dialog.open) {
      loadVideo(background);
      background.play().catch((error) => {
        // A visibility change can interrupt play(); it is not a user preference.
        if (error.name !== "AbortError") motionEnabled = false;
        updateControl();
      });
    } else {
      background.pause();
    }
  }

  background.muted = true;
  toggle.hidden = false;
  background.addEventListener("play", updateControl);
  background.addEventListener("pause", updateControl);
  background.addEventListener("error", () => { motionEnabled = false; updateControl(); });
  toggle.addEventListener("click", () => {
    motionEnabled = background.paused;
    syncBackground();
  });
  document.addEventListener("visibilitychange", syncBackground);
  reducedMotion.addEventListener("change", () => {
    motionEnabled = !reducedMotion.matches && !connection?.saveData;
    syncBackground();
  });
  if (connection?.addEventListener) {
    connection.addEventListener("change", () => {
      if (connection.saveData) { motionEnabled = false; syncBackground(); }
    });
  }
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      syncBackground();
    }).observe(hero);
  }

  // A normal MP4 link remains usable if JavaScript or native dialogs are unavailable.
  if (typeof dialog.showModal === "function") {
    filmLink.addEventListener("click", (event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      dialog.showModal();
      document.body.classList.add("hero-film-open");
      syncBackground();
      film.preload = "metadata";
      loadVideo(film);
      film.play().catch(() => { /* Native controls remain available. */ });
    });
    dialog.querySelector(".hero-film-close").addEventListener("click", () => dialog.close());
    dialog.addEventListener("click", (event) => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
    });
    dialog.addEventListener("close", () => {
      film.pause();
      document.body.classList.remove("hero-film-open");
      syncBackground();
    });
  }
  syncBackground();
})();

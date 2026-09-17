document.querySelectorAll(".sensor-frame-3d").forEach((viewer) => {
  const scene = viewer.querySelector(".frame-scene");
  if (!scene) return;

  let rotX = Number(viewer.dataset.rotX || -22);
  let rotY = Number(viewer.dataset.rotY || 34);
  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  const applyRotation = () => {
    scene.style.setProperty("--rot-x", `${rotX}deg`);
    scene.style.setProperty("--rot-y", `${rotY}deg`);
  };

  const start = (event) => {
    dragging = true;
    lastX = event.clientX;
    lastY = event.clientY;
    viewer.setPointerCapture?.(event.pointerId);
    viewer.classList.add("is-dragging");
  };

  const move = (event) => {
    if (!dragging) return;
    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;
    rotY += dx * 0.45;
    rotX = Math.max(-70, Math.min(35, rotX - dy * 0.35));
    applyRotation();
  };

  const stop = () => {
    dragging = false;
    viewer.classList.remove("is-dragging");
  };

  viewer.addEventListener("pointerdown", start);
  viewer.addEventListener("pointermove", move);
  viewer.addEventListener("pointerup", stop);
  viewer.addEventListener("pointercancel", stop);
  viewer.addEventListener("lostpointercapture", stop);

  viewer.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft") rotY -= 8;
    else if (event.key === "ArrowRight") rotY += 8;
    else if (event.key === "ArrowUp") rotX = Math.max(-70, rotX - 6);
    else if (event.key === "ArrowDown") rotX = Math.min(35, rotX + 6);
    else return;

    event.preventDefault();
    applyRotation();
  });

  applyRotation();
});

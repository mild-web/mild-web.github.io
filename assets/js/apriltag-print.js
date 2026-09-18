const APRILTAG_MAX_COUNT = 32;
const APRILTAG_FAMILY = "tagCustom48h12";

const tagCountInput = document.getElementById("apriltagCountInput");
const tagDownload = document.getElementById("apriltagDownload");
const tagPrintNote = document.getElementById("apriltagPrintNote");
const tagPreviewCount = document.getElementById("apriltagPreviewCount");
const tagGrid = document.getElementById("apriltagGrid");

function clampTagCount(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(1, Math.min(APRILTAG_MAX_COUNT, parsed));
}

function countLabel(count) {
  if (count === 1) return "ID 0";
  return `IDs 0--${count - 1}`;
}

function pdfPath(count) {
  return `assets/apriltags/pdf/${APRILTAG_FAMILY}_count_${String(count).padStart(2, "0")}_A4.pdf`;
}

function tagImagePath(id) {
  return `assets/apriltags/png/${APRILTAG_FAMILY}_id${String(id).padStart(3, "0")}.png`;
}

function renderTagGrid(count) {
  if (!tagGrid) return;
  const cells = [];
  for (let id = 0; id < count; id += 1) {
    const cell = document.createElement("figure");
    cell.className = "apriltag-cell";

    const image = document.createElement("img");
    image.src = tagImagePath(id);
    image.alt = `${APRILTAG_FAMILY} ID ${id}`;
    image.loading = "lazy";

    const caption = document.createElement("figcaption");
    caption.textContent = `ID ${id}`;

    cell.append(image, caption);
    cells.push(cell);
  }
  tagGrid.replaceChildren(...cells);
}

function updateAprilTagDownload() {
  if (!tagCountInput || !tagDownload || !tagPrintNote || !tagPreviewCount) return;

  const count = clampTagCount(tagCountInput.value);
  if (String(count) !== tagCountInput.value) {
    tagCountInput.value = count;
  }

  const href = pdfPath(count);
  const label = countLabel(count);
  tagDownload.href = href;
  tagDownload.setAttribute("download", href.split("/").pop());
  tagDownload.setAttribute("aria-label", `Download ${APRILTAG_FAMILY} A4 PDF for ${count} tags`);
  tagPrintNote.textContent = `Family: ${APRILTAG_FAMILY}. ${label}. Print at 100% / actual size on A4 paper.`;
  tagPreviewCount.textContent = `${count} ${count === 1 ? "tag" : "tags"}`;
  renderTagGrid(count);
}

tagCountInput?.addEventListener("input", updateAprilTagDownload);
tagCountInput?.addEventListener("change", updateAprilTagDownload);
updateAprilTagDownload();

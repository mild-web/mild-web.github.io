const TAG_PREVIEW_LIMIT = 32;
const MM_TO_PT = 72 / 25.4;
const A4 = { width: 210 * MM_TO_PT, height: 297 * MM_TO_PT };
const TAG_IMAGE_WIDTH_PT = 180 * MM_TO_PT;

const tagCountInput = document.getElementById("apriltagCountInput");
const tagDownload = document.getElementById("apriltagDownload");
const tagPrintNote = document.getElementById("apriltagPrintNote");
const tagPreviewCount = document.getElementById("apriltagPreviewCount");
const tagGrid = document.getElementById("apriltagGrid");

function family() {
  return window.TAG_CUSTOM48H12;
}

function maxCount() {
  return family()?.ncodes || 42211;
}

function clampTagCount(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(1, Math.min(maxCount(), parsed));
}

function countLabel(count) {
  if (count === 1) return "ID 0";
  return `IDs 0--${count - 1}`;
}

function tagMatrix(id) {
  const f = family();
  const matrix = Array.from({ length: f.totalWidth }, () => Array(f.totalWidth).fill(0));
  const code = BigInt(`0x${f.codes[id]}`);
  const whiteBorderWidth = f.widthAtBorder + (f.reversedBorder ? 0 : 2);
  const whiteBorderStart = Math.floor((f.totalWidth - whiteBorderWidth) / 2);

  for (let i = 0; i < whiteBorderWidth - 1; i += 1) {
    matrix[whiteBorderStart][whiteBorderStart + i] = 1;
    matrix[whiteBorderStart + i][f.totalWidth - 1 - whiteBorderStart] = 1;
    matrix[f.totalWidth - 1 - whiteBorderStart][whiteBorderStart + i + 1] = 1;
    matrix[whiteBorderStart + 1 + i][whiteBorderStart] = 1;
  }

  const borderStart = Math.floor((f.totalWidth - f.widthAtBorder) / 2);
  for (let i = 0; i < f.nbits; i += 1) {
    const mask = 1n << BigInt(f.nbits - i - 1);
    if ((code & mask) !== 0n) {
      matrix[f.bitY[i] + borderStart][f.bitX[i] + borderStart] = 1;
    }
  }
  return matrix;
}

function drawTagOnCanvas(canvas, id) {
  const f = family();
  const size = 120;
  const scale = size / f.totalWidth;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  const matrix = tagMatrix(id);
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = "#ffffff";
  for (let y = 0; y < f.totalWidth; y += 1) {
    for (let x = 0; x < f.totalWidth; x += 1) {
      if (matrix[y][x]) {
        ctx.fillRect(x * scale, y * scale, scale, scale);
      }
    }
  }
}

function renderTagGrid(count) {
  if (!tagGrid || !family()) return;
  const cells = [];
  const visibleCount = Math.min(count, TAG_PREVIEW_LIMIT);
  const tagCells = count > TAG_PREVIEW_LIMIT ? TAG_PREVIEW_LIMIT - 1 : visibleCount;

  for (let id = 0; id < tagCells; id += 1) {
    const cell = document.createElement("figure");
    cell.className = "apriltag-cell";

    const canvas = document.createElement("canvas");
    canvas.setAttribute("aria-label", `${family().name} ID ${id}`);
    drawTagOnCanvas(canvas, id);

    const caption = document.createElement("figcaption");
    caption.textContent = `ID ${id}`;

    cell.append(canvas, caption);
    cells.push(cell);
  }

  if (count > TAG_PREVIEW_LIMIT) {
    const more = document.createElement("div");
    more.className = "apriltag-cell apriltag-more-cell";
    more.textContent = "...";
    more.setAttribute("aria-label", `${count - tagCells} additional tags not shown in preview`);
    cells.push(more);
  }

  tagGrid.replaceChildren(...cells);
}

function updateAprilTagDownload() {
  if (!tagCountInput || !tagDownload || !tagPrintNote || !tagPreviewCount || !family()) return;

  const count = clampTagCount(tagCountInput.value);
  if (String(count) !== tagCountInput.value) {
    tagCountInput.value = count;
  }

  const label = countLabel(count);
  tagDownload.disabled = false;
  tagDownload.setAttribute("aria-label", `Generate ${family().name} A4 PDF for ${count} tags`);
  tagPrintNote.textContent = `Family: ${family().name}. ${label}. Print at 100% / actual size on A4 paper. Large PDFs may take time to generate.`;
  tagPreviewCount.textContent = `${count} ${count === 1 ? "tag" : "tags"}`;
  renderTagGrid(count);
}

function fmt(value) {
  return Number(value).toFixed(3).replace(/\\.0+$/, "").replace(/(\\.\\d*?)0+$/, "$1");
}

function pdfEscape(text) {
  return String(text).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function pageContent(id) {
  const f = family();
  const matrix = tagMatrix(id);
  const x0 = (A4.width - TAG_IMAGE_WIDTH_PT) / 2;
  const y0 = (A4.height - TAG_IMAGE_WIDTH_PT) / 2;
  const cell = TAG_IMAGE_WIDTH_PT / f.totalWidth;
  const commands = [
    "0 g",
    `${fmt(x0)} ${fmt(y0)} ${fmt(TAG_IMAGE_WIDTH_PT)} ${fmt(TAG_IMAGE_WIDTH_PT)} re f`,
    "1 g",
  ];

  for (let y = 0; y < f.totalWidth; y += 1) {
    for (let x = 0; x < f.totalWidth; x += 1) {
      if (matrix[y][x]) {
        const px = x0 + x * cell;
        const py = y0 + (f.totalWidth - 1 - y) * cell;
        commands.push(`${fmt(px)} ${fmt(py)} ${fmt(cell)} ${fmt(cell)} re f`);
      }
    }
  }

  commands.push("0 g");
  commands.push("BT /F1 10 Tf");
  commands.push(`${fmt(A4.width / 2 - 122)} ${fmt(18 * MM_TO_PT)} Td`);
  commands.push(`(${pdfEscape(`${f.name} ID ${String(id).padStart(3, "0")} | Print at 100% / actual size`)}) Tj`);
  commands.push("ET");
  return `${commands.join("\\n")}\\n`;
}

function buildPdf(count) {
  const objects = [null];
  const pageIds = [];

  const addObject = (content) => {
    objects.push(content);
    return objects.length - 1;
  };

  objects[1] = "";
  objects[2] = "";
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";

  for (let id = 0; id < count; id += 1) {
    const stream = pageContent(id);
    const contentId = addObject(`<< /Length ${stream.length} >>\\nstream\\n${stream}endstream`);
    const pageId = addObject(`<< /Type /Page /Parent 1 0 R /MediaBox [0 0 ${fmt(A4.width)} ${fmt(A4.height)}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`);
    pageIds.push(pageId);
  }

  objects[1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
  objects[2] = "<< /Type /Catalog /Pages 1 0 R >>";

  let pdf = "%PDF-1.4\\n";
  const offsets = [0];
  for (let i = 1; i < objects.length; i += 1) {
    offsets[i] = pdf.length;
    pdf += `${i} 0 obj\\n${objects[i]}\\nendobj\\n`;
  }
  const xrefOffset = pdf.length;
  pdf += `xref\\n0 ${objects.length}\\n`;
  pdf += "0000000000 65535 f \\n";
  for (let i = 1; i < objects.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \\n`;
  }
  pdf += `trailer\\n<< /Size ${objects.length} /Root 2 0 R >>\\nstartxref\\n${xrefOffset}\\n%%EOF\\n`;
  return new Blob([pdf], { type: "application/pdf" });
}

function generatePdf() {
  const count = clampTagCount(tagCountInput?.value);
  if (!count || !family()) return;
  tagDownload.disabled = true;
  const originalText = tagDownload.textContent;
  tagDownload.textContent = "Generating...";
  window.setTimeout(() => {
    try {
      const blob = buildPdf(count);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${family().name}_count_${String(count).padStart(5, "0")}_A4.pdf`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 4000);
    } finally {
      tagDownload.disabled = false;
      tagDownload.textContent = originalText;
    }
  }, 20);
}

tagCountInput?.addEventListener("input", updateAprilTagDownload);
tagCountInput?.addEventListener("change", updateAprilTagDownload);
tagDownload?.addEventListener("click", generatePdf);
updateAprilTagDownload();

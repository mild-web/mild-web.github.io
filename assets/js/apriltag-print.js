const APRILTAG_PDFS = {
  1: {
    href: "assets/apriltags/tagCustom48h12_ids_0_A4.pdf",
    label: "1 tag: ID 0",
  },
  2: {
    href: "assets/apriltags/tagCustom48h12_ids_0_1_A4.pdf",
    label: "2 tags: IDs 0--1",
  },
  3: {
    href: "assets/apriltags/tagCustom48h12_ids_0_2_A4.pdf",
    label: "3 tags: IDs 0--2",
  },
  4: {
    href: "assets/apriltags/tagCustom48h12_ids_0_3_A4.pdf",
    label: "4 tags: IDs 0--3",
  },
};

const tagCountSelect = document.getElementById("apriltagCountSelect");
const tagDownload = document.getElementById("apriltagDownload");
const tagPrintNote = document.getElementById("apriltagPrintNote");

function updateAprilTagDownload() {
  if (!tagCountSelect || !tagDownload || !tagPrintNote) return;
  const config = APRILTAG_PDFS[tagCountSelect.value] || APRILTAG_PDFS[4];
  tagDownload.href = config.href;
  tagDownload.setAttribute("download", config.href.split("/").pop());
  tagDownload.setAttribute("aria-label", `Download custom48h12 PDF for ${config.label}`);
  tagPrintNote.textContent = `Family: tagCustom48h12. ${config.label}. Print at 100% / actual size on A4 paper.`;
}

tagCountSelect?.addEventListener("change", updateAprilTagDownload);
updateAprilTagDownload();

from __future__ import annotations

import csv
import math
from pathlib import Path


def write_mock_trajectory(output_dir: Path, *, samples: int = 240) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    csv_path = output_dir / "trajectory.csv"
    with csv_path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        writer.writerow(["timestamp_s", "x_m", "y_m", "z_m"])
        for idx in range(samples):
            t = idx / 30.0
            theta = idx / (samples - 1) * 2.0 * math.pi
            radius = 0.18 + 0.02 * math.sin(3 * theta)
            x = radius * math.cos(theta)
            y = 0.65 * radius * math.sin(theta)
            z = 0.04 * math.sin(2 * theta)
            writer.writerow([f"{t:.6f}", f"{x:.6f}", f"{y:.6f}", f"{z:.6f}"])
    return csv_path


def write_svg_preview(csv_path: Path, output_dir: Path) -> Path:
    rows = []
    with csv_path.open("r", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        for row in reader:
            rows.append((float(row["x_m"]), float(row["y_m"])))
    if not rows:
        rows = [(0.0, 0.0)]
    xs = [p[0] for p in rows]
    ys = [p[1] for p in rows]
    pad = 18
    width = 720
    height = 460
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    span_x = max(max_x - min_x, 1e-6)
    span_y = max(max_y - min_y, 1e-6)

    def project(point: tuple[float, float]) -> tuple[float, float]:
        x, y = point
        px = pad + (x - min_x) / span_x * (width - 2 * pad)
        py = height - pad - (y - min_y) / span_y * (height - 2 * pad)
        return px, py

    points = " ".join(f"{x:.2f},{y:.2f}" for x, y in map(project, rows))
    start = project(rows[0])
    end = project(rows[-1])
    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" role="img" aria-label="AprilVINS trajectory preview">
  <rect width="{width}" height="{height}" fill="#ffffff"/>
  <rect x="1" y="1" width="{width - 2}" height="{height - 2}" rx="18" fill="#f8fbff" stroke="#dbe6f3"/>
  <polyline points="{points}" fill="none" stroke="#e5484d" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="{start[0]:.2f}" cy="{start[1]:.2f}" r="7" fill="#2fb344"/>
  <path d="M {end[0] - 8:.2f} {end[1] + 8:.2f} L {end[0]:.2f} {end[1] - 8:.2f} L {end[0] + 8:.2f} {end[1] + 8:.2f} Z" fill="#7c3aed"/>
  <text x="22" y="34" font-family="Inter, Arial, sans-serif" font-size="18" font-weight="700" fill="#111827">Trajectory preview</text>
  <text x="22" y="58" font-family="Inter, Arial, sans-serif" font-size="13" fill="#667085">Mock output until a real AprilVINS command is configured.</text>
</svg>
"""
    svg_path = output_dir / "trajectory_preview.svg"
    svg_path.write_text(svg, encoding="utf-8")
    return svg_path


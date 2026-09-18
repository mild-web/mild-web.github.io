from __future__ import annotations

import json
import shlex
import subprocess
import traceback
from pathlib import Path

from .config import Settings
from .store import JobStore, utc_now
from .visualizer import write_mock_trajectory, write_svg_preview


def _artifact_map(output_dir: Path) -> dict[str, str]:
    artifacts: dict[str, str] = {}
    for path in sorted(output_dir.iterdir()):
        if path.is_file():
            artifacts[path.name] = path.name
    return artifacts


def _write_log(output_dir: Path, lines: list[str]) -> Path:
    path = output_dir / "run_log.txt"
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path


def _run_command(settings: Settings, manifest: dict, input_file: Path, output_dir: Path, job_dir: Path) -> list[str]:
    metadata = manifest.get("metadata", {})
    template = settings.aprilvins_command_template
    command = template.format(
        input_file=str(input_file),
        output_dir=str(output_dir),
        job_dir=str(job_dir),
        tag_size_m=metadata.get("tag_size_m", "0.108"),
        sensor_route=metadata.get("sensor_route", "insta360_x5"),
    )
    args = shlex.split(command)
    completed = subprocess.run(args, cwd=str(job_dir), text=True, capture_output=True, check=False)
    return [
        f"[{utc_now()}] Real AprilVINS command executed.",
        f"command: {command}",
        f"return_code: {completed.returncode}",
        "",
        "[stdout]",
        completed.stdout,
        "",
        "[stderr]",
        completed.stderr,
    ]


def process_job(job_id: str, store: JobStore, settings: Settings) -> None:
    try:
        manifest = store.update_status(job_id, "running")
        job_dir = store.job_dir(job_id)
        input_dir = job_dir / "input"
        output_dir = job_dir / "output"
        input_files = [p for p in input_dir.iterdir() if p.is_file()]
        if not input_files:
            raise RuntimeError("no uploaded input file found")
        input_file = input_files[0]

        log_lines = [
            f"[{utc_now()}] Job started.",
            f"job_id: {job_id}",
            f"input_file: {input_file.name}",
            f"mode: {'real-command' if settings.aprilvins_command_template else 'mock'}",
        ]

        if settings.aprilvins_command_template:
            log_lines.extend(_run_command(settings, manifest, input_file, output_dir, job_dir))
        elif settings.mock_without_command:
            csv_path = write_mock_trajectory(output_dir)
            svg_path = write_svg_preview(csv_path, output_dir)
            log_lines.extend(
                [
                    f"[{utc_now()}] No APRILVINS_COMMAND_TEMPLATE configured.",
                    "Generated deterministic mock trajectory for unattended end-to-end testing.",
                    f"trajectory_csv: {csv_path.name}",
                    f"preview_svg: {svg_path.name}",
                ]
            )
        else:
            raise RuntimeError("APRILVINS_COMMAND_TEMPLATE is not configured and mock mode is disabled")

        metadata_path = output_dir / "job_metadata.json"
        metadata_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        _write_log(output_dir, log_lines + [f"[{utc_now()}] Job finished."])
        result_zip = store.package_output(job_id)
        artifacts = _artifact_map(output_dir)
        artifacts["result_package.zip"] = result_zip.name
        store.update_status(job_id, "succeeded", artifacts=artifacts, error=None)
    except Exception as exc:  # keep broad exception to preserve unattended diagnostics
        job_dir = store.job_dir(job_id)
        output_dir = job_dir / "output"
        output_dir.mkdir(parents=True, exist_ok=True)
        _write_log(
            output_dir,
            [
                f"[{utc_now()}] Job failed.",
                str(exc),
                "",
                traceback.format_exc(),
            ],
        )
        store.update_status(job_id, "failed", artifacts=_artifact_map(output_dir), error=str(exc))


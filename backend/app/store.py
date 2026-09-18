from __future__ import annotations

import json
import re
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, BinaryIO


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def safe_filename(name: str) -> str:
    name = Path(name or "upload.zip").name
    name = re.sub(r"[^A-Za-z0-9._-]+", "_", name)
    return name[:160] or "upload.zip"


class JobStore:
    def __init__(self, root: Path):
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)

    def create_job(self, metadata: dict[str, Any]) -> tuple[str, Path]:
        job_id = uuid.uuid4().hex
        job_dir = self.job_dir(job_id)
        (job_dir / "input").mkdir(parents=True, exist_ok=False)
        (job_dir / "output").mkdir(parents=True, exist_ok=False)
        manifest = {
            "job_id": job_id,
            "status": "created",
            "created_at": utc_now(),
            "updated_at": utc_now(),
            "metadata": metadata,
            "artifacts": {},
            "error": None,
        }
        self.write_manifest(job_id, manifest)
        return job_id, job_dir

    def job_dir(self, job_id: str) -> Path:
        if not re.fullmatch(r"[a-f0-9]{32}", job_id):
            raise ValueError("invalid job id")
        return self.root / job_id

    def manifest_path(self, job_id: str) -> Path:
        return self.job_dir(job_id) / "job_metadata.json"

    def read_manifest(self, job_id: str) -> dict[str, Any]:
        with self.manifest_path(job_id).open("r", encoding="utf-8") as fh:
            return json.load(fh)

    def write_manifest(self, job_id: str, manifest: dict[str, Any]) -> None:
        manifest["updated_at"] = utc_now()
        path = self.manifest_path(job_id)
        tmp = path.with_suffix(".json.tmp")
        with tmp.open("w", encoding="utf-8") as fh:
            json.dump(manifest, fh, indent=2, ensure_ascii=False)
            fh.write("\n")
        tmp.replace(path)

    def update_status(
        self,
        job_id: str,
        status: str,
        *,
        artifacts: dict[str, str] | None = None,
        error: str | None = None,
        extra: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        manifest = self.read_manifest(job_id)
        manifest["status"] = status
        if artifacts:
            manifest.setdefault("artifacts", {}).update(artifacts)
        if error is not None:
            manifest["error"] = error
        if extra:
            manifest.update(extra)
        self.write_manifest(job_id, manifest)
        return manifest

    def save_upload(self, job_id: str, source: BinaryIO, filename: str, max_bytes: int) -> tuple[Path, int]:
        target = self.job_dir(job_id) / "input" / safe_filename(filename)
        total = 0
        with target.open("wb") as fh:
            while True:
                chunk = source.read(1024 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > max_bytes:
                    fh.close()
                    target.unlink(missing_ok=True)
                    raise ValueError(f"upload exceeds max size of {max_bytes} bytes")
                fh.write(chunk)
        return target, total

    def package_output(self, job_id: str) -> Path:
        job_dir = self.job_dir(job_id)
        output_dir = job_dir / "output"
        result_zip = job_dir / "result_package.zip"
        if result_zip.exists():
            result_zip.unlink()
        base = result_zip.with_suffix("")
        shutil.make_archive(str(base), "zip", output_dir)
        return result_zip

    def artifact_path(self, job_id: str, artifact_name: str) -> Path:
        if "/" in artifact_name or "\\" in artifact_name or artifact_name.startswith("."):
            raise ValueError("invalid artifact name")
        path = self.job_dir(job_id) / "output" / artifact_name
        if not path.exists():
            raise FileNotFoundError(artifact_name)
        return path


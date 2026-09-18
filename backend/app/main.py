from __future__ import annotations

from pathlib import Path
from typing import Optional

from fastapi import BackgroundTasks, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from typing_extensions import Annotated

from .config import get_settings
from .runner import process_job
from .store import JobStore, safe_filename


settings = get_settings()
store = JobStore(settings.upload_root)

app = FastAPI(title="MILD AprilVINS Upload API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


def _public_manifest(manifest: dict) -> dict:
    job_id = manifest["job_id"]
    result = dict(manifest)
    artifacts = {}
    for name in manifest.get("artifacts", {}):
        if name == "result_package.zip":
            artifacts[name] = f"/api/jobs/{job_id}/result.zip"
        else:
            artifacts[name] = f"/api/jobs/{job_id}/artifacts/{name}"
    result["artifact_urls"] = artifacts
    return result


@app.get("/api/health")
def health() -> dict:
    return {
        "ok": True,
        "storage": "local",
        "mock_without_command": settings.mock_without_command,
        "real_command_configured": bool(settings.aprilvins_command_template),
    }


@app.post("/api/jobs")
async def create_job(
    background_tasks: BackgroundTasks,
    recording: Annotated[UploadFile, File(description="Zipped Insta360 X5 recording package")],
    consent: Annotated[bool, Form(description="User consent for retention and research use")],
    email: Annotated[str, Form()] = "",
    sensor_route: Annotated[str, Form()] = "insta360_x5",
    tag_size_m: Annotated[str, Form()] = "0.108",
    notes: Annotated[str, Form()] = "",
    content_length: Annotated[Optional[int], Header()] = None,
) -> dict:
    if not consent:
        raise HTTPException(status_code=400, detail="Consent is required before uploading data.")
    if content_length and content_length > settings.max_upload_bytes:
        raise HTTPException(status_code=413, detail="Upload exceeds configured size limit.")

    filename = safe_filename(recording.filename or "x5_recording.zip")
    metadata = {
        "email": email.strip(),
        "sensor_route": sensor_route,
        "tag_size_m": tag_size_m,
        "notes": notes.strip(),
        "original_filename": filename,
        "retention_consent": True,
        "retain_uploads": settings.retain_uploads,
    }
    job_id, _job_dir = store.create_job(metadata)
    try:
        input_path, size_bytes = store.save_upload(job_id, recording.file, filename, settings.max_upload_bytes)
    except ValueError as exc:
        raise HTTPException(status_code=413, detail=str(exc)) from exc
    manifest = store.update_status(
        job_id,
        "queued",
        extra={
            "input": {
                "filename": input_path.name,
                "size_bytes": size_bytes,
            }
        },
    )
    background_tasks.add_task(process_job, job_id, store, settings)
    return _public_manifest(manifest)


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str) -> dict:
    try:
        return _public_manifest(store.read_manifest(job_id))
    except (FileNotFoundError, ValueError):
        raise HTTPException(status_code=404, detail="Job not found")


@app.get("/api/jobs/{job_id}/result.zip")
def download_result(job_id: str) -> FileResponse:
    try:
        path = store.job_dir(job_id) / "result_package.zip"
    except ValueError:
        raise HTTPException(status_code=404, detail="Job not found")
    if not path.exists():
        raise HTTPException(status_code=404, detail="Result package is not available yet")
    return FileResponse(path, media_type="application/zip", filename=f"mild_aprilvins_{job_id}.zip")


@app.get("/api/jobs/{job_id}/artifacts/{artifact_name}")
def download_artifact(job_id: str, artifact_name: str) -> FileResponse:
    try:
        path = store.artifact_path(job_id, artifact_name)
    except (FileNotFoundError, ValueError):
        raise HTTPException(status_code=404, detail="Artifact not found")
    media_type = "text/plain"
    if path.suffix == ".svg":
        media_type = "image/svg+xml"
    elif path.suffix == ".csv":
        media_type = "text/csv"
    elif path.suffix == ".json":
        media_type = "application/json"
    return FileResponse(path, media_type=media_type, filename=Path(path).name)

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def _load_env_file() -> None:
    env_path = Path(__file__).resolve().parents[1] / ".env"
    if not env_path.exists():
        return
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


def _bool_env(name: str, default: bool) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _list_env(name: str, default: list[str]) -> list[str]:
    value = os.environ.get(name)
    if not value:
        return default
    return [item.strip() for item in value.split(",") if item.strip()]


@dataclass(frozen=True)
class Settings:
    upload_root: Path
    allowed_origins: list[str]
    max_upload_bytes: int
    retain_uploads: bool
    mock_without_command: bool
    aprilvins_command_template: str


def get_settings() -> Settings:
    _load_env_file()
    root = Path(os.environ.get("MILD_UPLOAD_ROOT", "backend/runtime/jobs")).expanduser()
    return Settings(
        upload_root=root,
        allowed_origins=_list_env(
            "MILD_ALLOWED_ORIGINS",
            ["http://127.0.0.1:5500", "http://localhost:5500", "https://mild-web.github.io"],
        ),
        max_upload_bytes=int(os.environ.get("MILD_MAX_UPLOAD_BYTES", str(20 * 1024 * 1024 * 1024))),
        retain_uploads=_bool_env("MILD_RETAIN_UPLOADS", True),
        mock_without_command=_bool_env("MILD_MOCK_WITHOUT_COMMAND", True),
        aprilvins_command_template=os.environ.get("APRILVINS_COMMAND_TEMPLATE", "").strip(),
    )

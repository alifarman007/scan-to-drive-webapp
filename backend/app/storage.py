"""Where dashboard photos are kept.

Development: a local folder. Production: Azure Blob Storage (to be added as a second class
with the same save/delete methods; switch it in get_storage()).
"""
from pathlib import Path
from typing import Protocol

from app.config import settings


class PhotoStorage(Protocol):
    def save(self, key: str, data: bytes) -> None: ...
    def delete(self, key: str) -> None: ...
    def read(self, key: str) -> bytes: ...


class LocalStorage:
    def __init__(self, base_dir: str | Path):
        self.base = Path(base_dir).resolve()

    def _path(self, key: str) -> Path:
        path = (self.base / key).resolve()
        if self.base not in path.parents:  # block ../ tricks
            raise ValueError("Invalid storage key")
        return path

    def save(self, key: str, data: bytes) -> None:
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)

    def delete(self, key: str) -> None:
        self._path(key).unlink(missing_ok=True)

    def read(self, key: str) -> bytes:
        return self._path(key).read_bytes()


def get_storage() -> PhotoStorage:
    return LocalStorage(settings.storage_dir)


def detect_image_type(data: bytes) -> str | None:
    """File extension if the bytes really are a JPEG, PNG or WebP picture."""
    if data[:3] == b"\xff\xd8\xff":
        return "jpg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    return None

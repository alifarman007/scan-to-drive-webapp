"""Bring dashboard photos saved before 2026-10-11 to the same standard as new ones (app/services/photos.py):
upright, no hidden data, at most 2048 px, JPEG, with size and fingerprint saved.

    python -m app.recompress_photos            # shows what would change, changes nothing
    python -m app.recompress_photos --apply    # does it

Photos that already have their details saved are skipped, so it is safe to run again. A photo file that is
missing or cannot be read is listed and left as it is.
"""
import sys

from sqlalchemy import select

from app.db import SessionLocal
from app.models import TripPhoto
from app.services.photos import BadPhoto, prepare_photo
from app.storage import get_storage


def main() -> None:
    do_it = "--apply" in sys.argv
    storage = get_storage()
    done = skipped = before = after = 0
    with SessionLocal() as db:
        rows = db.scalars(select(TripPhoto).where(TripPhoto.sha256.is_(None)).order_by(TripPhoto.id)).all()
        if not rows:
            print("Nothing to do: every photo already has its details.")
            return
        for row in rows:
            try:
                raw = storage.read(row.file_url)
                pic = prepare_photo(raw)
            except (OSError, ValueError, BadPhoto) as exc:
                skipped += 1
                print(f"  skipped {row.file_url}: {exc.__class__.__name__}")
                continue
            before += len(raw)
            after += len(pic.data)
            done += 1
            if not do_it:
                continue
            new_key = row.file_url.rsplit(".", 1)[0] + ".jpg"
            storage.save(new_key, pic.data)
            if new_key != row.file_url:
                storage.delete(row.file_url)
            row.file_url = new_key
            row.width, row.height = pic.width, pic.height
            row.size_bytes, row.original_bytes, row.sha256 = len(pic.data), len(raw), pic.sha256
            db.commit()
    mb = lambda n: f"{n / 1_000_000:.1f} MB"  # noqa: E731
    print(f"{done} photos {'done' if do_it else 'to do'} ({mb(before)} -> {mb(after)}), {skipped} skipped.")
    if not do_it:
        print("Nothing changed yet. Run again with --apply.")


if __name__ == "__main__":
    main()

"""Every dashboard photo is cleaned and compressed on the server (app/services/photos.py)."""
import io

import pytest
from PIL import Image
from sqlalchemy import select

from app.models import TripPhoto
from app.services.photos import PHOTO_MAX_SIDE, BadPhoto, prepare_photo
from tests.test_admin_trips import hdr, make_admin
from tests.test_end_trip import client, end  # noqa: F401  (client fixture comes from there)
from tests.test_trips import make_car, make_driver, real_jpeg, start


def phone_photo(size=(4000, 3000), orientation=None, gps=True, fmt="JPEG", mode="RGB") -> bytes:
    """Like a phone's camera file: big, with EXIF (rotation tag, GPS, phone model)."""
    img = Image.new(mode, size, (200, 30, 30) if mode == "RGB" else (200, 30, 30, 120))
    for x in range(0, size[0], 40):  # some detail, so the JPEG is not trivially small
        img.paste((20, 20, 20) if mode == "RGB" else (20, 20, 20, 255), (x, 0, x + 8, size[1]))
    exif = Image.Exif()
    exif[0x0110] = "Phone Model X"  # camera model
    if orientation:
        exif[0x0112] = orientation
    if gps:
        exif[0x8825] = {1: "N", 2: (23.0, 46.0, 50.0)}
    buf = io.BytesIO()
    img.save(buf, fmt, exif=exif.tobytes(), quality=95) if fmt == "JPEG" else img.save(buf, fmt)
    return buf.getvalue()


def test_big_phone_photo_is_shrunk_and_stays_jpeg():
    raw = phone_photo()
    p = prepare_photo(raw)
    assert (p.width, p.height) == (PHOTO_MAX_SIDE, 1536) and p.ext == "jpg"
    assert p.original_bytes == len(raw) and len(p.sha256) == 64
    with Image.open(io.BytesIO(p.data)) as img:
        assert img.format == "JPEG" and img.size == (2048, 1536)


def test_hidden_data_is_removed_and_the_photo_is_turned_upright():
    p = prepare_photo(phone_photo(size=(800, 600), orientation=6))  # 6 = "rotate 90° to view"
    with Image.open(io.BytesIO(p.data)) as img:
        assert img.size == (600, 800)  # turned upright
        exif = img.getexif()
        assert 0x0110 not in exif and 0x8825 not in exif and 0x0112 not in exif


def test_small_photo_keeps_its_size_and_png_with_transparency_becomes_jpeg():
    p = prepare_photo(phone_photo(size=(640, 480), fmt="PNG", mode="RGBA"))
    assert (p.width, p.height) == (640, 480) and p.ext == "jpg"
    with Image.open(io.BytesIO(p.data)) as img:
        assert img.mode == "RGB"


def test_full_colour_detail_is_kept_for_reading_digits():
    p = prepare_photo(phone_photo(size=(800, 600)))
    with Image.open(io.BytesIO(p.data)) as img:
        # every channel sampled 1x1 = 4:4:4 (no colour blur around the digit edges)
        assert [(h, v) for _, h, v, _ in img.layer] == [(1, 1), (1, 1), (1, 1)]


def test_garbage_with_a_jpeg_start_is_refused():
    with pytest.raises(BadPhoto):
        prepare_photo(b"\xff\xd8\xff" + b"0" * 500)


def test_upload_stores_the_cleaned_photo_with_its_details(client, db):
    car, driver = make_car(db), make_driver(db)
    raw = phone_photo(size=(3000, 4000), orientation=1)
    r = start(client, driver, car, photo=raw)
    assert r.status_code == 201
    photo = db.scalar(select(TripPhoto).where(TripPhoto.trip_id == r.json()["trip"]["id"]))
    assert (photo.width, photo.height) == (1536, 2048) and photo.file_url.endswith("start.jpg")
    assert photo.original_bytes == len(raw) and photo.size_bytes < len(raw) and photo.sha256


def test_unreadable_upload_is_refused(client, db):
    r = start(client, make_driver(db), make_car(db), photo=b"\xff\xd8\xff" + b"x" * 800)
    assert r.status_code == 400 and r.json()["detail"]["code"] == "INVALID_PHOTO"


def test_admin_sees_when_the_same_photo_was_used_twice(client, db):
    admin = make_admin(db)
    same = real_jpeg((10, 120, 200))
    first = start(client, make_driver(db), make_car(db), photo=same).json()["trip"]["id"]
    second = start(client, make_driver(db), make_car(db), photo=same).json()["trip"]["id"]
    photos = client.get(f"/api/admin/trips/{second}", headers=hdr(admin)).json()["trip"]["photos"]
    assert photos["start"]["reused_on"]["id"] == first


def test_same_picture_for_start_and_end_is_flagged(client, db):
    admin = make_admin(db)
    car, driver = make_car(db), make_driver(db)
    same = real_jpeg((200, 120, 10))
    trip_id = start(client, driver, car, photo=same, with_passenger="false", purpose="Office errand").json()["trip"]["id"]
    end(client, driver, trip_id, photo=same)
    photos = client.get(f"/api/admin/trips/{trip_id}", headers=hdr(admin)).json()["trip"]["photos"]
    assert photos["end"]["reused_on"]["id"] == trip_id and photos["start"]["reused_on"]["id"] == trip_id

"""Dashboard photos: every upload is cleaned up and compressed the same way on the server, whatever the phone sent.

Why on the server too (the phone already shrinks the photo): older phones and some browsers send the original
file, PNG or WebP. Doing it here means every stored photo looks the same, which matters for reading the km
from the photo automatically later (OCR):

- turned upright (phones store "rotate 90°" as a tag, not in the pixels),
- hidden data removed (EXIF: GPS position, phone model, time; the trip already keeps its own GPS),
- at most PHOTO_MAX_SIDE pixels on the long side (enough for the odometer digits to stay sharp),
- saved as JPEG at PHOTO_QUALITY with full colour detail (no 4:2:0 colour blur around the digit edges),
- a fingerprint (SHA-256) and the size are kept with the photo, so the same picture used twice can be spotted.
"""
import hashlib
import io
from dataclasses import dataclass

from PIL import Image, ImageOps, UnidentifiedImageError

PHOTO_MAX_SIDE = 2048
PHOTO_QUALITY = 88
MAX_PIXELS = 60_000_000  # refuse "decompression bomb" files (a normal 48 MP phone photo is fine)


class BadPhoto(ValueError):
    """The file is not a picture we can read."""


@dataclass
class PreparedPhoto:
    data: bytes
    ext: str  # always "jpg"
    width: int
    height: int
    original_bytes: int
    sha256: str


def prepare_photo(raw: bytes) -> PreparedPhoto:
    Image.MAX_IMAGE_PIXELS = MAX_PIXELS
    try:
        with Image.open(io.BytesIO(raw)) as img:
            if img.format == "JPEG":
                # let the decoder skip detail we would throw away anyway (it keeps at least PHOTO_MAX_SIDE)
                img.draft("RGB", (PHOTO_MAX_SIDE, PHOTO_MAX_SIDE))
            img.load()
            img = ImageOps.exif_transpose(img)  # upright, and drops the orientation tag
            if img.mode in ("RGBA", "LA", "P"):
                img = img.convert("RGBA")
                flat = Image.new("RGB", img.size, (255, 255, 255))
                flat.paste(img, mask=img.getchannel("A"))
                img = flat
            elif img.mode != "RGB":
                img = img.convert("RGB")
            longest = max(img.size)
            if longest > PHOTO_MAX_SIDE:
                scale = PHOTO_MAX_SIDE / longest
                img = img.resize((round(img.width * scale), round(img.height * scale)), Image.Resampling.LANCZOS,
                                 reducing_gap=3.0)
            out = io.BytesIO()
            # no exif= argument: nothing from the phone's metadata is written back
            img.save(out, "JPEG", quality=PHOTO_QUALITY, subsampling=0, optimize=True, progressive=True)
            data = out.getvalue()
            return PreparedPhoto(data=data, ext="jpg", width=img.width, height=img.height,
                                 original_bytes=len(raw), sha256=hashlib.sha256(data).hexdigest())
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError) as exc:
        raise BadPhoto(str(exc)) from exc

"""Printable car QR sticker (PDF 8 and 11.2): about 6 x 6 cm, the car code printed under the QR."""
import io

import qrcode
from qrcode.constants import ERROR_CORRECT_M
from qrcode.image.pil import PilImage
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

from app.config import settings

STICKER_MM = 60


def car_qr_link(car_code: str, qr_version: int) -> str:
    """What the sticker holds: only the car code and the sticker version, no personal data."""
    return f"{settings.public_base_url.rstrip('/')}/c/{car_code}?v={qr_version}"


def _qr_image(link: str) -> ImageReader:
    qr = qrcode.QRCode(error_correction=ERROR_CORRECT_M, box_size=12, border=0)
    qr.add_data(link)
    qr.make(fit=True)
    buf = io.BytesIO()
    qr.make_image(image_factory=PilImage, fill_color="black", back_color="white").save(buf, format="PNG")
    buf.seek(0)
    return ImageReader(buf)


def _draw_sticker(c: canvas.Canvas, x: float, y: float, car_code: str, qr_version: int) -> None:
    """Draw one sticker with its lower-left corner at (x, y)."""
    size = STICKER_MM * mm
    pad = 4 * mm
    qr_size = size - 2 * pad - 12 * mm  # room under the QR for the text
    c.setLineWidth(0.3)
    c.setDash(1, 2)
    c.rect(x, y, size, size)  # cut line
    c.setDash()
    c.drawImage(_qr_image(car_qr_link(car_code, qr_version)), x + (size - qr_size) / 2, y + size - pad - qr_size,
                qr_size, qr_size)
    c.setFont("Helvetica-Bold", 13)
    c.drawCentredString(x + size / 2, y + 7.5 * mm, car_code)
    c.setFont("Helvetica", 7.5)
    c.drawCentredString(x + size / 2, y + 3.5 * mm, "Scan to start trip")
    c.setFont("Helvetica", 5)
    c.drawRightString(x + size - 1.5 * mm, y + 1.2 * mm, f"v{qr_version}")


def sticker_pdf(car_code: str, qr_version: int, layout: str = "sticker") -> bytes:
    """layout 'sticker': one 6 x 6 cm page (label printer). 'a4': an A4 page with the sticker at the top left."""
    buf = io.BytesIO()
    if layout == "a4":
        from reportlab.lib.pagesizes import A4
        c = canvas.Canvas(buf, pagesize=A4)
        _draw_sticker(c, 15 * mm, A4[1] - 15 * mm - STICKER_MM * mm, car_code, qr_version)
    else:
        c = canvas.Canvas(buf, pagesize=(STICKER_MM * mm, STICKER_MM * mm))
        _draw_sticker(c, 0, 0, car_code, qr_version)
    c.setTitle(f"{car_code} QR sticker")
    c.showPage()
    c.save()
    return buf.getvalue()

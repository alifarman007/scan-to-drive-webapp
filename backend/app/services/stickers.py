"""Printable car QR sticker (PDF 8 and 11.2): about 6 x 6 cm, the car code printed under the QR."""
import io
from pathlib import Path

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


NAVY = (0x1C / 255, 0x2E / 255, 0x6F / 255)
SKY = (0x9F / 255, 0xB4 / 255, 0xF5 / 255)
LOGO = Path(__file__).resolve().parent.parent / "assets" / "epic-logo-light.png"


def _draw_sticker(c: canvas.Canvas, x: float, y: float, car_code: str, qr_version: int) -> None:
    """Draw one sticker with its lower-left corner at (x, y): a navy band with the Epic logo and the app name,
    the QR on white in the middle (big quiet zone, so any phone camera reads it), the car code and a short line."""
    size = STICKER_MM * mm
    band = 11 * mm
    radius = 3.5 * mm
    # card and cut line
    c.setFillColorRGB(1, 1, 1)
    c.setStrokeColorRGB(0.75, 0.78, 0.85)
    c.setLineWidth(0.3)
    c.setDash(1, 2)
    c.roundRect(x, y, size, size, radius, stroke=1, fill=1)
    c.setDash()
    # navy band along the top (rounded top corners only)
    path = c.beginPath()
    path.moveTo(x, y + size - band)
    path.lineTo(x, y + size - radius)
    path.arcTo(x, y + size - 2 * radius, x + 2 * radius, y + size, startAng=180, extent=-90)
    path.lineTo(x + size - radius, y + size)
    path.arcTo(x + size - 2 * radius, y + size - 2 * radius, x + size, y + size, startAng=90, extent=-90)
    path.lineTo(x + size, y + size - band)
    path.close()
    c.setFillColorRGB(*NAVY)
    c.drawPath(path, stroke=0, fill=1)
    if LOGO.exists():
        logo_h = 5.6 * mm
        c.drawImage(ImageReader(str(LOGO)), x + 4 * mm, y + size - band + (band - logo_h) / 2, logo_h * 286 / 124, logo_h,
                    mask="auto")
    c.setFillColorRGB(1, 1, 1)
    c.setFont("Helvetica-Bold", 7.5)
    c.drawRightString(x + size - 4 * mm, y + size - band / 2 - 1.2 * mm, "Scan-to-Drive")
    # the QR
    qr_size = 29 * mm
    qr_top = y + size - band - 3.4 * mm
    c.drawImage(_qr_image(car_qr_link(car_code, qr_version)), x + (size - qr_size) / 2, qr_top - qr_size, qr_size, qr_size)
    # car code and the line under it
    c.setFillColorRGB(*NAVY)
    c.setFont("Helvetica-Bold", 14)
    c.drawCentredString(x + size / 2, y + 8 * mm, car_code)
    c.setFillColorRGB(0.35, 0.39, 0.47)
    c.setFont("Helvetica", 6.8)
    c.drawCentredString(x + size / 2, y + 4.2 * mm, "Scan to start trip")
    c.setFillColorRGB(*SKY)
    c.setFont("Helvetica", 5)
    c.drawRightString(x + size - 2.5 * mm, y + 1.8 * mm, f"v{qr_version}")


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

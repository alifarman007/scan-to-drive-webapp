"""Phone numbers typed by visitors are compared by digits only, so the same number matches
however it is written: "+880 1712-345678", "8801712345678" and "01712345678" are the same."""
import re


def normalize_phone(raw: str) -> str:
    digits = re.sub(r"\D", "", raw or "")
    if digits.startswith("00"):  # international prefix typed as 00
        digits = digits[2:]
    if digits.startswith("880") and len(digits) >= 12:  # Bangladesh country code -> local form
        digits = "0" + digits[3:]
    return digits

"""The real Epic Group fleet (October 2026), from the two lists the transport office gave:

- "EPIC GROUP CORPORATE OWN VEHICLE LIST" (COMPANY_OWNED_VEHICLE_DETAILS - 01.xlsx): 14 cars, models not given yet
- "LIST OF RENTAL VEHICLES - LANKA BANGLA ENTERPRISE" (List of Rental vehicles.xlsx): 10 cars

Used by app/load_fleet.py (replace the test data with these) and app/seed.py (a new, empty database).

Still to come from Epic, so placeholders for now (all can be edited on the Cars and Drivers pages):
- models of the Epic cars: "Toyota"
- driver IDs: 7 digits given here in list order, Epic drivers from 1239001, vendor drivers after them
- phone numbers: DUMMY_PHONE for everyone
- odometer km: not known (0); each car's first trip sets it
"""
import re

DUMMY_PHONE = "01752156244"
VENDOR_NAME = "Lanka Bangla Enterprise"
FIRST_DRIVER_ID = 1239001

# (registration number as written in the list, driver name)
EPIC_CARS = [
    (" DM GHA -17-3556 ", "Md. Dainul Haque"),
    (" DM CHA-52-3351", "Md. Shariful Islam"),
    (" DM  CHA -53-8889 ", "Md. Ilias Hossain"),
    (" DM CHA-53-7322 ", "Md. Ismail Hossain"),
    (" DM CHA -53-2042 ", "Md. Shariful Islam"),  # same name as car 2; kept as a second driver (see README)
    (" DM GHA -13-3917 ", "Md. Mizanur Rahman"),
    (" DM GHA -17-0857 ", "Md. Nayon"),
    (" DM GHA -53-1135", "Md. Rashed"),
    (" DM GA -27-6992 ", "Md. Sirajul Islam (Liton)"),
    (" DM GA -23-5977 ", "Md. Shakib"),
    (" DM GA -29-8044 ", "Md. Swapan"),
    (" DM GA -23-4201 ", "Md. ShaAlam"),
    (" DM GA -17-8554 ", "Md. Motiar Rahman"),
    ("\xa0DM GA-29-6245", "Md. Salim Hossain"),
]
EPIC_MODEL = "Toyota"

# (model and registration number as written in the list, driver name)
VENDOR_CARS = [
    ("Axio-DM-GA-16-2066", "Masud"),
    ("Axio-DM-GA-34-7673", "Ansir Ali"),
    ("Axio-DM-GA-37-2616", "Hanif"),
    ("Axio-DM-GA-22-9704", "Rana"),
    ("Axio-DM-GA-34-3296", "Tutul"),
    ("Hi-Ace-DM-Cha-19-6893", "Asif"),
    ("Toyota Esq-DM-Cha-12-5358", "Delwar"),
    ("Axio-DM-GA-45-7302", "Rashed"),
    ("Axio-DM-GA-32-4724", "Rakib"),
    ("Axio-DM-GA-39-5264", "Selim-2"),
]
VENDOR_MODELS = {"axio": "Toyota Axio", "hi-ace": "Toyota HiAce", "toyota esq": "Toyota Esquire"}

PLATE_RE = re.compile(r"DM\s*-?\s*(GA|GHA|CHA)\s*-?\s*(\d{2})\s*-\s*(\d{4})", re.I)


def plate(raw: str) -> str:
    """'DM  CHA -53-8889' -> 'DM-CHA 53-8889' (city-class, then the number), the way plates are shown in the app."""
    m = PLATE_RE.search(" ".join(raw.split()))
    if not m:
        raise ValueError(f"Cannot read the registration number {raw!r}")
    return f"DM-{m.group(1).upper()} {m.group(2)}-{m.group(3)}"


def vendor_model(raw: str) -> str:
    head = raw[: raw.upper().index("DM-")].rstrip("-").strip().lower()
    return VENDOR_MODELS[head]


def fleet() -> tuple[list[dict], list[dict]]:
    """(cars, drivers) as rows to insert. Cars CAR-01 ... CAR-24 in list order, Epic first; each car's driver gets
    the next driver ID. Vendor cars have vendor=True (the loader fills in the vendor's id)."""
    cars, drivers = [], []
    rows = [(plate(r), EPIC_MODEL, False, n) for r, n in EPIC_CARS] + [(plate(r), vendor_model(r), True, n) for r, n in VENDOR_CARS]
    for i, (reg, model, vendor, name) in enumerate(rows):
        cars.append({"car_code": f"CAR-{i + 1:02d}", "reg_number": reg, "model": model, "vendor": vendor})
        drivers.append({"employee_id": str(FIRST_DRIVER_ID + i), "name": " ".join(name.split()), "phone": DUMMY_PHONE,
                        "vendor": vendor})
    return cars, drivers

"""The real fleet lists (app/fleet_data.py) read the way the loader and seed use them."""
import pytest

from app.fleet_data import DUMMY_PHONE, fleet, plate, vendor_model


@pytest.mark.parametrize("raw, expected", [
    (" DM GHA -17-3556 ", "DM-GHA 17-3556"),
    (" DM  CHA -53-8889 ", "DM-CHA 53-8889"),
    ("\xa0DM GA-29-6245", "DM-GA 29-6245"),
    ("Axio-DM-GA-16-2066", "DM-GA 16-2066"),
    ("Hi-Ace-DM-Cha-19-6893", "DM-CHA 19-6893"),
])
def test_plates_are_written_one_way(raw, expected):
    assert plate(raw) == expected


def test_vendor_models():
    assert [vendor_model(r) for r in ("Axio-DM-GA-16-2066", "Hi-Ace-DM-Cha-19-6893", "Toyota Esq-DM-Cha-12-5358")] == [
        "Toyota Axio", "Toyota HiAce", "Toyota Esquire"]


def test_fleet_has_24_cars_and_drivers_with_unique_codes_plates_and_ids():
    cars, drivers = fleet()
    assert len(cars) == len(drivers) == 24
    assert sum(c["vendor"] for c in cars) == 10 and cars[13]["car_code"] == "CAR-14" and not cars[13]["vendor"]
    assert len({c["car_code"] for c in cars}) == len({c["reg_number"] for c in cars}) == 24
    ids = [d["employee_id"] for d in drivers]
    assert ids[0] == "1239001" and ids[-1] == "1239024" and len(set(ids)) == 24
    assert all(len(i) == 7 and i.isdigit() for i in ids)
    assert {d["phone"] for d in drivers} == {DUMMY_PHONE} and len(DUMMY_PHONE) == 11
    assert all(c["model"] == "Toyota" for c in cars if not c["vendor"])

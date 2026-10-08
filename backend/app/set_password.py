"""Change (or create) an admin/viewer password from the terminal.

Run from backend/:
    python -m app.set_password admin
    python -m app.set_password newperson --create --role viewer
The password is typed hidden and is never printed or stored in plain text.
"""
import argparse
import getpass
import sys

from sqlalchemy import select

from app.db import SessionLocal
from app.models import AdminRole, AdminUser
from app.security import hash_secret


def main() -> int:
    parser = argparse.ArgumentParser(description="Set an admin/viewer password")
    parser.add_argument("username")
    parser.add_argument("--create", action="store_true", help="create the user if missing")
    parser.add_argument("--role", choices=[r.value for r in AdminRole], default="viewer")
    args = parser.parse_args()

    password = getpass.getpass("New password (8-72 characters): ")
    if getpass.getpass("Repeat password: ") != password:
        print("Passwords do not match.")
        return 1
    if not 8 <= len(password.encode()) <= 72:
        print("Password must be 8 to 72 bytes long.")
        return 1

    with SessionLocal() as db:
        user = db.scalar(select(AdminUser).where(AdminUser.username == args.username))
        if user is None:
            if not args.create:
                print(f"No user '{args.username}'. Add --create --role admin|viewer to create it.")
                return 1
            user = AdminUser(username=args.username, role=AdminRole(args.role), password_hash="")
            db.add(user)
        user.password_hash = hash_secret(password)
        db.commit()
    print(f"Password saved for '{args.username}'.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

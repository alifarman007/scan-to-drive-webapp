from fastapi import HTTPException


def api_error(status_code: int, code: str, message: str, **extra) -> HTTPException:
    """Errors the app can react to: {"detail": {"code": ..., "message": ...}}."""
    return HTTPException(status_code, {"code": code, "message": message, **extra})

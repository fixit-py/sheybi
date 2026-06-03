import os


def is_admin_user(user_id: str) -> bool:
    raw = os.getenv("ADMIN_USER_IDS", "")
    allowed = {s.strip() for s in raw.split(",") if s.strip()}
    return bool(user_id) and user_id in allowed


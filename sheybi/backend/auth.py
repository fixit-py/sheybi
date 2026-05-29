import os
from functools import wraps

import jwt
from flask import g, jsonify, request


PERMITTED_ORIGINS = [
    "http://localhost:3000",
]


def _get_token():
    auth = request.headers.get("Authorization", "")

    if auth.startswith("Bearer "):
        return auth[7:].strip()

    return None


def require_auth(f):
    @wraps(f)
    def wrapped(*args, **kwargs):
        token = _get_token()
        key = os.getenv("CLERK_JWT_KEY")
        print("key", key)
        if not key:
            return jsonify({"error": "missing_clerk_key"}), 500
        if not token:
            return jsonify({"error": "unauthorized"}), 401

        try:
            payload = jwt.decode(
                token,
                key,
                algorithms=["RS256"],
            )

            azp = payload.get("azp")

            if azp and azp not in PERMITTED_ORIGINS:
                return jsonify({"error": "invalid_origin"}), 401

            g.clerk_user_id = payload["sub"]

        except jwt.ExpiredSignatureError:
            return jsonify({"error": "token_expired"}), 401

        except jwt.InvalidTokenError as e:
            return jsonify({"error": "invalid_token", "detail": str(e)}), 401

        return f(*args, **kwargs)

    return wrapped
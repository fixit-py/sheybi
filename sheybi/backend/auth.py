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
        # Dev bypass (explicitly opt-in).
        # When DEV_AUTH=1, you can pass X-Dev-User-Id (and optional X-Dev-User-Name)
        # instead of a Clerk JWT. Never enable in production.
        if os.getenv("DEV_AUTH", "").strip() in ("1", "true", "TRUE", "yes", "YES"):
            dev_user = (request.headers.get("X-Dev-User-Id") or "").strip()
            if dev_user:
                g.clerk_user_id = dev_user
                g.dev_user_name = (request.headers.get("X-Dev-User-Name") or "").strip() or None
                return f(*args, **kwargs)

        token = _get_token()
        if not token:
            return jsonify({"error": "unauthorized"}), 401

        try:
            # Clerk session tokens are RS256-signed; verify with Clerk's JWKS.
            # Configure either:
            # - CLERK_ISSUER (recommended), optionally CLERK_JWKS_URL and CLERK_AUDIENCE
            # - or CLERK_JWKS_URL directly
            unverified = jwt.decode(token, options={"verify_signature": False})

            issuer_env = os.getenv("CLERK_ISSUER")
            issuer_token = unverified.get("iss")
            if issuer_env and issuer_token and issuer_env.rstrip("/") != issuer_token.rstrip("/"):
                return jsonify({"error": "invalid_issuer"}), 401

            jwks_url = os.getenv("CLERK_JWKS_URL")
            if not jwks_url:
                issuer = (issuer_env or issuer_token or "").rstrip("/")
                if not issuer:
                    return jsonify({"error": "missing_clerk_issuer"}), 500
                jwks_url = f"{issuer}/.well-known/jwks.json"

            jwk_client = jwt.PyJWKClient(jwks_url)
            signing_key = jwk_client.get_signing_key_from_jwt(token).key

            audience = os.getenv("CLERK_AUDIENCE")
            payload = jwt.decode(
                token,
                signing_key,
                algorithms=["RS256"],
                audience=audience if audience else None,
                options={"verify_aud": bool(audience)},
            )

            azp = payload.get("azp")

            if azp and azp not in PERMITTED_ORIGINS:
                return jsonify({"error": "invalid_origin"}), 401

            g.clerk_user_id = payload["sub"]

        except jwt.ExpiredSignatureError:
            return jsonify({"error": "token_expired"}), 401

        except jwt.PyJWKClientError as e:
            return jsonify({"error": "jwks_error", "detail": str(e)}), 401

        except jwt.InvalidTokenError as e:
            return jsonify({"error": "invalid_token", "detail": str(e)}), 401

        return f(*args, **kwargs)

    return wrapped

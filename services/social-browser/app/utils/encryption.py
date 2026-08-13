import base64
import hashlib

from cryptography.fernet import Fernet

from app.core.config import get_settings


def _fernet_from_secret(secret: str) -> Fernet:
    key = hashlib.sha256(secret.encode("utf-8")).digest()
    return Fernet(base64.urlsafe_b64encode(key))


def encrypt_cookie_payload(value: str) -> str:
    return (
        _fernet_from_secret(get_settings().COOKIE_ENCRYPTION_KEY)
        .encrypt(value.encode("utf-8"))
        .decode("ascii")
    )


def decrypt_cookie_payload(encrypted: str) -> str:
    return (
        _fernet_from_secret(get_settings().COOKIE_ENCRYPTION_KEY)
        .decrypt(encrypted.encode("ascii"))
        .decode("utf-8")
    )


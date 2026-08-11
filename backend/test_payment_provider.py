import base64
import unittest
from unittest.mock import patch

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

from app.domain.billing import payment_provider


class _FakeResponse:
    def __init__(self, payload):
        self.payload = payload

    def raise_for_status(self):
        return None

    def json(self):
        return self.payload


class _FakeAsyncClient:
    def __init__(self, payload, captured, **_kwargs):
        self.payload = payload
        self.captured = captured

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, traceback):
        return False

    async def post(self, url, data):
        self.captured.update({"url": url, "data": data})
        return _FakeResponse(self.payload)


class PaymentProviderSignatureTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        cls.private_pem = private_key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        ).decode("ascii")
        cls.public_pem = private_key.public_key().public_bytes(
            serialization.Encoding.PEM,
            serialization.PublicFormat.SubjectPublicKeyInfo,
        ).decode("ascii")
        cls.private_raw = "".join(cls.private_pem.splitlines()[1:-1])
        cls.public_raw = "".join(cls.public_pem.splitlines()[1:-1])

    def test_canonicalization_uses_ascii_key_order_and_excludes_signature_empty_and_binary(self) -> None:
        self.assertEqual(
            payment_provider.canonicalize_parameters(
                {
                    "z": "last",
                    "a": "first",
                    "sign": "excluded",
                    "sign_type": "RSA",
                    "empty": "",
                    "none": None,
                    "file": b"bytes",
                }
            ),
            "a=first&z=last",
        )

    def test_v2_uses_official_cashier_and_query_paths(self) -> None:
        self.assertEqual(payment_provider.CHECKOUT_PATH, "/api/pay/submit")
        self.assertEqual(payment_provider.QUERY_PATH, "/api/pay/query")

    def test_sha256_rsa_signature_round_trip_and_tamper_rejection(self) -> None:
        now = 1_721_206_072
        payload = {
            "pid": "1001",
            "money": "9.90",
            "out_trade_no": "RF123",
            "timestamp": str(now),
        }
        signature = payment_provider.sign_parameters(payload, self.private_pem)
        self.assertTrue(base64.b64decode(signature, validate=True))
        signed = {**payload, "sign_type": "RSA", "sign": signature}
        self.assertTrue(
            payment_provider.verify_parameters(
                signed,
                self.public_pem,
                now_timestamp=now,
            )
        )
        self.assertFalse(
            payment_provider.verify_parameters(
                {**signed, "money": "18.90"},
                self.public_pem,
                now_timestamp=now,
            )
        )

    def test_build_signed_fields_keeps_rsa_marker_out_of_signature_content(self) -> None:
        fields = payment_provider.build_signed_fields(
            {
                "pid": "1001",
                "out_trade_no": "RF123",
                "timestamp": "1721206072",
                "type": None,
            },
            self.private_pem,
        )
        self.assertEqual(fields["sign_type"], "RSA")
        self.assertNotIn("type", fields)
        self.assertTrue(
            payment_provider.verify_parameters(
                fields,
                self.public_pem,
                now_timestamp=1_721_206_072,
            )
        )

    def test_headerless_portal_keys_are_supported(self) -> None:
        payload = {
            "pid": "1001",
            "out_trade_no": "RF-RAW",
            "timestamp": "1721206072",
        }
        signature = payment_provider.sign_parameters(payload, self.private_raw)
        self.assertTrue(
            payment_provider.verify_parameters(
                {**payload, "sign": signature, "sign_type": "RSA"},
                self.public_raw,
                now_timestamp=1_721_206_072,
            )
        )

    def test_verification_rejects_missing_stale_and_wrong_sign_type_timestamps(self) -> None:
        now = 1_721_206_072
        payload = {"pid": "1001", "timestamp": str(now)}
        signature = payment_provider.sign_parameters(payload, self.private_pem)
        signed = {**payload, "sign": signature, "sign_type": "RSA"}

        self.assertFalse(
            payment_provider.verify_parameters(
                {"pid": "1001", "sign": signature, "sign_type": "RSA"},
                self.public_pem,
                now_timestamp=now,
            )
        )
        self.assertFalse(
            payment_provider.verify_parameters(
                signed,
                self.public_pem,
                now_timestamp=now + payment_provider.MAX_TIMESTAMP_SKEW_SECONDS + 1,
            )
        )
        self.assertFalse(
            payment_provider.verify_parameters(
                {**signed, "sign_type": "MD5"},
                self.public_pem,
                now_timestamp=now,
            )
        )


class PaymentProviderQueryTests(unittest.IsolatedAsyncioTestCase):
    async def test_query_posts_official_v2_fields_and_verifies_response(self) -> None:
        now = 1_721_206_072
        private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        private_pem = private_key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        ).decode("ascii")
        public_pem = private_key.public_key().public_bytes(
            serialization.Encoding.PEM,
            serialization.PublicFormat.SubjectPublicKeyInfo,
        ).decode("ascii")
        response_fields = {
            "code": "0",
            "pid": "1001",
            "out_trade_no": "RF123",
            "trade_no": "YF123",
            "status": "1",
            "money": "9.90",
            "timestamp": str(now),
            "sign_type": "RSA",
        }
        response_fields["sign"] = payment_provider.sign_parameters(response_fields, private_pem)
        captured = {}

        with (
            patch.object(payment_provider.time, "time", return_value=now),
            patch.object(
                payment_provider.httpx,
                "AsyncClient",
                side_effect=lambda **kwargs: _FakeAsyncClient(
                    response_fields,
                    captured,
                    **kwargs,
                ),
            ),
        ):
            result = await payment_provider.query_order(
                base_url="https://www.yifut.com",
                merchant_id="1001",
                merchant_private_key=private_pem,
                platform_public_key=public_pem,
                merchant_order_no="RF123",
            )

        self.assertEqual(captured["url"], "https://www.yifut.com/api/pay/query")
        self.assertEqual(captured["data"]["out_trade_no"], "RF123")
        self.assertNotIn("trade_no", captured["data"])
        self.assertEqual(captured["data"]["timestamp"], str(now))
        self.assertEqual(result["status"], "1")


if __name__ == "__main__":
    unittest.main()

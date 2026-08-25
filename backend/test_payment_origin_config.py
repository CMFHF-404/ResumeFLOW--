import unittest

from app.config import (
    DEFAULT_YIFUT_BASE_URL,
    _normalize_origin,
    _normalize_public_api_origin,
    _require_exact_https_origin,
    _resolve_yifut_base_url,
    build_public_api_url,
)


class PaymentOriginConfigTests(unittest.TestCase):
    def test_accepts_exact_https_origin(self) -> None:
        for value in ("https://www.yifut.com", "https://www.yifut.com/"):
            with self.subTest(value=value):
                self.assertEqual(
                    _require_exact_https_origin(value, "YIFUT_BASE_URL"),
                    "https://www.yifut.com",
                )

    def test_rejects_non_origin_or_insecure_payment_urls(self) -> None:
        for value in (
            "http://www.yifut.com",
            "https://www.yifut.com/api/pay/submit",
            "https://user@www.yifut.com",
            "https://www.yifut.com?next=evil",
            "https://bad..yifut.com",
            "https://-bad.yifut.com",
            "https://www.yifut.com:0",
            "https://www.yifut.com; form-action *",
            " https://www.yifut.com",
        ):
            with self.subTest(value=value):
                with self.assertRaisesRegex(RuntimeError, "exact HTTPS origin"):
                    _require_exact_https_origin(value, "YIFUT_BASE_URL")

    def test_disabled_invalid_provider_url_falls_back_but_enabled_fails_closed(self) -> None:
        invalid = "http://attacker.invalid/payment"
        self.assertEqual(
            _resolve_yifut_base_url(invalid, enabled=False),
            DEFAULT_YIFUT_BASE_URL,
        )
        with self.assertRaisesRegex(RuntimeError, "exact HTTPS origin"):
            _resolve_yifut_base_url(invalid, enabled=True)


class DeploymentOriginSecurityTests(unittest.TestCase):
    def test_remote_http_is_rejected_for_frontend_and_public_api(self) -> None:
        for normalize in (_normalize_origin, _normalize_public_api_origin):
            with self.subTest(normalize=normalize.__name__):
                with self.assertRaisesRegex(RuntimeError, r"secure HTTP\(S\) base URL"):
                    normalize("http://api.example.test")

    def test_strict_loopback_http_is_canonicalized(self) -> None:
        for normalize in (_normalize_origin, _normalize_public_api_origin):
            for value, expected in (
                ("http://localhost:5173/", "http://localhost:5173"),
                ("http://127.0.0.42:8000/api/", "http://127.0.0.42:8000/api"),
                ("http://[::1]:8000/api/", "http://[::1]:8000/api"),
            ):
                with self.subTest(normalize=normalize.__name__, value=value):
                    self.assertEqual(normalize(value), expected)

    def test_lookalike_loopback_hosts_are_rejected(self) -> None:
        for value in (
            "http://localhost.example.test",
            "http://127.0.0.1.example.test",
            "http://0.0.0.0:8000",
        ):
            with self.subTest(value=value):
                with self.assertRaisesRegex(RuntimeError, r"secure HTTP\(S\) base URL"):
                    _normalize_public_api_origin(value)


class PublicApiOriginPathTests(unittest.TestCase):
    def test_build_public_api_url_preserves_or_deduplicates_mount_prefix(self) -> None:
        for base, path, expected in (
            (
                "https://api.example.test",
                "/api/billing/payments/yifut/notify",
                "https://api.example.test/api/billing/payments/yifut/notify",
            ),
            (
                "https://api.example.test/api",
                "/api/billing/payments/yifut/notify",
                "https://api.example.test/api/billing/payments/yifut/notify",
            ),
            (
                "https://api.example.test/gateway",
                "/api/billing/payments/yifut/notify",
                "https://api.example.test/gateway/api/billing/payments/yifut/notify",
            ),
            (
                "https://api.example.test/gateway/api",
                "/api/billing/payments/yifut/notify",
                "https://api.example.test/gateway/api/billing/payments/yifut/notify",
            ),
            (
                "https://api.example.test/api",
                "/agent/v1/exports/resume-pdf/snapshot-1",
                "https://api.example.test/api/agent/v1/exports/resume-pdf/snapshot-1",
            ),
            (
                "https://api.example.test/gateway/api",
                "/agent/v1/exports/resume-pdf/snapshot-1",
                "https://api.example.test/gateway/api/agent/v1/exports/resume-pdf/snapshot-1",
            ),
        ):
            with self.subTest(base=base, path=path):
                self.assertEqual(build_public_api_url(base, path), expected)

    def test_build_public_api_url_rejects_ambiguous_or_absolute_paths(self) -> None:
        for path in (
            "https://attacker.invalid/exports/render-snapshots/snapshot-1",
            "//attacker.invalid/exports/render-snapshots/snapshot-1",
            "/exports/../private",
            "/exports/%2Fprivate",
            "/exports/render-snapshots/snapshot-1?next=attacker",
            "/exports/render-snapshots/snapshot-1#fragment",
        ):
            with self.subTest(path=path):
                with self.assertRaisesRegex(ValueError, "relative API path"):
                    build_public_api_url("https://api.example.test/api", path)


if __name__ == "__main__":
    unittest.main()

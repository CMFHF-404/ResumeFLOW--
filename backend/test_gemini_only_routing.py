import asyncio
import os
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from app import config as config_module
from app.domain.ai import llm_transport

import verify_ai


GEMINI_MODEL = "gemini-3.5-flash-lite"


class GeminiOnlyRoutingTests(unittest.TestCase):
    def _load_settings(self, environment: dict[str, str]):
        required_env = {
            "DATABASE_URL": "postgresql://user:password@localhost:5432/resumeflow",
            "LOGTO_ISSUER": "https://example.logto.app/oidc",
            "LOGTO_APP_ID": "resume-spa-app-id",
        }
        with patch.dict(os.environ, {**required_env, **environment}, clear=True):
            with patch.object(config_module, "_load_env", return_value=None):
                config_module._settings = None
                try:
                    return config_module.load_settings()
                finally:
                    config_module._settings = None

    def _run_gemini_stream_probe(self, lines: list[str]) -> bool:
        route = verify_ai.ProbeRoute(
            lane="thinking",
            provider="gemini",
            api_key="gemini-key",
            base_url="https://generativelanguage.googleapis.com/v1beta",
            model=GEMINI_MODEL,
            transport="gemini_stream_generate_content",
        )

        class Response:
            status_code = 200

            async def aread(self) -> bytes:
                return b""

            async def aiter_lines(self):
                for line in lines:
                    yield line

        class StreamContext:
            async def __aenter__(self):
                return Response()

            async def __aexit__(self, exc_type, exc, traceback):
                return False

        class Client:
            def __init__(self, **kwargs):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, exc_type, exc, traceback):
                return False

            def stream(self, *args, **kwargs):
                return StreamContext()

        with patch.object(verify_ai.httpx, "AsyncClient", Client):
            return asyncio.run(verify_ai.test_gemini_stream(route))

    def _production_environment(self) -> dict[str, str]:
        return {
            "RESUMEFLOW_DEPLOYMENT_MODE": "production",
            "FRONTEND_ORIGIN": "https://app.example.com",
            "CORS_ALLOW_ORIGINS": "https://app.example.com",
            "FRONTEND_LOGTO_ENDPOINT": "https://example.logto.app",
            "FRONTEND_LOGTO_APP_ID": "resume-spa-app-id",
            "FRONTEND_LOGTO_REDIRECT_URI": "https://app.example.com/callback",
            "PUBLIC_API_ORIGIN": "https://api.example.com",
        }

    def test_gemini_primary_routes_resume_parse_through_gemini(self) -> None:
        fake_settings = SimpleNamespace(
            ai_route_profile="gemini_primary",
            ai_api_key="unused-openai-key",
            ai_base_url="https://unused.example.com/v1",
            ai_model="unused-model",
            ai_fast_api_key="unused-fast-key",
            ai_fast_base_url="https://unused-fast.example.com/v1",
            ai_fast_model="unused-fast-model",
            gemini_api_key="gemini-key",
            gemini_base_url="https://generativelanguage.googleapis.com/v1beta",
            gemini_model=GEMINI_MODEL,
        )

        with patch.object(llm_transport, "settings", fake_settings):
            route = llm_transport._resolve_ai_route(
                lane=llm_transport.LANE_RESUME_PARSE
            )

        self.assertEqual(route.provider, "gemini")
        self.assertEqual(route.model, GEMINI_MODEL)
        self.assertEqual(route.transport, "gemini_generate_content")

    def test_verify_ai_routes_resume_parse_through_gemini(self) -> None:
        with patch.dict(
            os.environ,
            {
                "AI_ROUTE_PROFILE": "gemini_primary",
                "AI_FAST_API_KEY": "unused-fast-key",
                "AI_FAST_BASE_URL": "https://unused-fast.example.com/v1",
                "AI_FAST_MODEL": "unused-fast-model",
                "GEMINI_API_KEY": "gemini-key",
                "GEMINI_BASE_URL": "https://generativelanguage.googleapis.com/v1beta",
                "GEMINI_MODEL": GEMINI_MODEL,
            },
            clear=True,
        ):
            route = verify_ai.resolve_route("resume_parse")

        self.assertEqual(route.provider, "gemini")
        self.assertEqual(route.model, GEMINI_MODEL)
        self.assertEqual(route.transport, "gemini_generate_content")

    def test_default_settings_use_only_gemini_flash_lite_models(self) -> None:
        settings = self._load_settings({})

        self.assertEqual(settings.ai_route_profile, "gemini_primary")
        self.assertEqual(settings.ai_model, GEMINI_MODEL)
        self.assertEqual(settings.ai_fast_model, GEMINI_MODEL)
        self.assertEqual(settings.ai_dedupe_model, GEMINI_MODEL)
        self.assertEqual(settings.gemini_model, GEMINI_MODEL)

    def test_production_gemini_default_rejects_an_ai_api_key_without_gemini_key(self) -> None:
        with self.assertRaisesRegex(
            RuntimeError,
            "GEMINI_API_KEY.*gemini_primary",
        ):
            self._load_settings(
                {
                    **self._production_environment(),
                    "AI_API_KEY": "legacy-openai-key",
                }
            )

    def test_production_explicit_openai_profile_does_not_require_gemini_key(self) -> None:
        settings = self._load_settings(
            {
                **self._production_environment(),
                "AI_ROUTE_PROFILE": "openai_primary",
                "AI_API_KEY": "openai-key",
                "AI_BASE_URL": "https://relay.example/v1",
                "AI_RESPONSES_BASE_URL": "https://relay.example/responses/v1",
                "AI_MODEL": "gpt-test",
            }
        )

        self.assertEqual(settings.ai_route_profile, "openai_primary")
        self.assertIsNone(settings.gemini_api_key)

    def test_production_openai_and_qwen_profiles_require_ai_api_key(self) -> None:
        cases = (
            (
                "openai_primary",
                {
                    "AI_BASE_URL": "https://api.openai.com/v1",
                    "AI_RESPONSES_BASE_URL": "https://api.openai.com/v1",
                    "AI_MODEL": "gpt-4.1",
                },
            ),
            (
                "qwen_primary",
                {
                    "AI_BASE_URL": "https://dashscope.aliyuncs.com/compatible-mode/v1",
                    "AI_MODEL": "qwen3.7-plus",
                },
            ),
        )
        for profile, profile_env in cases:
            for missing_key in (None, "   "):
                environment = {
                    **self._production_environment(),
                    "AI_ROUTE_PROFILE": profile,
                    **profile_env,
                }
                if missing_key is not None:
                    environment["AI_API_KEY"] = missing_key
                with self.subTest(profile=profile, key=missing_key):
                    with self.assertRaisesRegex(
                        RuntimeError,
                        rf"AI_API_KEY.*{profile}",
                    ):
                        self._load_settings(environment)

    def test_production_hybrid_requires_credentials_for_every_active_lane(self) -> None:
        cases = (
            (
                "missing resume_parse credentials",
                {"GEMINI_API_KEY": "gemini-key"},
                "AI_API_KEY.*resume_parse",
            ),
            (
                "missing default credentials",
                {
                    "AI_FAST_API_KEY": "fast-key",
                    "AI_FAST_BASE_URL": "https://fast.example/v1",
                },
                "AI_API_KEY or GEMINI_API_KEY.*default",
            ),
        )
        for label, credentials, expected_error in cases:
            with self.subTest(label=label):
                with self.assertRaisesRegex(RuntimeError, expected_error):
                    self._load_settings(
                        {
                            **self._production_environment(),
                            "AI_ROUTE_PROFILE": "hybrid_gemini_aifast",
                            "AI_MODEL": "qwen3.7-plus",
                            **credentials,
                        }
                    )

    def test_production_hybrid_accepts_independent_gemini_and_fast_credentials(self) -> None:
        settings = self._load_settings(
            {
                **self._production_environment(),
                "AI_ROUTE_PROFILE": "hybrid_gemini_aifast",
                "GEMINI_API_KEY": "gemini-key",
                "AI_FAST_API_KEY": "fast-key",
                "AI_FAST_BASE_URL": "https://fast.example/v1",
                "AI_FAST_MODEL": "fast-parser",
            }
        )

        self.assertIsNone(settings.ai_api_key)
        self.assertEqual(settings.gemini_api_key, "gemini-key")
        self.assertEqual(settings.ai_fast_api_key, "fast-key")
        self.assertEqual(settings.ai_fast_base_url, "https://fast.example/v1")

        with patch.object(llm_transport, "settings", settings):
            default_route = llm_transport._resolve_ai_route(
                lane=llm_transport.LANE_DEFAULT
            )
            parse_route = llm_transport._resolve_ai_route(
                lane=llm_transport.LANE_RESUME_PARSE
            )

        self.assertEqual(default_route.provider, "gemini")
        self.assertEqual(default_route.api_key, "gemini-key")
        self.assertEqual(parse_route.api_key, "fast-key")
        self.assertEqual(parse_route.base_url, "https://fast.example/v1")

    def test_production_openai_profile_rejects_known_non_streaming_models(self) -> None:
        for model in (
            "o1-pro",
            "o1-pro-2025-03-19",
            "o3-pro",
            "o3-pro-2025-06-10",
            "gpt-5.5-pro",
            "gpt-5.5-pro-2026-04-23",
        ):
            with self.subTest(model=model):
                with self.assertRaisesRegex(
                    RuntimeError,
                    "AI_MODEL.*streaming",
                ):
                    self._load_settings(
                        {
                            **self._production_environment(),
                            "AI_ROUTE_PROFILE": "openai_primary",
                            "AI_API_KEY": "openai-key",
                            "AI_BASE_URL": "https://api.openai.com/v1",
                            "AI_MODEL": model,
                        }
                    )

    def test_active_gemini_model_must_be_nonempty_and_gemini_family(self) -> None:
        for profile in ("gemini_primary", "hybrid_gemini_aifast"):
            for model in ("", "   ", "gpt-4o"):
                environment = {
                    **self._production_environment(),
                    "AI_ROUTE_PROFILE": profile,
                    "GEMINI_API_KEY": "gemini-key",
                    "GEMINI_MODEL": model,
                }
                if profile == "hybrid_gemini_aifast":
                    environment.update(
                        {
                            "AI_FAST_API_KEY": "fast-key",
                            "AI_FAST_BASE_URL": "https://fast.example/v1",
                            "AI_FAST_MODEL": "fast-parser",
                        }
                    )
                with self.subTest(profile=profile, model=model):
                    with self.assertRaisesRegex(RuntimeError, "GEMINI_MODEL"):
                        self._load_settings(environment)

    def test_production_rejects_remote_plain_http_for_every_active_ai_lane(self) -> None:
        cases = (
            (
                "gemini_primary",
                {
                    "GEMINI_API_KEY": "gemini-key",
                    "GEMINI_BASE_URL": "http://gemini.example/v1beta",
                },
                "GEMINI_BASE_URL",
            ),
            (
                "openai_primary",
                {
                    "AI_API_KEY": "openai-key",
                    "AI_BASE_URL": "http://openai.example/v1",
                    "AI_RESPONSES_BASE_URL": "http://openai.example/v1",
                    "AI_MODEL": "gpt-4.1",
                },
                "AI_BASE_URL",
            ),
            (
                "qwen_primary",
                {
                    "AI_API_KEY": "qwen-key",
                    "AI_BASE_URL": "http://qwen.example/v1",
                    "AI_MODEL": "qwen3.7-plus",
                },
                "AI_BASE_URL",
            ),
            (
                "hybrid_gemini_aifast",
                {
                    "GEMINI_API_KEY": "gemini-key",
                    "GEMINI_BASE_URL": "https://gemini.example/v1beta",
                    "AI_FAST_API_KEY": "fast-key",
                    "AI_FAST_BASE_URL": "http://fast.example/v1",
                    "AI_FAST_MODEL": "fast-parser",
                },
                "AI_FAST_BASE_URL",
            ),
        )
        for profile, profile_env, expected_name in cases:
            with self.subTest(profile=profile):
                with self.assertRaisesRegex(RuntimeError, expected_name):
                    self._load_settings(
                        {
                            **self._production_environment(),
                            "AI_ROUTE_PROFILE": profile,
                            **profile_env,
                        }
                    )

    def test_production_allows_loopback_http_ai_sidecars(self) -> None:
        settings = self._load_settings(
            {
                **self._production_environment(),
                "AI_ROUTE_PROFILE": "hybrid_gemini_aifast",
                "GEMINI_API_KEY": "gemini-key",
                "GEMINI_BASE_URL": "http://localhost:9000/v1beta",
                "AI_FAST_API_KEY": "fast-key",
                "AI_FAST_BASE_URL": "http://127.0.0.1:9001/v1",
                "AI_FAST_MODEL": "fast-parser",
            }
        )

        self.assertEqual(settings.gemini_base_url, "http://localhost:9000/v1beta")
        self.assertEqual(settings.ai_fast_base_url, "http://127.0.0.1:9001/v1")

    def test_verify_ai_reuses_active_provider_model_and_url_boundaries(self) -> None:
        invalid_environments = (
            (
                {
                    "RESUMEFLOW_DEPLOYMENT_MODE": "production",
                    "AI_ROUTE_PROFILE": "gemini_primary",
                    "GEMINI_API_KEY": "gemini-key",
                    "GEMINI_BASE_URL": "http://gemini.example/v1beta",
                },
                "GEMINI_BASE_URL",
            ),
            (
                {
                    "RESUMEFLOW_DEPLOYMENT_MODE": "production",
                    "AI_ROUTE_PROFILE": "gemini_primary",
                    "GEMINI_API_KEY": "gemini-key",
                    "GEMINI_MODEL": "gpt-4o",
                },
                "GEMINI_MODEL",
            ),
            (
                {
                    "RESUMEFLOW_DEPLOYMENT_MODE": "production",
                    "AI_ROUTE_PROFILE": "openai_primary",
                    "AI_API_KEY": "openai-key",
                    "AI_BASE_URL": "https://api.openai.com/v1",
                    "AI_MODEL": "o3-pro",
                },
                "AI_MODEL.*streaming",
            ),
        )
        for environment, expected_error in invalid_environments:
            with self.subTest(environment=environment):
                with patch.dict(os.environ, environment, clear=True):
                    with self.assertRaisesRegex(RuntimeError, expected_error):
                        verify_ai.resolve_route("thinking")

    def test_verify_ai_hybrid_accepts_gemini_plus_independent_fast_without_primary(self) -> None:
        environment = {
            "RESUMEFLOW_DEPLOYMENT_MODE": "production",
            "AI_ROUTE_PROFILE": "hybrid_gemini_aifast",
            "GEMINI_API_KEY": "gemini-key",
            "GEMINI_MODEL": GEMINI_MODEL,
            "AI_FAST_API_KEY": "fast-key",
            "AI_FAST_BASE_URL": "https://fast.example/v1",
            "AI_FAST_MODEL": "fast-parser",
        }
        with patch.dict(os.environ, environment, clear=True):
            default_route = verify_ai.resolve_route("default")
            parse_route = verify_ai.resolve_route("resume_parse")

        self.assertEqual(default_route.provider, "gemini")
        self.assertEqual(default_route.api_key, "gemini-key")
        self.assertEqual(parse_route.api_key, "fast-key")
        self.assertEqual(parse_route.model, "fast-parser")

    def test_gemini_primary_ignores_stale_fast_and_dedupe_model_overrides(self) -> None:
        selected_model = "gemini-3.1-flash-lite"
        settings = self._load_settings(
            {
                "AI_ROUTE_PROFILE": "gemini_primary",
                "AI_FAST_MODEL": "legacy-fast-model",
                "AI_DEDUPE_MODEL": "legacy-dedupe-model",
                "GEMINI_MODEL": selected_model,
            }
        )

        self.assertEqual(settings.ai_model, selected_model)
        self.assertEqual(settings.ai_fast_model, selected_model)
        self.assertEqual(settings.ai_dedupe_model, selected_model)
        self.assertEqual(settings.gemini_model, selected_model)

    def test_fast_endpoint_and_key_must_be_configured_as_a_pair(self) -> None:
        for fast_setting in (
            {"AI_FAST_BASE_URL": "https://fast-relay.example/v1"},
            {"AI_FAST_API_KEY": "fast-key"},
        ):
            with self.subTest(fast_setting=fast_setting):
                with self.assertRaisesRegex(
                    RuntimeError,
                    "AI_FAST_BASE_URL and AI_FAST_API_KEY must be configured together",
                ):
                    self._load_settings(
                        {
                            "AI_ROUTE_PROFILE": "openai_primary",
                            "AI_API_KEY": "primary-key",
                            "AI_BASE_URL": "https://relay.example/v1",
                            "AI_MODEL": "gpt-test",
                            **fast_setting,
                        }
                    )

    def test_openai_primary_allows_a_same_origin_responses_relay(self) -> None:
        settings = self._load_settings(
            {
                "AI_ROUTE_PROFILE": "openai_primary",
                "AI_API_KEY": "primary-key",
                "AI_BASE_URL": "https://relay.example/v1",
                "AI_RESPONSES_BASE_URL": "https://relay.example/responses/v1",
                "AI_MODEL": "gpt-test",
            }
        )

        self.assertEqual(
            settings.ai_responses_base_url,
            "https://relay.example/responses/v1",
        )

    def test_same_origin_recognizes_explicit_default_http_ports(self) -> None:
        for first_url, second_url in (
            ("https://relay.example/v1", "https://relay.example:443/responses"),
            ("http://relay.example/v1", "http://relay.example:80/responses"),
        ):
            with self.subTest(first_url=first_url, second_url=second_url):
                self.assertTrue(
                    config_module._has_same_http_origin(first_url, second_url)
                )

    def test_openai_primary_rejects_a_cross_origin_responses_endpoint(self) -> None:
        with self.assertRaisesRegex(
            RuntimeError,
            "AI_RESPONSES_BASE_URL must share an origin with AI_BASE_URL",
        ):
            self._load_settings(
                {
                    "AI_ROUTE_PROFILE": "openai_primary",
                    "AI_API_KEY": "primary-key",
                    "AI_BASE_URL": "https://relay.example/v1",
                    "AI_RESPONSES_BASE_URL": "https://responses.example/v1",
                    "AI_MODEL": "gpt-test",
                }
            )

    def test_verify_ai_rejects_a_fast_endpoint_without_its_own_key(self) -> None:
        with patch.dict(
            os.environ,
            {
                "AI_ROUTE_PROFILE": "openai_primary",
                "AI_API_KEY": "primary-key",
                "AI_BASE_URL": "https://relay.example/v1",
                "AI_MODEL": "gpt-test",
                "AI_FAST_BASE_URL": "https://fast-relay.example/v1",
            },
            clear=True,
        ):
            with self.assertRaisesRegex(
                RuntimeError,
                "AI_FAST_BASE_URL and AI_FAST_API_KEY must be configured together",
            ):
                verify_ai.resolve_route("resume_parse")

    def test_verify_ai_rejects_a_cross_origin_responses_endpoint(self) -> None:
        with patch.dict(
            os.environ,
            {
                "AI_ROUTE_PROFILE": "openai_primary",
                "AI_API_KEY": "primary-key",
                "AI_BASE_URL": "https://relay.example/v1",
                "AI_RESPONSES_BASE_URL": "https://responses.example/v1",
                "AI_MODEL": "gpt-test",
            },
            clear=True,
        ):
            with self.assertRaisesRegex(
                RuntimeError,
                "AI_RESPONSES_BASE_URL must share an origin with AI_BASE_URL",
            ):
                verify_ai.resolve_route("thinking")

    def test_verify_ai_gemini3_stream_payload_uses_thinking_level(self) -> None:
        route = verify_ai.ProbeRoute(
            lane="thinking",
            provider="gemini",
            api_key="gemini-key",
            base_url="https://generativelanguage.googleapis.com/v1beta",
            model=GEMINI_MODEL,
            transport="gemini_stream_generate_content",
        )

        generation_config = verify_ai.build_gemini_stream_probe_generation_config(route)

        self.assertNotIn("temperature", generation_config)
        self.assertEqual(
            generation_config["thinkingConfig"],
            {"includeThoughts": True, "thinkingLevel": "low"},
        )

    def test_verify_ai_rejects_an_empty_successful_gemini_stream(self) -> None:
        self.assertFalse(self._run_gemini_stream_probe([]))

    def test_verify_ai_rejects_a_gemini_stream_with_only_an_empty_json_object(self) -> None:
        self.assertFalse(self._run_gemini_stream_probe(["data: {} "]))

    def test_non_gemini_profiles_require_an_explicit_compatible_ai_model(self) -> None:
        required_env = {
            "DATABASE_URL": "postgresql://user:password@localhost:5432/resumeflow",
            "LOGTO_ISSUER": "https://example.logto.app/oidc",
            "LOGTO_APP_ID": "resume-spa-app-id",
        }
        for profile in ("openai_primary", "qwen_primary", "hybrid_gemini_aifast"):
            with self.subTest(profile=profile):
                with patch.dict(
                    os.environ,
                    {**required_env, "AI_ROUTE_PROFILE": profile},
                    clear=True,
                ):
                    with patch.object(config_module, "_load_env", return_value=None):
                        config_module._settings = None
                        try:
                            with self.assertRaisesRegex(
                                RuntimeError,
                                "AI_MODEL.*explicitly configured",
                            ):
                                config_module.load_settings()
                        finally:
                            config_module._settings = None

    def test_non_gemini_profiles_reject_gemini_models_on_compatible_lanes(self) -> None:
        required_env = {
            "DATABASE_URL": "postgresql://user:password@localhost:5432/resumeflow",
            "LOGTO_ISSUER": "https://example.logto.app/oidc",
            "LOGTO_APP_ID": "resume-spa-app-id",
            "AI_MODEL": GEMINI_MODEL,
        }
        for profile in ("openai_primary", "qwen_primary", "hybrid_gemini_aifast"):
            with self.subTest(profile=profile):
                with patch.dict(
                    os.environ,
                    {**required_env, "AI_ROUTE_PROFILE": profile},
                    clear=True,
                ):
                    with patch.object(config_module, "_load_env", return_value=None):
                        config_module._settings = None
                        try:
                            with self.assertRaisesRegex(
                                RuntimeError,
                                "AI_MODEL.*Gemini model",
                            ):
                                config_module.load_settings()
                        finally:
                            config_module._settings = None

    def test_verify_ai_rejects_implicit_gemini_model_for_non_gemini_profile(self) -> None:
        with patch.dict(
            os.environ,
            {"AI_ROUTE_PROFILE": "openai_primary"},
            clear=True,
        ):
            with self.assertRaisesRegex(
                RuntimeError,
                "AI_MODEL.*explicitly configured",
            ):
                verify_ai.resolve_route("default")


if __name__ == "__main__":
    unittest.main()

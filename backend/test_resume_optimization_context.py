from __future__ import annotations

from copy import deepcopy
from datetime import date, datetime, timezone
import json
import os
from types import SimpleNamespace
import unittest
import uuid
from unittest.mock import AsyncMock, patch


def _set_required_env_defaults() -> None:
    os.environ["DATABASE_URL"] = (
        "postgresql+asyncpg://user:password@localhost:5432/resumeflow"
    )
    os.environ.setdefault("LOGTO_ISSUER", "https://example.logto.app/oidc")
    os.environ.setdefault("LOGTO_APP_ID", "resume-spa-app-id")


_set_required_env_defaults()

from app.domain.resume.resume_service import NotFoundError as ResumeNotFoundError  # noqa: E402
from app.domain.resume_optimization import context_service  # noqa: E402
from app.domain.resume_optimization.schemas import ResumeOptimizationStartRequest  # noqa: E402
from app.models import ExperienceCategory  # noqa: E402


USER_ID = "user-a"
RESUME_ID = uuid.UUID("11111111-1111-1111-1111-111111111111")
SELECTED_MASTER_ID = uuid.UUID("22222222-2222-2222-2222-222222222222")
UNSELECTED_MASTER_ID = uuid.UUID("33333333-3333-3333-3333-333333333333")
SELECTED_OLD_VERSION_ID = uuid.UUID("44444444-4444-4444-4444-444444444444")
SELECTED_NEW_VERSION_ID = uuid.UUID("55555555-5555-5555-5555-555555555555")
RESUME_LINK_ID = uuid.UUID("66666666-6666-6666-6666-666666666666")
BASE_TIME = datetime(2026, 9, 1, 3, 0, tzinfo=timezone.utc)


def _request(**overrides) -> ResumeOptimizationStartRequest:
    values = {
        "resume_id": str(RESUME_ID),
        "evaluation_signature": "evaluation-signature",
        "expected_resume_updated_at": BASE_TIME.isoformat(),
        "include_bank_suggestions": True,
    }
    values.update(overrides)
    return ResumeOptimizationStartRequest.model_validate(values)


def _evaluation() -> dict:
    return {
        "evaluationVersion": "resume_flow_v1",
        "evaluationScope": "full_resume",
        "overallScore": 72,
        "issues": [],
    }


def _resume(*, config_overrides: dict | None = None):
    jd_analysis = {
        "result": {
            "resumeEvaluation": _evaluation(),
            "experienceMatches": [
                {
                    "id": str(UNSELECTED_MASTER_ID),
                    "score": 91,
                    "reason": "strong roadmap evidence",
                }
            ],
        },
        "evaluationSignature": "evaluation-signature",
        "evaluationIsOutdated": False,
        "jdInputSignature": "jd-signature",
    }
    config = {
        "selection": {"experienceIds": [str(SELECTED_MASTER_ID)]},
        "jdAnalysis": jd_analysis,
    }
    if config_overrides:
        for key, value in config_overrides.items():
            if key == "jdAnalysis" and isinstance(value, dict):
                jd_analysis.update(value)
            else:
                config[key] = value
    return SimpleNamespace(
        id=RESUME_ID,
        user_id=USER_ID,
        title="Product resume",
        target_role="Product Manager",
        config=config,
        updated_at=BASE_TIME,
    )


def _resume_item(
    *,
    link_id: uuid.UUID = RESUME_LINK_ID,
    master_id: uuid.UUID = SELECTED_MASTER_ID,
    version_id: uuid.UUID = SELECTED_OLD_VERSION_ID,
):
    return SimpleNamespace(
        id=str(link_id),
        resume_id=str(RESUME_ID),
        experience_version_id=str(version_id),
        display_order=0,
        overrides_json={
            "summary": "short resume override",
            "star": {"s": "short situation", "t": "", "a": "", "r": ""},
        },
        experience=SimpleNamespace(
            master_experience_id=str(master_id),
            title="Selected role",
            org="Selected org",
            summary="short resume override",
            star={"s": "short situation", "t": "", "a": "", "r": ""},
        ),
    )


def _selected_old_version():
    return SimpleNamespace(
        id=SELECTED_OLD_VERSION_ID,
        master_experience_id=SELECTED_MASTER_ID,
        version=1,
        title="Selected source role",
        org="Selected source org",
        start_date=date(2023, 1, 1),
        end_date=date(2024, 2, 1),
        is_current=False,
        summary="full selected source summary",
        highlights=["private selected highlight"],
        tags=["private selected tag"],
        star={
            "s": "full selected situation",
            "t": "full selected task",
            "a": "full selected action",
            "r": "full selected result",
        },
    )


def _analysis_text(*, selected: bool = True) -> str:
    experiences = []
    if selected:
        experiences.append(
            {
                "id": str(SELECTED_MASTER_ID),
                "category": "work",
                "title": "Selected role",
                "org": "Selected org",
                "start_date": "2023-01",
                "end_date": "2024-02",
                "star": {
                    "s": "short situation",
                    "t": "",
                    "a": "short action",
                    "r": "",
                },
            }
        )
    return json.dumps(
        {
            "evaluation_scope": "full_resume",
            "target_role": "Product Manager",
            "resume": {
                "section_order": ["summary", "work", "skills"],
                "profile": {"name": "Candidate"},
                "personal_summary": "Current summary",
                "experiences": experiences,
                "educations": [],
                "certifications": [],
                "skills": [
                    {"id": "skill-1", "name": "SQL", "category": "Tools"}
                ],
            },
            "experience_atoms": [
                {
                    "id": str(SELECTED_MASTER_ID),
                    "category": "work",
                    "title": "Selected source role",
                    "org": "Selected source org",
                    "summary": "full selected source summary",
                    "star": {"r": "full selected result"},
                    "tags": ["private selected tag"],
                },
                {
                    "id": str(UNSELECTED_MASTER_ID),
                    "category": "project",
                    "title": "Unselected project",
                    "org": "Unselected org",
                    "summary": "UNSELECTED SECRET SUMMARY",
                    "star": {"r": "UNSELECTED SECRET STAR"},
                    "tags": ["UNSELECTED SECRET TAG"],
                },
            ],
            "match_candidates": {
                "certifications": [{"id": "cert-secret", "name": "SECRET CERT"}],
                "skills": [{"id": "skill-secret", "name": "SECRET SKILL"}],
            },
            "fact_metadata": (
                [
                    {
                        "fact_id": "FACT_001",
                        "content": "short action",
                        "source": "resume.experiences[0].star.a",
                        "verification_status": "user_claimed",
                        "confidence": 1,
                    }
                ]
                if selected
                else []
            ) + [
                {
                    "fact_id": "FACT_002",
                    "content": "Candidate",
                    "source": "resume.profile.name",
                    "verification_status": "user_claimed",
                    "confidence": 1,
                },
                {
                    "fact_id": "FACT_003",
                    "content": "SQL",
                    "source": "resume.skills[0].name",
                    "verification_status": "user_claimed",
                    "confidence": 1,
                },
                {
                    "fact_id": "FACT_004",
                    "content": "Product Manager",
                    "source": "target_role",
                    "verification_status": "user_claimed",
                    "confidence": 1,
                },
            ],
        },
        ensure_ascii=False,
    )


class _ContextFixture:
    def __init__(
        self,
        testcase: unittest.TestCase,
        *,
        resume=None,
        items=None,
        analysis_text: str | None = None,
        source_versions=None,
    ) -> None:
        self.testcase = testcase
        self.resume = resume or _resume()
        self.items = [_resume_item()] if items is None else items
        self.analysis_text = analysis_text or _analysis_text()
        self.source_versions = source_versions or [_selected_old_version()]
        self.bank = {
            "profile": None,
            "experiences": [],
            "certifications": [],
            "skills": [],
        }
        self.category_map = {
            str(SELECTED_MASTER_ID): ExperienceCategory.WORK,
        }

    async def build(self, request=None):
        version_by_id = {
            str(version.id): version for version in self.source_versions
        }

        async def get_version(_session, _user_id, version_id):
            return version_by_id[str(version_id)]

        with (
            patch.object(
                context_service,
                "get_resume_detail",
                new=AsyncMock(return_value=(self.resume, self.items)),
            ) as get_detail,
            patch.object(
                context_service,
                "_load_agent_bank",
                new=AsyncMock(return_value=self.bank),
            ),
            patch.object(
                context_service,
                "_load_resume_item_categories",
                new=AsyncMock(return_value=self.category_map),
            ),
            patch.object(
                context_service,
                "get_version_for_user",
                new=AsyncMock(side_effect=get_version),
            ) as get_version_mock,
            patch.object(
                context_service,
                "build_resume_analysis_text",
                new=AsyncMock(return_value=self.analysis_text),
            ) as build_analysis,
        ):
            result = await context_service.build_frozen_optimization_context(
                session=object(),
                user_id=USER_ID,
                request=request or _request(),
            )

        get_detail.assert_awaited_once()
        return result, build_analysis, get_version_mock


class ResumeOptimizationContextTests(unittest.IsolatedAsyncioTestCase):
    async def test_builds_allowlisted_context_from_short_resume_and_full_fixed_source(self) -> None:
        fixture = _ContextFixture(self)

        context, build_analysis, get_version = await fixture.build()

        selected_id = str(SELECTED_MASTER_ID)
        self.assertEqual(
            context.current_resume["experiences"][selected_id]["star"]["s"],
            "short situation",
        )
        self.assertEqual(
            context.selected_source_experiences[selected_id]["star"]["r"],
            "full selected result",
        )
        self.assertEqual(
            context.selected_source_experiences[selected_id]["summary"],
            "full selected source summary",
        )
        self.assertEqual(context.selected_master_experience_ids, [selected_id])
        self.assertEqual(
            context.selected_experience_links[selected_id],
            {
                "resume_link_id": str(RESUME_LINK_ID),
                "source_version_id": str(SELECTED_OLD_VERSION_ID),
            },
        )
        self.assertEqual(context.target_role, "Product Manager")
        self.assertEqual(context.jd_signature, "jd-signature")
        self.assertEqual(context.evaluation["evaluationVersion"], "resume_flow_v1")
        self.assertEqual(context.fact_metadata[0]["fact_id"], "FACT_001")
        self.assertRegex(context.snapshot_hash, r"^[0-9a-f]{64}$")
        self.assertEqual(
            set(context.source_documents),
            {"currentResume", "selectedSourceExperiences", "userAnswers"},
        )
        self.assertEqual(context.source_documents["userAnswers"], {})
        self.assertEqual(
            context.current_resume["target_role"],
            "Product Manager",
        )

        analysis_dump = json.dumps(context.model_payload(), ensure_ascii=False)
        self.assertNotIn("UNSELECTED SECRET SUMMARY", analysis_dump)
        self.assertNotIn("UNSELECTED SECRET STAR", analysis_dump)
        self.assertNotIn("UNSELECTED SECRET TAG", analysis_dump)
        self.assertNotIn("SECRET CERT", analysis_dump)
        self.assertNotIn("SECRET SKILL", analysis_dump)
        self.assertNotIn("private selected highlight", analysis_dump)
        self.assertNotIn("private selected tag", analysis_dump)
        self.assertEqual(
            context.bank_suggestion_candidates,
            [
                {
                    "master_experience_id": str(UNSELECTED_MASTER_ID),
                    "category": "project",
                    "title": "Unselected project",
                    "org": "Unselected org",
                    "match_score": 91,
                    "reason": "strong roadmap evidence",
                }
            ],
        )

        build_analysis.assert_awaited_once_with(
            unittest.mock.ANY,
            USER_ID,
            fixture.resume,
            resume_items=fixture.items,
            bank=fixture.bank,
            category_by_master_id=fixture.category_map,
            target_role=fixture.resume.target_role,
        )
        get_version.assert_awaited_once_with(
            unittest.mock.ANY,
            USER_ID,
            str(SELECTED_OLD_VERSION_ID),
        )

    async def test_uses_linked_old_source_version_even_when_master_latest_is_newer(self) -> None:
        old_version = _selected_old_version()
        old_version.star = {**old_version.star, "r": "old fixed result"}
        newer_version = deepcopy(old_version)
        newer_version.id = SELECTED_NEW_VERSION_ID
        newer_version.version = 2
        newer_version.star = {**newer_version.star, "r": "NEWER LATEST RESULT"}
        fixture = _ContextFixture(
            self,
            source_versions=[old_version, newer_version],
        )

        context, _builder, get_version = await fixture.build()

        selected = context.selected_source_experiences[str(SELECTED_MASTER_ID)]
        self.assertEqual(selected["source_version_id"], str(SELECTED_OLD_VERSION_ID))
        self.assertEqual(selected["star"]["r"], "old fixed result")
        self.assertNotIn("NEWER LATEST RESULT", json.dumps(context.model_payload()))
        get_version.assert_awaited_once_with(
            unittest.mock.ANY,
            USER_ID,
            str(SELECTED_OLD_VERSION_ID),
        )

    async def test_owner_mismatch_is_not_found(self) -> None:
        with patch.object(
            context_service,
            "get_resume_detail",
            new=AsyncMock(side_effect=ResumeNotFoundError("Resume not found")),
        ):
            with self.assertRaises(context_service.OptimizationContextNotFoundError) as caught:
                await context_service.build_frozen_optimization_context(
                    object(), USER_ID, _request()
                )

        self.assertEqual(caught.exception.status_code, 404)

    async def test_missing_stale_wrong_version_signature_and_timestamp_are_typed(self) -> None:
        cases = []

        missing = _resume(config_overrides={"jdAnalysis": {"result": {}}})
        cases.append(
            (
                "missing",
                missing,
                _request(),
                context_service.OptimizationEvaluationInvalidError,
                422,
            )
        )

        stale = _resume(config_overrides={"jdAnalysis": {"evaluationIsOutdated": True}})
        cases.append(
            (
                "stale",
                stale,
                _request(),
                context_service.OptimizationContextStaleError,
                409,
            )
        )

        wrong_version = _resume()
        wrong_version.config["jdAnalysis"]["result"]["resumeEvaluation"] = {
            **_evaluation(),
            "evaluationVersion": "legacy_v0",
        }
        cases.append(
            (
                "wrong-version",
                wrong_version,
                _request(),
                context_service.OptimizationEvaluationInvalidError,
                422,
            )
        )

        wrong_signature = _resume(
            config_overrides={"jdAnalysis": {"evaluationSignature": "other"}}
        )
        cases.append(
            (
                "signature",
                wrong_signature,
                _request(),
                context_service.OptimizationContextStaleError,
                409,
            )
        )

        changed = _resume()
        changed.updated_at = BASE_TIME.replace(hour=4)
        cases.append(
            (
                "timestamp",
                changed,
                _request(),
                context_service.OptimizationContextStaleError,
                409,
            )
        )

        naive_request = _request(expected_resume_updated_at="2026-09-01T03:00:00")
        cases.append(
            (
                "naive-timestamp",
                _resume(),
                naive_request,
                context_service.OptimizationContextRequestError,
                400,
            )
        )

        for label, resume, request, error_type, status_code in cases:
            with self.subTest(label=label):
                fixture = _ContextFixture(self, resume=resume)
                with self.assertRaises(error_type) as caught:
                    await fixture.build(request=request)
                self.assertEqual(caught.exception.status_code, status_code)

    async def test_duplicate_links_and_selected_but_unlinked_are_rejected_before_builder(self) -> None:
        duplicate_items = [
            _resume_item(),
            _resume_item(
                link_id=uuid.UUID("77777777-7777-7777-7777-777777777777"),
                version_id=SELECTED_NEW_VERSION_ID,
            ),
        ]
        duplicate_fixture = _ContextFixture(self, items=duplicate_items)

        with self.assertRaises(context_service.OptimizationSelectionInvalidError):
            await duplicate_fixture.build()

        unlinked_master_id = uuid.UUID("88888888-8888-8888-8888-888888888888")
        unlinked_resume = _resume(
            config_overrides={
                "selection": {"experienceIds": [str(unlinked_master_id)]}
            }
        )
        unlinked_fixture = _ContextFixture(self, resume=unlinked_resume)

        with self.assertRaises(context_service.OptimizationSelectionInvalidError):
            await unlinked_fixture.build()

    async def test_explicit_empty_selection_is_stable_and_loads_no_source_versions(self) -> None:
        resume = _resume(config_overrides={"selection": {"experienceIds": []}})
        fixture = _ContextFixture(
            self,
            resume=resume,
            analysis_text=_analysis_text(selected=False),
        )

        context, _builder, get_version = await fixture.build()

        self.assertEqual(context.selected_master_experience_ids, [])
        self.assertEqual(context.selected_source_experiences, {})
        self.assertEqual(context.selected_experience_links, {})
        get_version.assert_not_awaited()

    async def test_snapshot_hash_is_deterministic_and_outputs_do_not_alias_inputs(self) -> None:
        fixture = _ContextFixture(self)
        original_config = deepcopy(fixture.resume.config)
        original_star = deepcopy(fixture.source_versions[0].star)

        first, _builder, _version = await fixture.build()
        second, _builder, _version = await fixture.build()

        self.assertEqual(first.snapshot_hash, second.snapshot_hash)
        first.current_resume["profile"]["name"] = "Mutated output"
        first.selected_source_experiences[str(SELECTED_MASTER_ID)]["star"]["r"] = (
            "Mutated source"
        )
        first.source_documents["userAnswers"]["Q1"] = "Mutated answer"

        self.assertEqual(fixture.resume.config, original_config)
        self.assertEqual(fixture.source_versions[0].star, original_star)
        self.assertEqual(second.current_resume["profile"]["name"], "Candidate")
        self.assertEqual(
            second.selected_source_experiences[str(SELECTED_MASTER_ID)]["star"]["r"],
            "full selected result",
        )
        self.assertEqual(second.source_documents["userAnswers"], {})

    async def test_model_payload_omits_bank_candidates_and_reasons_entirely(self) -> None:
        context, _builder, _version = await _ContextFixture(self).build()

        planner_payload = context.model_payload()
        planner_text = json.dumps(planner_payload, ensure_ascii=False)

        self.assertNotIn("bankSuggestionCandidates", planner_payload)
        self.assertNotIn("bank_suggestion_candidates", planner_payload)
        self.assertNotIn("strong roadmap evidence", planner_text)
        self.assertNotIn("bankSuggestionCandidates", context.source_documents)
        self.assertEqual(
            context.snapshot_payload()["bank_suggestion_candidates"][0]["reason"],
            "strong roadmap evidence",
        )

    async def test_same_context_public_mutation_cannot_change_authoritative_payload(self) -> None:
        context, _builder, _version = await _ContextFixture(self).build()
        original_model = context.model_payload()
        original_snapshot = context.snapshot_payload()
        original_documents = context.source_documents
        original_hash = context.snapshot_hash

        context.current_resume["profile"]["name"] = "mutated current"
        context.evaluation["overallScore"] = 0
        context.selected_source_experiences[str(SELECTED_MASTER_ID)]["star"]["r"] = "mutated source"
        context.selected_master_experience_ids.append("mutated-id")
        context.selected_experience_links[str(SELECTED_MASTER_ID)]["source_version_id"] = "mutated-version"
        context.bank_suggestion_candidates[0]["reason"] = "mutated reason"
        context.fact_metadata[0]["content"] = "mutated fact"
        context.source_documents["currentResume"]["profile"]["name"] = "mutated document"
        context.model_payload()["currentResume"]["profile"]["name"] = "mutated model"
        context.snapshot_payload()["current_resume"]["profile"]["name"] = "mutated snapshot"

        self.assertEqual(context.model_payload(), original_model)
        self.assertEqual(context.snapshot_payload(), original_snapshot)
        self.assertEqual(context.source_documents, original_documents)
        self.assertEqual(context.snapshot_hash, original_hash)
        self.assertEqual(
            context.snapshot_hash,
            context_service.hash_canonical_json(context.snapshot_payload()),
        )

    async def test_invalid_fact_sources_and_content_are_typed_evaluation_errors(self) -> None:
        cases = {
            "malformed": {
                "source": "resume.skills[broken].name",
                "content": "SQL",
            },
            "out-of-range": {
                "source": "resume.skills[99].name",
                "content": "SQL",
            },
            "missing": {
                "source": "resume.profile.missing",
                "content": "Candidate",
            },
            "mismatch": {
                "source": "resume.profile.name",
                "content": "Different Candidate",
            },
        }

        for label, invalid in cases.items():
            with self.subTest(label=label):
                parsed = json.loads(_analysis_text())
                parsed["fact_metadata"] = [
                    {
                        "fact_id": "FACT_BAD",
                        "content": invalid["content"],
                        "source": invalid["source"],
                        "verification_status": "user_claimed",
                        "confidence": 1,
                    }
                ]
                fixture = _ContextFixture(
                    self,
                    analysis_text=json.dumps(parsed, ensure_ascii=False),
                )

                with self.assertRaises(
                    context_service.OptimizationEvaluationInvalidError
                ) as caught:
                    await fixture.build()

                self.assertEqual(caught.exception.status_code, 422)

    async def test_current_experiences_are_an_insertion_ordered_master_id_mapping(self) -> None:
        second_master_id = uuid.UUID("99999999-9999-9999-9999-999999999999")
        second_version_id = uuid.UUID("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
        second_link_id = uuid.UUID("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")
        first_item = _resume_item()
        second_item = _resume_item(
            link_id=second_link_id,
            master_id=second_master_id,
            version_id=second_version_id,
        )
        resume = _resume(
            config_overrides={
                "selection": {
                    "experienceIds": [
                        str(SELECTED_MASTER_ID),
                        str(second_master_id),
                    ]
                }
            }
        )
        parsed = json.loads(_analysis_text())
        parsed["resume"]["experiences"].append(
            {
                "id": str(second_master_id),
                "category": "project",
                "title": "Second project",
                "org": "Second org",
                "start_date": "2024-03",
                "end_date": "",
                "star": {"s": "second s", "t": "second t", "a": "second a", "r": "second r"},
            }
        )
        second_version = SimpleNamespace(
            id=second_version_id,
            master_experience_id=second_master_id,
            version=1,
            title="Second project source",
            org="Second org",
            start_date=date(2024, 3, 1),
            end_date=None,
            is_current=True,
            summary="Second full summary",
            highlights=[],
            tags=[],
            star={"s": "second full s", "t": "second full t", "a": "second full a", "r": "second full r"},
        )
        fixture = _ContextFixture(
            self,
            resume=resume,
            items=[first_item, second_item],
            analysis_text=json.dumps(parsed, ensure_ascii=False),
            source_versions=[_selected_old_version(), second_version],
        )
        fixture.category_map[str(second_master_id)] = ExperienceCategory.PROJECT

        context, _builder, _version = await fixture.build()

        self.assertIsInstance(context.current_resume["experiences"], dict)
        self.assertEqual(
            list(context.current_resume["experiences"]),
            [str(SELECTED_MASTER_ID), str(second_master_id)],
        )
        self.assertEqual(
            list(context.source_documents["currentResume"]["experiences"]),
            [str(SELECTED_MASTER_ID), str(second_master_id)],
        )

    async def test_every_fact_source_is_an_allowed_resolvable_rfc6901_pointer(self) -> None:
        def resolve_pointer(documents: dict, pointer: str):
            self.assertTrue(pointer.startswith("/"), pointer)
            current = documents
            for raw_token in pointer[1:].split("/"):
                index = 0
                decoded = []
                while index < len(raw_token):
                    char = raw_token[index]
                    if char != "~":
                        decoded.append(char)
                        index += 1
                        continue
                    self.assertLess(index + 1, len(raw_token), pointer)
                    escape = raw_token[index + 1]
                    self.assertIn(escape, {"0", "1"}, pointer)
                    decoded.append("~" if escape == "0" else "/")
                    index += 2
                token = "".join(decoded)
                if isinstance(current, list):
                    self.assertRegex(token, r"^(0|[1-9][0-9]*)$", pointer)
                    current = current[int(token)]
                else:
                    self.assertIsInstance(current, dict, pointer)
                    self.assertIn(token, current, pointer)
                    current = current[token]
            return current

        context, _builder, _version = await _ContextFixture(self).build()
        sample_pointer = (
            f"/currentResume/experiences/{SELECTED_MASTER_ID}/star/a"
        )

        self.assertEqual(
            resolve_pointer(context.source_documents, sample_pointer),
            "short action",
        )
        self.assertEqual(
            [fact["fact_id"] for fact in context.fact_metadata],
            ["FACT_001", "FACT_002", "FACT_003", "FACT_004"],
        )
        for fact in context.fact_metadata:
            self.assertIn(
                fact["source"].split("/", 2)[1],
                {"currentResume", "selectedSourceExperiences", "userAnswers"},
            )
            self.assertEqual(
                resolve_pointer(context.source_documents, fact["source"]),
                fact["content"],
            )

        escaped_documents = {
            "currentResume": {
                "experiences": {
                    "master/~id": {"star": {"a": "escaped action"}}
                }
            }
        }
        escaped_pointer = context_service._fact_source_pointer(
            "resume.experiences[0].star.a",
            current_resume=escaped_documents["currentResume"],
        )
        self.assertEqual(
            escaped_pointer,
            "/currentResume/experiences/master~1~0id/star/a",
        )
        self.assertEqual(
            resolve_pointer(escaped_documents, escaped_pointer),
            "escaped action",
        )


if __name__ == "__main__":
    unittest.main()

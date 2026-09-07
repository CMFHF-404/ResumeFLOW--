from __future__ import annotations

from copy import deepcopy
from contextlib import nullcontext
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
from app.domain.ai.resume_evaluation import DIMENSION_SUBSCORES  # noqa: E402
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


def _jd_input_signature(
    jd_text: str,
    *,
    input_mode: str = "text",
    attachment_signature=None,
) -> str:
    return json.dumps(
        {
            "inputMode": input_mode,
            "textSignature": jd_text.strip(),
            "attachmentSignature": attachment_signature,
        },
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    )


def _request(**overrides) -> ResumeOptimizationStartRequest:
    baseline_resume = _resume()
    values = {
        "resume_id": str(RESUME_ID),
        "evaluation_signature": _frontend_evaluation_signature(
            _frontend_snapshot_from_analysis_text(_analysis_text()),
            result=baseline_resume.config["jdAnalysis"]["result"],
        ),
        "expected_resume_updated_at": BASE_TIME.isoformat(),
        "include_bank_suggestions": True,
    }
    values.update(overrides)
    return ResumeOptimizationStartRequest.model_validate(values)


def _evaluation() -> dict:
    dimensions = []
    for dimension_name, subscores in DIMENSION_SUBSCORES:
        is_quantification = dimension_name == "成果量化"
        dimensions.append(
            {
                "dimension": dimension_name,
                "score": 0 if is_quantification else 100,
                "level": "不足" if is_quantification else "卓越",
                "subscores": [
                    {
                        "name": name,
                        "maxScore": max_score,
                        "score": 0 if is_quantification else max_score,
                        "evidenceIds": [] if is_quantification else ["E001"],
                    }
                    for name, max_score in subscores
                ],
                "strengths": [],
                "issues": ["ISSUE_QUANT"] if is_quantification else [],
                "improvementQuestions": [],
            }
        )
    return {
        "evaluationVersion": "resume_flow_v1",
        "scoringVersion": "coverage_consensus_v4",
        "evaluationScope": "full_resume",
        "targetRole": "Product Manager",
        "overallScore": 83,
        "overallLevel": "良好",
        "evaluationConfidence": 0.82,
        "scoreCalculation": {
            "dimensionSum": 500,
            "rawAverage": 500 / 6,
            "roundingRule": "round_half_up",
            "finalScore": 83,
        },
        "dimensions": dimensions,
        "evidence": [
            {
                "evidenceId": "E001",
                "sourceText": "Candidate",
                "location": "resume.profile.name",
                "factId": "FACT_001",
                "verificationStatus": "user_claimed",
                "supportedDimensions": [
                    dimension_name
                    for dimension_name, _subscores in DIMENSION_SUBSCORES
                    if dimension_name != "成果量化"
                ],
            }
        ],
        "issues": [
            {
                "issueId": "ISSUE_QUANT",
                "description": "缺少可验证的量化成果指标",
                "primaryDimension": "成果量化",
                "relatedDimensions": [],
                "evidenceIds": [],
                "severity": "high",
                "pointsNotEarned": 100,
            }
        ],
        "missingInformation": [],
        "riskFlags": [],
        "topPriorities": [],
        "jdMatch": 88,
    }


def _resume(*, config_overrides: dict | None = None):
    jd_analysis = {
        "result": {
            "matchPercentage": 88,
            "extractedJdText": "Product manager JD",
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
        "jdText": "Product manager JD",
        "inputMode": "text",
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


def _frontend_snapshot_from_analysis_text(value: str) -> dict:
    parsed = json.loads(value)
    resume = parsed["resume"]
    section_order = []
    for section_id in [
        *(resume.get("section_order") or []),
        "summary",
        "education",
        "work",
        "project",
        "certifications",
        "skills",
    ]:
        if section_id not in section_order:
            section_order.append(section_id)
    if not str(resume.get("personal_summary") or "").strip():
        section_order = [item for item in section_order if item != "summary"]

    def optional_text_fields(item: dict, keys: tuple[str, ...]) -> dict:
        return {
            key: str(item[key])
            for key in keys
            if item.get(key) not in (None, "")
        }

    formal_experiences = []
    for item in resume.get("experiences", []):
        formal_experiences.append(
            {
                "id": str(item.get("id") or ""),
                "title": str(item.get("title") or ""),
                "org": str(item.get("org") or ""),
                **{
                    key: item.get(key)
                    for key in ("start_date", "end_date")
                    if key in item
                },
                "star": {
                    key: str((item.get("star") or {}).get(key) or "")
                    for key in ("s", "t", "a", "r")
                },
                "category": str(item.get("category") or ""),
            }
        )

    candidate_experiences = []
    for item in parsed.get("experience_atoms", []):
        candidate_experiences.append(
            {
                "id": str(item.get("id") or ""),
                "title": str(item.get("title") or ""),
                "org": str(item.get("org") or ""),
                **{
                    key: item.get(key)
                    for key in ("start_date", "end_date")
                    if key in item
                },
                "star": {
                    key: str((item.get("star") or {}).get(key) or "")
                    for key in ("s", "t", "a", "r")
                },
            }
        )

    frontend_snapshot = {
        "evaluation_scope": "full_resume",
        "target_role": str(parsed.get("target_role") or "").strip(),
        "resume": {
            "section_order": section_order,
            "profile": {
                key: str((resume.get("profile") or {}).get(key) or "").strip()
                for key in ("name", "email", "phone", "location", "linkedin")
            },
            "personal_summary": str(resume.get("personal_summary") or "").strip(),
            "experiences": formal_experiences,
            "educations": [
                {
                    "id": str(item.get("id") or ""),
                    "school": str(item.get("school") or "").strip(),
                    "major": str(item.get("major") or "").strip(),
                    "degree": str(item.get("degree") or "").strip(),
                    **optional_text_fields(
                        item,
                        ("start_date", "end_date", "gpa", "courses"),
                    ),
                }
                for item in resume.get("educations", [])
            ],
            "certifications": [
                {
                    "id": str(item.get("id") or ""),
                    "name": str(item.get("name") or ""),
                    "issuer": str(item.get("issuer") or ""),
                    "issue_date": str(item.get("issue_date") or ""),
                }
                for item in resume.get("certifications", [])
            ],
            "skills": [
                {
                    "id": str(item.get("id") or ""),
                    "name": str(item.get("name") or ""),
                    "category": str(item.get("category") or ""),
                }
                for item in resume.get("skills", [])
            ],
        },
        "experience_atoms": candidate_experiences,
        "match_candidates": {
            "certifications": [
                {
                    "id": str(item.get("id") or ""),
                    "name": str(item.get("name") or ""),
                    "issuer": str(item.get("issuer") or ""),
                    "issue_date": str(item.get("issue_date") or ""),
                }
                for item in (parsed.get("match_candidates") or {}).get(
                    "certifications", []
                )
            ],
            "skills": [
                {
                    "id": str(item.get("id") or ""),
                    "name": str(item.get("name") or ""),
                    "category": str(item.get("category") or ""),
                }
                for item in (parsed.get("match_candidates") or {}).get("skills", [])
            ],
        },
        "fact_metadata": [],
    }
    from app.domain.resume_optimization import apply_service

    frontend_snapshot["fact_metadata"] = apply_service._rebuild_frontend_fact_metadata(
        frontend_snapshot
    )
    return frontend_snapshot


def _frontend_evaluation_signature(
    snapshot: dict,
    *,
    jd_signature: str = "jd-signature",
    result: dict | None = None,
    jd_available: bool = True,
) -> str:
    trusted_result = result if isinstance(result, dict) else _resume().config["jdAnalysis"]["result"]
    identity = deepcopy(trusted_result)
    identity.pop("resumeEvaluation", None)
    return json.dumps(
        {
            "jdInputSignature": jd_signature,
            "resume": snapshot,
            "jdAvailable": jd_available,
            "jdResultIdentity": json.dumps(
                identity if jd_available else None,
                ensure_ascii=False,
                separators=(",", ":"),
                sort_keys=True,
            ),
            "jdMatchPercentage": trusted_result.get("matchPercentage")
            if jd_available
            else None,
        },
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
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
        bank: dict | None = None,
        category_map: dict | None = None,
        session=None,
        use_guidance_receipt_stub: bool = True,
    ) -> None:
        self.testcase = testcase
        self.resume = resume or _resume()
        self.items = [_resume_item()] if items is None else items
        self.analysis_text = analysis_text or _analysis_text()
        self.source_versions = source_versions or [_selected_old_version()]
        self.bank = bank if bank is not None else {
            "profile": None,
            "experiences": [],
            "certifications": [],
            "skills": [],
        }
        self.category_map = category_map if category_map is not None else {
            str(SELECTED_MASTER_ID): ExperienceCategory.WORK,
        }
        self.session = session or object()
        self.use_guidance_receipt_stub = use_guidance_receipt_stub
        analysis = self.resume.config.get("jdAnalysis", {})
        analysis_result = analysis.get("result")
        if (
            analysis.get("evaluationSignature") == "evaluation-signature"
            and isinstance(analysis_result, dict)
            and isinstance(analysis_result.get("resumeEvaluation"), dict)
        ):
            has_jd_text = bool(str(analysis.get("jdText") or "").strip())
            has_attachment = (
                analysis.get("inputMode") == "attachment"
                and bool(str(analysis.get("attachmentExtractedText") or "").strip())
            )
            analysis["evaluationSignature"] = _frontend_evaluation_signature(
                _frontend_snapshot_from_analysis_text(self.analysis_text),
                jd_signature=str(analysis.get("jdInputSignature") or ""),
                result=analysis_result,
                jd_available=has_jd_text or has_attachment,
            )

    async def build(self, request=None):
        version_by_id = {
            str(version.id): version for version in self.source_versions
        }

        async def get_version(_session, _user_id, version_id):
            return version_by_id[str(version_id)]

        analysis_result = self.resume.config["jdAnalysis"]["result"]
        original_evaluation = analysis_result.get("resumeEvaluation")
        resolver_context = nullcontext()
        if self.use_guidance_receipt_stub and isinstance(original_evaluation, dict):
            source_evaluation = deepcopy(original_evaluation)
            fixture_snapshot = _frontend_snapshot_from_analysis_text(self.analysis_text)
            fixture_resume = context_service._allowlist_current_resume(
                fixture_snapshot.get("resume"),
                target_role=str(getattr(self.resume, "target_role", "") or ""),
            )
            fixture_facts = context_service._allowlist_fact_metadata(
                fixture_snapshot.get("fact_metadata"),
                current_resume=fixture_resume,
            )
            public_guidance = deepcopy(original_evaluation)
            public_guidance["evaluationVersion"] = context_service.GUIDANCE_VERSION
            public_guidance["auditReceipt"] = {"receiptId": "fixture-receipt"}
            analysis_result["resumeEvaluation"] = public_guidance

            async def resolve_stub(
                _public,
                *,
                user_id,
                evaluation_input,
                jd_available,
            ):
                del _public, user_id
                try:
                    internal = context_service.normalize_resume_evaluation(
                        source_evaluation,
                        jd_available=jd_available,
                        fact_metadata=fixture_facts,
                    )
                except (TypeError, ValueError) as exc:
                    raise context_service.OptimizationEvaluationInvalidError(
                        "The persisted six-dimensional evaluation failed integrity checks"
                    ) from exc
                internal["scoringVersion"] = context_service.GUIDANCE_VERSION
                return internal, {"receiptId": "fixture-receipt"}, [], {}

            resolver_context = patch.object(
                context_service,
                "_resolve_guidance_evaluation",
                new=AsyncMock(side_effect=resolve_stub),
            )

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
            resolver_context,
        ):
            resolved_request = request or _request(
                evaluation_signature=self.resume.config["jdAnalysis"][
                    "evaluationSignature"
                ],
                expected_resume_updated_at=self.resume.updated_at.isoformat(),
            )
            result = await context_service.build_frozen_optimization_context(
                session=self.session,
                user_id=USER_ID,
                request=resolved_request,
            )

        if self.use_guidance_receipt_stub:
            analysis_result["resumeEvaluation"] = original_evaluation

        get_detail.assert_awaited_once()
        return result, build_analysis, get_version_mock


class ResumeOptimizationContextTests(unittest.IsolatedAsyncioTestCase):
    async def test_builds_context_from_real_reproducible_guidance_receipt(self) -> None:
        from app.domain.ai.guidance_evaluation import (
            AUDIT_VERSION,
            assemble_guidance,
            audit_schema,
            guidance_rubric,
        )
        from app.domain.ai.guidance_receipts import (
            canonical_json_hash,
            guidance_public_hash,
        )
        from app.domain.ai.guidance_tasks import (
            build_task_contract,
            validate_judgments,
        )

        parsed = json.loads(_analysis_text())
        receipt_input = {
            "resume": deepcopy(parsed["resume"]),
            "fact_metadata": deepcopy(parsed["fact_metadata"]),
        }
        contract = build_task_contract(receipt_input)
        model_rows = {}
        for task in contract["tasks"]:
            if task["taskId"] in contract["deterministic"]:
                continue
            model_rows[task["taskId"]] = {
                "assessment": task["allowedAssessments"][0],
                "sourceRefs": list(task["allowedSources"]),
                "reason": "当前内容支持该判断。",
                "guidance": {"type": "none", "prompt": ""},
            }
        judgments = validate_judgments(model_rows, contract)
        audit = {
            task["taskId"]: {
                "sourceSupported": True,
                "assessmentSupported": True,
                "guidanceActionable": True,
                "guidanceSafe": True,
                "verdict": "approved",
                "reason": "判断有依据。",
            }
            for task in contract["tasks"]
        }
        public, internal = assemble_guidance(
            contract,
            judgments,
            audit=audit,
            target_role="Product Manager",
            jd_match=88,
        )
        schemas = {
            "generation": contract["generationSchema"],
            "audit": audit_schema(contract),
        }
        rubric = guidance_rubric()
        receipt = {
            "receipt_id": "a" * 32,
            "public_hash": guidance_public_hash(public),
            "input_hash": canonical_json_hash(receipt_input),
            "tasks_hash": canonical_json_hash(contract["tasks"]),
            "judgments_hash": canonical_json_hash(judgments),
            "rubric_hash": canonical_json_hash(rubric),
            "schema_hash": canonical_json_hash(schemas),
            "audit_version": AUDIT_VERSION,
            "input": receipt_input,
            "tasks": contract["tasks"],
            "sources": contract["sources"],
            "judgments": judgments,
            "internal_report": internal,
            "audit": audit,
            "rubric": rubric,
            "schema": schemas,
        }
        public["auditReceipt"] = {
            "receiptId": receipt["receipt_id"],
            "inputHash": receipt["input_hash"],
            "tasksHash": receipt["tasks_hash"],
            "judgmentsHash": receipt["judgments_hash"],
            "rubricHash": receipt["rubric_hash"],
            "schemaHash": receipt["schema_hash"],
            "auditVersion": AUDIT_VERSION,
        }
        resume = _resume()
        resume.config["jdAnalysis"]["result"]["resumeEvaluation"] = public
        fixture = _ContextFixture(
            self,
            resume=resume,
            use_guidance_receipt_stub=False,
        )
        with patch.object(
            context_service,
            "load_guidance_receipt",
            new=AsyncMock(return_value=receipt),
        ) as load:
            context, _builder, _version = await fixture.build()

        load.assert_awaited_once_with(receipt_id="a" * 32, user_id=USER_ID)
        self.assertEqual(context.evaluation["scoringVersion"], "guidance_audit_v1")
        self.assertEqual(
            context.evaluation["_guidanceReceiptBinding"],
            public["auditReceipt"],
        )
        self.assertEqual(context.evaluation["_guidanceTasks"], contract["tasks"])

    async def test_old_scoring_rules_are_readable_but_cannot_start_optimization(self):
        for version in (
            None,
            "previous_rules",
            "coverage_consensus_v1",
            "coverage_consensus_v4",
        ):
            with self.subTest(version=version):
                fixture = _ContextFixture(self, use_guidance_receipt_stub=False)
                evaluation = fixture.resume.config["jdAnalysis"]["result"]["resumeEvaluation"]
                if version is None:
                    evaluation.pop("scoringVersion", None)
                else:
                    evaluation["scoringVersion"] = version
                with self.assertRaises(context_service.OptimizationContextStaleError):
                    await fixture.build()

    async def test_rejects_non_five_field_signature_before_server_snapshot_build(self) -> None:
        for invalid_signature in (
            "legacy-evaluation-signature",
            json.dumps(
                {
                    "jdInputSignature": "jd-signature",
                    "resume": _frontend_snapshot_from_analysis_text(_analysis_text()),
                },
                ensure_ascii=False,
                separators=(",", ":"),
                sort_keys=True,
            ),
        ):
            with self.subTest(signature=invalid_signature[:32]):
                resume = _resume(
                    config_overrides={
                        "jdAnalysis": {"evaluationSignature": invalid_signature}
                    }
                )
                fixture = _ContextFixture(self, resume=resume)
                with self.assertRaises(
                    context_service.OptimizationEvaluationInvalidError
                ) as caught:
                    await fixture.build(
                        request=_request(evaluation_signature=invalid_signature)
                    )
                self.assertEqual(caught.exception.status_code, 422)

    async def test_rejects_self_consistent_forged_frontend_resume_signature(self) -> None:
        trusted_analysis_text = _analysis_text()
        from app.domain.resume_optimization import apply_service

        mutations = {
            "resume.personal_summary": lambda snapshot: snapshot["resume"].__setitem__(
                "personal_summary", "FORGED SUMMARY"
            ),
            "resume.skills[0].name": lambda snapshot: snapshot["resume"]["skills"][0].__setitem__(
                "name", "FORGED SKILL"
            ),
            "experience_atoms[0].title": lambda snapshot: snapshot[
                "experience_atoms"
            ][0].__setitem__("title", "FORGED BANK TITLE"),
        }
        for expected_path, mutate in mutations.items():
            with self.subTest(expected_path=expected_path):
                forged_snapshot = _frontend_snapshot_from_analysis_text(
                    trusted_analysis_text
                )
                mutate(forged_snapshot)
                forged_snapshot["fact_metadata"] = (
                    apply_service._rebuild_frontend_fact_metadata(forged_snapshot)
                )
                resume = _resume()
                forged_signature = _frontend_evaluation_signature(
                    forged_snapshot,
                    result=resume.config["jdAnalysis"]["result"],
                )
                resume.config["jdAnalysis"][
                    "evaluationSignature"
                ] = forged_signature
                fixture = _ContextFixture(
                    self,
                    resume=resume,
                    analysis_text=trusted_analysis_text,
                )

                with self.assertRaises(
                    context_service.OptimizationContextStaleError
                ) as caught:
                    await fixture.build(
                        request=_request(evaluation_signature=forged_signature)
                    )

                self.assertEqual(caught.exception.status_code, 409)
                self.assertIn(expected_path, str(caught.exception))

    async def test_accepts_db_backed_frontend_equivalent_snapshot(self) -> None:
        education_id = uuid.UUID("cccccccc-cccc-cccc-cccc-cccccccccccc")
        selected_item = _resume_item()
        selected_item.experience.start_date = date(2023, 1, 1)
        selected_item.experience.end_date = date(2024, 2, 1)
        selected_item.experience.is_current = False
        selected_latest = SimpleNamespace(
            id=SELECTED_NEW_VERSION_ID,
            title="Latest selected title",
            org="Latest selected org",
            start_date=date(2025, 1, 1),
            end_date=None,
            is_current=True,
            star={"s": "latest situation", "t": "", "a": "", "r": ""},
        )
        unselected_latest = SimpleNamespace(
            id=uuid.UUID("dddddddd-dddd-dddd-dddd-dddddddddddd"),
            title="Unselected project",
            org="Unselected org",
            start_date=None,
            end_date=None,
            is_current=True,
            star={"s": "candidate only", "t": "", "a": "", "r": ""},
        )
        education_latest = SimpleNamespace(
            id=uuid.UUID("eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee"),
            title="Computer Science",
            org="Example University",
            start_date=date(2020, 9, 1),
            end_date=date(2024, 6, 1),
            is_current=False,
            star={"degree": "Bachelor", "gpa": "3.8", "courses": "AI"},
        )
        certification_new = SimpleNamespace(
            id="cert-new",
            name="PMP",
            issuer="PMI",
            issue_date=date(2025, 3, 1),
        )
        certification_old = SimpleNamespace(
            id="cert-old",
            name="Cloud",
            issuer="Example",
            issue_date=date(2024, 2, 1),
        )
        skill_sql_user = SimpleNamespace(id="skill-sql")
        skill_sql = SimpleNamespace(name="SQL", category="Tools")
        skill_en_user = SimpleNamespace(id="skill-en")
        skill_en = SimpleNamespace(name="English", category="Languages")
        profile = SimpleNamespace(
            full_name="Global Candidate",
            email="global@example.com",
            phone="",
            location="Global City",
            summary="Global summary",
            social_links={"linkedin": {"url": "https://global.example"}},
            extra_json={},
        )
        bank = {
            "profile": profile,
            "experiences": [
                (
                    SimpleNamespace(
                        id=SELECTED_MASTER_ID,
                        category=ExperienceCategory.WORK,
                    ),
                    selected_latest,
                ),
                (
                    SimpleNamespace(
                        id=UNSELECTED_MASTER_ID,
                        category=ExperienceCategory.PROJECT,
                    ),
                    unselected_latest,
                ),
                (
                    SimpleNamespace(
                        id=education_id,
                        category=ExperienceCategory.EDUCATION,
                    ),
                    education_latest,
                ),
            ],
            "certifications": [certification_new, certification_old],
            "skills": [
                (skill_sql_user, skill_sql),
                (skill_en_user, skill_en),
            ],
        }
        resume = _resume(
            config_overrides={
                "profileSyncMode": "local",
                "profile": {
                    "name": "Candidate",
                    "email": "local@example.com",
                    "phone": "123",
                    "location": "Local City",
                    "linkedin": "https://local.example",
                    "summary": "Ignored profile summary",
                    "avatarDataUrl": "",
                },
                "personalSummary": "Local summary",
                "selection": {
                    "experienceIds": [str(SELECTED_MASTER_ID)],
                    "educationIds": [str(education_id)],
                    "certificationIds": ["cert-new", "cert-old"],
                    "skillIds": ["skill-sql", "skill-en"],
                },
                "layout": {
                    "sectionOrder": ["work", "summary"],
                    "isSummaryVisible": True,
                    "orders": {
                        "certificationIds": ["cert-old", "cert-new"],
                        "skillGroupNames": ["Languages", "Tools"],
                    },
                },
            }
        )
        expected_snapshot = {
            "evaluation_scope": "full_resume",
            "target_role": "Product Manager",
            "resume": {
                "section_order": [
                    "work",
                    "summary",
                    "education",
                    "project",
                    "certifications",
                    "skills",
                ],
                "profile": {
                    "name": "Candidate",
                    "email": "local@example.com",
                    "phone": "123",
                    "location": "Local City",
                    "linkedin": "https://local.example",
                },
                "personal_summary": "Local summary",
                "experiences": [
                    {
                        "id": str(SELECTED_MASTER_ID),
                        "title": "Selected role",
                        "org": "Selected org",
                        "start_date": "2023-01-01",
                        "end_date": "2024-02-01",
                        "star": {
                            "s": "short situation",
                            "t": "",
                            "a": "",
                            "r": "",
                        },
                        "category": "work",
                    }
                ],
                "educations": [
                    {
                        "id": str(education_id),
                        "school": "Example University",
                        "major": "Computer Science",
                        "degree": "Bachelor",
                        "start_date": "2020.09",
                        "end_date": "2024.06",
                        "gpa": "3.8",
                        "courses": "AI",
                    }
                ],
                "certifications": [
                    {
                        "id": "cert-old",
                        "name": "Cloud",
                        "issuer": "Example",
                        "issue_date": "2024.02",
                    },
                    {
                        "id": "cert-new",
                        "name": "PMP",
                        "issuer": "PMI",
                        "issue_date": "2025.03",
                    },
                ],
                "skills": [
                    {"id": "skill-sql", "name": "SQL", "category": "Tools"},
                    {
                        "id": "skill-en",
                        "name": "English",
                        "category": "Languages",
                    },
                ],
            },
            "experience_atoms": [
                {
                    "id": str(SELECTED_MASTER_ID),
                    "title": "Selected role",
                    "org": "Selected org",
                    "start_date": "2023-01-01",
                    "end_date": "2024-02-01",
                    "star": {
                        "s": "short situation",
                        "t": "",
                        "a": "",
                        "r": "",
                    },
                },
                {
                    "id": str(UNSELECTED_MASTER_ID),
                    "title": "Unselected project",
                    "org": "Unselected org",
                    "star": {
                        "s": "candidate only",
                        "t": "",
                        "a": "",
                        "r": "",
                    },
                },
            ],
            "match_candidates": {
                "certifications": [
                    {
                        "id": "cert-old",
                        "name": "Cloud",
                        "issuer": "Example",
                        "issue_date": "2024.02",
                    },
                    {
                        "id": "cert-new",
                        "name": "PMP",
                        "issuer": "PMI",
                        "issue_date": "2025.03",
                    },
                ],
                "skills": [
                    {
                        "id": "skill-en",
                        "name": "English",
                        "category": "Languages",
                    },
                    {"id": "skill-sql", "name": "SQL", "category": "Tools"},
                ],
            },
            "fact_metadata": [],
        }
        from app.domain.resume_optimization import apply_service

        expected_snapshot["fact_metadata"] = (
            apply_service._rebuild_frontend_fact_metadata(expected_snapshot)
        )
        signature = _frontend_evaluation_signature(
            expected_snapshot,
            result=resume.config["jdAnalysis"]["result"],
        )
        resume.config["jdAnalysis"]["evaluationSignature"] = signature
        context, _builder, _version = await _ContextFixture(
            self,
            resume=resume,
            items=[selected_item],
            analysis_text=_analysis_text(),
            bank=bank,
        ).build(request=_request(evaluation_signature=signature))

        self.assertEqual(
            context.current_resume["personal_summary"],
            "Local summary",
        )
        self.assertEqual(
            context.current_resume["skills"][0]["id"],
            "skill-sql",
        )
        self.assertEqual(
            context.evaluation_signature_schema,
            "frontend_evaluation_v2",
        )

        resume.config["selection"].pop("experienceIds")
        resume.config["selection"].pop("educationIds")
        inherited_context, _builder, _version = await _ContextFixture(
            self,
            resume=resume,
            items=[selected_item],
            analysis_text=_analysis_text(),
            bank=bank,
        ).build(request=_request(evaluation_signature=signature))
        self.assertEqual(
            inherited_context.selected_master_experience_ids,
            [str(SELECTED_MASTER_ID)],
        )
        self.assertEqual(
            [item["id"] for item in inherited_context.current_resume["educations"]],
            [str(education_id)],
        )

        empty_selection_snapshot = deepcopy(expected_snapshot)
        empty_selection_snapshot["resume"]["experiences"] = []
        empty_selection_snapshot["resume"]["educations"] = []
        empty_selection_snapshot["fact_metadata"] = (
            apply_service._rebuild_frontend_fact_metadata(
                empty_selection_snapshot
            )
        )
        resume.config["selection"]["experienceIds"] = []
        resume.config["selection"]["educationIds"] = []
        empty_selection_signature = _frontend_evaluation_signature(
            empty_selection_snapshot,
            result=resume.config["jdAnalysis"]["result"],
        )
        resume.config["jdAnalysis"][
            "evaluationSignature"
        ] = empty_selection_signature

        empty_context, _builder, get_version = await _ContextFixture(
            self,
            resume=resume,
            items=[selected_item],
            analysis_text=_analysis_text(selected=False),
            bank=bank,
        ).build(
            request=_request(evaluation_signature=empty_selection_signature)
        )

        self.assertEqual(empty_context.current_resume["experiences"], {})
        self.assertEqual(empty_context.current_resume["educations"], [])
        self.assertEqual(empty_context.selected_master_experience_ids, [])
        self.assertFalse(
            any(
                fact["source"].startswith(
                    ("/currentResume/experiences/", "/currentResume/educations/")
                )
                for fact in empty_context.fact_metadata
            )
        )
        get_version.assert_not_awaited()

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
            context.evaluation_signature_schema,
            "frontend_evaluation_v2",
        )
        self.assertEqual(
            context.snapshot_payload()["evaluation_signature_schema"],
            "frontend_evaluation_v2",
        )
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

    async def test_lossy_legacy_evaluation_is_rejected_before_optimization(self) -> None:
        resume = _resume()
        resume.config["jdAnalysis"]["result"]["resumeEvaluation"]["dimensions"] = [
            {
                "dimension": "逻辑清晰",
                "score": 70,
                "strengths": [],
                "issues": ["SERVER_GAP_001"],
            }
        ]
        fixture = _ContextFixture(self, resume=resume)

        with self.assertRaises(
            context_service.OptimizationEvaluationInvalidError
        ) as caught:
            await fixture.build()

        self.assertEqual(caught.exception.status_code, 422)

    async def test_persisted_evaluation_is_grounded_and_normalized_for_planning(self) -> None:
        resume = _resume()
        evaluation = resume.config["jdAnalysis"]["result"]["resumeEvaluation"]
        for dimension in evaluation["dimensions"]:
            for subscore in dimension["subscores"]:
                if subscore["evidenceIds"]:
                    subscore["evidenceIds"] = ["FACT_001"]
        evaluation["issues"].append(
            {
                "issueId": "ISSUE_ALIAS",
                "description": "需要人工复核行动描述",
                "primaryDimension": "逻辑清晰",
                "relatedDimensions": [],
                "evidenceIds": ["FACT_001"],
                "severity": "low",
                "pointsNotEarned": 0,
            }
        )
        evaluation["dimensions"][0]["issues"] = ["ISSUE_ALIAS"]
        evaluation["riskFlags"] = [
            {
                "type": "unverified_fact",
                "description": "需要人工复核",
                "evidenceIds": ["FACT_001"],
            }
        ]
        evaluation["topPriorities"] = [
            {
                "priority": 7,
                "issueId": "ISSUE_ALIAS",
                "action": "复核行动描述",
                "expectedScoreGain": 0,
            }
        ]

        context, _builder, _get_version = await _ContextFixture(
            self,
            resume=resume,
        ).build()

        for dimension in context.evaluation["dimensions"]:
            for subscore in dimension["subscores"]:
                if subscore["score"] > 0:
                    self.assertEqual(subscore["evidenceIds"], ["E001"])
        self.assertEqual(
            context.evaluation["issues"][1]["evidenceIds"],
            ["E001"],
        )
        self.assertEqual(
            context.evaluation["riskFlags"][0]["evidenceIds"],
            ["E001"],
        )
        self.assertEqual(context.evaluation["topPriorities"][0]["priority"], 1)

    async def test_malformed_persisted_evaluations_fail_closed_after_grounding(self) -> None:
        def null_evidence(evaluation: dict) -> None:
            evaluation["evidence"] = None

        def invalid_risk(evaluation: dict) -> None:
            evaluation["riskFlags"] = [
                {
                    "type": "invented_risk",
                    "description": "invalid",
                    "evidenceIds": ["E001"],
                }
            ]

        def invalid_priority(evaluation: dict) -> None:
            evaluation["topPriorities"] = [
                {
                    "priority": "1",
                    "issueId": "ISSUE_QUANT",
                    "action": "补充量化成果",
                    "expectedScoreGain": 10,
                }
            ]

        def invalid_related_dimension(evaluation: dict) -> None:
            evaluation["issues"][0]["relatedDimensions"] = ["not-a-dimension"]

        def unknown_fact_id(evaluation: dict) -> None:
            evaluation["evidence"][0]["factId"] = "FACT_UNKNOWN"
            evaluation["evidence"][0]["sourceText"] = "not present in this resume"

        def missing_supported_dimensions(evaluation: dict) -> None:
            evaluation["evidence"][0].pop("supportedDimensions")

        def invalid_confidence(evaluation: dict) -> None:
            evaluation["evaluationConfidence"] = "0.82"

        def non_finite_confidence(evaluation: dict) -> None:
            evaluation["evaluationConfidence"] = float("nan")

        cases = {
            "null-evidence": null_evidence,
            "invalid-risk": invalid_risk,
            "invalid-priority": invalid_priority,
            "invalid-related-dimension": invalid_related_dimension,
            "unknown-fact-id": unknown_fact_id,
            "missing-supported-dimensions": missing_supported_dimensions,
            "invalid-confidence": invalid_confidence,
            "non-finite-confidence": non_finite_confidence,
        }

        for label, corrupt in cases.items():
            with self.subTest(label=label):
                resume = _resume()
                corrupt(
                    resume.config["jdAnalysis"]["result"]["resumeEvaluation"]
                )
                with self.assertRaises(
                    context_service.OptimizationEvaluationInvalidError
                ) as caught:
                    await _ContextFixture(self, resume=resume).build()

                self.assertEqual(caught.exception.status_code, 422)
                self.assertEqual(
                    str(caught.exception),
                    "The persisted six-dimensional evaluation failed integrity checks",
                )

    async def test_jd_availability_comes_from_persisted_input_context(self) -> None:
        cases = {
            "text": {
                "jdText": "Product manager JD",
                "inputMode": "text",
            },
            "attachment": {
                "jdText": "",
                "inputMode": "attachment",
                "attachmentName": "role.pdf",
            },
        }
        for label, analysis_context in cases.items():
            with self.subTest(label=label):
                resume = _resume(config_overrides={"jdAnalysis": analysis_context})
                resume.config["jdAnalysis"]["result"]["resumeEvaluation"][
                    "jdMatch"
                ] = None

                with self.assertRaises(
                    context_service.OptimizationEvaluationInvalidError
                ) as caught:
                    await _ContextFixture(self, resume=resume).build()

                self.assertEqual(caught.exception.status_code, 422)

        for supplemental_text in ("", "Supplemental note only"):
            with self.subTest(label=f"attachment-missing-body:{supplemental_text!r}"):
                missing_body = _resume(
                    config_overrides={
                        "jdAnalysis": {
                            "jdText": supplemental_text,
                            "inputMode": "attachment",
                            "attachmentName": "role.pdf",
                            "attachmentExtractedText": None,
                        }
                    }
                )
                with self.assertRaises(
                    context_service.OptimizationEvaluationInvalidError
                ) as caught:
                    await _ContextFixture(self, resume=missing_body).build()
                self.assertEqual(
                    str(caught.exception),
                    "The persisted JD attachment text is unavailable",
                )

        restored_attachment = _resume(
            config_overrides={
                "jdAnalysis": {
                    "jdText": "Supplemental note",
                    "inputMode": "attachment",
                    "attachmentName": "role.pdf",
                    "attachmentExtractedText": "Full restored attachment JD",
                }
            }
        )
        restored_attachment.config["jdAnalysis"]["jdInputSignature"] = (
            _jd_input_signature(
                "Supplemental note",
                input_mode="attachment",
                attachment_signature="role.pdf",
            )
        )
        restored_attachment.config["jdAnalysis"]["result"][
            "extractedJdText"
        ] = "Full restored attachment JD"
        restored_context, _builder, _get_version = await _ContextFixture(
            self,
            resume=restored_attachment,
        ).build()
        self.assertEqual(restored_context.evaluation["jdMatch"], 88)

        attachment_body_only = _resume(
            config_overrides={
                "jdAnalysis": {
                    "jdText": "",
                    "inputMode": "attachment",
                    "attachmentName": "role.pdf",
                    "attachmentExtractedText": "Full attachment JD",
                    "jdInputSignature": _jd_input_signature(
                        "",
                        input_mode="attachment",
                        attachment_signature="role.pdf",
                    ),
                }
            }
        )
        attachment_body_only.config["jdAnalysis"]["result"][
            "extractedJdText"
        ] = "Full attachment JD"
        attachment_context, _builder, _get_version = await _ContextFixture(
            self,
            resume=attachment_body_only,
        ).build()
        self.assertEqual(attachment_context.evaluation["jdMatch"], 88)

        promoted_attachment_text = (
            "Full attachment JD\n\n补充 JD 说明：\nSupplemental note"
        )
        promoted_attachment = _resume(
            config_overrides={
                "jdAnalysis": {
                    "jdText": promoted_attachment_text,
                    "inputMode": "text",
                    "attachmentName": None,
                    "attachmentExtractedText": "Full attachment JD",
                    "jdInputSignature": _jd_input_signature(
                        promoted_attachment_text
                    ),
                }
            }
        )
        promoted_attachment.config["jdAnalysis"]["result"][
            "extractedJdText"
        ] = "Full attachment JD"
        promoted_context, _builder, _get_version = await _ContextFixture(
            self,
            resume=promoted_attachment,
        ).build()
        self.assertEqual(promoted_context.evaluation["jdMatch"], 88)

        legacy_text = _resume()
        legacy_text.config["jdAnalysis"].pop("inputMode", None)
        legacy_context, _builder, _get_version = await _ContextFixture(
            self,
            resume=legacy_text,
        ).build()
        self.assertEqual(legacy_context.evaluation["jdMatch"], 88)

        legacy_canonical_text = _resume(
            config_overrides={
                "jdAnalysis": {
                    "jdText": "Canonical legacy text JD",
                    "jdInputSignature": _jd_input_signature(
                        "Canonical legacy text JD"
                    ),
                }
            }
        )
        legacy_canonical_text.config["jdAnalysis"].pop("inputMode", None)
        legacy_canonical_text.config["jdAnalysis"]["result"][
            "extractedJdText"
        ] = "Canonical legacy text JD"
        legacy_canonical_context, _builder, _get_version = await _ContextFixture(
            self,
            resume=legacy_canonical_text,
        ).build()
        self.assertEqual(legacy_canonical_context.evaluation["jdMatch"], 88)

        unknown_mode = _resume(
            config_overrides={
                "jdAnalysis": {
                    "inputMode": "attachment_v2",
                }
            }
        )
        with self.assertRaises(
            context_service.OptimizationEvaluationInvalidError
        ) as unknown_mode_error:
            await _ContextFixture(self, resume=unknown_mode).build()
        self.assertEqual(
            str(unknown_mode_error.exception),
            "The persisted JD input mode is invalid",
        )

        resume_without_jd = _resume(
            config_overrides={
                "jdAnalysis": {
                    "jdText": "",
                    "inputMode": "text",
                }
            }
        )
        resume_without_jd.config["jdAnalysis"]["result"]["resumeEvaluation"][
            "jdMatch"
        ] = None
        context, _builder, _get_version = await _ContextFixture(
            self,
            resume=resume_without_jd,
        ).build()
        self.assertIsNone(context.evaluation["jdMatch"])

    async def test_persisted_jd_body_is_bound_even_with_opaque_signatures(self) -> None:
        original = _resume(
            config_overrides={
                "jdAnalysis": {
                    "jdText": "BODY-A",
                    "jdInputSignature": "opaque-jd-signature",
                }
            }
        )
        original.config["jdAnalysis"]["result"]["extractedJdText"] = "BODY-A"
        original_context, _builder, _get_version = await _ContextFixture(
            self,
            resume=original,
        ).build()

        rebound = deepcopy(original)
        rebound.config["jdAnalysis"]["jdText"] = "BODY-B"
        self.assertEqual(
            rebound.config["jdAnalysis"]["jdInputSignature"],
            original.config["jdAnalysis"]["jdInputSignature"],
        )
        self.assertEqual(
            rebound.config["jdAnalysis"]["evaluationSignature"],
            original.config["jdAnalysis"]["evaluationSignature"],
        )

        with self.assertRaises(
            context_service.OptimizationEvaluationInvalidError
        ) as caught:
            await _ContextFixture(self, resume=rebound).build()

        self.assertEqual(caught.exception.status_code, 422)
        self.assertEqual(
            str(caught.exception),
            "The persisted JD input does not match its analysis provenance",
        )
        self.assertRegex(original_context.snapshot_hash, r"^[0-9a-f]{64}$")

    async def test_attachment_body_and_supplement_are_both_bound(self) -> None:
        original = _resume(
            config_overrides={
                "jdAnalysis": {
                    "jdText": "SUPPLEMENT-A",
                    "inputMode": "attachment",
                    "attachmentName": "role.pdf",
                    "attachmentExtractedText": "BODY-A",
                    "jdInputSignature": _jd_input_signature(
                        "SUPPLEMENT-A",
                        input_mode="attachment",
                        attachment_signature="role.pdf",
                    ),
                }
            }
        )
        original.config["jdAnalysis"]["result"]["extractedJdText"] = "BODY-A"
        await _ContextFixture(self, resume=original).build()

        changed_body = deepcopy(original)
        changed_body.config["jdAnalysis"]["attachmentExtractedText"] = "BODY-B"
        with self.assertRaises(
            context_service.OptimizationEvaluationInvalidError
        ) as body_error:
            await _ContextFixture(self, resume=changed_body).build()
        self.assertEqual(
            str(body_error.exception),
            "The persisted JD input does not match its analysis provenance",
        )

        changed_supplement = deepcopy(original)
        changed_supplement.config["jdAnalysis"]["jdText"] = "SUPPLEMENT-B"
        changed_supplement.config["jdAnalysis"]["result"][
            "extractedJdText"
        ] = "BODY-A"
        with self.assertRaises(
            context_service.OptimizationEvaluationInvalidError
        ) as supplement_error:
            await _ContextFixture(self, resume=changed_supplement).build()
        self.assertEqual(
            str(supplement_error.exception),
            "The persisted JD input signature does not match its text",
        )

    async def test_no_jd_disables_candidates_from_stale_analysis_result(self) -> None:
        resume_without_jd = _resume(
            config_overrides={
                "jdAnalysis": {
                    "jdText": "",
                    "inputMode": "text",
                }
            }
        )
        resume_without_jd.config["jdAnalysis"]["result"]["resumeEvaluation"][
            "jdMatch"
        ] = None

        context, _builder, _get_version = await _ContextFixture(
            self,
            resume=resume_without_jd,
        ).build()

        self.assertIsNone(context.evaluation["jdMatch"])
        self.assertEqual(context.bank_suggestion_candidates, [])

    async def test_jd_match_must_agree_with_the_trusted_outer_result(self) -> None:
        resume = _resume()
        resume.config["jdAnalysis"]["result"]["matchPercentage"] = 77

        with self.assertRaises(
            context_service.OptimizationEvaluationInvalidError
        ) as caught:
            await _ContextFixture(self, resume=resume).build()

        self.assertEqual(caught.exception.status_code, 422)
        self.assertEqual(
            str(caught.exception),
            "The persisted JD match does not match the six-dimensional evaluation",
        )

    async def test_stale_jd_analysis_is_rejected_even_when_evaluation_is_current(self) -> None:
        resume = _resume(
            config_overrides={
                "jdAnalysis": {
                    "isOutdated": True,
                    "evaluationIsOutdated": False,
                }
            }
        )

        with self.assertRaises(context_service.OptimizationContextStaleError) as caught:
            await _ContextFixture(self, resume=resume).build()

        self.assertEqual(caught.exception.status_code, 409)
        self.assertEqual(
            str(caught.exception),
            "The persisted JD analysis is outdated",
        )

    async def test_jd_mode_requires_a_trusted_outer_match(self) -> None:
        invalid_values = {
            "missing": None,
            "boolean": True,
            "non-finite": float("nan"),
        }
        for label, value in invalid_values.items():
            with self.subTest(label=label):
                resume = _resume()
                if value is None:
                    resume.config["jdAnalysis"]["result"].pop("matchPercentage")
                else:
                    resume.config["jdAnalysis"]["result"]["matchPercentage"] = value

                with self.assertRaises(
                    context_service.OptimizationEvaluationInvalidError
                ) as caught:
                    await _ContextFixture(self, resume=resume).build()

                self.assertEqual(caught.exception.status_code, 422)
                self.assertEqual(
                    str(caught.exception),
                    "The persisted JD match is invalid",
                )

    async def test_content_completeness_invariant_is_enforced_for_planning(self) -> None:
        resume = _resume()
        evaluation = resume.config["jdAnalysis"]["result"]["resumeEvaluation"]
        completeness = next(
            dimension
            for dimension in evaluation["dimensions"]
            if dimension["dimension"] == "内容完整"
        )
        for subscore in completeness["subscores"]:
            subscore["score"] = 0
            subscore["evidenceIds"] = []
        completeness["score"] = 0
        completeness["issues"] = ["ISSUE_COMPLETENESS"]
        evaluation["issues"].append(
            {
                "issueId": "ISSUE_COMPLETENESS",
                "description": "内容完整度错误地归零",
                "primaryDimension": "内容完整",
                "relatedDimensions": [],
                "evidenceIds": [],
                "severity": "high",
                "pointsNotEarned": 100,
            }
        )
        parsed = json.loads(_analysis_text())
        parsed["resume"]["educations"] = [
            {
                "id": "education-1",
                "school": "Example University",
                "major": "Computer Science",
                "degree": "Bachelor",
                "start_date": "2020-09",
                "end_date": "2024-06",
                "gpa": "",
                "courses": "",
            }
        ]
        parsed["fact_metadata"].append(
            {
                "fact_id": "FACT_EDUCATION",
                "content": "Example University",
                "source": "resume.educations[0].school",
                "verification_status": "user_claimed",
                "confidence": 1,
            }
        )

        with self.assertRaises(
            context_service.OptimizationEvaluationInvalidError
        ) as caught:
            await _ContextFixture(
                self,
                resume=resume,
                analysis_text=json.dumps(parsed, ensure_ascii=False),
            ).build()

        self.assertEqual(caught.exception.status_code, 422)

    async def test_missing_stale_wrong_version_signature_and_timestamp_are_typed(self) -> None:
        cases = []

        missing = _resume(config_overrides={"jdAnalysis": {"result": {}}})
        cases.append(
            (
                "missing",
                missing,
                _request(
                    evaluation_signature=missing.config["jdAnalysis"][
                        "evaluationSignature"
                    ]
                ),
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

    async def test_archived_linked_selection_is_ignored_when_absent_from_fresh_snapshot(self) -> None:
        active_version_id = uuid.UUID("abababab-abab-4bab-8bab-abababababab")
        active_link_id = uuid.UUID("cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd")
        active_item = _resume_item(
            link_id=active_link_id,
            master_id=UNSELECTED_MASTER_ID,
            version_id=active_version_id,
        )
        active_item.experience.title = "Visible project"
        active_item.experience.org = "Visible org"
        active_version = SimpleNamespace(
            id=active_version_id,
            master_experience_id=UNSELECTED_MASTER_ID,
            version=1,
            title="Visible project source",
            org="Visible source org",
            start_date=date(2025, 1, 1),
            end_date=None,
            is_current=True,
            summary="Visible source summary",
            highlights=[],
            tags=[],
            star={"s": "visible situation", "t": "", "a": "", "r": ""},
        )
        active_master = SimpleNamespace(
            id=UNSELECTED_MASTER_ID,
            category=ExperienceCategory.PROJECT,
        )
        skill_user = SimpleNamespace(id="skill-1")
        skill = SimpleNamespace(name="SQL", category="Tools")
        bank = {
            "profile": None,
            "experiences": [(active_master, active_version)],
            "certifications": [],
            "skills": [(skill_user, skill)],
        }
        items = [_resume_item(), active_item]
        category_map = {
            str(SELECTED_MASTER_ID): ExperienceCategory.WORK,
            str(UNSELECTED_MASTER_ID): ExperienceCategory.PROJECT,
        }
        analysis_text = _analysis_text()
        archived_result = SimpleNamespace(
            scalars=lambda: SimpleNamespace(all=lambda: [SELECTED_MASTER_ID])
        )
        session = SimpleNamespace(execute=AsyncMock(return_value=archived_result))
        resume = _resume(
            config_overrides={
                "selection": {
                    "experienceIds": [
                        str(SELECTED_MASTER_ID),
                        str(UNSELECTED_MASTER_ID),
                    ],
                    "skillIds": ["skill-1"],
                }
            }
        )
        fresh_snapshot = context_service._trusted_frontend_evaluation_snapshot(
            json.loads(analysis_text),
            resume=resume,
            resume_items=items,
            bank=bank,
            category_by_master_id=category_map,
        )
        self.assertEqual(
            json.loads(analysis_text)["resume"]["experiences"][0]["id"],
            str(SELECTED_MASTER_ID),
        )
        self.assertEqual(
            [item["id"] for item in fresh_snapshot["resume"]["experiences"]],
            [str(UNSELECTED_MASTER_ID)],
        )
        resume.config["jdAnalysis"]["evaluationSignature"] = (
            _frontend_evaluation_signature(
                fresh_snapshot,
                result=resume.config["jdAnalysis"]["result"],
            )
        )
        fixture = _ContextFixture(
            self,
            resume=resume,
            items=items,
            analysis_text=analysis_text,
            source_versions=[_selected_old_version(), active_version],
            bank=bank,
            category_map=category_map,
            session=session,
        )

        context, _builder, get_version = await fixture.build()

        self.assertEqual(
            context.selected_master_experience_ids,
            [str(UNSELECTED_MASTER_ID)],
        )
        self.assertEqual(
            set(context.selected_source_experiences),
            {str(UNSELECTED_MASTER_ID)},
        )
        self.assertEqual(
            context.selected_experience_links[str(UNSELECTED_MASTER_ID)],
            {
                "resume_link_id": str(active_link_id),
                "source_version_id": str(active_version_id),
            },
        )
        session.execute.assert_awaited_once()
        statement = session.execute.await_args.args[0]
        sql = str(statement)
        self.assertIn("master_experiences.user_id =", sql)
        self.assertIn("master_experiences.id IN", sql)
        self.assertIn("master_experiences.is_archived IS true", sql)
        compiled_params = statement.compile().params.values()
        self.assertIn(USER_ID, compiled_params)
        self.assertIn([SELECTED_MASTER_ID], compiled_params)
        get_version.assert_awaited_once_with(
            session,
            USER_ID,
            str(active_version_id),
        )

    async def test_non_archived_linked_selection_missing_from_snapshot_is_rejected(self) -> None:
        active_result = SimpleNamespace(
            scalars=lambda: SimpleNamespace(all=lambda: [])
        )
        session = SimpleNamespace(execute=AsyncMock(return_value=active_result))
        resume = _resume(
            config_overrides={
                "selection": {"experienceIds": [str(SELECTED_MASTER_ID)]}
            }
        )
        fixture = _ContextFixture(
            self,
            resume=resume,
            items=[_resume_item()],
            analysis_text=_analysis_text(selected=False),
            bank={
                "profile": None,
                "experiences": [],
                "certifications": [],
                "skills": [],
            },
            session=session,
        )

        with self.assertRaises(
            context_service.OptimizationSelectionInvalidError
        ) as caught:
            await fixture.build()

        self.assertEqual(
            str(caught.exception),
            "The current resume snapshot does not match the persisted selection",
        )
        session.execute.assert_awaited_once()

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
        self.assertNotIn("UNSELECTED SECRET STAR", planner_text)
        self.assertNotIn("SECRET CERT", planner_text)
        self.assertNotIn("SECRET SKILL", planner_text)
        self.assertNotIn(context.evaluation_signature, planner_text)
        self.assertNotIn(context.jd_signature, planner_text)
        self.assertRegex(
            planner_payload["evaluationSignature"],
            r"^sha256:[0-9a-f]{64}$",
        )
        self.assertRegex(
            planner_payload["jdSignature"],
            r"^sha256:[0-9a-f]{64}$",
        )
        self.assertNotIn("strong roadmap evidence", planner_text)
        self.assertNotIn("bankSuggestionCandidates", context.source_documents)
        self.assertEqual(
            context.snapshot_payload()["bank_suggestion_candidates"][0]["reason"],
            "strong roadmap evidence",
        )
        changed_resume = _resume(
            config_overrides={
                "jdAnalysis": {"jdInputSignature": "different-jd-signature"}
            }
        )
        changed_context, _builder, _version = await _ContextFixture(
            self,
            resume=changed_resume,
        ).build()
        self.assertNotEqual(
            changed_context.model_payload()["evaluationSignature"],
            planner_payload["evaluationSignature"],
        )
        self.assertNotEqual(
            changed_context.model_payload()["jdSignature"],
            planner_payload["jdSignature"],
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
                with self.assertRaises(
                    context_service.OptimizationEvaluationInvalidError
                ) as caught:
                    current_resume = context_service._allowlist_current_resume(
                        json.loads(_analysis_text())["resume"],
                        target_role="Product Manager",
                    )
                    facts = context_service._allowlist_fact_metadata(
                        [
                            {
                                "fact_id": "FACT_BAD",
                                "content": invalid["content"],
                                "source": invalid["source"],
                                "verification_status": "user_claimed",
                                "confidence": 1,
                            }
                        ],
                        current_resume=current_resume,
                    )
                    context_service._validate_fact_metadata_sources(
                        facts,
                        {
                            "currentResume": current_resume,
                            "selectedSourceExperiences": {},
                            "userAnswers": {},
                        },
                    )

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
            [f"FACT_{index:03d}" for index in range(1, 12)],
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

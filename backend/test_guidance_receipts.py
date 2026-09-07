from __future__ import annotations

import copy
from copy import deepcopy
import os
import json
import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from sqlalchemy.exc import SQLAlchemyError


def _set_required_env_defaults() -> None:
    os.environ["DATABASE_URL"] = (
        "postgresql+asyncpg://user:password@localhost:5432/resumeflow"
    )
    os.environ.setdefault("LOGTO_ISSUER", "https://example.logto.app/oidc")
    os.environ.setdefault("LOGTO_APP_ID", "resume-spa-app-id")


_set_required_env_defaults()

from app.domain.ai.guidance_receipts import (  # noqa: E402
    GuidanceReceiptInvalidError,
    canonical_json_hash,
    guidance_public_hash,
    load_guidance_receipt,
    persist_guidance_receipt,
    validate_guidance_receipt,
)
from app.domain.resume_optimization import context_service  # noqa: E402
from app.domain.resume_optimization.apply_service import _post_guidance_summary  # noqa: E402
from app.domain.resume_optimization.schemas import OptimizationPlan  # noqa: E402


def _public_report() -> dict:
    return {
        "evaluationVersion": "guidance_audit_v1",
        "evaluationScope": "full_resume",
        "targetRole": "Product Manager",
        "overallBand": "needs_attention",
        "confidence": "medium",
        "dimensionGuidance": [],
        "topPriorities": [],
        "safeCleanup": [],
        "informationNeeded": [],
        "riskFlags": [],
        "jdMatch": 88,
        "auditReceipt": {
            "receiptId": "receipt-1",
            "inputHash": "placeholder",
            "tasksHash": "placeholder",
            "judgmentsHash": "placeholder",
            "rubricHash": "placeholder",
            "schemaHash": "placeholder",
            "auditVersion": "guidance_audit_v1",
        },
    }


def _receipt(
    *,
    receipt_input: dict | None = None,
    target_role: str = "Product Manager",
    jd_match: int | None = 88,
    receipt_id: str = "a" * 32,
) -> dict:
    from app.domain.ai.guidance_evaluation import (
        AUDIT_VERSION,
        assemble_guidance,
        audit_schema,
        guidance_rubric,
    )
    from app.domain.ai.guidance_tasks import build_task_contract, validate_judgments

    default_input = {
        "resume": {
            "section_order": ["summary"],
            "profile": {"name": "Candidate"},
            "personal_summary": "Product manager",
            "experiences": [
                {
                    "id": "exp-1",
                    "title": "Product Manager",
                    "org": "Example",
                    "star": {
                        "s": "负责产品交付背景。",
                        "t": "完成版本交付。",
                        "a": "整理需求并协调开发。",
                        "r": "版本已上线。",
                    },
                }
            ],
            "educations": [],
            "certifications": [],
            "skills": [],
        },
        "fact_metadata": [
            {
                "fact_id": "FACT_001",
                "content": "Candidate",
                "source": "resume.profile.name",
                "verification_status": "user_claimed",
            },
            *[
                {
                    "fact_id": f"FACT_00{index + 2}",
                    "content": content,
                    "source": f"resume.experiences[0].star.{letter}",
                    "verification_status": "user_claimed",
                }
                for index, (letter, content) in enumerate(
                    (
                        ("s", "负责产品交付背景。"),
                        ("t", "完成版本交付。"),
                        ("a", "整理需求并协调开发。"),
                        ("r", "版本已上线。"),
                    )
                )
            ],
        ],
    }
    input_payload = deepcopy(receipt_input) if receipt_input is not None else default_input
    contract = build_task_contract(input_payload)
    model_rows = {}
    for task in contract["tasks"]:
        if task["taskId"] in contract["deterministic"]:
            continue
        assessment = task["allowedAssessments"][0]
        model_rows[task["taskId"]] = {
            "assessment": assessment,
            "sourceRefs": list(task["allowedSources"]),
            "reason": "当前内容支持该判断。",
            "guidance": {"type": "none", "prompt": ""},
        }
    judgments = validate_judgments(model_rows, contract)
    audit = {
        task["taskId"]: {
            "verdict": "approved",
            "sourceSupported": True,
            "assessmentSupported": True,
            "guidanceActionable": True,
            "guidanceSafe": True,
            "reason": "判断有依据。",
        }
        for task in contract["tasks"]
    }
    public, internal_report = assemble_guidance(
        contract,
        judgments,
        audit=audit,
        target_role=target_role,
        jd_match=jd_match,
    )
    rubric = guidance_rubric()
    schema = {
        "generation": contract["generationSchema"],
        "audit": audit_schema(contract),
    }
    return {
        "receipt_id": receipt_id,
        "public_hash": guidance_public_hash(public),
        "input_hash": canonical_json_hash(
            {"resume": input_payload["resume"], "fact_metadata": input_payload["fact_metadata"]}
        ),
        "tasks_hash": canonical_json_hash(contract["tasks"]),
        "judgments_hash": canonical_json_hash(judgments),
        "rubric_hash": canonical_json_hash(rubric),
        "schema_hash": canonical_json_hash(schema),
        "audit_version": AUDIT_VERSION,
        "input": input_payload,
        "sources": contract["sources"],
        "tasks": contract["tasks"],
        "judgments": judgments,
        "rubric": rubric,
        "schema": schema,
        "internal_report": internal_report,
        "audit": audit,
    }


def _bind_public(report: dict, receipt: dict) -> dict:
    bound = copy.deepcopy(report)
    bound["auditReceipt"] = {
        "receiptId": receipt["receipt_id"],
        "inputHash": receipt["input_hash"],
        "tasksHash": receipt["tasks_hash"],
        "judgmentsHash": receipt["judgments_hash"],
        "rubricHash": receipt["rubric_hash"],
        "schemaHash": receipt["schema_hash"],
        "auditVersion": receipt["audit_version"],
    }
    return bound


def _approved_public(receipt: dict) -> dict:
    from app.domain.ai.guidance_evaluation import assemble_guidance
    from app.domain.ai.guidance_tasks import build_task_contract

    contract = build_task_contract(receipt["input"])
    public, _internal = assemble_guidance(
        contract,
        receipt["judgments"],
        audit=receipt["audit"],
        target_role=receipt["internal_report"]["targetRole"],
        jd_match=receipt["internal_report"]["jdMatch"],
    )
    return _bind_public(public, receipt)


class GuidanceReceiptTests(unittest.TestCase):
    def test_public_hash_excludes_only_top_level_audit_receipt(self) -> None:
        report = _public_report()
        changed_receipt = copy.deepcopy(report)
        changed_receipt["auditReceipt"]["receiptId"] = "other"
        self.assertEqual(guidance_public_hash(report), guidance_public_hash(changed_receipt))

        changed_guidance = copy.deepcopy(report)
        changed_guidance["overallBand"] = "strong"
        self.assertNotEqual(guidance_public_hash(report), guidance_public_hash(changed_guidance))

    def test_valid_receipt_returns_a_deep_copy(self) -> None:
        receipt = _receipt()
        original = receipt["internal_report"]["overallScore"]
        validated = validate_guidance_receipt(receipt)
        validated["internal_report"]["overallScore"] = 0
        self.assertEqual(receipt["internal_report"]["overallScore"], original)

    def test_receipt_rejects_binding_tampering(self) -> None:
        for key, mutation in (
            ("input_hash", "0" * 64),
            ("tasks_hash", "0" * 64),
            ("judgments_hash", "0" * 64),
            ("rubric_hash", "0" * 64),
            ("schema_hash", "0" * 64),
        ):
            with self.subTest(key=key):
                receipt = _receipt()
                receipt[key] = mutation
                with self.assertRaises(GuidanceReceiptInvalidError):
                    validate_guidance_receipt(receipt)

    def test_receipt_rejects_unapproved_or_incomplete_task_audit(self) -> None:
        receipt = _receipt()
        first_task_id = receipt["tasks"][0]["taskId"]
        receipt["audit"][first_task_id]["guidanceSafe"] = False
        with self.assertRaises(GuidanceReceiptInvalidError):
            validate_guidance_receipt(receipt)


class GuidanceOptimizationReceiptTests(unittest.IsolatedAsyncioTestCase):
    async def test_post_receipt_must_match_the_validated_current_snapshot(self) -> None:
        from app.domain.resume_optimization import apply_service

        receipt = _receipt()
        public = _approved_public(receipt)
        wrong_snapshot = {
            "resume": deepcopy(receipt["input"]["resume"]),
            "fact_metadata": deepcopy(receipt["input"]["fact_metadata"]),
        }
        wrong_snapshot["resume"]["profile"]["name"] = "Other candidate"
        with patch(
            "app.domain.ai.guidance_receipts.load_guidance_receipt",
            new=AsyncMock(return_value=receipt),
        ):
            with self.assertRaisesRegex(ValueError, "current snapshot"):
                await apply_service._load_private_guidance_evaluation(
                    user_id="user-a",
                    public_report=public,
                    current_snapshot=wrong_snapshot,
                    expected_target_role="Product Manager",
                )

    async def test_finalize_source_receipt_is_replayed_under_current_rubric(self) -> None:
        from app.domain.ai import guidance_evaluation
        from app.domain.resume_optimization import apply_service

        receipt = _receipt()
        public = _approved_public(receipt)
        frozen = deepcopy(receipt["internal_report"])
        frozen.update({
            "_guidanceReceiptBinding": deepcopy(public["auditReceipt"]),
            "_guidanceTasks": deepcopy(receipt["tasks"]),
            "_guidanceSources": deepcopy(receipt["sources"]),
        })
        changed_rubric = {**guidance_evaluation.guidance_rubric(), "version": "changed"}
        with (
            patch(
                "app.domain.ai.guidance_receipts.load_guidance_receipt",
                new=AsyncMock(return_value=receipt),
            ),
            patch.object(
                guidance_evaluation,
                "guidance_rubric",
                return_value=changed_rubric,
            ),
        ):
            with self.assertRaisesRegex(ValueError, "rules or source binding"):
                await apply_service._reload_frozen_guidance_evaluation(
                    user_id="user-a",
                    frozen_evaluation=frozen,
                )

    async def test_current_jd_rejects_a_null_guidance_jd_mirror(self) -> None:
        from app.domain.resume_optimization.schemas import ResumeOptimizationStartRequest
        from test_resume_optimization_context import BASE_TIME, _resume

        resume = _resume()
        receipt = _receipt(jd_match=None)
        resume.config["jdAnalysis"]["result"]["resumeEvaluation"] = _approved_public(
            receipt
        )
        request = ResumeOptimizationStartRequest(
            resume_id=str(resume.id),
            evaluation_signature=resume.config["jdAnalysis"]["evaluationSignature"],
            expected_resume_updated_at=BASE_TIME,
        )
        with self.assertRaisesRegex(
            context_service.OptimizationEvaluationInvalidError,
            "JD match",
        ):
            context_service._validate_report(resume, request)

    async def test_transient_receipt_storage_error_keeps_apply_retryable(self) -> None:
        from app.domain.resume_optimization import apply_service
        from app.domain.resume_optimization.run_service import hash_canonical_json
        from semantic_review_test_support import review_run_fixture
        from test_resume_optimization_apply import (
            RUN_ID,
            USER_ID,
            _change,
            _link,
            _request as apply_request,
            _resume,
            _run,
            _transaction_session,
        )
        from test_resume_optimization_finalize import _prepare_source_evaluation

        run = _run([_change("CHG_A")])
        resume = _resume()
        _prepare_source_evaluation(run, resume_config=resume.config, jd_match=80)
        resume.config["jdAnalysis"]["evaluationSignature"] = (
            run.source_evaluation_signature
        )
        binding = resume.config["jdAnalysis"]["result"]["resumeEvaluation"][
            "auditReceipt"
        ]
        run.before_snapshot["evaluation"]["_guidanceReceiptBinding"] = deepcopy(
            binding
        )
        run.source_snapshot_hash = hash_canonical_json(run.before_snapshot)
        review_run_fixture(run)
        session = _transaction_session(run, resume, _link())

        with (
            patch(
                "app.domain.ai.guidance_receipts.load_guidance_receipt",
                new=AsyncMock(side_effect=SQLAlchemyError("temporary storage failure")),
            ),
            self.assertRaises(SQLAlchemyError),
        ):
            await apply_service.apply_resume_optimization(
                session=session,
                user_id=USER_ID,
                run_id=str(RUN_ID),
                payload=apply_request("CHG_A"),
            )

        self.assertEqual(run.status, "preview_ready")
        self.assertEqual(session.commits, 0)
        self.assertEqual(session.rollbacks, 1)
        self.assertEqual(session.stale_session.commits, 0)

    async def test_real_receipts_authorize_apply_and_score_free_finalize(self) -> None:
        from app.domain.resume_optimization import apply_service
        from app.domain.resume_optimization.run_service import hash_canonical_json
        from semantic_review_test_support import review_run_fixture
        from test_resume_optimization_apply import (
            MASTER_ID,
            RUN_ID,
            USER_ID,
            _change,
            _link,
            _request as apply_request,
            _resume,
            _run,
            _transaction_session,
        )
        from test_resume_optimization_finalize import (
            POST_SCORE_TIME,
            RESCORE_CLAIM_ID,
            RESCORE_CLAIM_TIME,
            _finalize_request,
            _finalize_session,
            _frontend_evaluation_signature,
            _frontend_source_snapshot,
            _post_frontend_snapshot,
            _prepare_source_evaluation,
        )

        run = _run([_change("CHG_A")])
        resume = _resume()
        _prepare_source_evaluation(run, resume_config=resume.config, jd_match=80)
        source_snapshot = _frontend_source_snapshot(personal_summary="原摘要")
        source_receipt = _receipt(
            receipt_input={
                "resume": source_snapshot["resume"],
                "fact_metadata": source_snapshot["fact_metadata"],
            },
            target_role="产品经理",
            jd_match=80,
            receipt_id="1" * 32,
        )
        source_public = _approved_public(source_receipt)
        analysis = resume.config["jdAnalysis"]
        analysis["result"]["resumeEvaluation"] = source_public
        source_signature = _frontend_evaluation_signature(
            jd_input_signature=run.source_jd_signature,
            resume_snapshot=source_snapshot,
            jd_result=analysis["result"],
            jd_available=True,
        )
        analysis["evaluationSignature"] = source_signature
        run.source_evaluation_signature = source_signature
        frozen = deepcopy(run.before_snapshot)
        frozen_internal = deepcopy(source_receipt["internal_report"])
        frozen_internal.update({
            "_guidanceReceiptBinding": deepcopy(source_public["auditReceipt"]),
            "_guidanceTasks": deepcopy(source_receipt["tasks"]),
            "_guidanceSources": deepcopy(source_receipt["sources"]),
        })
        frozen["evaluation"] = frozen_internal
        frozen["evaluation_signature"] = source_signature
        frozen["fact_metadata"] = deepcopy(source_snapshot["fact_metadata"])
        run.before_snapshot = frozen
        run.source_snapshot_hash = hash_canonical_json(frozen)
        review_run_fixture(run)
        # Exercise the same persisted envelope used by planning and answers,
        # through real receipt validation, apply, and finalize.
        from app.domain.resume_optimization.schemas import OptimizationPlan
        run.plan_json = OptimizationPlan.model_validate(run.plan_json).storage_dump()
        run.result_json = OptimizationPlan.model_validate(run.result_json).storage_dump()
        link = _link()
        link.overrides_json["star"]["r"] = "转化率提升 30%"
        apply_session = _transaction_session(run, resume, link)

        with patch(
            "app.domain.ai.guidance_receipts.load_guidance_receipt",
            new=AsyncMock(return_value=source_receipt),
        ):
            applied = await apply_service.apply_resume_optimization(
                session=apply_session,
                user_id=USER_ID,
                run_id=str(RUN_ID),
                payload=apply_request("CHG_A"),
            )

        applied.run.error_json = {
            "_activeRescoreClaim": {
                "claimId": RESCORE_CLAIM_ID,
                "claimedAt": RESCORE_CLAIM_TIME.isoformat(),
            }
        }
        post_snapshot = _post_frontend_snapshot(applied.run, applied.resume)
        post_receipt = _receipt(
            receipt_input={
                "resume": post_snapshot["resume"],
                "fact_metadata": post_snapshot["fact_metadata"],
            },
            target_role="产品经理",
            jd_match=80,
            receipt_id="2" * 32,
        )
        post_public = _approved_public(post_receipt)
        post_analysis = applied.resume.config["jdAnalysis"]
        post_analysis["evaluationIsOutdated"] = False
        post_analysis["result"]["resumeEvaluation"] = post_public
        post_analysis["evaluationSignature"] = _frontend_evaluation_signature(
            jd_input_signature=applied.run.source_jd_signature,
            resume_snapshot=post_snapshot,
            jd_result=post_analysis["result"],
            jd_available=True,
        )
        applied.resume.updated_at = POST_SCORE_TIME
        finalize_session = _finalize_session(applied.run, applied.resume, link)

        async def load_final_receipt(*, receipt_id, user_id):
            self.assertEqual(user_id, USER_ID)
            return {
                source_receipt["receipt_id"]: source_receipt,
                post_receipt["receipt_id"]: post_receipt,
            }[receipt_id]

        with patch(
            "app.domain.ai.guidance_receipts.load_guidance_receipt",
            new=AsyncMock(side_effect=load_final_receipt),
        ):
            completed = await apply_service.finalize_run_from_persisted_evaluation(
                session=finalize_session,
                user_id=USER_ID,
                run_id=str(RUN_ID),
                payload=_finalize_request(),
            )

        self.assertNotEqual(source_receipt["input_hash"], post_receipt["input_hash"])
        self.assertEqual(completed.status, "completed")
        self.assertEqual(
            completed.post_evaluation_json["version"],
            "guidance_optimization_post_v1",
        )
        self.assertFalse(
            {"beforeScore", "afterScore", "scoreDelta", "dimensionDeltas"}
            & set(completed.post_evaluation_json)
        )

    async def test_persist_and_load_use_one_user_owned_usage_event(self) -> None:
        receipt = _receipt()
        event = SimpleNamespace(
            id="event-1",
            created_at=datetime(2026, 9, 7, tzinfo=timezone.utc),
            metadata_json={"guidance_audit_attempt_id": "attempt-1"},
        )

        class Result:
            def scalars(self):
                return self

            def all(self):
                return [event]

        class FakeSession:
            committed = False

            async def __aenter__(self):
                return self

            async def __aexit__(self, *_args):
                return None

            async def execute(self, _statement):
                return Result()

            def add(self, _row):
                return None

            async def commit(self):
                self.committed = True

        fake_session = FakeSession()
        with (
            patch(
                "app.domain.billing.billing_service.get_current_billing_context",
                return_value=SimpleNamespace(user_id="user-a"),
            ),
            patch("app.database.AsyncSessionFactory", return_value=fake_session),
        ):
            await persist_guidance_receipt("attempt-1", receipt)
            loaded = await load_guidance_receipt(
                receipt_id=receipt["receipt_id"],
                user_id="user-a",
            )

        self.assertTrue(fake_session.committed)
        self.assertEqual(
            event.metadata_json["guidance_receipt_id"],
            receipt["receipt_id"],
        )
        self.assertEqual(loaded, validate_guidance_receipt(receipt))

    async def test_private_guidance_receipt_material_never_enters_planner_payload(self) -> None:
        from test_resume_optimization_planner import _context

        context = _context()
        context._snapshot["evaluation"].update({
            "_guidanceReceiptBinding": {"receiptId": "receipt-1"},
            "_guidanceTasks": [{"taskId": "PROFILE_EMAIL"}],
            "_guidanceSources": {
                "SRC_001": {"content": "private@example.com"}
            },
        })
        from app.domain.resume_optimization.planner_service import (
            _minimized_planner_model_payload,
        )

        serialized = json.dumps(
            _minimized_planner_model_payload(context),
            ensure_ascii=False,
        )
        self.assertNotIn("_guidance", serialized)
        self.assertNotIn("private@example.com", serialized)

    async def test_optimizer_resolves_only_the_bound_private_internal_report(self) -> None:
        receipt = _receipt()
        public = _approved_public(receipt)
        with patch.object(
            context_service,
            "load_guidance_receipt",
            new=AsyncMock(return_value=receipt),
        ) as load:
            internal, binding, tasks, sources = (
                await context_service._resolve_guidance_evaluation(
                    public,
                    user_id="user-a",
                    evaluation_input={**receipt["input"], "target_role": "Product Manager"},
                    jd_available=True,
                )
            )

        load.assert_awaited_once_with(receipt_id="a" * 32, user_id="user-a")
        self.assertEqual(internal["scoringVersion"], "guidance_audit_v1")
        self.assertEqual(binding["receiptId"], "a" * 32)
        self.assertEqual(tasks, receipt["tasks"])
        self.assertEqual(sources, receipt["sources"])

    async def test_optimizer_rejects_current_input_that_differs_from_receipt(self) -> None:
        receipt = _receipt()
        public = _approved_public(receipt)
        current = copy.deepcopy(receipt["input"])
        current["target_role"] = "Product Manager"
        current["resume"]["profile"]["name"] = "Changed"
        with patch.object(
            context_service,
            "load_guidance_receipt",
            new=AsyncMock(return_value=receipt),
        ):
            with self.assertRaises(context_service.OptimizationContextStaleError):
                await context_service._resolve_guidance_evaluation(
                    public,
                    user_id="user-a",
                    evaluation_input=current,
                    jd_available=True,
                )

    async def test_optimizer_rejects_public_guidance_tampering(self) -> None:
        receipt = _receipt()
        public = _approved_public(receipt)
        public["overallBand"] = "strong"
        with patch.object(
            context_service,
            "load_guidance_receipt",
            new=AsyncMock(return_value=receipt),
        ):
            with self.assertRaises(context_service.OptimizationEvaluationInvalidError):
                await context_service._resolve_guidance_evaluation(
                    public,
                    user_id="user-a",
                    evaluation_input={**receipt["input"], "target_role": "Product Manager"},
                    jd_available=True,
                )

        receipt = _receipt()
        receipt["audit"] = {}
        with self.assertRaises(GuidanceReceiptInvalidError):
            validate_guidance_receipt(receipt)

    def test_receipt_rejects_unknown_task_sources_and_judgments(self) -> None:
        receipt = _receipt()
        receipt["tasks"][0]["allowedSources"] = ["SRC_UNKNOWN"]
        receipt["tasks_hash"] = canonical_json_hash(receipt["tasks"])
        with self.assertRaises(GuidanceReceiptInvalidError):
            validate_guidance_receipt(receipt)

    def test_guidance_post_summary_contains_no_quality_numbers(self) -> None:
        receipt = _receipt()
        internal = receipt["internal_report"]
        plan = OptimizationPlan()
        run = SimpleNamespace(
            result_json=plan.model_dump(mode="json"),
            plan_json=plan.model_dump(mode="json"),
            accepted_change_ids=[],
        )
        summary = _post_guidance_summary(
            run=run,
            resume=SimpleNamespace(updated_at=datetime(2026, 9, 7, tzinfo=timezone.utc)),
            evaluation_signature="signature",
            before=internal,
            after=internal,
        )
        self.assertEqual(summary["version"], "guidance_optimization_post_v1")
        self.assertFalse(
            {"beforeScore", "afterScore", "scoreDelta", "dimensionDeltas"}
            & set(summary)
        )

        receipt = _receipt()
        first_task_id = receipt["tasks"][0]["taskId"]
        receipt["judgments"]["UNKNOWN"] = receipt["judgments"][first_task_id]
        receipt["judgments_hash"] = canonical_json_hash(receipt["judgments"])
        with self.assertRaises(GuidanceReceiptInvalidError):
            validate_guidance_receipt(receipt)


if __name__ == "__main__":
    unittest.main()

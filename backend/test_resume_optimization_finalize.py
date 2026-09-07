from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timedelta, timezone
import hashlib
import json
from types import SimpleNamespace
import unittest
import uuid
from unittest.mock import AsyncMock, Mock, patch

from fastapi import HTTPException
from pydantic import ValidationError

from app.domain.ai.resume_evaluation import DIMENSION_NAMES, DIMENSION_SUBSCORES
from app.domain.resume_optimization import apply_service, router as router_module
from app.domain.resume_optimization.run_service import canonical_json, hash_canonical_json
from app.domain.resume_optimization.schemas import (
    ResumeOptimizationFinalizeRequest,
    ResumeOptimizationRescoreClaimRequest,
    ResumeOptimizationRevertRequest,
    ResumeOptimizationStatus,
)

from test_resume_optimization_apply import (
    BASE_TIME,
    LINK_ID,
    MASTER_ID,
    RUN_ID,
    USER_ID,
    _FakeSession,
    _change,
    _link,
    _request as _apply_request,
    _resume,
    _run,
    _transaction_session,
)


POST_SCORE_TIME = BASE_TIME + timedelta(minutes=10)
RESCORE_CLAIM_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
RESCORE_CLAIM_TIME = datetime.now(timezone.utc)


def _frontend_source_snapshot(
    *,
    personal_summary: str = "原摘要",
    summary_visible: bool = True,
    section_order: list[str] | None = None,
) -> dict:
    resolved_summary = personal_summary if summary_visible else ""
    editor_order = []
    for section_id in section_order or ["summary", "work", "skills"]:
        if (
            section_id
            in {"summary", "education", "work", "project", "certifications", "skills"}
            and section_id not in editor_order
        ):
            editor_order.append(section_id)
    if "summary" not in editor_order:
        editor_order.insert(0, "summary")
    for section_id in [
        "summary",
        "education",
        "work",
        "project",
        "certifications",
        "skills",
    ]:
        if section_id not in editor_order:
            editor_order.append(section_id)
    normalized_order = []
    for section_id in editor_order:
        if (
            section_id not in normalized_order
            and section_id
            in {"summary", "education", "work", "project", "certifications", "skills"}
            and (section_id != "summary" or bool(resolved_summary))
        ):
            normalized_order.append(section_id)
    raw = {
        "evaluation_scope": "full_resume",
        "target_role": "产品经理",
        "resume": {
            "section_order": normalized_order,
            "profile": {
                "name": "",
                "email": "",
                "phone": "",
                "location": "",
                "linkedin": "",
            },
            "personal_summary": resolved_summary,
            "experiences": [
                {
                    "id": str(MASTER_ID),
                    "title": "产品实习生",
                    "org": "原子科技",
                    "star": {
                        "s": "原情境",
                        "t": "原任务",
                        "a": "原行动",
                        "r": "转化率提升 30%",
                    },
                    "category": "work",
                }
            ],
            "educations": [],
            "certifications": [],
            "skills": [
                {"id": "skill-a", "name": "A", "category": "技能"},
                {"id": "skill-b", "name": "B", "category": "技能"},
            ],
        },
        "experience_atoms": [
            {
                "id": str(MASTER_ID),
                "title": "产品实习生",
                "org": "原子科技",
                "star": {
                    "s": "原情境",
                    "t": "原任务",
                    "a": "原行动",
                    "r": "转化率提升 30%",
                },
            }
        ],
        "match_candidates": {"certifications": [], "skills": []},
        "fact_metadata": [],
    }
    raw["fact_metadata"] = apply_service._rebuild_frontend_fact_metadata(raw)
    return apply_service._validate_exact_frontend_evaluation_snapshot(raw)


def _post_frontend_snapshot(run, resume) -> dict:
    post = deepcopy(
        apply_service._source_frontend_evaluation_snapshot(
            run,
            allow_legacy=(
                run.status
                in {
                    ResumeOptimizationStatus.APPLIED.value,
                    ResumeOptimizationStatus.RESCORING.value,
                    ResumeOptimizationStatus.COMPLETED.value,
                    ResumeOptimizationStatus.REVERTED.value,
                }
            ),
        )
    )
    post_resume = post["resume"]
    accepted = set(run.accepted_change_ids)
    changes = [
        change
        for change in run.result_json["changes"]
        if change["change_id"] in accepted
    ]
    layout = resume.config.get("layout")
    layout = layout if isinstance(layout, dict) else {}
    summary_visible = layout.get("isSummaryVisible") is not False
    has_summary_change = any(
        change["module_type"] == "personal_summary" for change in changes
    )
    has_section_change = any(
        change["module_type"] == "section_order" for change in changes
    )
    for change in changes:
        if change["module_type"] == "experience_star":
            key = change["field_path"][-1]
            target = apply_service._frontend_star_plain_text(change["targeted_value"])
            next(item for item in post_resume["experiences"] if item["id"] == change["module_id"])["star"][key] = target
            next(item for item in post["experience_atoms"] if item["id"] == change["module_id"])["star"][key] = change["targeted_value"]
        elif change["module_type"] == "personal_summary" and summary_visible:
            post_resume["personal_summary"] = apply_service._frontend_plain_text(
                change["targeted_value"]
            )
        elif change["module_type"] == "skills_order":
            by_id = {item["id"]: item for item in post_resume["skills"]}
            post_resume["skills"] = [
                deepcopy(by_id[item_id]) for item_id in change["targeted_value"]
            ]
    raw_order = layout.get("sectionOrder")
    if isinstance(raw_order, list) or has_summary_change or has_section_change:
        post_resume["section_order"] = apply_service._frontend_evaluation_section_order(
            raw_order if isinstance(raw_order, list) else [],
            has_summary=bool(post_resume["personal_summary"]),
        )
    post["fact_metadata"] = apply_service._rebuild_frontend_fact_metadata(post)
    return apply_service._validate_exact_frontend_evaluation_snapshot(post)


def _frontend_evaluation_signature(
    *,
    jd_input_signature: str,
    resume_snapshot: dict,
    jd_result: dict | None,
    jd_available: bool,
) -> str:
    if jd_available:
        assert isinstance(jd_result, dict)
        identity = deepcopy(jd_result)
        identity.pop("resumeEvaluation", None)
        match_percentage = jd_result.get("matchPercentage")
    else:
        identity = None
        match_percentage = None
    return canonical_json(
        {
            "jdInputSignature": jd_input_signature,
            "resume": resume_snapshot,
            "jdAvailable": jd_available,
            "jdResultIdentity": canonical_json(identity),
            "jdMatchPercentage": match_percentage,
        }
    )


def _raw_evaluation_jd_available_for_test(evaluation) -> bool:
    return isinstance(evaluation, dict) and evaluation.get("jdMatch") is not None


def _evaluation(
    scores: list[int],
    *,
    issue_prefix: str,
    jd_match: int | None = 80,
) -> dict:
    fact_id = "FACT_007"
    evidence_id = "E_RESULT"
    dimensions = []
    issues = []
    for index, ((name, subscores), target_score) in enumerate(
        zip(DIMENSION_SUBSCORES, scores)
    ):
        remaining = target_score
        normalized_subscores = []
        for subscore_name, max_score in subscores:
            score = min(max_score, remaining)
            remaining -= score
            normalized_subscores.append(
                {
                    "name": subscore_name,
                    "maxScore": max_score,
                    "score": score,
                    "evidenceIds": [evidence_id] if score > 0 else [],
                }
            )
        dimension_issue_ids = []
        if target_score < 100:
            issue_id = f"{issue_prefix}_{index + 1}"
            dimension_issue_ids.append(issue_id)
            issues.append(
                {
                    "issueId": issue_id,
                    "description": f"{name}仍有改进空间",
                    "primaryDimension": name,
                    "relatedDimensions": [],
                    "evidenceIds": [evidence_id],
                    "severity": "low",
                    "pointsNotEarned": 100 - target_score,
                }
            )
        dimensions.append(
            {
                "dimension": name,
                "subscores": normalized_subscores,
                "strengths": [],
                "issues": dimension_issue_ids,
                "improvementQuestions": [],
            }
        )
    return {
        "evaluationVersion": "resume_flow_v1",
        "scoringVersion": "coverage_consensus_v2",
        "evaluationScope": "full_resume",
        "overallScore": round(sum(scores) / len(scores)),
        "targetRole": "产品经理",
        "evaluationConfidence": 0.89,
        "dimensions": dimensions,
        "evidence": [
            {
                "evidenceId": evidence_id,
                "factId": fact_id,
                "sourceText": "转化率提升 30%",
                "location": "经历结果",
                "verificationStatus": "user_claimed",
                "supportedDimensions": list(DIMENSION_NAMES),
            }
        ],
        "issues": issues,
        "missingInformation": [],
        "riskFlags": [],
        "topPriorities": [],
        "jdMatch": jd_match,
    }


def _source_evaluation(*, jd_match: int | None = 80) -> dict:
    return _evaluation(
        [60, 62, 64, 66, 68, 70],
        issue_prefix="BEFORE",
        jd_match=jd_match,
    )


def _post_evaluation(*, jd_match: int | None = 80) -> dict:
    return _evaluation(
        [100, 100, 100, 76, 78, 80],
        issue_prefix="AFTER",
        jd_match=jd_match,
    )


def _prepare_source_evaluation(
    run,
    *,
    resume_config: dict,
    jd_match: int | None = 80,
) -> None:
    layout = resume_config.get("layout", {})
    personal_summary = str(resume_config.get("personalSummary") or "")
    frontend_snapshot = _frontend_source_snapshot(
        personal_summary=personal_summary,
        summary_visible=layout.get("isSummaryVisible") is not False,
        section_order=layout.get("sectionOrder"),
    )
    analysis = resume_config["jdAnalysis"]
    analysis_result = analysis["result"]
    analysis_result["resumeEvaluation"] = _source_evaluation(jd_match=jd_match)
    if jd_match is None:
        analysis_result.pop("matchPercentage", None)
    else:
        analysis_result["matchPercentage"] = jd_match
    run.source_evaluation_signature = _frontend_evaluation_signature(
        jd_input_signature=run.source_jd_signature,
        resume_snapshot=frontend_snapshot,
        jd_result=analysis_result,
        jd_available=jd_match is not None,
    )
    snapshot = deepcopy(run.before_snapshot)
    snapshot["current_resume"]["personal_summary"] = personal_summary
    snapshot["current_resume"]["section_order"] = deepcopy(
        layout.get("sectionOrder")
    )
    snapshot["current_resume"]["experiences"][str(MASTER_ID)]["star"]["r"] = (
        "转化率提升 30%"
    )
    snapshot["evaluation"] = deepcopy(analysis_result["resumeEvaluation"])
    snapshot["evaluation_signature"] = run.source_evaluation_signature
    snapshot["fact_metadata"] = deepcopy(frontend_snapshot["fact_metadata"])
    run.before_snapshot = snapshot
    run.source_snapshot_hash = hash_canonical_json(snapshot)
    safety = run.result_json["safety_summary"]
    safety["allowed_change_ids"] = [
        change["change_id"] for change in run.result_json["changes"]
    ]
    safety["blocked_change_ids"] = ["CHG_BLOCKED"]
    safety["pending_change_ids"] = ["CHG_PENDING"]
    safety["findings"] = ["保留事实边界"]


async def _applied_fixture(
    *,
    changes: list[dict] | None = None,
    accepted_ids: tuple[str, ...] = ("CHG_A",),
    config_mutator=None,
    link_mutator=None,
    source_jd_match: int | None = 80,
):
    resolved_changes = changes or [_change("CHG_A")]
    run = _run(resolved_changes)
    resume = _resume()
    if config_mutator is not None:
        config_mutator(resume.config)
    _prepare_source_evaluation(
        run,
        resume_config=resume.config,
        jd_match=source_jd_match,
    )
    resume.config["jdAnalysis"]["evaluationSignature"] = (
        run.source_evaluation_signature
    )
    link = _link()
    link.overrides_json["star"]["r"] = "转化率提升 30%"
    if link_mutator is not None:
        link_mutator(link)
    from semantic_review_test_support import review_run_fixture
    review_run_fixture(run)
    session = _transaction_session(run, resume, link)
    result = await apply_service.apply_resume_optimization(
        session=session,
        user_id=USER_ID,
        run_id=str(RUN_ID),
        payload=_apply_request(*accepted_ids),
    )
    result.run.error_json = {
        "_activeRescoreClaim": {
            "claimId": RESCORE_CLAIM_ID,
            "claimedAt": RESCORE_CLAIM_TIME.isoformat(),
        }
    }
    return result.run, result.resume, link


def _install_persisted_post_evaluation(
    run,
    resume,
    *,
    evaluation: dict | None = None,
    evaluation_is_outdated: bool = False,
    signature: str | None = None,
) -> None:
    analysis = resume.config["jdAnalysis"]
    analysis["evaluationIsOutdated"] = evaluation_is_outdated
    post_snapshot = _post_frontend_snapshot(run, resume)
    analysis["jdInputSignature"] = run.source_jd_signature
    if evaluation is None:
        analysis["result"].pop("resumeEvaluation", None)
    else:
        analysis["result"]["resumeEvaluation"] = deepcopy(evaluation)
    analysis["evaluationSignature"] = signature or _frontend_evaluation_signature(
        jd_input_signature=run.source_jd_signature,
        resume_snapshot=post_snapshot,
        jd_result=analysis["result"],
        jd_available=_raw_evaluation_jd_available_for_test(evaluation),
    )
    resume.updated_at = POST_SCORE_TIME


def _finalize_session(
    run,
    resume,
    link,
    *,
    query_links=None,
    tracked_links=None,
) -> _FakeSession:
    selected = list(query_links or [link])
    tracked = list(tracked_links or selected)
    return _FakeSession(
        [[run], [resume], selected],
        run=run,
        resume=resume,
        links=tracked,
    )


def _finalize_request(
    expected=POST_SCORE_TIME,
    *,
    claim_id: str = RESCORE_CLAIM_ID,
) -> ResumeOptimizationFinalizeRequest:
    return ResumeOptimizationFinalizeRequest(
        expected_resume_updated_at=expected,
        claim_id=claim_id,
    )


def _revert_request(expected) -> ResumeOptimizationRevertRequest:
    return ResumeOptimizationRevertRequest(
        expected_resume_updated_at=expected,
        claim_id=RESCORE_CLAIM_ID,
    )


class ResumeOptimizationFinalizeTests(unittest.IsolatedAsyncioTestCase):
    async def test_already_applied_legacy_baseline_requires_revert_instead_of_retrying_scores(self):
        run, resume, link = await _applied_fixture()
        run.before_snapshot["evaluation"].pop("scoringVersion")
        run.source_snapshot_hash = hash_canonical_json(run.before_snapshot)
        run.after_snapshot["rollback_before_signature"] = apply_service._rollback_before_signature(
            run_id=run.id, resume_id=run.resume_id, source_snapshot_hash=run.source_snapshot_hash,
            applied_change_ids=list(run.accepted_change_ids), before=run.after_snapshot["before"])
        _install_persisted_post_evaluation(run, resume, evaluation=_post_evaluation())
        with self.assertRaises(apply_service.OptimizationScoringVersionMismatchError):
            await apply_service.finalize_run_from_persisted_evaluation(
                session=_finalize_session(run, resume, link), user_id=USER_ID,
                run_id=str(RUN_ID), payload=_finalize_request())
        self.assertEqual(run.status, ResumeOptimizationStatus.APPLIED.value)
        self.assertFalse(run.error_json["retryable"])
        self.assertIn("撤销", run.error_json["message"])
        self.assertFalse(run.post_evaluation_json)

    def test_mixed_or_missing_scoring_versions_cannot_produce_score_delta(self):
        for version in (None, "previous_rules", "coverage_consensus_v1"):
            for side in ("before", "after"):
                with self.subTest(version=version, side=side):
                    evaluations = {"before": _source_evaluation(), "after": _post_evaluation()}
                    if version is None:
                        evaluations[side].pop("scoringVersion")
                    else:
                        evaluations[side]["scoringVersion"] = version
                    with self.assertRaises(apply_service.OptimizationScoringVersionMismatchError):
                        apply_service._post_evaluation_summary(run=None, resume=None,
                            evaluation_signature="test", **evaluations)

    async def test_implicit_archived_selection_survives_post_apply_operations(self) -> None:
        for selection_mode in ("missing_field", "missing_selection"):
            for operation in ("resume", "claim", "finalize", "revert"):
                with self.subTest(selection_mode=selection_mode, operation=operation):
                    def omit_selection(config):
                        if selection_mode == "missing_selection":
                            config.pop("selection")
                        else:
                            config["selection"].pop("experienceIds")

                    run, resume, link = await _applied_fixture(config_mutator=omit_selection)
                    archived_link = deepcopy(link)
                    archived_link.id = uuid.UUID("77777777-7777-4777-8777-777777777777")
                    archived_link.experience_version_id = uuid.UUID("88888888-8888-4888-8888-888888888888")
                    archived_overrides = deepcopy(archived_link.overrides_json)
                    if operation == "finalize":
                        _install_persisted_post_evaluation(run, resume, evaluation=_post_evaluation())
                    session = _FakeSession(
                        [[run], [resume], [link, archived_link], [archived_link.id]],
                        run=run, resume=resume, links=[link, archived_link],
                    )
                    kwargs = dict(session=session, user_id=USER_ID, run_id=str(RUN_ID))
                    if operation == "resume":
                        self.assertTrue(await apply_service.is_applied_run_resumable(**kwargs))
                    elif operation == "claim":
                        await apply_service.claim_resume_optimization_rescore(
                            **kwargs,
                            payload=ResumeOptimizationRescoreClaimRequest(
                                expected_resume_updated_at=resume.updated_at,
                                claim_id=RESCORE_CLAIM_ID,
                            ),
                        )
                    elif operation == "finalize":
                        completed = await apply_service.finalize_run_from_persisted_evaluation(
                            **kwargs, payload=_finalize_request(),
                        )
                        self.assertEqual(completed.status, ResumeOptimizationStatus.COMPLETED.value)
                    else:
                        reverted = await apply_service.revert_resume_optimization(
                            **kwargs, payload=_revert_request(resume.updated_at),
                        )
                        self.assertEqual(reverted.run.status, ResumeOptimizationStatus.REVERTED.value)
                    if selection_mode == "missing_selection":
                        self.assertNotIn("selection", resume.config)
                    else:
                        self.assertNotIn("experienceIds", resume.config["selection"])
                    self.assertEqual(archived_link.overrides_json, archived_overrides)
                    archived_query = session.statements[3]
                    self.assertIn("master_experiences.is_archived IS true", str(archived_query))
                    self.assertIn(USER_ID, archived_query.compile().params.values())
                    self.assertIsNotNone(archived_query._for_update_arg)
                    self.assertTrue(archived_query._for_update_arg.skip_locked)

    async def test_implicit_extra_link_must_be_confirmed_archived_before_rescore(self) -> None:
        run, resume, link = await _applied_fixture(
            config_mutator=lambda config: config["selection"].pop("experienceIds"),
        )
        extra_link = deepcopy(link)
        extra_link.id = uuid.UUID("77777777-7777-4777-8777-777777777777")
        extra_link.experience_version_id = uuid.UUID("88888888-8888-4888-8888-888888888888")
        # An active, restored, missing, or concurrently locked master yields no
        # confirmed archived link. None of these cases may start paid rescore.
        session = _FakeSession(
            [[run], [resume], [link, extra_link], []],
            run=run, resume=resume, links=[link, extra_link],
        )
        with self.assertRaises(apply_service.OptimizationContentConflictError):
            await apply_service.claim_resume_optimization_rescore(
                session=session, user_id=USER_ID, run_id=str(RUN_ID),
                payload=ResumeOptimizationRescoreClaimRequest(
                    expected_resume_updated_at=resume.updated_at,
                    claim_id=RESCORE_CLAIM_ID,
                ),
            )
        self.assertEqual(session.commits, 0)
        self.assertEqual(session.flushes, 0)
        self.assertEqual(run.status, ResumeOptimizationStatus.APPLIED.value)

    async def test_archived_selection_survives_apply_and_post_apply_operations(self) -> None:
        archived_id = uuid.UUID("77777777-7777-4777-8777-777777777777")
        for operation in ("resume", "claim", "finalize", "revert"):
            with self.subTest(operation=operation):
                run, resume, link = await _applied_fixture(
                    config_mutator=lambda config: config["selection"]["experienceIds"].append(str(archived_id)),
                )
                self.assertEqual(run.status, ResumeOptimizationStatus.APPLIED.value)
                if operation == "finalize":
                    _install_persisted_post_evaluation(run, resume, evaluation=_post_evaluation())
                session = _FakeSession(
                    [[run], [resume], [archived_id], [link]],
                    run=run, resume=resume, links=[link],
                )
                kwargs = dict(session=session, user_id=USER_ID, run_id=str(RUN_ID))
                if operation == "resume":
                    self.assertTrue(await apply_service.is_applied_run_resumable(**kwargs))
                elif operation == "claim":
                    await apply_service.claim_resume_optimization_rescore(
                        **kwargs,
                        payload=ResumeOptimizationRescoreClaimRequest(
                            expected_resume_updated_at=resume.updated_at,
                            claim_id=RESCORE_CLAIM_ID,
                        ),
                    )
                elif operation == "finalize":
                    completed = await apply_service.finalize_run_from_persisted_evaluation(
                        **kwargs, payload=_finalize_request(),
                    )
                    self.assertEqual(completed.status, ResumeOptimizationStatus.COMPLETED.value)
                else:
                    reverted = await apply_service.revert_resume_optimization(
                        **kwargs, payload=_revert_request(resume.updated_at),
                    )
                    self.assertEqual(reverted.run.status, ResumeOptimizationStatus.REVERTED.value)
                self.assertEqual(
                    resume.config["selection"]["experienceIds"],
                    [str(MASTER_ID), str(archived_id)],
                )
                archived_query = session.statements[2]
                self.assertIn("master_experiences.is_archived IS true", str(archived_query))
                self.assertIn(USER_ID, archived_query.compile().params.values())
                self.assertIsNotNone(archived_query._for_update_arg)
                self.assertTrue(archived_query._for_update_arg.skip_locked)

    async def test_hidden_selection_must_be_confirmed_archived_before_resuming(self) -> None:
        hidden_id = "77777777-7777-4777-8777-777777777777"
        run, resume, link = await _applied_fixture(
            config_mutator=lambda config: config["selection"]["experienceIds"].append(hidden_id),
        )
        session = _FakeSession([[run], [resume], []], run=run, resume=resume, links=[link])
        self.assertFalse(await apply_service.is_applied_run_resumable(
            session=session, user_id=USER_ID, run_id=str(RUN_ID),
        ))
        self.assertEqual(session.commits, 0)
        self.assertEqual(session.flushes, 0)

        # A row being restored by another transaction is skipped by the lock
        # query just like an already restored row: no paid rescore may begin.
        claim_session = _FakeSession([[run], [resume], []], run=run, resume=resume, links=[link])
        with self.assertRaises(apply_service.OptimizationContentConflictError):
            await apply_service.claim_resume_optimization_rescore(
                session=claim_session, user_id=USER_ID, run_id=str(RUN_ID),
                payload=ResumeOptimizationRescoreClaimRequest(
                    expected_resume_updated_at=resume.updated_at,
                    claim_id=RESCORE_CLAIM_ID,
                ),
            )
        self.assertEqual(claim_session.commits, 0)
        self.assertEqual(claim_session.flushes, 0)

    async def test_resumability_recheck_returns_the_locked_terminal_run(self) -> None:
        initially_applied, _, _ = await _applied_fixture()
        finalized_while_rechecking = deepcopy(initially_applied)
        finalized_while_rechecking.status = ResumeOptimizationStatus.COMPLETED.value

        with patch.object(
            apply_service,
            "_lock_run",
            AsyncMock(return_value=finalized_while_rechecking),
        ) as lock_run:
            recheck = await apply_service.is_applied_run_resumable(
                session=SimpleNamespace(),
                user_id=USER_ID,
                run_id=str(RUN_ID),
            )

        self.assertFalse(recheck.is_resumable)
        self.assertIs(recheck.run, finalized_while_rechecking)
        self.assertIsNot(recheck.run, initially_applied)
        lock_run.assert_awaited_once_with(
            unittest.mock.ANY,
            user_id=USER_ID,
            run_id=str(RUN_ID),
        )

    async def test_legacy_two_field_signature_is_only_accepted_for_unmarked_post_apply_runs(self) -> None:
        snapshot = _frontend_source_snapshot()
        legacy_signature = canonical_json(
            {
                "jdInputSignature": "jd-signature",
                "resume": snapshot,
            }
        )
        with self.assertRaises(apply_service.OptimizationRunDataInvalidError):
            apply_service._parse_frontend_evaluation_signature(
                legacy_signature,
                jd_input_signature="jd-signature",
                field_name="new source signature",
            )

        run = _run([_change("CHG_LEGACY_SIGNATURE")])
        run.source_evaluation_signature = legacy_signature
        run.before_snapshot["evaluation_signature"] = legacy_signature
        run.source_snapshot_hash = hash_canonical_json(run.before_snapshot)
        with self.assertRaises(apply_service.OptimizationRunDataInvalidError):
            apply_service._source_frontend_evaluation_snapshot(
                run,
                allow_legacy=True,
            )

        run.before_snapshot.pop("evaluation_signature_schema")
        run.source_snapshot_hash = hash_canonical_json(run.before_snapshot)
        run.status = ResumeOptimizationStatus.APPLIED.value
        self.assertEqual(
            apply_service._source_frontend_evaluation_snapshot(
                run,
                allow_legacy=True,
            ),
            snapshot,
        )
        run.before_snapshot["evaluation_signature_schema"] = "frontend_evaluation_v2"
        run.source_snapshot_hash = hash_canonical_json(run.before_snapshot)
        with self.assertRaises(apply_service.OptimizationRunDataInvalidError):
            apply_service._source_frontend_evaluation_snapshot(
                run,
                allow_legacy=True,
            )

    async def test_unmarked_post_apply_source_uses_the_legacy_profile_fact_contract(self) -> None:
        snapshot = _frontend_source_snapshot(
            personal_summary="<b>字面摘要</b>",
        )
        legacy_snapshot = deepcopy(snapshot)
        legacy_snapshot["fact_metadata"] = (
            apply_service._rebuild_frontend_fact_metadata(
                legacy_snapshot,
                normalized_profile_summary=False,
            )
        )
        self.assertNotEqual(
            snapshot["fact_metadata"],
            legacy_snapshot["fact_metadata"],
        )
        for signature_shape in ("legacy_two_field", "historical_five_field"):
            with self.subTest(signature_shape=signature_shape):
                run = _run(
                    [_change("CHG_LEGACY_FACTS")],
                    status=ResumeOptimizationStatus.APPLIED,
                )
                signature_payload = json.loads(run.source_evaluation_signature)
                signature_payload["resume"] = legacy_snapshot
                if signature_shape == "legacy_two_field":
                    signature_payload = {
                        "jdInputSignature": signature_payload["jdInputSignature"],
                        "resume": legacy_snapshot,
                    }
                legacy_signature = canonical_json(signature_payload)
                run.source_evaluation_signature = legacy_signature
                run.before_snapshot["evaluation_signature"] = legacy_signature
                run.before_snapshot.pop("evaluation_signature_schema")
                run.source_snapshot_hash = hash_canonical_json(run.before_snapshot)

                self.assertEqual(
                    apply_service._source_frontend_evaluation_snapshot(
                        run,
                        allow_legacy=True,
                    ),
                    legacy_snapshot,
                )

    async def test_legacy_applied_completed_and_reverted_runs_remain_readable(self) -> None:
        async def legacy_applied_fixture():
            run, resume, link = await _applied_fixture()
            source = json.loads(run.source_evaluation_signature)
            legacy_signature = canonical_json(
                {
                    "jdInputSignature": source["jdInputSignature"],
                    "resume": source["resume"],
                }
            )
            run.source_evaluation_signature = legacy_signature
            run.before_snapshot["evaluation_signature"] = legacy_signature
            run.before_snapshot.pop("evaluation_signature_schema")
            run.source_snapshot_hash = hash_canonical_json(run.before_snapshot)
            run.after_snapshot["rollback_before_signature"] = (
                apply_service._rollback_before_signature(
                    run_id=run.id,
                    resume_id=run.resume_id,
                    source_snapshot_hash=run.source_snapshot_hash,
                    applied_change_ids=list(run.accepted_change_ids),
                    before=run.after_snapshot["before"],
                )
            )
            return run, resume, link

        tampered_run, _tampered_resume, _tampered_link = await _applied_fixture()
        tampered_source = json.loads(tampered_run.source_evaluation_signature)
        tampered_run.source_evaluation_signature = canonical_json(
            {
                "jdInputSignature": tampered_source["jdInputSignature"],
                "resume": tampered_source["resume"],
            }
        )
        with self.assertRaises(router_module.OptimizationPersistedRunInvalidError):
            router_module._run_to_read(tampered_run)

        applied_run, _applied_resume, _applied_link = await legacy_applied_fixture()
        self.assertEqual(
            router_module._run_to_read(applied_run).status,
            ResumeOptimizationStatus.APPLIED,
        )

        completed_run, completed_resume, completed_link = (
            await legacy_applied_fixture()
        )
        _install_persisted_post_evaluation(
            completed_run,
            completed_resume,
            evaluation=_post_evaluation(),
        )
        completed = await apply_service.finalize_run_from_persisted_evaluation(
            session=_finalize_session(
                completed_run,
                completed_resume,
                completed_link,
            ),
            user_id=USER_ID,
            run_id=str(RUN_ID),
            payload=_finalize_request(),
        )
        self.assertEqual(
            router_module._run_to_read(completed).status,
            ResumeOptimizationStatus.COMPLETED,
        )

        reverted_run, reverted_resume, reverted_link = await legacy_applied_fixture()
        reverted = await apply_service.revert_resume_optimization(
            session=_finalize_session(
                reverted_run,
                reverted_resume,
                reverted_link,
            ),
            user_id=USER_ID,
            run_id=str(RUN_ID),
            payload=_revert_request(reverted_resume.updated_at),
        )
        self.assertEqual(
            router_module._run_to_read(reverted.run).status,
            ResumeOptimizationStatus.REVERTED,
        )

    async def test_current_five_field_frontend_signature_is_accepted(self) -> None:
        snapshot = _frontend_source_snapshot()
        jd_result = {
            "matchPercentage": 80,
            "requirements": ["负责产品规划"],
            "resumeEvaluation": _source_evaluation(),
        }
        signature = canonical_json(
            {
                "jdInputSignature": "jd-signature",
                "resume": snapshot,
                "jdAvailable": True,
                "jdResultIdentity": canonical_json(
                    {
                        "matchPercentage": 80,
                        "requirements": ["负责产品规划"],
                    }
                ),
                "jdMatchPercentage": 80,
            }
        )

        rebuilt = apply_service._parse_frontend_evaluation_signature(
            signature,
            jd_input_signature="jd-signature",
            field_name="current frontend signature",
        )

        self.assertEqual(rebuilt, snapshot)

    async def test_frontend_signature_rejects_numbers_outside_javascript_finite_range(self) -> None:
        snapshot = _frontend_source_snapshot()
        huge = 10**400
        base = {
            "jdAvailable": True,
            "jdInputSignature": "jd-signature",
            "jdMatchPercentage": 80,
            "jdResultIdentity": canonical_json({"matchPercentage": 80}),
            "resume": snapshot,
        }
        cases = []
        root = deepcopy(base)
        root["jdMatchPercentage"] = huge
        cases.append(root)
        nested = deepcopy(base)
        nested["jdResultIdentity"] = canonical_json(
            {"matchPercentage": 80, "nested": {"huge": huge}}
        )
        cases.append(nested)
        for signature in cases:
            with self.subTest(signature=signature):
                with self.assertRaises(apply_service.OptimizationRunDataInvalidError):
                    apply_service._parse_frontend_evaluation_signature(
                        canonical_json(signature),
                        jd_input_signature="jd-signature",
                        field_name="oversized numeric signature",
                    )

    async def test_huge_signature_numbers_fail_with_read_domain_and_finalize_pending_errors(self) -> None:
        huge = 10**400
        read_run, _read_resume, _read_link = await _applied_fixture()
        read_signature = json.loads(read_run.source_evaluation_signature)
        read_signature["jdMatchPercentage"] = huge
        read_run.source_evaluation_signature = canonical_json(read_signature)
        with self.assertRaises(router_module.OptimizationPersistedRunInvalidError):
            router_module._run_to_read(read_run)

        for location in ("root", "nested"):
            with self.subTest(location=location):
                run, resume, link = await _applied_fixture()
                _install_persisted_post_evaluation(
                    run,
                    resume,
                    evaluation=_post_evaluation(),
                )
                signature = json.loads(
                    resume.config["jdAnalysis"]["evaluationSignature"]
                )
                if location == "root":
                    signature["jdMatchPercentage"] = huge
                else:
                    identity = json.loads(signature["jdResultIdentity"])
                    identity["nestedHuge"] = huge
                    signature["jdResultIdentity"] = canonical_json(identity)
                resume.config["jdAnalysis"]["evaluationSignature"] = canonical_json(
                    signature
                )
                session = _finalize_session(run, resume, link)

                with self.assertRaises(apply_service.OptimizationFinalizePendingError):
                    await apply_service.finalize_run_from_persisted_evaluation(
                        session=session,
                        user_id=USER_ID,
                        run_id=str(RUN_ID),
                        payload=_finalize_request(),
                    )

                self.assertEqual(run.status, ResumeOptimizationStatus.APPLIED.value)
                self.assertEqual(session.commits, 1)

    async def test_frontend_signature_accepts_javascript_number_serialization(self) -> None:
        snapshot = _frontend_source_snapshot()
        evaluation = _source_evaluation(jd_match=0.000001)
        jd_result = {
            "evidenceCompleteness": 0.000001,
            "largeFixed": 10**20,
            "largeScientific": 1e21,
            "matchPercentage": 0.000001,
            "negativeZero": -0.0,
            "recommendedTitles": [{"confidence": 1e-7}],
            "resumeEvaluation": evaluation,
        }
        # Exact JSON.stringify/canonicalStringify spellings.  Python's json
        # encoder instead emits 1e-06, 1e-07 and -0.0 for three of these.
        identity = (
            '{"evidenceCompleteness":0.000001,'
            '"largeFixed":100000000000000000000,'
            '"largeScientific":1e+21,'
            '"matchPercentage":0.000001,'
            '"negativeZero":0,'
            '"recommendedTitles":[{"confidence":1e-7}]}'
        )
        signature = canonical_json(
            {
                "jdAvailable": True,
                "jdInputSignature": "jd-signature",
                "jdMatchPercentage": 0.000001,
                "jdResultIdentity": identity,
                "resume": snapshot,
            }
        ).replace('"jdMatchPercentage":1e-06', '"jdMatchPercentage":0.000001')

        rebuilt = apply_service._parse_frontend_evaluation_signature(
            signature,
            jd_input_signature="jd-signature",
            field_name="JavaScript-number frontend signature",
            expected_evaluation=evaluation,
            expected_jd_result=jd_result,
        )

        self.assertEqual(rebuilt, snapshot)
        self.assertIn('\\"largeFixed\\":100000000000000000000', signature)
        self.assertIn('\\"largeScientific\\":1e+21', signature)
        self.assertIn('\\"negativeZero\\":0', signature)
        self.assertIn('\\"confidence\\":1e-7', signature)

    async def test_frontend_signature_rejects_noncanonical_or_duplicate_json(self) -> None:
        snapshot = _frontend_source_snapshot()
        jd_result = {
            "matchPercentage": 80,
            "requirements": ["负责产品规划"],
            "resumeEvaluation": _source_evaluation(),
        }
        valid = _frontend_evaluation_signature(
            jd_input_signature="jd-signature",
            resume_snapshot=snapshot,
            jd_result=jd_result,
            jd_available=True,
        )
        payload = json.loads(valid)
        unsorted = json.dumps(
            {
                "resume": payload["resume"],
                "jdResultIdentity": payload["jdResultIdentity"],
                "jdMatchPercentage": 80,
                "jdInputSignature": "jd-signature",
                "jdAvailable": True,
            },
            ensure_ascii=False,
            separators=(",", ":"),
        )
        duplicate_root = '{"jdAvailable":true,' + valid[1:]
        identity_duplicate = deepcopy(payload)
        identity_duplicate["jdResultIdentity"] = (
            '{"matchPercentage":80,"matchPercentage":80,'
            '"requirements":["负责产品规划"]}'
        )
        identity_whitespace = deepcopy(payload)
        identity_whitespace["jdResultIdentity"] = (
            '{"matchPercentage":80, "requirements":["负责产品规划"]}'
        )
        nonfinite = valid.replace(
            '"jdMatchPercentage":80',
            '"jdMatchPercentage":1e999',
            1,
        )
        invalid_signatures = [
            valid.replace("{", "{ ", 1),
            unsorted,
            duplicate_root,
            canonical_json(identity_duplicate),
            canonical_json(identity_whitespace),
            nonfinite,
        ]

        for signature in invalid_signatures:
            with self.subTest(signature=signature[:80]):
                with self.assertRaises(
                    apply_service.OptimizationRunDataInvalidError
                ):
                    apply_service._parse_frontend_evaluation_signature(
                        signature,
                        jd_input_signature="jd-signature",
                        field_name="noncanonical frontend signature",
                        expected_evaluation=jd_result["resumeEvaluation"],
                        expected_jd_result=jd_result,
                    )

    async def test_frontend_signature_rejects_jd_identity_match_and_shape_tampering(self) -> None:
        snapshot = _frontend_source_snapshot()
        evaluation = _source_evaluation()
        jd_result = {
            "matchPercentage": 80,
            "requirements": ["负责产品规划"],
            "resumeEvaluation": evaluation,
        }
        valid_payload = json.loads(
            _frontend_evaluation_signature(
                jd_input_signature="jd-signature",
                resume_snapshot=snapshot,
                jd_result=jd_result,
                jd_available=True,
            )
        )
        tampered_payloads = []
        changed_identity = deepcopy(valid_payload)
        changed_identity["jdResultIdentity"] = canonical_json(
            {"matchPercentage": 80, "requirements": ["不同但同分的JD"]}
        )
        tampered_payloads.append(changed_identity)
        changed_match = deepcopy(valid_payload)
        changed_match["jdMatchPercentage"] = 81
        tampered_payloads.append(changed_match)
        unknown_root = deepcopy(valid_payload)
        unknown_root["unknown"] = True
        tampered_payloads.append(unknown_root)
        tampered_payloads.append(
            {
                "jdInputSignature": "jd-signature",
                "resume": snapshot,
            }
        )

        for payload in tampered_payloads:
            with self.subTest(keys=tuple(payload)):
                with self.assertRaises(
                    apply_service.OptimizationRunDataInvalidError
                ):
                    apply_service._parse_frontend_evaluation_signature(
                        canonical_json(payload),
                        jd_input_signature="jd-signature",
                        field_name="tampered frontend signature",
                        expected_evaluation=evaluation,
                        expected_jd_result=jd_result,
                    )

    async def test_frontend_signature_enforces_no_jd_semantics(self) -> None:
        snapshot = _frontend_source_snapshot()
        evaluation = _source_evaluation(jd_match=None)
        jd_result = {"resumeEvaluation": evaluation}
        signature = _frontend_evaluation_signature(
            jd_input_signature="jd-signature",
            resume_snapshot=snapshot,
            jd_result=jd_result,
            jd_available=False,
        )

        rebuilt = apply_service._parse_frontend_evaluation_signature(
            signature,
            jd_input_signature="jd-signature",
            field_name="no-JD frontend signature",
            expected_evaluation=evaluation,
            expected_jd_result=jd_result,
        )
        self.assertEqual(rebuilt, snapshot)

        tampered = json.loads(signature)
        tampered["jdResultIdentity"] = canonical_json({})
        with self.assertRaises(apply_service.OptimizationRunDataInvalidError):
            apply_service._parse_frontend_evaluation_signature(
                canonical_json(tampered),
                jd_input_signature="jd-signature",
                field_name="tampered no-JD frontend signature",
                expected_evaluation=evaluation,
                expected_jd_result=jd_result,
            )

    async def test_server_evaluation_signature_matches_frontend_canonical_shape(self) -> None:
        snapshot = {
            "evaluation_scope": "full_resume",
            "target_role": "产品经理",
            "resume": {
                "section_order": ["summary", "education", "work", "project", "certifications", "skills"],
                "profile": {"name": "范鼎", "email": "fan@example.com", "phone": "", "location": "杭州", "linkedin": ""},
                "personal_summary": "当前简历总结\n第二行",
                "experiences": [{"id": "exp-selected", "title": "<b>产品实习生</b>", "org": "原子科技", "start_date": "", "end_date": "", "star": {"s": "用户流失复购下降", "t": "定位原因", "a": "访谈 20 人", "r": "形成方案"}, "category": "work"}],
                "educations": [{"id": "edu-selected", "school": "原子大学", "major": "信息管理", "degree": "本科", "gpa": "3.8", "courses": "数据分析"}],
                "certifications": [{"id": "cert-selected", "name": "PMP", "issuer": "PMI", "issue_date": "2025-03"}],
                "skills": [{"id": "skill-selected", "name": "Figma", "category": "未分类"}],
            },
            "experience_atoms": [{"id": "exp-selected", "title": "<b>产品实习生</b>", "org": "原子科技", "start_date": "", "end_date": "", "star": {"s": "<ul><li>用户流失</li><li>复购下降</li></ul>", "t": "定位原因", "a": "<b>访谈 20 人</b>", "r": "形成方案"}}],
            "match_candidates": {
                "certifications": [{"id": "cert-selected", "name": "PMP", "issuer": "PMI", "issue_date": "2025-03"}],
                "skills": [{"id": "skill-selected", "name": "Figma", "category": "未分类"}],
            },
            "fact_metadata": [],
        }
        snapshot["fact_metadata"] = apply_service._rebuild_frontend_fact_metadata(snapshot)
        jd_result = {"matchPercentage": 80, "requirements": ["产品规划"]}
        signature = _frontend_evaluation_signature(
            jd_input_signature="jd-signature",
            resume_snapshot=snapshot,
            jd_result=jd_result,
            jd_available=True,
        )

        rebuilt = apply_service._parse_frontend_evaluation_signature(
            signature,
            jd_input_signature="jd-signature",
            field_name="golden frontend signature",
        )

        self.assertEqual(rebuilt, snapshot)
        self.assertRegex(
            hashlib.sha256(signature.encode("utf-8")).hexdigest(),
            r"^[0-9a-f]{64}$",
        )
        self.assertEqual(rebuilt["resume"]["experiences"][0]["start_date"], "")
        self.assertEqual(rebuilt["resume"]["skills"][0]["category"], "未分类")
        self.assertIn("<ul>", rebuilt["experience_atoms"][0]["star"]["s"])
        self.assertEqual(apply_service._frontend_plain_text("A&nbsp;B"), "A B")
        self.assertEqual(apply_service._frontend_plain_text("A\u00a0B"), "A B")

        null_dates = deepcopy(snapshot)
        null_dates["resume"]["experiences"][0]["start_date"] = None
        null_dates["resume"]["experiences"][0]["end_date"] = None
        null_dates["experience_atoms"][0]["start_date"] = None
        null_dates["experience_atoms"][0]["end_date"] = None
        null_dates["fact_metadata"] = apply_service._rebuild_frontend_fact_metadata(
            null_dates
        )
        null_signature = _frontend_evaluation_signature(
            jd_input_signature="jd-signature",
            resume_snapshot=null_dates,
            jd_result=jd_result,
            jd_available=True,
        )
        self.assertEqual(
            apply_service._parse_frontend_evaluation_signature(
                null_signature,
                jd_input_signature="jd-signature",
                field_name="null-date frontend signature",
            ),
            null_dates,
        )

    async def test_applied_run_transitions_through_rescoring_to_completed(self) -> None:
        run, resume, link = await _applied_fixture()
        _install_persisted_post_evaluation(run, resume, evaluation=_post_evaluation())
        session = _finalize_session(run, resume, link)

        result = await apply_service.finalize_run_from_persisted_evaluation(
            session=session,
            user_id=USER_ID,
            run_id=str(RUN_ID),
            payload=_finalize_request(),
        )

        self.assertEqual(
            session.flush_statuses,
            [
                ResumeOptimizationStatus.RESCORING.value,
                ResumeOptimizationStatus.COMPLETED.value,
            ],
        )
        self.assertEqual(result.status, ResumeOptimizationStatus.COMPLETED.value)
        self.assertIsNotNone(result.completed_at)
        self.assertEqual(session.commits, 1)
        self.assertIs(resume.config["jdAnalysis"]["isOutdated"], True)

    async def test_no_jd_run_can_finalize_with_current_signature_shape(self) -> None:
        run, resume, link = await _applied_fixture(source_jd_match=None)
        _install_persisted_post_evaluation(
            run,
            resume,
            evaluation=_post_evaluation(jd_match=None),
        )

        result = await apply_service.finalize_run_from_persisted_evaluation(
            session=_finalize_session(run, resume, link),
            user_id=USER_ID,
            run_id=str(RUN_ID),
            payload=_finalize_request(),
        )

        self.assertEqual(result.status, ResumeOptimizationStatus.COMPLETED.value)

    async def test_apply_rejects_persisted_jd_identity_or_match_drift(self) -> None:
        for mutation in ("identity", "match"):
            with self.subTest(mutation=mutation):
                run = _run([_change("CHG_A")])
                resume = _resume()
                _prepare_source_evaluation(run, resume_config=resume.config)
                resume.config["jdAnalysis"]["evaluationSignature"] = (
                    run.source_evaluation_signature
                )
                if mutation == "identity":
                    resume.config["jdAnalysis"]["result"]["requirements"] = [
                        "同分但不同JD内容"
                    ]
                else:
                    resume.config["jdAnalysis"]["result"]["matchPercentage"] = 81
                link = _link()
                link.overrides_json["star"]["r"] = "转化率提升 30%"
                session = _transaction_session(run, resume, link)
                before_config = deepcopy(resume.config)
                before_overrides = deepcopy(link.overrides_json)

                with self.assertRaises(
                    apply_service.OptimizationApplyValidationError
                ):
                    await apply_service.apply_resume_optimization(
                        session=session,
                        user_id=USER_ID,
                        run_id=str(RUN_ID),
                        payload=_apply_request("CHG_A"),
                    )

                self.assertEqual(run.status, ResumeOptimizationStatus.PREVIEW_READY.value)
                self.assertEqual(resume.config, before_config)
                self.assertEqual(link.overrides_json, before_overrides)
                self.assertEqual(session.commits, 0)

    async def test_finalize_rejects_same_score_different_jd_result_identity(self) -> None:
        run, resume, link = await _applied_fixture()
        resume.config["jdAnalysis"]["result"]["requirements"] = ["不同JD内容"]
        _install_persisted_post_evaluation(
            run,
            resume,
            evaluation=_post_evaluation(),
        )
        session = _finalize_session(run, resume, link)

        with self.assertRaises(apply_service.OptimizationFinalizePendingError):
            await apply_service.finalize_run_from_persisted_evaluation(
                session=session,
                user_id=USER_ID,
                run_id=str(RUN_ID),
                payload=_finalize_request(),
            )

        self.assertEqual(run.status, ResumeOptimizationStatus.APPLIED.value)

    async def test_finalize_rejects_jd_match_percentage_drift(self) -> None:
        run, resume, link = await _applied_fixture()
        resume.config["jdAnalysis"]["result"]["matchPercentage"] = 81
        post_snapshot = _post_frontend_snapshot(run, resume)
        signature = _frontend_evaluation_signature(
            jd_input_signature=run.source_jd_signature,
            resume_snapshot=post_snapshot,
            jd_result=resume.config["jdAnalysis"]["result"],
            jd_available=True,
        )
        _install_persisted_post_evaluation(
            run,
            resume,
            evaluation=_post_evaluation(),
            signature=signature,
        )
        session = _finalize_session(run, resume, link)

        with self.assertRaises(apply_service.OptimizationFinalizePendingError):
            await apply_service.finalize_run_from_persisted_evaluation(
                session=session,
                user_id=USER_ID,
                run_id=str(RUN_ID),
                payload=_finalize_request(),
            )

        self.assertEqual(run.status, ResumeOptimizationStatus.APPLIED.value)

    async def test_finalize_reads_only_persisted_server_evaluation(self) -> None:
        run, resume, link = await _applied_fixture()
        persisted = _post_evaluation()
        _install_persisted_post_evaluation(run, resume, evaluation=persisted)
        session = _finalize_session(run, resume, link)
        request = _finalize_request()

        self.assertEqual(request.model_dump(), {
            "expected_resume_updated_at": POST_SCORE_TIME,
            "claim_id": RESCORE_CLAIM_ID,
        })
        result = await apply_service.finalize_run_from_persisted_evaluation(
            session=session,
            user_id=USER_ID,
            run_id=str(RUN_ID),
            payload=request,
        )

        self.assertEqual(
            result.post_evaluation_json["afterScore"],
            persisted["overallScore"],
        )

    async def test_finalize_schema_requires_a_rescore_claim(self) -> None:
        with self.assertRaises(ValidationError):
            ResumeOptimizationFinalizeRequest(
                expected_resume_updated_at=POST_SCORE_TIME,
            )

    async def test_finalize_rejects_an_expired_matching_rescore_claim(self) -> None:
        run, resume, link = await _applied_fixture()
        run.error_json["_activeRescoreClaim"]["claimedAt"] = (
            datetime.now(timezone.utc) - timedelta(hours=1)
        ).isoformat()
        _install_persisted_post_evaluation(run, resume, evaluation=_post_evaluation())

        with self.assertRaises(apply_service.OptimizationRescoreClaimLostError):
            await apply_service.finalize_run_from_persisted_evaluation(
                session=_finalize_session(run, resume, link),
                user_id=USER_ID,
                run_id=str(RUN_ID),
                payload=_finalize_request(),
            )

    async def test_finalize_normalizes_forged_score_and_rejects_incomplete_dimensions(self) -> None:
        run, resume, link = await _applied_fixture()
        forged = _post_evaluation()
        forged["overallScore"] = 1
        _install_persisted_post_evaluation(run, resume, evaluation=forged)
        result = await apply_service.finalize_run_from_persisted_evaluation(
            session=_finalize_session(run, resume, link),
            user_id=USER_ID,
            run_id=str(RUN_ID),
            payload=_finalize_request(),
        )
        self.assertEqual(result.post_evaluation_json["afterScore"], 89)

        run, resume, link = await _applied_fixture()
        incomplete = _post_evaluation()
        incomplete["dimensions"].pop()
        _install_persisted_post_evaluation(run, resume, evaluation=incomplete)
        with self.assertRaises(apply_service.OptimizationFinalizePendingError):
            await apply_service.finalize_run_from_persisted_evaluation(
                session=_finalize_session(run, resume, link),
                user_id=USER_ID,
                run_id=str(RUN_ID),
                payload=_finalize_request(),
            )

    async def test_finalize_records_scores_dimension_deltas_issues_and_safety(self) -> None:
        run, resume, link = await _applied_fixture()
        before = _source_evaluation()
        after = _post_evaluation()
        _install_persisted_post_evaluation(run, resume, evaluation=after)
        session = _finalize_session(run, resume, link)

        result = await apply_service.finalize_run_from_persisted_evaluation(
            session=session,
            user_id=USER_ID,
            run_id=str(RUN_ID),
            payload=_finalize_request(),
        )
        payload = result.post_evaluation_json

        self.assertEqual(payload["beforeScore"], before["overallScore"])
        self.assertEqual(payload["afterScore"], after["overallScore"])
        self.assertEqual(
            payload["scoreDelta"],
            after["overallScore"] - before["overallScore"],
        )
        self.assertEqual(len(payload["dimensionDeltas"]), 6)
        before_scores = [60, 62, 64, 66, 68, 70]
        after_scores = [100, 100, 100, 76, 78, 80]
        for index, item in enumerate(payload["dimensionDeltas"]):
            self.assertEqual(item["dimension"], DIMENSION_NAMES[index])
            self.assertEqual(item["beforeScore"], before_scores[index])
            self.assertEqual(item["afterScore"], after_scores[index])
            self.assertEqual(
                item["delta"],
                after_scores[index] - before_scores[index],
            )
        self.assertEqual(
            payload["issueCounts"],
            {
                "before": 6,
                "after": 3,
                "resolved": 3,
                "remaining": 3,
                "introduced": 0,
            },
        )
        self.assertEqual(
            payload["safetySummary"],
            run.result_json["safety_summary"],
        )

    async def test_missing_stale_or_invalid_evaluation_returns_to_applied_for_retry(self) -> None:
        cases = (
            ("missing", None, False, None),
            ("stale", _post_evaluation(), True, None),
            ("invalid", {"overallScore": "PRIVATE_INVALID"}, False, None),
            ("bad_signature", _post_evaluation(), False, "PRIVATE_SIGNATURE"),
        )
        for name, evaluation, outdated, signature in cases:
            with self.subTest(name=name):
                run, resume, link = await _applied_fixture()
                _install_persisted_post_evaluation(
                    run,
                    resume,
                    evaluation=evaluation,
                    evaluation_is_outdated=outdated,
                    signature=signature,
                )
                session = _finalize_session(run, resume, link)

                with self.assertRaises(
                    apply_service.OptimizationFinalizePendingError
                ) as raised:
                    await apply_service.finalize_run_from_persisted_evaluation(
                        session=session,
                        user_id=USER_ID,
                        run_id=str(RUN_ID),
                        payload=_finalize_request(),
                    )

                self.assertEqual(run.status, ResumeOptimizationStatus.APPLIED.value)
                self.assertEqual(run.post_evaluation_json, {})
                self.assertEqual(
                    session.flush_statuses,
                    [
                        ResumeOptimizationStatus.RESCORING.value,
                        ResumeOptimizationStatus.APPLIED.value,
                    ],
                )
                self.assertEqual(session.commits, 1)
                self.assertNotIn("PRIVATE", raised.exception.public_message)

    async def test_finalize_requires_the_active_rescore_claim_and_clears_it_on_success(self) -> None:
        run, resume, link = await _applied_fixture()
        claim_id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
        run.error_json = {
            "_activeRescoreClaim": {
                "claimId": claim_id,
                "claimedAt": RESCORE_CLAIM_TIME.isoformat(),
            }
        }
        _install_persisted_post_evaluation(run, resume, evaluation=_post_evaluation())

        with self.assertRaises(apply_service.OptimizationRescoreClaimLostError):
            await apply_service.finalize_run_from_persisted_evaluation(
                session=_finalize_session(run, resume, link),
                user_id=USER_ID,
                run_id=str(RUN_ID),
                payload=_finalize_request(
                    claim_id="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                ),
            )

        result = await apply_service.finalize_run_from_persisted_evaluation(
            session=_finalize_session(run, resume, link),
            user_id=USER_ID,
            run_id=str(RUN_ID),
            payload=_finalize_request(claim_id=claim_id),
        )
        self.assertEqual(result.status, ResumeOptimizationStatus.COMPLETED.value)
        self.assertEqual(result.error_json, {})

    async def test_finalize_pending_clears_rescore_claim_for_immediate_retry(self) -> None:
        run, resume, link = await _applied_fixture()
        claim_id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
        run.error_json = {
            "_activeRescoreClaim": {
                "claimId": claim_id,
                "claimedAt": RESCORE_CLAIM_TIME.isoformat(),
            }
        }
        _install_persisted_post_evaluation(run, resume, evaluation=None)

        with self.assertRaises(apply_service.OptimizationFinalizePendingError):
            await apply_service.finalize_run_from_persisted_evaluation(
                session=_finalize_session(run, resume, link),
                user_id=USER_ID,
                run_id=str(RUN_ID),
                payload=_finalize_request(claim_id=claim_id),
            )

        self.assertEqual(run.status, ResumeOptimizationStatus.APPLIED.value)
        self.assertNotIn("_activeRescoreClaim", run.error_json)

    async def test_finalize_rejects_source_jd_signature_mismatch_for_retry(self) -> None:
        run, resume, link = await _applied_fixture()
        _install_persisted_post_evaluation(run, resume, evaluation=_post_evaluation())
        resume.config["jdAnalysis"]["jdInputSignature"] = "changed-jd-signature"
        session = _finalize_session(run, resume, link)

        with self.assertRaises(apply_service.OptimizationContentConflictError):
            await apply_service.finalize_run_from_persisted_evaluation(
                session=session,
                user_id=USER_ID,
                run_id=str(RUN_ID),
                payload=_finalize_request(),
            )

        self.assertEqual(run.status, ResumeOptimizationStatus.APPLIED.value)
        self.assertEqual(session.commits, 0)
        self.assertEqual(session.rollbacks, 1)

    async def test_finalize_rejects_untouched_frontend_snapshot_drift(self) -> None:
        run, resume, link = await _applied_fixture()
        post = _post_frontend_snapshot(run, resume)
        post["match_candidates"]["skills"].append(
            {"id": "skill-private", "name": "PRIVATE", "category": "未分类"}
        )
        post["fact_metadata"] = apply_service._rebuild_frontend_fact_metadata(post)
        signature = _frontend_evaluation_signature(
            jd_input_signature=run.source_jd_signature,
            resume_snapshot=post,
            jd_result=resume.config["jdAnalysis"]["result"],
            jd_available=True,
        )
        _install_persisted_post_evaluation(
            run,
            resume,
            evaluation=_post_evaluation(),
            signature=signature,
        )
        session = _finalize_session(run, resume, link)

        with self.assertRaises(apply_service.OptimizationFinalizePendingError):
            await apply_service.finalize_run_from_persisted_evaluation(
                session=session,
                user_id=USER_ID,
                run_id=str(RUN_ID),
                payload=_finalize_request(),
            )

        self.assertEqual(run.status, ResumeOptimizationStatus.APPLIED.value)
        self.assertEqual(session.commits, 1)

    async def test_non_jd_evaluation_with_nonempty_signature_finalizes_and_reloads(self) -> None:
        run, resume, link = await _applied_fixture(
            source_jd_match=None,
        )
        post = _evaluation(
            [100, 100, 100, 76, 78, 80],
            issue_prefix="AFTER",
            jd_match=None,
        )
        _install_persisted_post_evaluation(run, resume, evaluation=post)

        result = await apply_service.finalize_run_from_persisted_evaluation(
            session=_finalize_session(run, resume, link),
            user_id=USER_ID,
            run_id=str(RUN_ID),
            payload=_finalize_request(),
        )

        self.assertTrue(run.source_jd_signature)
        self.assertEqual(result.status, ResumeOptimizationStatus.COMPLETED.value)
        self.assertEqual(router_module._run_to_read(run).source_before_score, 65)

    async def test_naive_database_timestamp_accepts_aware_expected_and_stores_aware_time(self) -> None:
        run, resume, link = await _applied_fixture()
        _install_persisted_post_evaluation(run, resume, evaluation=_post_evaluation())
        resume.updated_at = POST_SCORE_TIME.replace(tzinfo=None)

        result = await apply_service.finalize_run_from_persisted_evaluation(
            session=_finalize_session(run, resume, link),
            user_id=USER_ID,
            run_id=str(RUN_ID),
            payload=_finalize_request(POST_SCORE_TIME),
        )

        stored = result.post_evaluation_json["resumeUpdatedAt"]
        parsed = datetime.fromisoformat(stored.replace("Z", "+00:00"))
        self.assertIsNotNone(parsed.utcoffset())

    async def test_summary_visibility_and_empty_transitions_match_frontend_snapshot(self) -> None:
        cases = (
            ("hidden", "原摘要", "定向摘要", False, "", False),
            ("empty_to_nonempty", "", "新增摘要", True, "新增摘要", True),
            ("nonempty_to_empty", "原摘要", "", True, "", False),
            (
                "encoded_markup_stays_literal",
                "原摘要",
                "&lt;b&gt;摘要&lt;/b&gt;",
                True,
                "<b>摘要</b>",
                True,
            ),
            (
                "double_encoded_markup_decodes_once",
                "原摘要",
                "&amp;lt;b&amp;gt;摘要&amp;lt;/b&amp;gt;",
                True,
                "&lt;b&gt;摘要&lt;/b&gt;",
                True,
            ),
        )
        for name, before, targeted, visible, expected_summary, has_section in cases:
            with self.subTest(name=name):
                def mutate(config):
                    config["personalSummary"] = before
                    config["layout"]["isSummaryVisible"] = visible

                change = _change(
                    "CHG_SUMMARY",
                    module_type="personal_summary",
                    field_path="personalSummary",
                    before_value=before,
                    general_value=targeted,
                    targeted_value=targeted,
                )
                run, resume, link = await _applied_fixture(
                    changes=[change],
                    accepted_ids=("CHG_SUMMARY",),
                    config_mutator=mutate,
                )
                _install_persisted_post_evaluation(
                    run,
                    resume,
                    evaluation=_post_evaluation(),
                )
                result = await apply_service.finalize_run_from_persisted_evaluation(
                    session=_finalize_session(run, resume, link),
                    user_id=USER_ID,
                    run_id=str(RUN_ID),
                    payload=_finalize_request(),
                )
                signed = json.loads(
                    resume.config["jdAnalysis"]["evaluationSignature"]
                )["resume"]

                self.assertEqual(result.status, ResumeOptimizationStatus.COMPLETED.value)
                self.assertEqual(signed["resume"]["personal_summary"], expected_summary)
                self.assertEqual(
                    "summary" in signed["resume"]["section_order"],
                    has_section,
                )

    async def test_skills_order_finalize_requires_frontend_target_order_contract(self) -> None:
        change = _change(
            "CHG_SKILLS",
            module_type="skills_order",
            field_path="selection.skillIds",
            before_value=["skill-a", "skill-b"],
            general_value=["skill-a", "skill-b"],
            targeted_value=["skill-b", "skill-a"],
        )
        run, resume, link = await _applied_fixture(
            changes=[change],
            accepted_ids=("CHG_SKILLS",),
        )
        _install_persisted_post_evaluation(run, resume, evaluation=_post_evaluation())

        result = await apply_service.finalize_run_from_persisted_evaluation(
            session=_finalize_session(run, resume, link),
            user_id=USER_ID,
            run_id=str(RUN_ID),
            payload=_finalize_request(),
        )
        signed = json.loads(
            resume.config["jdAnalysis"]["evaluationSignature"]
        )["resume"]

        self.assertEqual(result.status, ResumeOptimizationStatus.COMPLETED.value)
        self.assertEqual(
            [item["id"] for item in signed["resume"]["skills"]],
            ["skill-b", "skill-a"],
        )

    async def test_star_only_finalize_allows_missing_layout_config(self) -> None:
        run, resume, link = await _applied_fixture(
            config_mutator=lambda config: config.pop("layout"),
        )
        _install_persisted_post_evaluation(run, resume, evaluation=_post_evaluation())

        result = await apply_service.finalize_run_from_persisted_evaluation(
            session=_finalize_session(run, resume, link),
            user_id=USER_ID,
            run_id=str(RUN_ID),
            payload=_finalize_request(),
        )

        self.assertEqual(result.status, ResumeOptimizationStatus.COMPLETED.value)

    async def test_star_only_partial_layout_uses_summary_first_editor_order(self) -> None:
        run, resume, link = await _applied_fixture(
            config_mutator=lambda config: config["layout"].update(
                {"sectionOrder": ["work", "skills"]}
            ),
        )
        source_snapshot = apply_service._source_frontend_evaluation_snapshot(run)
        self.assertEqual(
            source_snapshot["resume"]["section_order"],
            ["summary", "work", "skills", "education", "project", "certifications"],
        )
        post_snapshot = _post_frontend_snapshot(run, resume)
        post_snapshot["resume"]["section_order"] = deepcopy(
            source_snapshot["resume"]["section_order"]
        )
        post_snapshot["fact_metadata"] = apply_service._rebuild_frontend_fact_metadata(
            post_snapshot
        )
        signature = _frontend_evaluation_signature(
            jd_input_signature=run.source_jd_signature,
            resume_snapshot=post_snapshot,
            jd_result=resume.config["jdAnalysis"]["result"],
            jd_available=True,
        )
        _install_persisted_post_evaluation(
            run,
            resume,
            evaluation=_post_evaluation(),
            signature=signature,
        )

        result = await apply_service.finalize_run_from_persisted_evaluation(
            session=_finalize_session(run, resume, link),
            user_id=USER_ID,
            run_id=str(RUN_ID),
            payload=_finalize_request(),
        )

        self.assertEqual(result.status, ResumeOptimizationStatus.COMPLETED.value)

    async def test_encoded_star_targets_match_reload_then_frontend_deep_entity_decoding(self) -> None:
        for targeted in (
            "&lt;b&gt;foo&lt;/b&gt;",
            "&amp;lt;b&amp;gt;foo&amp;lt;/b&amp;gt;",
        ):
            with self.subTest(targeted=targeted):
                change = _change(
                    "CHG_ENCODED",
                    targeted_value=targeted,
                    general_value=targeted,
                )
                run, resume, link = await _applied_fixture(
                    changes=[change],
                    accepted_ids=("CHG_ENCODED",),
                )
                post_snapshot = _post_frontend_snapshot(run, resume)
                post_snapshot["resume"]["experiences"][0]["star"]["a"] = "foo"
                post_snapshot["experience_atoms"][0]["star"]["a"] = "<b>foo</b>"
                post_snapshot["fact_metadata"] = (
                    apply_service._rebuild_frontend_fact_metadata(post_snapshot)
                )
                signature = _frontend_evaluation_signature(
                    jd_input_signature=run.source_jd_signature,
                    resume_snapshot=post_snapshot,
                    jd_result=resume.config["jdAnalysis"]["result"],
                    jd_available=True,
                )
                _install_persisted_post_evaluation(
                    run,
                    resume,
                    evaluation=_post_evaluation(),
                    signature=signature,
                )

                result = await apply_service.finalize_run_from_persisted_evaluation(
                    session=_finalize_session(run, resume, link),
                    user_id=USER_ID,
                    run_id=str(RUN_ID),
                    payload=_finalize_request(),
                )

                self.assertEqual(
                    result.status,
                    ResumeOptimizationStatus.COMPLETED.value,
                )

    async def test_comment_seamed_star_markdown_matches_reload_then_rescore(self) -> None:
        targeted = "**原<!--c-->情境**"
        change = _change(
            "CHG_COMMENT_SEAMED_STAR",
            field_path="star.s",
            before_value="原情境",
            general_value=targeted,
            targeted_value=targeted,
        )
        run, resume, link = await _applied_fixture(
            changes=[change],
            accepted_ids=("CHG_COMMENT_SEAMED_STAR",),
        )
        post_snapshot = _post_frontend_snapshot(run, resume)
        self.assertEqual(
            post_snapshot["resume"]["experiences"][0]["star"]["s"],
            "原情境",
        )
        # The editor reloads the applied raw value through normalizeStarValue
        # before building the candidate atom portion of the post snapshot.
        post_snapshot["experience_atoms"][0]["star"]["s"] = "**原情境**"
        post_snapshot["fact_metadata"] = (
            apply_service._rebuild_frontend_fact_metadata(post_snapshot)
        )
        self.assertEqual(
            post_snapshot["experience_atoms"][0]["star"]["s"],
            "**原情境**",
        )
        signature = _frontend_evaluation_signature(
            jd_input_signature=run.source_jd_signature,
            resume_snapshot=post_snapshot,
            jd_result=resume.config["jdAnalysis"]["result"],
            jd_available=True,
        )
        _install_persisted_post_evaluation(
            run,
            resume,
            evaluation=_post_evaluation(),
            signature=signature,
        )

        result = await apply_service.finalize_run_from_persisted_evaluation(
            session=_finalize_session(run, resume, link),
            user_id=USER_ID,
            run_id=str(RUN_ID),
            payload=_finalize_request(),
        )

        self.assertEqual(result.status, ResumeOptimizationStatus.COMPLETED.value)

    async def test_literal_markup_forgery_cannot_bypass_trusted_post_content_paths(self) -> None:
        cases = (
            (
                "summary",
                _change(
                    "CHG_SUMMARY_LITERAL_FORGERY",
                    module_type="personal_summary",
                    field_path="personalSummary",
                    before_value="原摘要",
                    general_value="真实摘要",
                    targeted_value="真实摘要",
                ),
                "CHG_SUMMARY_LITERAL_FORGERY",
            ),
            (
                "star",
                _change(
                    "CHG_STAR_LITERAL_FORGERY",
                    general_value="真实行动",
                    targeted_value="真实行动",
                ),
                "CHG_STAR_LITERAL_FORGERY",
            ),
        )
        for name, change, change_id in cases:
            with self.subTest(name=name):
                run, resume, link = await _applied_fixture(
                    changes=[change],
                    accepted_ids=(change_id,),
                )
                post = _post_frontend_snapshot(run, resume)
                if name == "summary":
                    trusted = post["resume"]["personal_summary"]
                    post["resume"]["personal_summary"] = f"<b>{trusted}</b>"
                else:
                    trusted = post["resume"]["experiences"][0]["star"]["a"]
                    post["resume"]["experiences"][0]["star"]["a"] = (
                        f"<b>{trusted}</b>"
                    )
                    post["experience_atoms"][0]["star"]["a"] = f"<b>{trusted}</b>"
                post["fact_metadata"] = apply_service._rebuild_frontend_fact_metadata(
                    post
                )
                forged_signature = _frontend_evaluation_signature(
                    jd_input_signature=run.source_jd_signature,
                    resume_snapshot=post,
                    jd_result=resume.config["jdAnalysis"]["result"],
                    jd_available=True,
                )
                _install_persisted_post_evaluation(
                    run,
                    resume,
                    evaluation=_post_evaluation(),
                    signature=forged_signature,
                )
                session = _finalize_session(run, resume, link)

                with self.assertRaises(apply_service.OptimizationFinalizePendingError):
                    await apply_service.finalize_run_from_persisted_evaluation(
                        session=session,
                        user_id=USER_ID,
                        run_id=str(RUN_ID),
                        payload=_finalize_request(),
                    )

                self.assertEqual(run.status, ResumeOptimizationStatus.APPLIED.value)
                self.assertEqual(session.commits, 1)

    async def test_block_star_targets_match_frontend_block_line_breaks(self) -> None:
        for targeted, expected in (
            ("<div>one</div><div>two</div>", "one\ntwo"),
            ("<p>one</p><p>two</p>", "one\ntwo"),
            ("one<br><br>two", "one\n\ntwo"),
            ("<div>one</div><br><div>two</div>", "one\n\ntwo"),
            ("<div>one</div><div><br></div><div>two</div>", "one\n\ntwo"),
            ("<b>one<br></b><br>two", "one\n\ntwo"),
            ("<ul><li>one<br></li><li>two</li></ul>", "one\n\ntwo"),
            ("<ul><li>one</li><li>two</li></ul>", "one\ntwo"),
            ("<div>one<div>two</div>three</div>", "onetwo\nthree"),
            ("one<br>", "one"),
            ("<div>one</div>", "one"),
            ("one\n\ntwo", "one\n\ntwo"),
            ("one\r\rtwo", "one\n\ntwo"),
            ("one\r\n\r\ntwo", "one\n\ntwo"),
        ):
            with self.subTest(targeted=targeted):
                change = _change(
                    "CHG_BLOCKS",
                    targeted_value=targeted,
                    general_value=targeted,
                )
                with (
                    patch.object(
                        apply_service,
                        "project_plan_with_current_safety",
                        side_effect=lambda _run, *, plan: plan,
                    ),
                    patch.object(
                        apply_service,
                        "preserves_rich_text_structure",
                        return_value=True,
                    ),
                ):
                    run, resume, link = await _applied_fixture(
                        changes=[change],
                        accepted_ids=("CHG_BLOCKS",),
                    )
                post_snapshot = _post_frontend_snapshot(run, resume)
                # Keep this literal independent from the backend plain-text helper:
                # the browser sanitizer deduplicates BRs per direct DOM parent.
                post_snapshot["resume"]["experiences"][0]["star"]["a"] = expected
                post_snapshot["experience_atoms"][0]["star"]["a"] = targeted
                post_snapshot["fact_metadata"] = (
                    apply_service._rebuild_frontend_fact_metadata(post_snapshot)
                )
                signature = _frontend_evaluation_signature(
                    jd_input_signature=run.source_jd_signature,
                    resume_snapshot=post_snapshot,
                    jd_result=resume.config["jdAnalysis"]["result"],
                    jd_available=True,
                )
                _install_persisted_post_evaluation(
                    run,
                    resume,
                    evaluation=_post_evaluation(),
                    signature=signature,
                )

                result = await apply_service.finalize_run_from_persisted_evaluation(
                    session=_finalize_session(run, resume, link),
                    user_id=USER_ID,
                    run_id=str(RUN_ID),
                    payload=_finalize_request(),
                )

                self.assertEqual(
                    result.status,
                    ResumeOptimizationStatus.COMPLETED.value,
                )

    async def test_completed_finalize_is_idempotent_only_for_same_timestamp(self) -> None:
        run, resume, link = await _applied_fixture()
        _install_persisted_post_evaluation(run, resume, evaluation=_post_evaluation())
        await apply_service.finalize_run_from_persisted_evaluation(
            session=_finalize_session(run, resume, link),
            user_id=USER_ID,
            run_id=str(RUN_ID),
            payload=_finalize_request(),
        )
        replay_session = _finalize_session(run, resume, link)

        replayed = await apply_service.finalize_run_from_persisted_evaluation(
            session=replay_session,
            user_id=USER_ID,
            run_id=str(RUN_ID),
            payload=_finalize_request(),
        )

        self.assertIs(replayed, run)
        self.assertEqual(replay_session.commits, 1)
        self.assertEqual(replay_session.flush_statuses, [])
        with self.assertRaises(apply_service.OptimizationContentConflictError):
            await apply_service.finalize_run_from_persisted_evaluation(
                session=_finalize_session(run, resume, link),
                user_id=USER_ID,
                run_id=str(RUN_ID),
                payload=_finalize_request(POST_SCORE_TIME + timedelta(seconds=1)),
            )

    async def test_unexpected_finalize_failure_rolls_back_without_leaving_rescoring(self) -> None:
        run, resume, link = await _applied_fixture()
        _install_persisted_post_evaluation(run, resume, evaluation=_post_evaluation())
        session = _finalize_session(run, resume, link)
        with patch.object(
            apply_service,
            "_validated_post_frontend_evaluation_context",
            side_effect=RuntimeError("PRIVATE_INTERNAL_FAILURE"),
        ):
            with self.assertRaisesRegex(RuntimeError, "PRIVATE_INTERNAL_FAILURE"):
                await apply_service.finalize_run_from_persisted_evaluation(
                    session=session,
                    user_id=USER_ID,
                    run_id=str(RUN_ID),
                    payload=_finalize_request(),
                )

        self.assertEqual(run.status, ResumeOptimizationStatus.APPLIED.value)
        self.assertEqual(run.post_evaluation_json, {})
        self.assertEqual(session.commits, 0)
        self.assertEqual(session.rollbacks, 1)

    async def test_finalize_rejects_content_drift_without_completing(self) -> None:
        run, resume, link = await _applied_fixture()
        _install_persisted_post_evaluation(run, resume, evaluation=_post_evaluation())
        link.overrides_json["star"]["a"] = "用户后续手动修改"
        session = _finalize_session(run, resume, link)

        with self.assertRaises(apply_service.OptimizationContentConflictError):
            await apply_service.finalize_run_from_persisted_evaluation(
                session=session,
                user_id=USER_ID,
                run_id=str(RUN_ID),
                payload=_finalize_request(),
            )

        self.assertEqual(run.status, ResumeOptimizationStatus.APPLIED.value)
        self.assertEqual(session.commits, 0)
        self.assertEqual(session.rollbacks, 1)

    async def test_current_selected_link_membership_handles_implicit_and_explicit_selection(self) -> None:
        extra = deepcopy(_link())
        extra.id = uuid.UUID("77777777-7777-7777-7777-777777777777")
        extra.experience_version_id = uuid.UUID(
            "88888888-8888-8888-8888-888888888888"
        )

        run, resume, link = await _applied_fixture(
            config_mutator=lambda config: config.pop("selection"),
        )
        _install_persisted_post_evaluation(run, resume, evaluation=_post_evaluation())
        implicit_session = _finalize_session(
            run,
            resume,
            link,
            query_links=[link, extra],
            tracked_links=[link, extra],
        )
        with self.assertRaises(apply_service.OptimizationContentConflictError):
            await apply_service.finalize_run_from_persisted_evaluation(
                session=implicit_session,
                user_id=USER_ID,
                run_id=str(RUN_ID),
                payload=_finalize_request(),
            )
        self.assertEqual(run.status, ResumeOptimizationStatus.APPLIED.value)
        self.assertEqual(implicit_session.commits, 0)

        run, resume, link = await _applied_fixture()
        _install_persisted_post_evaluation(run, resume, evaluation=_post_evaluation())
        explicit_session = _finalize_session(
            run,
            resume,
            link,
            query_links=[link],
            tracked_links=[link, extra],
        )
        result = await apply_service.finalize_run_from_persisted_evaluation(
            session=explicit_session,
            user_id=USER_ID,
            run_id=str(RUN_ID),
            payload=_finalize_request(),
        )

        self.assertEqual(result.status, ResumeOptimizationStatus.COMPLETED.value)
        selected_lock_sql = str(explicit_session.statements[2])
        self.assertIn("master_experiences.category", selected_lock_sql)

        run, resume, link = await _applied_fixture(
            config_mutator=lambda config: config.pop("selection"),
        )
        _install_persisted_post_evaluation(run, resume, evaluation=_post_evaluation())
        education_filtered_session = _finalize_session(
            run,
            resume,
            link,
            query_links=[link],
            tracked_links=[link, extra],
        )
        result = await apply_service.finalize_run_from_persisted_evaluation(
            session=education_filtered_session,
            user_id=USER_ID,
            run_id=str(RUN_ID),
            payload=_finalize_request(),
        )
        self.assertEqual(result.status, ResumeOptimizationStatus.COMPLETED.value)
        self.assertIn(
            "master_experiences.category",
            str(education_filtered_session.statements[2]),
        )

    async def test_completed_run_can_be_read_after_reload_with_final_result(self) -> None:
        run, resume, link = await _applied_fixture()
        _install_persisted_post_evaluation(run, resume, evaluation=_post_evaluation())
        session = _finalize_session(run, resume, link)
        await apply_service.finalize_run_from_persisted_evaluation(
            session=session,
            user_id=USER_ID,
            run_id=str(RUN_ID),
            payload=_finalize_request(),
        )

        public = router_module._run_to_read(run).model_dump(mode="json")

        self.assertEqual(public["status"], ResumeOptimizationStatus.COMPLETED.value)
        self.assertEqual(public["result"]["changes"][0]["change_id"], "CHG_A")
        self.assertEqual(public["post_evaluation"]["afterScore"], 89)
        self.assertEqual(public["source_before_score"], 65)
        self.assertEqual(public["plan"]["changes"][0]["change_id"], "CHG_A")
        for private_key in (
            "before_snapshot",
            "after_snapshot",
            "protected_content",
            "touched_config",
            "touched_links",
        ):
            self.assertNotIn(private_key, public)

    async def test_applied_reload_exposes_only_normalized_source_before_score(self) -> None:
        run, _, _ = await _applied_fixture()

        public = router_module._run_to_read(run).model_dump(mode="json")

        self.assertEqual(public["status"], ResumeOptimizationStatus.APPLIED.value)
        self.assertEqual(public["source_before_score"], 65)
        self.assertIsNone(public["post_evaluation"])
        self.assertNotIn("before_snapshot", public)

    async def test_reload_rejects_corrupt_post_evaluation_arithmetic(self) -> None:
        run, resume, link = await _applied_fixture()
        _install_persisted_post_evaluation(run, resume, evaluation=_post_evaluation())
        await apply_service.finalize_run_from_persisted_evaluation(
            session=_finalize_session(run, resume, link),
            user_id=USER_ID,
            run_id=str(RUN_ID),
            payload=_finalize_request(),
        )
        run.post_evaluation_json["issueCounts"]["resolved"] = 99

        with self.assertRaises(router_module.OptimizationPersistedRunInvalidError):
            router_module._run_to_read(run)


class ResumeOptimizationRevertTests(unittest.IsolatedAsyncioTestCase):
    async def test_applied_and_completed_runs_may_revert(self) -> None:
        for status in (
            ResumeOptimizationStatus.APPLIED,
            ResumeOptimizationStatus.COMPLETED,
        ):
            with self.subTest(status=status.value):
                run, resume, link = await _applied_fixture()
                run.status = status.value
                session = _finalize_session(run, resume, link)

                result = await apply_service.revert_resume_optimization(
                    session=session,
                    user_id=USER_ID,
                    run_id=str(RUN_ID),
                    payload=_revert_request(resume.updated_at),
                )

                self.assertEqual(result.run.status, ResumeOptimizationStatus.REVERTED.value)
                self.assertEqual(session.commits, 1)

    async def test_revert_restores_exact_touched_config_and_raw_overrides(self) -> None:
        changes = [
            _change("CHG_STAR"),
            _change(
                "CHG_SUMMARY",
                module_type="personal_summary",
                field_path="personalSummary",
                before_value="原摘要",
                general_value="通用摘要",
                targeted_value="定向摘要",
            ),
            _change(
                "CHG_SKILLS",
                module_type="skills_order",
                field_path="selection.skillIds",
                before_value=["skill-a", "skill-b"],
                general_value=["skill-a", "skill-b"],
                targeted_value=["skill-b", "skill-a"],
            ),
            _change(
                "CHG_SECTIONS",
                module_type="section_order",
                field_path="sectionOrder",
                before_value=["summary", "work", "skills"],
                general_value=["summary", "work", "skills"],
                targeted_value=["work", "summary", "skills"],
            ),
        ]
        accepted = tuple(change["change_id"] for change in changes)
        original_resume = _resume()
        original_config = deepcopy(original_resume.config)
        original_overrides = deepcopy(_link().overrides_json)
        original_overrides["star"]["r"] = "转化率提升 30%"
        run, resume, link = await _applied_fixture(
            changes=changes,
            accepted_ids=accepted,
        )
        current_analysis = deepcopy(resume.config["jdAnalysis"])
        session = _finalize_session(run, resume, link)

        result = await apply_service.revert_resume_optimization(
            session=session,
            user_id=USER_ID,
            run_id=str(RUN_ID),
            payload=_revert_request(resume.updated_at),
        )

        expected_config = deepcopy(original_config)
        expected_config["jdAnalysis"] = current_analysis
        expected_config["jdAnalysis"]["isOutdated"] = True
        expected_config["jdAnalysis"]["evaluationIsOutdated"] = True
        self.assertEqual(result.resume.config, expected_config)
        self.assertEqual(link.overrides_json, original_overrides)
        self.assertEqual(result.run.status, ResumeOptimizationStatus.REVERTED.value)

    async def test_revert_restores_top_level_selection_presence_exactly(self) -> None:
        for state in ("missing", "none"):
            with self.subTest(state=state):
                def mutate(config):
                    if state == "missing":
                        config.pop("selection")
                    else:
                        config["selection"] = None

                change = _change(
                    "CHG_SKILLS",
                    module_type="skills_order",
                    field_path="selection.skillIds",
                    before_value=["skill-a", "skill-b"],
                    general_value=["skill-a", "skill-b"],
                    targeted_value=["skill-b", "skill-a"],
                )
                run, resume, link = await _applied_fixture(
                    changes=[change],
                    accepted_ids=("CHG_SKILLS",),
                    config_mutator=mutate,
                )
                session = _finalize_session(run, resume, link)

                result = await apply_service.revert_resume_optimization(
                    session=session,
                    user_id=USER_ID,
                    run_id=str(RUN_ID),
                    payload=_revert_request(resume.updated_at),
                )

                if state == "missing":
                    self.assertNotIn("selection", result.resume.config)
                else:
                    self.assertIn("selection", result.resume.config)
                    self.assertIsNone(result.resume.config["selection"])

    async def test_revert_restores_nested_skill_ids_presence_and_parent_siblings(self) -> None:
        for state in ("missing", "none"):
            with self.subTest(state=state):
                def mutate(config):
                    config["selection"] = {
                        "experienceIds": [str(MASTER_ID)],
                        "keep": {"nested": True},
                    }
                    if state == "none":
                        config["selection"]["skillIds"] = None

                change = _change(
                    "CHG_SKILLS",
                    module_type="skills_order",
                    field_path="selection.skillIds",
                    before_value=["skill-a", "skill-b"],
                    general_value=["skill-a", "skill-b"],
                    targeted_value=["skill-b", "skill-a"],
                )
                run, resume, link = await _applied_fixture(
                    changes=[change],
                    accepted_ids=("CHG_SKILLS",),
                    config_mutator=mutate,
                )
                before_jd = deepcopy(resume.config["jdAnalysis"])
                result = await apply_service.revert_resume_optimization(
                    session=_finalize_session(run, resume, link),
                    user_id=USER_ID,
                    run_id=str(RUN_ID),
                    payload=_revert_request(resume.updated_at),
                )

                selection = result.resume.config["selection"]
                self.assertEqual(selection["keep"], {"nested": True})
                if state == "missing":
                    self.assertNotIn("skillIds", selection)
                else:
                    self.assertIsNone(selection["skillIds"])
                self.assertEqual(
                    result.resume.config["jdAnalysis"]["result"],
                    before_jd["result"],
                )

    async def test_revert_restores_missing_raw_star_and_preserves_override_extras(self) -> None:
        def remove_star(link):
            link.overrides_json.pop("star")
            link.overrides_json["privateExtra"] = {"keep": True}

        run, resume, link = await _applied_fixture(link_mutator=remove_star)
        self.assertIn("star", link.overrides_json)
        result = await apply_service.revert_resume_optimization(
            session=_finalize_session(run, resume, link),
            user_id=USER_ID,
            run_id=str(RUN_ID),
            payload=_revert_request(resume.updated_at),
        )

        self.assertNotIn("star", link.overrides_json)
        self.assertEqual(link.overrides_json["privateExtra"], {"keep": True})
        self.assertEqual(result.run.status, ResumeOptimizationStatus.REVERTED.value)

    async def test_revert_rejects_tampered_or_extra_journal_targets_fail_closed(self) -> None:
        mutators = (
            lambda journal: journal["touched_config"].update(
                {
                    "private.extra": {
                        "before": {"present": False, "value": None},
                        "after": {"present": True, "value": "PRIVATE"},
                    }
                }
            ),
            lambda journal: journal.update(
                {"applied_change_ids": ["CHG_A", "CHG_A"]}
            ),
            lambda journal: journal["touched_links"][str(LINK_ID)].update(
                {"source_version_id": "00000000-0000-0000-0000-000000000000"}
            ),
        )
        for mutate in mutators:
            with self.subTest(mutate=mutate):
                run, resume, link = await _applied_fixture()
                mutate(run.after_snapshot)
                before_config = deepcopy(resume.config)
                before_overrides = deepcopy(link.overrides_json)
                session = _finalize_session(run, resume, link)

                with self.assertRaises(apply_service.OptimizationRunDataInvalidError):
                    await apply_service.revert_resume_optimization(
                        session=session,
                        user_id=USER_ID,
                        run_id=str(RUN_ID),
                        payload=_revert_request(resume.updated_at),
                    )

                self.assertEqual(resume.config, before_config)
                self.assertEqual(link.overrides_json, before_overrides)
                self.assertEqual(session.commits, 0)

    async def test_revert_rejects_synchronized_before_journal_tampering(self) -> None:
        summary_change = _change(
            "CHG_SUMMARY",
            module_type="personal_summary",
            field_path="personalSummary",
            before_value="原摘要",
            general_value="定向摘要",
            targeted_value="定向摘要",
        )
        run, resume, link = await _applied_fixture(
            changes=[summary_change],
            accepted_ids=("CHG_SUMMARY",),
        )
        item = run.after_snapshot["touched_config"]["personalSummary"]
        item["before"] = {"present": True, "value": "PRIVATE_FAKE_BEFORE"}
        run.after_snapshot["before"]["touched_config"]["personalSummary"] = deepcopy(
            item["before"]
        )
        cases = [(run, resume, link)]

        run, resume, link = await _applied_fixture(
            changes=[summary_change],
            accepted_ids=("CHG_SUMMARY",),
        )
        collapsed = {"present": False, "value": None}
        run.after_snapshot["touched_config"]["personalSummary"]["before"] = deepcopy(
            collapsed
        )
        run.after_snapshot["before"]["touched_config"]["personalSummary"] = deepcopy(
            collapsed
        )
        cases.append((run, resume, link))

        skill_change = _change(
            "CHG_SKILLS",
            module_type="skills_order",
            field_path="selection.skillIds",
            before_value=["skill-a", "skill-b"],
            general_value=["skill-a", "skill-b"],
            targeted_value=["skill-b", "skill-a"],
        )
        run, resume, link = await _applied_fixture(
            changes=[skill_change],
            accepted_ids=("CHG_SKILLS",),
        )
        parent = run.after_snapshot["touched_config"]["selection"]["before"]
        parent["value"]["experienceIds"] = ["PRIVATE_OTHER_SELECTION"]
        run.after_snapshot["before"]["touched_config"]["selection"] = deepcopy(parent)
        cases.append((run, resume, link))

        run, resume, link = await _applied_fixture(
            changes=[skill_change],
            accepted_ids=("CHG_SKILLS",),
        )
        parent = run.after_snapshot["touched_config"]["selection"]["before"]
        parent["value"]["skillIds"] = ["skill-a", "PRIVATE_SKILL"]
        leaf = run.after_snapshot["touched_config"]["selection.skillIds"][
            "before"
        ]
        leaf["value"] = ["skill-a", "PRIVATE_SKILL"]
        run.after_snapshot["before"]["touched_config"]["selection"] = deepcopy(parent)
        run.after_snapshot["before"]["touched_config"][
            "selection.skillIds"
        ] = deepcopy(leaf)
        cases.append((run, resume, link))

        run, resume, link = await _applied_fixture()
        touched = run.after_snapshot["touched_links"][str(LINK_ID)]
        touched["before_overrides_json"]["star"]["a"] = "PRIVATE_FAKE_STAR"
        touched["before_star"]["value"]["a"] = "PRIVATE_FAKE_STAR"
        duplicate = run.after_snapshot["before"]["touched_links"][str(LINK_ID)]
        duplicate["overrides_json"] = deepcopy(touched["before_overrides_json"])
        duplicate["star"] = deepcopy(touched["before_star"])
        cases.append((run, resume, link))

        for run, resume, link in cases:
            with self.subTest(module=run.accepted_change_ids):
                before_config = deepcopy(resume.config)
                before_overrides = deepcopy(link.overrides_json)
                session = _finalize_session(run, resume, link)
                with self.assertRaises(apply_service.OptimizationRunDataInvalidError):
                    await apply_service.revert_resume_optimization(
                        session=session,
                        user_id=USER_ID,
                        run_id=str(RUN_ID),
                        payload=_revert_request(resume.updated_at),
                    )
                self.assertEqual(resume.config, before_config)
                self.assertEqual(link.overrides_json, before_overrides)
                self.assertEqual(session.commits, 0)

    async def test_manual_edit_causes_conflict_and_zero_overwrite(self) -> None:
        run, resume, link = await _applied_fixture()
        resume.config["personalSummary"] = "用户后续手动编辑"
        resume.updated_at = POST_SCORE_TIME
        before_config = deepcopy(resume.config)
        before_overrides = deepcopy(link.overrides_json)
        session = _finalize_session(run, resume, link)

        with self.assertRaises(apply_service.OptimizationContentConflictError):
            await apply_service.revert_resume_optimization(
                session=session,
                user_id=USER_ID,
                run_id=str(RUN_ID),
                payload=_revert_request(POST_SCORE_TIME),
            )

        self.assertEqual(resume.config, before_config)
        self.assertEqual(link.overrides_json, before_overrides)
        self.assertEqual(run.status, ResumeOptimizationStatus.APPLIED.value)
        self.assertEqual(session.commits, 0)
        self.assertEqual(session.rollbacks, 1)

    async def test_reverted_run_cannot_apply_again(self) -> None:
        run, resume, link = await _applied_fixture()
        revert_session = _finalize_session(run, resume, link)
        await apply_service.revert_resume_optimization(
            session=revert_session,
            user_id=USER_ID,
            run_id=str(RUN_ID),
            payload=_revert_request(resume.updated_at),
        )
        retry_session = _transaction_session(run, resume, link)

        with self.assertRaises(apply_service.OptimizationApplyConflictError):
            await apply_service.apply_resume_optimization(
                session=retry_session,
                user_id=USER_ID,
                run_id=str(RUN_ID),
                payload=_apply_request("CHG_A", expected=resume.updated_at),
            )

        self.assertEqual(run.status, ResumeOptimizationStatus.REVERTED.value)


class ResumeOptimizationFinalizeRouterTests(unittest.IsolatedAsyncioTestCase):
    def test_finalize_and_revert_requests_forbid_client_evaluation_payload(self) -> None:
        for request_type in (
            ResumeOptimizationFinalizeRequest,
            ResumeOptimizationRevertRequest,
        ):
            with self.subTest(request_type=request_type.__name__):
                with self.assertRaises(ValidationError):
                    request_type.model_validate(
                        {
                            "expected_resume_updated_at": BASE_TIME.isoformat(),
                            **(
                                {"claim_id": RESCORE_CLAIM_ID}
                                if request_type is ResumeOptimizationFinalizeRequest
                                else {}
                            ),
                            "evaluation": {"overallScore": 100},
                        }
                    )

    async def test_apply_finalize_and_revert_routes_never_bill(self) -> None:
        run, resume, link = await _applied_fixture()
        begin = AsyncMock()
        context = Mock()
        apply_result = SimpleNamespace(
            run=run,
            resume=resume,
            resume_updated_at=BASE_TIME.replace(tzinfo=None),
            applied_change_ids=["CHG_A"],
        )
        revert_result = SimpleNamespace(
            run=run,
            resume=resume,
            resume_updated_at=BASE_TIME.replace(tzinfo=None),
        )
        with (
            patch.object(router_module.billing_service, "begin_ai_request", begin),
            patch.object(router_module.billing_service, "ai_billing_context", context),
            patch.object(
                router_module,
                "apply_resume_optimization",
                AsyncMock(return_value=apply_result),
            ) as apply_call,
            patch.object(
                router_module,
                "finalize_run_from_persisted_evaluation",
                AsyncMock(return_value=run),
            ) as finalize_call,
            patch.object(
                router_module,
                "revert_resume_optimization",
                AsyncMock(return_value=revert_result),
            ) as revert_call,
        ):
            applied = await router_module.apply_resume_optimization_run(
                run_id=str(RUN_ID),
                payload=_apply_request("CHG_A"),
                session=SimpleNamespace(),
                current_user=SimpleNamespace(id=USER_ID),
            )
            finalized = await router_module.finalize_resume_optimization_run(
                run_id=str(RUN_ID),
                payload=_finalize_request(BASE_TIME),
                session=SimpleNamespace(),
                current_user=SimpleNamespace(id=USER_ID),
            )
            reverted = await router_module.revert_resume_optimization_run(
                run_id=str(RUN_ID),
                payload=_revert_request(BASE_TIME),
                session=SimpleNamespace(),
                current_user=SimpleNamespace(id=USER_ID),
            )

        self.assertEqual(applied.applied_change_ids, ["CHG_A"])
        self.assertEqual(finalized.run.id, str(RUN_ID))
        self.assertEqual(reverted.run.id, str(RUN_ID))
        apply_token = applied.model_dump(mode="json")["resume_updated_at"]
        revert_token = reverted.model_dump(mode="json")["resume_updated_at"]
        finalize_roundtrip = ResumeOptimizationFinalizeRequest.model_validate(
            {
                "expected_resume_updated_at": apply_token,
                "claim_id": RESCORE_CLAIM_ID,
            }
        )
        revert_roundtrip = ResumeOptimizationRevertRequest.model_validate(
            {"expected_resume_updated_at": revert_token}
        )
        self.assertIsNotNone(
            finalize_roundtrip.expected_resume_updated_at.utcoffset()
        )
        self.assertIsNotNone(revert_roundtrip.expected_resume_updated_at.utcoffset())
        apply_call.assert_awaited_once()
        finalize_call.assert_awaited_once()
        revert_call.assert_awaited_once()
        begin.assert_not_awaited()
        context.assert_not_called()

    async def test_finalize_and_revert_errors_map_to_stable_safe_http_details(self) -> None:
        cases = (
            (
                router_module.finalize_resume_optimization_run,
                _finalize_request(BASE_TIME),
                "finalize_run_from_persisted_evaluation",
                apply_service.OptimizationFinalizePendingError(),
                409,
                "resume_optimization_evaluation_pending",
            ),
            (
                router_module.revert_resume_optimization_run,
                _revert_request(BASE_TIME),
                "revert_resume_optimization",
                apply_service.OptimizationContentConflictError(),
                409,
                "resume_optimization_content_conflict",
            ),
        )
        for handler, payload, service_name, error, status, code in cases:
            with self.subTest(service_name=service_name):
                with patch.object(
                    router_module,
                    service_name,
                    AsyncMock(side_effect=error),
                    create=True,
                ):
                    with self.assertRaises(HTTPException) as raised:
                        await handler(
                            run_id=str(RUN_ID),
                            payload=payload,
                            session=SimpleNamespace(),
                            current_user=SimpleNamespace(id=USER_ID),
                        )

                self.assertEqual(raised.exception.status_code, status)
                self.assertEqual(raised.exception.detail["code"], code)
                self.assertNotIn("PRIVATE", json.dumps(raised.exception.detail))

    def test_router_declares_apply_finalize_and_revert_paths(self) -> None:
        paths = {route.path for route in router_module.router.routes}
        for path in (
            "/api/resume-optimizations/{run_id}/apply",
            "/api/resume-optimizations/{run_id}/finalize",
            "/api/resume-optimizations/{run_id}/revert",
        ):
            self.assertIn(path, paths)


if __name__ == "__main__":
    unittest.main()

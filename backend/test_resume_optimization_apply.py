from __future__ import annotations

import asyncio
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import json
import os
from types import SimpleNamespace
import unittest
import uuid

import asyncpg
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

def _set_required_env_defaults() -> None:
    os.environ["DATABASE_URL"] = (
        "postgresql+asyncpg://user:password@localhost:5432/resumeflow"
    )
    os.environ.setdefault("LOGTO_ISSUER", "https://example.logto.app/oidc")
    os.environ.setdefault("LOGTO_APP_ID", "resume-spa-app-id")


_set_required_env_defaults()

from app.domain.resume.models import Resume, ResumeExperienceLink  # noqa: E402
from app.domain.resume_optimization import apply_service  # noqa: E402
from app.domain.resume_optimization.models import ResumeOptimizationRun  # noqa: E402
from app.domain.resume_optimization.run_service import hash_canonical_json  # noqa: E402
from app.domain.resume_optimization.schemas import (  # noqa: E402
    OPTIMIZER_VERSION,
    POLICY_VERSION,
    PROMPT_VERSION,
    OptimizationPlan,
    ResumeOptimizationApplyRequest,
    ResumeOptimizationStatus,
)
from app.models import ExperienceCategory, ExperienceVersion, MasterExperience  # noqa: E402


USER_ID = "apply-user"
RESUME_ID = uuid.UUID("11111111-1111-1111-1111-111111111111")
RUN_ID = uuid.UUID("22222222-2222-2222-2222-222222222222")
MASTER_ID = uuid.UUID("33333333-3333-3333-3333-333333333333")
VERSION_ID = uuid.UUID("44444444-4444-4444-4444-444444444444")
NEW_VERSION_ID = uuid.UUID("55555555-5555-5555-5555-555555555555")
LINK_ID = uuid.UUID("66666666-6666-6666-6666-666666666666")
BASE_TIME = datetime(2026, 9, 1, 3, 0, tzinfo=timezone.utc)
NEXT_TIME = BASE_TIME + timedelta(minutes=5)


def _base_config() -> dict:
    return {
        "personalSummary": "原摘要",
        "selection": {
            "experienceIds": [str(MASTER_ID)],
            "educationIds": ["edu-1"],
            "certificationIds": ["cert-1"],
            "skillIds": ["skill-a", "skill-b"],
        },
        "layout": {
            "sectionOrder": ["summary", "work", "skills"],
            "theme": "slate",
        },
        "jdAnalysis": {
            "isOutdated": False,
            "evaluationIsOutdated": False,
            "evaluationSignature": "evaluation-signature",
            "jdInputSignature": "jd-signature",
            "result": {"resumeEvaluation": {"overallScore": 72}},
        },
        "unrelated": {"keep": True},
    }


def _change(
    change_id: str,
    *,
    module_type: str = "experience_star",
    module_id: str | None = None,
    field_path: str = "star.a",
    before_value="原行动",
    general_value="优化行动",
    targeted_value="优化行动",
    safety_status: str = "allowed",
) -> dict:
    resolved_module_id = module_id
    if resolved_module_id is None:
        resolved_module_id = (
            str(MASTER_ID)
            if module_type == "experience_star"
            else {
                "personal_summary": "current_resume",
                "skills_order": "skills",
                "section_order": "sections",
            }.get(module_type, "current_resume")
        )
    return {
        "change_id": change_id,
        "issue_ids": [f"ISSUE_{change_id}"],
        "dimension": "STAR应用",
        "module_type": module_type,
        "module_id": resolved_module_id,
        "field_path": field_path,
        "action_kind": "rewrite_now",
        "scope": "general",
        "before_value": deepcopy(before_value),
        "general_value": deepcopy(general_value),
        "targeted_value": deepcopy(targeted_value),
        "source_refs": ["/currentResume/personal_summary"],
        "introduced_terms": [],
        "rationale": "仅使用已确认事实",
        "expected_score_gain": 3,
        "default_selected": True,
        "safety_status": safety_status,
        "safety_findings": (["blocked"] if safety_status == "blocked" else []),
    }


def _run(
    changes: list[dict],
    *,
    status: ResumeOptimizationStatus = ResumeOptimizationStatus.PREVIEW_READY,
    include_frozen_link: bool = True,
) -> ResumeOptimizationRun:
    selected_links = (
        {
            str(MASTER_ID): {
                "resume_link_id": str(LINK_ID),
                "source_version_id": str(VERSION_ID),
            }
        }
        if include_frozen_link
        else {}
    )
    plan = OptimizationPlan.model_validate(
        {
            "changes": changes,
            "questions": [],
            "bank_suggestions": [],
            "safety_summary": {},
        }
    ).model_dump(mode="json")
    snapshot = {
        "resume_id": str(RESUME_ID),
        "resume_updated_at": BASE_TIME.isoformat(),
        "evaluation_signature": "evaluation-signature",
        "jd_signature": "jd-signature",
        "target_role": "产品经理",
        "evaluation": {"overallScore": 72, "issues": []},
        "current_resume": {
            "section_order": ["summary", "work", "skills"],
            "personal_summary": "原摘要",
            "skills": [
                {"id": "skill-a", "name": "A", "category": "技能"},
                {"id": "skill-b", "name": "B", "category": "技能"},
            ],
            "experiences": {
                str(MASTER_ID): {
                    "id": str(MASTER_ID),
                    "star": {
                        "s": "原情境",
                        "t": "原任务",
                        "a": "原行动",
                        "r": "原结果",
                    },
                }
            },
        },
        "selected_source_experiences": {
            str(MASTER_ID): {
                "id": str(MASTER_ID),
                "source_version_id": str(VERSION_ID),
            }
        },
        "selected_master_experience_ids": [str(MASTER_ID)],
        "selected_experience_links": selected_links,
        "bank_suggestion_candidates": [],
        "fact_metadata": [],
    }
    return ResumeOptimizationRun(
        id=RUN_ID,
        user_id=USER_ID,
        resume_id=RESUME_ID,
        status=status.value,
        optimizer_version=OPTIMIZER_VERSION,
        policy_version=POLICY_VERSION,
        prompt_version=PROMPT_VERSION,
        source_resume_updated_at=BASE_TIME,
        source_evaluation_signature="evaluation-signature",
        source_jd_signature="jd-signature",
        source_snapshot_hash=hash_canonical_json(snapshot),
        request_hash="request-hash",
        before_snapshot=snapshot,
        plan_json=deepcopy(plan),
        result_json=deepcopy(plan),
        answers_json={"answers": []},
        created_at=BASE_TIME,
        updated_at=BASE_TIME,
    )


def _resume(*, updated_at: datetime = BASE_TIME) -> Resume:
    return Resume(
        id=RESUME_ID,
        user_id=USER_ID,
        title="产品简历",
        target_role="产品经理",
        config=_base_config(),
        created_at=BASE_TIME,
        updated_at=updated_at,
    )


def _link(*, version_id: uuid.UUID = VERSION_ID) -> ResumeExperienceLink:
    return ResumeExperienceLink(
        id=LINK_ID,
        resume_id=RESUME_ID,
        experience_version_id=version_id,
        overrides_json={
            "summary": "保留摘要 override",
            "star": {
                "s": "原情境",
                "t": "原任务",
                "a": "原行动",
                "r": "原结果",
            },
            "tags": ["keep"],
        },
        display_order=0,
        created_at=BASE_TIME,
    )


def _request(*change_ids: str, expected: datetime = BASE_TIME):
    return ResumeOptimizationApplyRequest(
        accepted_change_ids=list(change_ids),
        expected_resume_updated_at=expected,
    )


class _ScalarResult:
    def __init__(self, values):
        self._values = list(values)

    def first(self):
        return self._values[0] if self._values else None

    def all(self):
        return list(self._values)


class _ExecuteResult:
    def __init__(self, values):
        self._values = values

    def scalars(self):
        return _ScalarResult(self._values)


class _FakeSession:
    def __init__(
        self,
        execute_values,
        *,
        run: ResumeOptimizationRun | None = None,
        resume: Resume | None = None,
        links: list[ResumeExperienceLink] | None = None,
        fail_on_flush: int | None = None,
    ) -> None:
        self._execute_values = [list(values) for values in execute_values]
        self.run = run
        self.resume = resume
        self.links = list(links or [])
        self.fail_on_flush = fail_on_flush
        self.statements = []
        self.added = []
        self.flushes = 0
        self.flush_statuses: list[str] = []
        self.commits = 0
        self.rollbacks = 0
        self.persisted = {
            "run_status": getattr(run, "status", None),
            "resume_config": deepcopy(getattr(resume, "config", None)),
            "link_overrides": {
                str(item.id): deepcopy(item.overrides_json) for item in self.links
            },
        }

    async def execute(self, statement):
        self.statements.append(statement)
        values = self._execute_values.pop(0) if self._execute_values else []
        return _ExecuteResult(values)

    def add(self, value) -> None:
        self.added.append(value)

    async def flush(self) -> None:
        self.flushes += 1
        if self.run is not None:
            self.flush_statuses.append(self.run.status)
        if self.fail_on_flush == self.flushes:
            raise RuntimeError("injected apply flush failure")

    async def commit(self) -> None:
        self.commits += 1
        if self.run is not None:
            self.persisted["run_status"] = self.run.status
        if self.resume is not None:
            self.persisted["resume_config"] = deepcopy(self.resume.config)
        self.persisted["link_overrides"] = {
            str(item.id): deepcopy(item.overrides_json) for item in self.links
        }

    async def rollback(self) -> None:
        self.rollbacks += 1


class _SessionContext:
    def __init__(self, session: _FakeSession) -> None:
        self.session = session
        self.exits = 0

    async def __aenter__(self):
        return self.session

    async def __aexit__(self, exc_type, exc, traceback):
        self.exits += 1
        return False


def _transaction_session(
    run: ResumeOptimizationRun,
    resume: Resume,
    link: ResumeExperienceLink | None = None,
    *,
    fail_on_flush: int | None = None,
) -> _FakeSession:
    values = [[run], [resume]]
    links = [] if link is None else [link]
    if link is not None:
        values.append([link])
    session = _FakeSession(
        values,
        run=run,
        resume=resume,
        links=links,
        fail_on_flush=fail_on_flush,
    )
    stale_session = _FakeSession([[run]], run=run)
    session.stale_session = stale_session
    session.stale_session_factory = lambda: _SessionContext(stale_session)
    return session


class ResumeOptimizationApplyPatchTests(unittest.TestCase):
    def test_accepted_experience_change_deep_merges_star_without_dropping_siblings(self) -> None:
        run = _run([_change("CHG_A")])
        current = {
            "summary": "保留摘要 override",
            "star": {"a": "原行动", "custom": "保留扩展字段"},
            "tags": ["keep"],
        }

        patch = apply_service.build_apply_patch(
            run=run,
            accepted_change_ids={"CHG_A"},
            current_resume_config=_base_config(),
            current_link_overrides={str(LINK_ID): current},
        )

        self.assertEqual(
            patch.experience_star_by_link_id[str(LINK_ID)],
            {
                "s": "原情境",
                "t": "原任务",
                "a": "优化行动",
                "r": "原结果",
                "custom": "保留扩展字段",
            },
        )
        self.assertEqual(current["summary"], "保留摘要 override")
        self.assertEqual(current["tags"], ["keep"])

    def test_unaccepted_changes_leave_values_untouched(self) -> None:
        run = _run(
            [
                _change("CHG_A", field_path="star.a", general_value="新行动"),
                _change(
                    "CHG_R",
                    field_path="star.r",
                    before_value="原结果",
                    general_value="新结果",
                    targeted_value="新结果",
                ),
            ]
        )

        patch = apply_service.build_apply_patch(
            run=run,
            accepted_change_ids={"CHG_A"},
            current_resume_config=_base_config(),
            current_link_overrides={str(LINK_ID): _link().overrides_json},
        )

        self.assertEqual(
            patch.experience_star_by_link_id[str(LINK_ID)]["a"], "优化行动"
        )
        self.assertEqual(
            patch.experience_star_by_link_id[str(LINK_ID)]["r"], "原结果"
        )
        self.assertEqual(patch.applied_change_ids, ["CHG_A"])

    def test_blocked_changes_cannot_be_accepted(self) -> None:
        run = _run([_change("CHG_BLOCKED", safety_status="blocked")])

        with self.assertRaises(apply_service.OptimizationApplyValidationError):
            apply_service.build_apply_patch(
                run=run,
                accepted_change_ids={"CHG_BLOCKED"},
                current_resume_config=_base_config(),
                current_link_overrides={str(LINK_ID): _link().overrides_json},
            )

    def test_summary_change_writes_personal_summary(self) -> None:
        run = _run(
            [
                _change(
                    "CHG_SUMMARY",
                    module_type="personal_summary",
                    field_path="personalSummary",
                    before_value="原摘要",
                    general_value="通用摘要",
                    targeted_value="新摘要",
                )
            ]
        )

        patch = apply_service.build_apply_patch(
            run=run,
            accepted_change_ids={"CHG_SUMMARY"},
            current_resume_config=_base_config(),
            current_link_overrides={},
        )

        self.assertEqual(patch.next_resume_config["personalSummary"], "新摘要")
        self.assertEqual(patch.next_resume_config["unrelated"], {"keep": True})

    def test_skill_order_only_reorders_existing_selected_skill_ids(self) -> None:
        run = _run(
            [
                _change(
                    "CHG_SKILLS",
                    module_type="skills_order",
                    field_path="selection.skillIds",
                    before_value=["skill-a", "skill-b"],
                    general_value=["skill-a", "skill-b"],
                    targeted_value=["skill-b", "skill-a"],
                )
            ]
        )
        patch = apply_service.build_apply_patch(
            run=run,
            accepted_change_ids={"CHG_SKILLS"},
            current_resume_config=_base_config(),
            current_link_overrides={},
        )
        self.assertEqual(
            patch.next_resume_config["selection"]["skillIds"],
            ["skill-b", "skill-a"],
        )

        changed_selection = _run(
            [
                _change(
                    "CHG_ADD_SKILL",
                    module_type="skills_order",
                    field_path="skillsOrder",
                    before_value=["skill-a", "skill-new"],
                    general_value=["skill-new", "skill-a"],
                    targeted_value=["skill-new", "skill-a"],
                )
            ]
        )
        with self.assertRaises(apply_service.OptimizationApplyValidationError):
            apply_service.build_apply_patch(
                run=changed_selection,
                accepted_change_ids={"CHG_ADD_SKILL"},
                current_resume_config=_base_config(),
                current_link_overrides={},
            )

    def test_skill_order_accepts_config_order_different_from_frozen_visible_order(self) -> None:
        run = _run(
            [
                _change(
                    "CHG_SKILLS",
                    module_type="skills_order",
                    field_path="selection.skillIds",
                    before_value=["skill-a", "skill-b"],
                    general_value=["skill-b", "skill-a"],
                    targeted_value=["skill-a", "skill-b"],
                )
            ]
        )
        config = _base_config()
        config["selection"]["skillIds"] = ["skill-b", "skill-a"]

        patch = apply_service.build_apply_patch(
            run=run,
            accepted_change_ids={"CHG_SKILLS"},
            current_resume_config=config,
            current_link_overrides={},
        )

        self.assertEqual(
            patch.next_resume_config["selection"]["skillIds"],
            ["skill-a", "skill-b"],
        )

        changed_membership = _base_config()
        changed_membership["selection"]["skillIds"] = ["skill-a", "skill-new"]
        with self.assertRaises(apply_service.OptimizationApplyValidationError):
            apply_service.build_apply_patch(
                run=run,
                accepted_change_ids={"CHG_SKILLS"},
                current_resume_config=changed_membership,
                current_link_overrides={},
            )

    def test_skill_order_materializes_missing_or_none_implicit_selection(self) -> None:
        run = _run(
            [
                _change(
                    "CHG_SKILLS",
                    module_type="skills_order",
                    field_path="selection.skillIds",
                    before_value=["skill-a", "skill-b"],
                    general_value=["skill-a", "skill-b"],
                    targeted_value=["skill-b", "skill-a"],
                )
            ]
        )
        for selection_state in ("missing", "none"):
            with self.subTest(selection_state=selection_state):
                config = _base_config()
                if selection_state == "missing":
                    config.pop("selection")
                else:
                    config["selection"] = None

                patch = apply_service.build_apply_patch(
                    run=run,
                    accepted_change_ids={"CHG_SKILLS"},
                    current_resume_config=config,
                    current_link_overrides={},
                )

                self.assertEqual(
                    patch.next_resume_config["selection"],
                    {"skillIds": ["skill-b", "skill-a"]},
                )
                self.assertEqual(
                    patch.next_resume_config["unrelated"],
                    {"keep": True},
                )

    def test_skill_order_materializes_missing_or_none_nested_skill_ids(self) -> None:
        run = _run(
            [
                _change(
                    "CHG_SKILLS",
                    module_type="skills_order",
                    field_path="selection.skillIds",
                    before_value=["skill-a", "skill-b"],
                    general_value=["skill-a", "skill-b"],
                    targeted_value=["skill-b", "skill-a"],
                )
            ]
        )
        for nested_state in ("missing", "none"):
            with self.subTest(nested_state=nested_state):
                config = _base_config()
                config["selection"] = {
                    "experienceIds": [str(MASTER_ID)],
                    "educationIds": ["edu-1"],
                    "customSibling": {"keep": True},
                }
                if nested_state == "none":
                    config["selection"]["skillIds"] = None

                patch = apply_service.build_apply_patch(
                    run=run,
                    accepted_change_ids={"CHG_SKILLS"},
                    current_resume_config=config,
                    current_link_overrides={},
                )

                self.assertEqual(
                    patch.next_resume_config["selection"]["skillIds"],
                    ["skill-b", "skill-a"],
                )
                self.assertEqual(
                    patch.next_resume_config["selection"]["customSibling"],
                    {"keep": True},
                )

        invalid = _base_config()
        invalid["selection"]["skillIds"] = "all"
        with self.assertRaises(apply_service.OptimizationApplyValidationError):
            apply_service.build_apply_patch(
                run=run,
                accepted_change_ids={"CHG_SKILLS"},
                current_resume_config=invalid,
                current_link_overrides={},
            )

    def test_section_order_only_reorders_existing_section_ids(self) -> None:
        run = _run(
            [
                _change(
                    "CHG_SECTIONS",
                    module_type="section_order",
                    field_path="sectionOrder",
                    before_value=["summary", "work", "skills"],
                    general_value=["summary", "work", "skills"],
                    targeted_value=["work", "summary", "skills"],
                )
            ]
        )
        patch = apply_service.build_apply_patch(
            run=run,
            accepted_change_ids={"CHG_SECTIONS"},
            current_resume_config=_base_config(),
            current_link_overrides={},
        )
        self.assertEqual(
            patch.next_resume_config["layout"]["sectionOrder"],
            ["work", "summary", "skills"],
        )

    def test_selected_ids_are_unchanged(self) -> None:
        config = _base_config()
        run = _run(
            [
                _change(
                    "CHG_SUMMARY",
                    module_type="personal_summary",
                    field_path="personal_summary",
                    before_value="原摘要",
                    general_value="新摘要",
                    targeted_value="新摘要",
                )
            ]
        )
        patch = apply_service.build_apply_patch(
            run=run,
            accepted_change_ids={"CHG_SUMMARY"},
            current_resume_config=config,
            current_link_overrides={},
        )
        self.assertEqual(patch.next_resume_config["selection"], config["selection"])

    def test_non_skill_changes_preserve_missing_or_none_selection_exactly(self) -> None:
        changes = (
            (
                _change("CHG_STAR"),
                {str(LINK_ID): _link().overrides_json},
            ),
            (
                _change(
                    "CHG_SUMMARY",
                    module_type="personal_summary",
                    field_path="personalSummary",
                    before_value="原摘要",
                    general_value="通用摘要",
                    targeted_value="定向摘要",
                ),
                {},
            ),
            (
                _change(
                    "CHG_SECTIONS",
                    module_type="section_order",
                    field_path="sectionOrder",
                    before_value=["summary", "work", "skills"],
                    general_value=["summary", "work", "skills"],
                    targeted_value=["work", "summary", "skills"],
                ),
                {},
            ),
        )
        for selection_state in ("missing", "none"):
            for change, overrides in changes:
                with self.subTest(
                    selection_state=selection_state,
                    module_type=change["module_type"],
                ):
                    config = _base_config()
                    if selection_state == "missing":
                        config.pop("selection")
                    else:
                        config["selection"] = None

                    patch = apply_service.build_apply_patch(
                        run=_run([change]),
                        accepted_change_ids={change["change_id"]},
                        current_resume_config=config,
                        current_link_overrides=overrides,
                    )

                    self.assertEqual(
                        "selection" in patch.next_resume_config,
                        "selection" in config,
                    )
                    if "selection" in config:
                        self.assertIsNone(patch.next_resume_config["selection"])

    def test_unknown_conflicting_selection_and_arbitrary_paths_fail_closed(self) -> None:
        base = _run([_change("CHG_A")])
        with self.assertRaises(apply_service.OptimizationApplyValidationError):
            apply_service.build_apply_patch(
                run=base,
                accepted_change_ids={"UNKNOWN"},
                current_resume_config=_base_config(),
                current_link_overrides={str(LINK_ID): _link().overrides_json},
            )

        conflict = _run([_change("CHG_A"), _change("CHG_B")])
        with self.assertRaises(apply_service.OptimizationApplyValidationError):
            apply_service.build_apply_patch(
                run=conflict,
                accepted_change_ids={"CHG_A", "CHG_B"},
                current_resume_config=_base_config(),
                current_link_overrides={str(LINK_ID): _link().overrides_json},
            )

        arbitrary = _run(
            [
                _change(
                    "CHG_SELECTION",
                    module_type="personal_summary",
                    field_path="selection.experienceIds",
                    general_value=["other-master"],
                    targeted_value=["other-master"],
                )
            ]
        )
        with self.assertRaises(apply_service.OptimizationApplyValidationError):
            apply_service.build_apply_patch(
                run=arbitrary,
                accepted_change_ids={"CHG_SELECTION"},
                current_resume_config=_base_config(),
                current_link_overrides={},
            )

    def test_selected_master_without_existing_frozen_link_fails_closed(self) -> None:
        run = _run([_change("CHG_A")], include_frozen_link=False)
        with self.assertRaises(apply_service.OptimizationApplyValidationError):
            apply_service.build_apply_patch(
                run=run,
                accepted_change_ids={"CHG_A"},
                current_resume_config=_base_config(),
                current_link_overrides={},
            )

    def test_final_safe_result_and_targeted_value_are_authoritative(self) -> None:
        run = _run(
            [
                _change(
                    "CHG_A",
                    general_value="通用稿内容",
                    targeted_value="当前简历定向内容",
                )
            ]
        )
        unsafe_model_plan = deepcopy(run.plan_json)
        unsafe_model_plan["changes"][0]["targeted_value"] = "不得应用的模型原稿"
        unsafe_model_plan["changes"][0]["safety_status"] = "blocked"
        run.plan_json = unsafe_model_plan

        patch = apply_service.build_apply_patch(
            run=run,
            accepted_change_ids={"CHG_A"},
            current_resume_config=_base_config(),
            current_link_overrides={str(LINK_ID): _link().overrides_json},
        )

        self.assertEqual(
            patch.experience_star_by_link_id[str(LINK_ID)]["a"],
            "当前简历定向内容",
        )

    def test_pending_and_read_only_sentinel_cannot_be_accepted(self) -> None:
        pending = _run([_change("CHG_PENDING", safety_status="pending")])
        sentinel = _run(
            [
                {
                    **_change(
                        "CHG_SENTINEL",
                        module_type="personal_summary",
                        field_path="unsupported",
                        before_value=None,
                        general_value=None,
                        targeted_value=None,
                        safety_status="allowed",
                    ),
                    "action_kind": "leave_unchanged",
                    "source_refs": [],
                    "expected_score_gain": 0,
                    "default_selected": False,
                }
            ]
        )
        for run, change_id in (
            (pending, "CHG_PENDING"),
            (sentinel, "CHG_SENTINEL"),
        ):
            with self.subTest(change_id=change_id):
                with self.assertRaises(
                    apply_service.OptimizationApplyValidationError
                ):
                    apply_service.build_apply_patch(
                        run=run,
                        accepted_change_ids={change_id},
                        current_resume_config=_base_config(),
                        current_link_overrides={str(LINK_ID): _link().overrides_json},
                    )

    def test_allowed_answer_backed_ask_user_change_is_applicable(self) -> None:
        change = _change(
            "CHG_ANSWERED",
            before_value="原行动",
            general_value="已有事实支持的通用表达",
            targeted_value="已有事实支持的定向表达",
            safety_status="allowed",
        )
        change["action_kind"] = "ask_user"
        run = _run([change])

        patch = apply_service.build_apply_patch(
            run=run,
            accepted_change_ids={"CHG_ANSWERED"},
            current_resume_config=_base_config(),
            current_link_overrides={str(LINK_ID): _link().overrides_json},
        )

        self.assertEqual(
            patch.experience_star_by_link_id[str(LINK_ID)]["a"],
            "已有事实支持的定向表达",
        )

    def test_path_aliases_share_one_conflict_target(self) -> None:
        run = _run(
            [
                _change(
                    "CHG_SUMMARY_1",
                    module_type="personal_summary",
                    field_path="personal_summary",
                    general_value="摘要一",
                    targeted_value="摘要一",
                ),
                _change(
                    "CHG_SUMMARY_2",
                    module_type="personal_summary",
                    field_path="personalSummary",
                    general_value="摘要二",
                    targeted_value="摘要二",
                ),
            ]
        )
        with self.assertRaises(apply_service.OptimizationApplyValidationError):
            apply_service.build_apply_patch(
                run=run,
                accepted_change_ids={"CHG_SUMMARY_1", "CHG_SUMMARY_2"},
                current_resume_config=_base_config(),
                current_link_overrides={},
            )

    def test_empty_or_corrupt_final_result_never_falls_back_to_model_plan(self) -> None:
        for result_json in (
            {},
            {"changes": [], "questions": [], "bank_suggestions": []},
            {
                "changes": [_change("CHG_A"), _change("CHG_A")],
                "questions": [],
                "bank_suggestions": [],
                "safety_summary": {},
            },
        ):
            with self.subTest(result_json=result_json):
                run = _run([_change("CHG_A")])
                run.result_json = result_json
                with self.assertRaises(
                    apply_service.OptimizationApplyValidationError
                ):
                    apply_service.build_apply_patch(
                        run=run,
                        accepted_change_ids={"CHG_A"},
                        current_resume_config=_base_config(),
                        current_link_overrides={str(LINK_ID): _link().overrides_json},
                    )


class ResumeOptimizationApplyTransactionTests(unittest.IsolatedAsyncioTestCase):
    async def _apply(
        self,
        run: ResumeOptimizationRun,
        resume: Resume,
        link: ResumeExperienceLink | None,
        *,
        request: ResumeOptimizationApplyRequest | None = None,
        fail_on_flush: int | None = None,
    ):
        session = _transaction_session(
            run,
            resume,
            link,
            fail_on_flush=fail_on_flush,
        )
        result = await apply_service.apply_resume_optimization(
            session=session,
            user_id=USER_ID,
            run_id=str(RUN_ID),
            payload=request or _request("CHG_A"),
        )
        return result, session

    async def test_master_experience_and_version_rows_are_unchanged(self) -> None:
        run = _run([_change("CHG_A")])
        resume = _resume()
        link = _link()
        master = MasterExperience(
            id=MASTER_ID,
            user_id=USER_ID,
            category=ExperienceCategory.WORK,
            latest_version_id=VERSION_ID,
            created_at=BASE_TIME,
            updated_at=BASE_TIME,
        )
        version = ExperienceVersion(
            id=VERSION_ID,
            master_experience_id=MASTER_ID,
            version=1,
            title="产品实习",
            star={"s": "事实源", "a": "原行动"},
            created_at=BASE_TIME,
        )
        master_before = master.model_dump()
        version_before = version.model_dump()
        original_version_id = link.experience_version_id

        _result, session = await self._apply(run, resume, link)

        self.assertEqual(master.model_dump(), master_before)
        self.assertEqual(version.model_dump(), version_before)
        self.assertEqual(link.experience_version_id, original_version_id)
        self.assertFalse(
            any(isinstance(item, (MasterExperience, ExperienceVersion)) for item in session.added)
        )

    async def test_stale_expected_resume_timestamp_raises_conflict(self) -> None:
        run = _run([_change("CHG_A")])
        resume = _resume(updated_at=NEXT_TIME)
        link = _link()
        session = _transaction_session(run, resume, link)
        before_config = deepcopy(resume.config)

        with self.assertRaises(apply_service.OptimizationApplyStaleError):
            await apply_service.apply_resume_optimization(
                session=session,
                user_id=USER_ID,
                run_id=str(RUN_ID),
                payload=_request("CHG_A", expected=BASE_TIME),
            )

        self.assertEqual(run.status, ResumeOptimizationStatus.STALE.value)
        self.assertEqual(resume.config, before_config)
        self.assertEqual(session.commits, 0)
        self.assertEqual(session.rollbacks, 1)
        self.assertEqual(session.stale_session.commits, 1)

    async def test_changed_source_experience_version_marks_run_stale(self) -> None:
        run = _run([_change("CHG_A")])
        resume = _resume()
        link = _link(version_id=NEW_VERSION_ID)
        session = _transaction_session(run, resume, link)
        original_overrides = deepcopy(link.overrides_json)

        with self.assertRaises(apply_service.OptimizationApplyStaleError):
            await apply_service.apply_resume_optimization(
                session=session,
                user_id=USER_ID,
                run_id=str(RUN_ID),
                payload=_request("CHG_A"),
            )

        self.assertEqual(run.status, ResumeOptimizationStatus.STALE.value)
        self.assertEqual(link.overrides_json, original_overrides)
        self.assertEqual(session.commits, 0)
        self.assertEqual(session.rollbacks, 1)
        self.assertEqual(session.stale_session.commits, 1)

    async def test_new_request_timestamp_cannot_authorize_an_old_run(self) -> None:
        run = _run([_change("CHG_A")])
        resume = _resume(updated_at=NEXT_TIME)
        link = _link()
        session = _transaction_session(run, resume, link)

        with self.assertRaises(apply_service.OptimizationApplyStaleError):
            await apply_service.apply_resume_optimization(
                session=session,
                user_id=USER_ID,
                run_id=str(RUN_ID),
                payload=_request("CHG_A", expected=NEXT_TIME),
            )

        self.assertEqual(run.status, ResumeOptimizationStatus.STALE.value)
        self.assertEqual(session.commits, 0)
        self.assertEqual(session.rollbacks, 1)
        self.assertEqual(session.stale_session.commits, 1)

    async def test_naive_expected_timestamp_is_rejected_before_lock_or_mutation(self) -> None:
        run = _run([_change("CHG_A")])
        resume = _resume()
        link = _link()
        session = _transaction_session(run, resume, link)

        with self.assertRaises(apply_service.OptimizationApplyValidationError):
            await apply_service.apply_resume_optimization(
                session=session,
                user_id=USER_ID,
                run_id=str(RUN_ID),
                payload=_request(
                    "CHG_A",
                    expected=BASE_TIME.replace(tzinfo=None),
                ),
            )

        self.assertEqual(session.statements, [])
        self.assertEqual(run.status, ResumeOptimizationStatus.PREVIEW_READY.value)
        self.assertEqual(session.commits, 0)

    async def test_analysis_and_evaluation_are_marked_outdated(self) -> None:
        result, _session = await self._apply(
            _run([_change("CHG_A")]),
            _resume(),
            _link(),
        )
        analysis = result.resume.config["jdAnalysis"]
        self.assertTrue(analysis["isOutdated"])
        self.assertTrue(analysis["evaluationIsOutdated"])

    async def test_missing_or_stale_current_report_marks_run_stale(self) -> None:
        for mutation in ("missing", "evaluation_stale", "signature_changed"):
            with self.subTest(mutation=mutation):
                run = _run([_change("CHG_A")])
                resume = _resume()
                if mutation == "missing":
                    resume.config.pop("jdAnalysis")
                elif mutation == "evaluation_stale":
                    resume.config["jdAnalysis"]["evaluationIsOutdated"] = True
                else:
                    resume.config["jdAnalysis"]["evaluationSignature"] = "new-signature"
                link = _link()
                session = _transaction_session(run, resume, link)

                with self.assertRaises(apply_service.OptimizationApplyStaleError):
                    await apply_service.apply_resume_optimization(
                        session=session,
                        user_id=USER_ID,
                        run_id=str(RUN_ID),
                        payload=_request("CHG_A"),
                    )

                self.assertEqual(run.status, ResumeOptimizationStatus.STALE.value)
                self.assertEqual(session.stale_session.commits, 1)

    async def test_fresh_evaluation_can_apply_while_jd_analysis_is_outdated(self) -> None:
        run = _run([_change("CHG_A")])
        resume = _resume()
        resume.config["jdAnalysis"]["isOutdated"] = True

        result, session = await self._apply(run, resume, _link())

        self.assertEqual(result.run.status, ResumeOptimizationStatus.APPLIED.value)
        self.assertEqual(session.commits, 1)

    async def test_run_transitions_preview_ready_to_applying_to_applied(self) -> None:
        result, session = await self._apply(
            _run([_change("CHG_A")]),
            _resume(),
            _link(),
        )
        self.assertEqual(
            session.flush_statuses,
            [
                ResumeOptimizationStatus.APPLYING.value,
                ResumeOptimizationStatus.APPLIED.value,
            ],
        )
        self.assertEqual(result.run.status, ResumeOptimizationStatus.APPLIED.value)
        self.assertEqual(session.commits, 1)

    async def test_resume_timestamp_mapping_matches_timestamptz_contract(self) -> None:
        self.assertTrue(Resume.__table__.c.updated_at.type.timezone)
        result, _session = await self._apply(
            _run([_change("CHG_A")]),
            _resume(updated_at=BASE_TIME),
            _link(),
        )

        self.assertIsNotNone(result.resume.updated_at.utcoffset())
        self.assertIsNotNone(result.run.updated_at.utcoffset())

    async def test_after_snapshot_and_applied_content_signature_are_recorded(self) -> None:
        result, _session = await self._apply(
            _run([_change("CHG_A")]),
            _resume(),
            _link(),
        )
        self.assertEqual(result.run.accepted_change_ids, ["CHG_A"])
        self.assertEqual(result.applied_change_ids, ["CHG_A"])
        self.assertTrue(result.run.after_snapshot["before"])
        self.assertTrue(result.run.after_snapshot["after"])
        self.assertEqual(
            result.run.applied_content_signature,
            hash_canonical_json(result.run.after_snapshot["after"]),
        )
        self.assertEqual(result.resume_updated_at, result.resume.updated_at)
        protected = result.run.after_snapshot["protected_content"]
        self.assertNotIn("jdAnalysis", protected["resume_config"])
        self.assertEqual(
            protected["resume_config"]["selection"]["skillIds"],
            ["skill-a", "skill-b"],
        )

    async def test_skill_order_journal_preserves_parent_and_leaf_presence(self) -> None:
        run_changes = [
            _change(
                "CHG_SKILLS",
                module_type="skills_order",
                field_path="selection.skillIds",
                before_value=["skill-a", "skill-b"],
                general_value=["skill-a", "skill-b"],
                targeted_value=["skill-b", "skill-a"],
            )
        ]
        cases = (
            ("top_missing", False, None, False, None),
            ("top_none", True, None, False, None),
            (
                "nested_missing",
                True,
                {"customSibling": {"keep": True}},
                False,
                None,
            ),
            (
                "nested_none",
                True,
                {"customSibling": {"keep": True}, "skillIds": None},
                True,
                None,
            ),
        )
        for name, parent_present, parent_value, leaf_present, leaf_value in cases:
            with self.subTest(name=name):
                run = _run(run_changes)
                resume = _resume()
                if not parent_present:
                    resume.config.pop("selection")
                else:
                    resume.config["selection"] = deepcopy(parent_value)
                link = _link()

                result, _session = await self._apply(
                    run,
                    resume,
                    link,
                    request=_request("CHG_SKILLS"),
                )

                journal = result.run.after_snapshot["touched_config"]
                self.assertEqual(
                    journal["selection"]["before"],
                    {"present": parent_present, "value": parent_value},
                )
                self.assertEqual(
                    journal["selection.skillIds"]["before"],
                    {"present": leaf_present, "value": leaf_value},
                )
                self.assertEqual(
                    journal["selection"]["after"],
                    {
                        "present": True,
                        "value": {
                            **(parent_value if isinstance(parent_value, dict) else {}),
                            "skillIds": ["skill-b", "skill-a"],
                        },
                    },
                )
                self.assertEqual(
                    journal["selection.skillIds"]["after"],
                    {"present": True, "value": ["skill-b", "skill-a"]},
                )

    async def test_tampered_frozen_snapshot_is_stale_before_content_mutation(self) -> None:
        run = _run([_change("CHG_A")])
        run.before_snapshot["target_role"] = "篡改后的岗位"
        resume = _resume()
        link = _link()
        session = _transaction_session(run, resume, link)
        before = deepcopy(link.overrides_json)

        with self.assertRaises(apply_service.OptimizationApplyStaleError):
            await apply_service.apply_resume_optimization(
                session=session,
                user_id=USER_ID,
                run_id=str(RUN_ID),
                payload=_request("CHG_A"),
            )

        self.assertEqual(link.overrides_json, before)
        self.assertEqual(run.status, ResumeOptimizationStatus.STALE.value)

    async def test_malformed_frozen_timestamp_persists_stale_after_rollback(self) -> None:
        run = _run([_change("CHG_A")])
        run.before_snapshot["resume_updated_at"] = "not-a-timestamp"
        run.source_snapshot_hash = hash_canonical_json(run.before_snapshot)
        resume = _resume()
        link = _link()
        session = _transaction_session(run, resume, link)

        with self.assertRaises(apply_service.OptimizationApplyStaleError):
            await apply_service.apply_resume_optimization(
                session=session,
                user_id=USER_ID,
                run_id=str(RUN_ID),
                payload=_request("CHG_A"),
            )

        self.assertEqual(session.rollbacks, 1)
        self.assertEqual(session.stale_session.commits, 1)
        self.assertEqual(run.status, ResumeOptimizationStatus.STALE.value)

    async def test_exception_rolls_back_resume_link_and_run_together(self) -> None:
        for fail_on_flush in (1, 2):
            with self.subTest(fail_on_flush=fail_on_flush):
                run = _run([_change("CHG_A")])
                resume = _resume()
                link = _link()
                session = _transaction_session(
                    run,
                    resume,
                    link,
                    fail_on_flush=fail_on_flush,
                )
                persisted_before = deepcopy(session.persisted)

                with self.assertRaisesRegex(
                    RuntimeError, "injected apply flush failure"
                ):
                    await apply_service.apply_resume_optimization(
                        session=session,
                        user_id=USER_ID,
                        run_id=str(RUN_ID),
                        payload=_request("CHG_A"),
                    )

                self.assertEqual(session.commits, 0)
                self.assertEqual(session.rollbacks, 1)
                self.assertEqual(session.persisted, persisted_before)

    async def test_second_apply_is_rejected_without_mutation(self) -> None:
        run = _run(
            [_change("CHG_A")],
            status=ResumeOptimizationStatus.APPLIED,
        )
        resume = _resume()
        link = _link()
        session = _transaction_session(run, resume, link)
        before_config = deepcopy(resume.config)

        with self.assertRaises(apply_service.OptimizationApplyConflictError):
            await apply_service.apply_resume_optimization(
                session=session,
                user_id=USER_ID,
                run_id=str(RUN_ID),
                payload=_request("CHG_A"),
            )

        self.assertEqual(run.status, ResumeOptimizationStatus.APPLIED.value)
        self.assertEqual(resume.config, before_config)
        self.assertEqual(session.commits, 0)
        self.assertEqual(session.rollbacks, 1)

    async def test_lock_order_is_run_then_resume_then_affected_links(self) -> None:
        _result, session = await self._apply(
            _run([_change("CHG_A")]),
            _resume(),
            _link(),
        )
        self.assertEqual(len(session.statements), 3)
        sql = [str(statement).lower() for statement in session.statements]
        self.assertIn("resume_optimization_runs", sql[0])
        self.assertIn("resumes", sql[1])
        self.assertIn("resume_experiences", sql[2])
        self.assertTrue(all(getattr(statement, "_for_update_arg", None) is not None for statement in session.statements))
        self.assertIn("resume_optimization_runs.user_id", sql[0])
        self.assertIn("resumes.user_id", sql[1])
        self.assertIn("resume_experiences.resume_id", sql[2])
        self.assertIn("master_experiences.user_id", sql[2])
        self.assertTrue(
            all(
                statement.get_execution_options().get("populate_existing") is True
                for statement in session.statements
            )
        )
        self.assertTrue(getattr(session.statements[2], "_order_by_clauses", ()))


@unittest.skipUnless(
    os.environ.get("RUN_RESUME_OPTIMIZATION_POSTGRES_TESTS") == "1"
    and os.environ.get("RESUME_OPTIMIZATION_TEST_DATABASE_URL"),
    "requires RUN_RESUME_OPTIMIZATION_POSTGRES_TESTS=1 and an isolated "
    "RESUME_OPTIMIZATION_TEST_DATABASE_URL",
)
class ResumeOptimizationApplyPostgresTests(unittest.IsolatedAsyncioTestCase):
    @staticmethod
    def _async_url(value: str) -> str:
        if value.startswith("postgresql+asyncpg://"):
            return value
        if value.startswith("postgresql://"):
            return value.replace("postgresql://", "postgresql+asyncpg://", 1)
        if value.startswith("postgres://"):
            return value.replace("postgres://", "postgresql+asyncpg://", 1)
        raise AssertionError(
            "RESUME_OPTIMIZATION_TEST_DATABASE_URL must use PostgreSQL"
        )

    @classmethod
    def _asyncpg_url(cls, value: str) -> str:
        return cls._async_url(value).replace(
            "postgresql+asyncpg://", "postgresql://", 1
        )

    async def asyncSetUp(self) -> None:
        self.database_url = self._async_url(
            os.environ["RESUME_OPTIMIZATION_TEST_DATABASE_URL"]
        )
        self.schema_name = f"rf_resume_optimization_{uuid.uuid4().hex}"
        connection = await asyncpg.connect(self._asyncpg_url(self.database_url))
        try:
            await connection.execute(f'CREATE SCHEMA "{self.schema_name}"')
            await connection.execute(
                f'''
                CREATE TABLE "{self.schema_name}".users (
                    id TEXT PRIMARY KEY
                );
                CREATE TABLE "{self.schema_name}".resumes (
                    id UUID PRIMARY KEY,
                    user_id TEXT NOT NULL REFERENCES "{self.schema_name}".users(id),
                    title TEXT NOT NULL,
                    target_role TEXT,
                    config JSONB NOT NULL DEFAULT '{{}}'::jsonb,
                    created_at TIMESTAMP NOT NULL,
                    updated_at TIMESTAMP NOT NULL
                );
                CREATE TABLE "{self.schema_name}".master_experiences (
                    id UUID PRIMARY KEY,
                    user_id TEXT NOT NULL REFERENCES "{self.schema_name}".users(id),
                    category TEXT NOT NULL,
                    latest_version_id UUID,
                    is_archived BOOLEAN NOT NULL DEFAULT false,
                    created_at TIMESTAMP NOT NULL,
                    updated_at TIMESTAMP NOT NULL
                );
                CREATE TABLE "{self.schema_name}".experience_versions (
                    id UUID PRIMARY KEY,
                    master_experience_id UUID NOT NULL
                        REFERENCES "{self.schema_name}".master_experiences(id),
                    version INTEGER NOT NULL,
                    title TEXT NOT NULL,
                    org TEXT,
                    location TEXT,
                    start_date DATE,
                    end_date DATE,
                    is_current BOOLEAN NOT NULL DEFAULT false,
                    summary TEXT,
                    highlights TEXT[] NOT NULL DEFAULT '{{}}',
                    tags TEXT[] NOT NULL DEFAULT '{{}}',
                    star JSONB NOT NULL DEFAULT '{{}}'::jsonb,
                    created_at TIMESTAMP NOT NULL
                );
                CREATE TABLE "{self.schema_name}".resume_experiences (
                    id UUID PRIMARY KEY,
                    resume_id UUID NOT NULL REFERENCES "{self.schema_name}".resumes(id),
                    experience_version_id UUID NOT NULL
                        REFERENCES "{self.schema_name}".experience_versions(id),
                    overrides_json JSONB NOT NULL DEFAULT '{{}}'::jsonb,
                    display_order INTEGER NOT NULL DEFAULT 0,
                    created_at TIMESTAMP NOT NULL
                );
                CREATE TABLE "{self.schema_name}".resume_optimization_runs (
                    id UUID PRIMARY KEY,
                    user_id TEXT NOT NULL REFERENCES "{self.schema_name}".users(id),
                    resume_id UUID NOT NULL REFERENCES "{self.schema_name}".resumes(id),
                    status TEXT NOT NULL,
                    optimizer_version TEXT NOT NULL,
                    policy_version TEXT NOT NULL,
                    prompt_version TEXT NOT NULL,
                    source_resume_updated_at TIMESTAMPTZ NOT NULL,
                    source_evaluation_signature TEXT NOT NULL,
                    source_jd_signature TEXT NOT NULL DEFAULT '',
                    source_snapshot_hash TEXT NOT NULL,
                    idempotency_key_hash TEXT,
                    request_hash TEXT NOT NULL,
                    before_snapshot JSONB NOT NULL DEFAULT '{{}}'::jsonb,
                    plan_json JSONB NOT NULL DEFAULT '{{}}'::jsonb,
                    answers_json JSONB NOT NULL DEFAULT '{{}}'::jsonb,
                    result_json JSONB NOT NULL DEFAULT '{{}}'::jsonb,
                    after_snapshot JSONB NOT NULL DEFAULT '{{}}'::jsonb,
                    post_evaluation_json JSONB NOT NULL DEFAULT '{{}}'::jsonb,
                    error_json JSONB NOT NULL DEFAULT '{{}}'::jsonb,
                    accepted_change_ids TEXT[] NOT NULL DEFAULT '{{}}',
                    applied_content_signature TEXT,
                    created_at TIMESTAMPTZ NOT NULL,
                    updated_at TIMESTAMPTZ NOT NULL,
                    applied_at TIMESTAMPTZ,
                    completed_at TIMESTAMPTZ
                );
                INSERT INTO "{self.schema_name}".users (id) VALUES ('{USER_ID}');
                '''
            )
        finally:
            await connection.close()

        self.engine = create_async_engine(
            self.database_url,
            connect_args={
                "statement_cache_size": 0,
                "server_settings": {"search_path": self.schema_name},
            },
            pool_size=3,
            max_overflow=0,
            pool_timeout=3,
        )
        self.sessions = async_sessionmaker(self.engine, expire_on_commit=False)
        await self._seed()

    async def asyncTearDown(self) -> None:
        await self.engine.dispose()
        connection = await asyncpg.connect(self._asyncpg_url(self.database_url))
        try:
            await connection.execute(
                f'DROP SCHEMA IF EXISTS "{self.schema_name}" CASCADE'
            )
        finally:
            await connection.close()

    async def _seed(self) -> None:
        run = _run([_change("CHG_A")])
        resume = _resume(updated_at=BASE_TIME.replace(tzinfo=None))
        link = _link()
        naive_time = BASE_TIME.replace(tzinfo=None)
        async with self.sessions() as session:
            await session.execute(
                text(
                    """
                    INSERT INTO resumes
                        (id, user_id, title, target_role, config, created_at, updated_at)
                    VALUES
                        (:id, :user_id, :title, :target_role,
                         CAST(:config AS jsonb), :created_at, :updated_at)
                    """
                ),
                {
                    "id": RESUME_ID,
                    "user_id": USER_ID,
                    "title": resume.title,
                    "target_role": resume.target_role,
                    "config": json.dumps(resume.config, ensure_ascii=False),
                    "created_at": naive_time,
                    "updated_at": naive_time,
                },
            )
            await session.execute(
                text(
                    """
                    INSERT INTO master_experiences
                        (id, user_id, category, latest_version_id, is_archived,
                         created_at, updated_at)
                    VALUES
                        (:id, :user_id, 'work', :latest_version_id, false,
                         :created_at, :updated_at)
                    """
                ),
                {
                    "id": MASTER_ID,
                    "user_id": USER_ID,
                    "latest_version_id": VERSION_ID,
                    "created_at": naive_time,
                    "updated_at": naive_time,
                },
            )
            for version_id, version_number, star in (
                (VERSION_ID, 1, {"s": "事实源", "a": "原行动"}),
                (NEW_VERSION_ID, 2, {"s": "新事实源", "a": "新行动"}),
            ):
                await session.execute(
                    text(
                        """
                        INSERT INTO experience_versions
                            (id, master_experience_id, version, title, star, created_at)
                        VALUES
                            (:id, :master_id, :version, '产品实习',
                             CAST(:star AS jsonb), :created_at)
                        """
                    ),
                    {
                        "id": version_id,
                        "master_id": MASTER_ID,
                        "version": version_number,
                        "star": json.dumps(star, ensure_ascii=False),
                        "created_at": naive_time,
                    },
                )
            await session.execute(
                text(
                    """
                    INSERT INTO resume_experiences
                        (id, resume_id, experience_version_id, overrides_json,
                         display_order, created_at)
                    VALUES
                        (:id, :resume_id, :version_id,
                         CAST(:overrides AS jsonb), 0, :created_at)
                    """
                ),
                {
                    "id": LINK_ID,
                    "resume_id": RESUME_ID,
                    "version_id": VERSION_ID,
                    "overrides": json.dumps(link.overrides_json, ensure_ascii=False),
                    "created_at": naive_time,
                },
            )
            await session.execute(
                text(
                    """
                    INSERT INTO resume_optimization_runs
                        (id, user_id, resume_id, status, optimizer_version,
                         policy_version, prompt_version, source_resume_updated_at,
                         source_evaluation_signature, source_jd_signature,
                         source_snapshot_hash, idempotency_key_hash, request_hash,
                         before_snapshot, plan_json, answers_json, result_json,
                         after_snapshot, post_evaluation_json, error_json,
                         accepted_change_ids, applied_content_signature,
                         created_at, updated_at, applied_at, completed_at)
                    VALUES
                        (:id, :user_id, :resume_id, :status, :optimizer_version,
                         :policy_version, :prompt_version, :source_updated_at,
                         :evaluation_signature, :jd_signature,
                         :snapshot_hash, NULL, :request_hash,
                         CAST(:before_snapshot AS jsonb), CAST(:plan AS jsonb),
                         CAST(:answers AS jsonb), CAST(:result AS jsonb),
                         '{}'::jsonb, '{}'::jsonb, '{}'::jsonb,
                         CAST(:accepted AS text[]), NULL,
                         :created_at, :updated_at, NULL, NULL)
                    """
                ),
                {
                    "id": RUN_ID,
                    "user_id": USER_ID,
                    "resume_id": RESUME_ID,
                    "status": run.status,
                    "optimizer_version": run.optimizer_version,
                    "policy_version": run.policy_version,
                    "prompt_version": run.prompt_version,
                    "source_updated_at": BASE_TIME,
                    "evaluation_signature": run.source_evaluation_signature,
                    "jd_signature": run.source_jd_signature,
                    "snapshot_hash": run.source_snapshot_hash,
                    "request_hash": run.request_hash,
                    "before_snapshot": json.dumps(
                        run.before_snapshot, ensure_ascii=False
                    ),
                    "plan": json.dumps(run.plan_json, ensure_ascii=False),
                    "answers": json.dumps(run.answers_json, ensure_ascii=False),
                    "result": json.dumps(run.result_json, ensure_ascii=False),
                    "accepted": [],
                    "created_at": BASE_TIME,
                    "updated_at": BASE_TIME,
                },
            )
            await session.commit()

    async def _row(self, query: str):
        async with self.sessions() as session:
            result = await session.execute(text(query))
            return result.mappings().one()

    async def test_isolated_postgres_apply_preserves_fact_rows(self) -> None:
        before_master = await self._row(
            "SELECT * FROM master_experiences WHERE id = "
            f"'{MASTER_ID}'::uuid"
        )
        before_version = await self._row(
            "SELECT * FROM experience_versions WHERE id = "
            f"'{VERSION_ID}'::uuid"
        )
        async with self.sessions() as session:
            await apply_service.apply_resume_optimization(
                session=session,
                user_id=USER_ID,
                run_id=str(RUN_ID),
                payload=_request("CHG_A"),
                stale_session_factory=self.sessions,
            )

        stored_run = await self._row(
            f"SELECT * FROM resume_optimization_runs WHERE id = '{RUN_ID}'::uuid"
        )
        stored_resume = await self._row(
            f"SELECT * FROM resumes WHERE id = '{RESUME_ID}'::uuid"
        )
        stored_link = await self._row(
            f"SELECT * FROM resume_experiences WHERE id = '{LINK_ID}'::uuid"
        )
        after_master = await self._row(
            f"SELECT * FROM master_experiences WHERE id = '{MASTER_ID}'::uuid"
        )
        after_version = await self._row(
            f"SELECT * FROM experience_versions WHERE id = '{VERSION_ID}'::uuid"
        )

        self.assertEqual(stored_run["status"], "applied")
        self.assertEqual(stored_run["accepted_change_ids"], ["CHG_A"])
        self.assertTrue(stored_resume["config"]["jdAnalysis"]["isOutdated"])
        self.assertEqual(stored_link["overrides_json"]["star"]["a"], "优化行动")
        self.assertEqual(
            stored_link["overrides_json"]["summary"], "保留摘要 override"
        )
        self.assertEqual(dict(after_master), dict(before_master))
        self.assertEqual(dict(after_version), dict(before_version))

    async def test_isolated_postgres_version_drift_persists_stale(self) -> None:
        async with self.sessions() as session:
            await session.execute(
                text(
                    "UPDATE resume_experiences SET experience_version_id = :version_id "
                    "WHERE id = :link_id"
                ),
                {"version_id": NEW_VERSION_ID, "link_id": LINK_ID},
            )
            await session.commit()

        async with self.sessions() as session:
            with self.assertRaises(apply_service.OptimizationApplyStaleError):
                await apply_service.apply_resume_optimization(
                    session=session,
                    user_id=USER_ID,
                    run_id=str(RUN_ID),
                    payload=_request("CHG_A"),
                    stale_session_factory=self.sessions,
                )

        stored_run = await self._row(
            f"SELECT status, error_json FROM resume_optimization_runs "
            f"WHERE id = '{RUN_ID}'::uuid"
        )
        stored_link = await self._row(
            f"SELECT experience_version_id, overrides_json FROM resume_experiences "
            f"WHERE id = '{LINK_ID}'::uuid"
        )
        self.assertEqual(stored_run["status"], "stale")
        self.assertEqual(
            stored_run["error_json"]["code"],
            "resume_optimization_context_stale",
        )
        self.assertEqual(stored_link["experience_version_id"], NEW_VERSION_ID)
        self.assertEqual(stored_link["overrides_json"], _link().overrides_json)

    async def test_isolated_postgres_mid_apply_failure_rolls_back_all_rows(self) -> None:
        async with self.sessions() as session:
            await session.execute(
                text(
                    """
                    CREATE FUNCTION reject_applied_run() RETURNS trigger AS $$
                    BEGIN
                        IF NEW.status = 'applied' THEN
                            RAISE EXCEPTION 'injected final apply failure';
                        END IF;
                        RETURN NEW;
                    END;
                    $$ LANGUAGE plpgsql;
                    """
                )
            )
            await session.execute(
                text(
                    """
                    CREATE TRIGGER reject_applied_run_trigger
                    BEFORE UPDATE ON resume_optimization_runs
                    FOR EACH ROW EXECUTE FUNCTION reject_applied_run();
                    """
                )
            )
            await session.commit()

        with self.assertRaises(DBAPIError) as raised:
            async with self.sessions() as session:
                await apply_service.apply_resume_optimization(
                    session=session,
                    user_id=USER_ID,
                    run_id=str(RUN_ID),
                    payload=_request("CHG_A"),
                    stale_session_factory=self.sessions,
                )
        self.assertIn("injected final apply failure", str(raised.exception))

        stored_run = await self._row(
            f"SELECT status, after_snapshot FROM resume_optimization_runs "
            f"WHERE id = '{RUN_ID}'::uuid"
        )
        stored_resume = await self._row(
            f"SELECT config FROM resumes WHERE id = '{RESUME_ID}'::uuid"
        )
        stored_link = await self._row(
            f"SELECT overrides_json FROM resume_experiences "
            f"WHERE id = '{LINK_ID}'::uuid"
        )
        self.assertEqual(stored_run["status"], "preview_ready")
        self.assertEqual(stored_run["after_snapshot"], {})
        self.assertFalse(stored_resume["config"]["jdAnalysis"]["isOutdated"])
        self.assertEqual(stored_link["overrides_json"], _link().overrides_json)

    async def test_isolated_postgres_concurrent_apply_has_one_winner(self) -> None:
        async def attempt():
            async with self.sessions() as session:
                return await apply_service.apply_resume_optimization(
                    session=session,
                    user_id=USER_ID,
                    run_id=str(RUN_ID),
                    payload=_request("CHG_A"),
                    stale_session_factory=self.sessions,
                )

        outcomes = await asyncio.gather(attempt(), attempt(), return_exceptions=True)
        successes = [
            outcome
            for outcome in outcomes
            if isinstance(outcome, apply_service.OptimizationApplyResult)
        ]
        conflicts = [
            outcome
            for outcome in outcomes
            if isinstance(outcome, apply_service.OptimizationApplyConflictError)
        ]
        self.assertEqual(len(successes), 1)
        self.assertEqual(len(conflicts), 1)
        stored_run = await self._row(
            f"SELECT status, accepted_change_ids FROM resume_optimization_runs "
            f"WHERE id = '{RUN_ID}'::uuid"
        )
        self.assertEqual(stored_run["status"], "applied")
        self.assertEqual(stored_run["accepted_change_ids"], ["CHG_A"])


if __name__ == "__main__":
    unittest.main()

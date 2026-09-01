from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timedelta, timezone
import hashlib
import json
import math
import os
import unittest
import uuid
from unittest.mock import patch

from sqlalchemy.exc import IntegrityError


def _set_required_env_defaults() -> None:
    os.environ["DATABASE_URL"] = (
        "postgresql+asyncpg://user:password@localhost:5432/resumeflow"
    )
    os.environ.setdefault("LOGTO_ISSUER", "https://example.logto.app/oidc")
    os.environ.setdefault("LOGTO_APP_ID", "resume-spa-app-id")


_set_required_env_defaults()

from app.domain.resume_optimization import run_service  # noqa: E402
from app.domain.resume_optimization.models import ResumeOptimizationRun  # noqa: E402
from app.domain.resume_optimization.schemas import (  # noqa: E402
    OPTIMIZER_VERSION,
    POLICY_VERSION,
    PROMPT_VERSION,
    ResumeOptimizationStartRequest,
    ResumeOptimizationStatus,
)
from app.domain.resume_optimization.state_machine import (  # noqa: E402
    InvalidOptimizationTransitionError,
)


USER_A = "user-a"
USER_B = "user-b"
RESUME_A = uuid.UUID("11111111-1111-1111-1111-111111111111")
RESUME_B = uuid.UUID("22222222-2222-2222-2222-222222222222")
BASE_TIME = datetime(2026, 9, 1, 2, 0, tzinfo=timezone.utc)


class _FakeScalarResult:
    def __init__(self, values):
        self._values = list(values)

    def first(self):
        return self._values[0] if self._values else None

    def all(self):
        return list(self._values)


class _FakeExecuteResult:
    def __init__(self, values):
        self._values = values

    def scalars(self):
        return _FakeScalarResult(self._values)


class _FakeNestedTransaction:
    def __init__(self, session):
        self._session = session

    async def __aenter__(self):
        self._session.nested_entries += 1
        return self

    async def __aexit__(self, exc_type, exc, traceback):
        if exc_type is not None:
            self._session.savepoint_rollbacks += 1
        return False


class _FakeAsyncSession:
    def __init__(self, execute_values=(), *, fail_flush_once: bool = False):
        self._execute_values = [list(values) for values in execute_values]
        self.fail_flush_once = fail_flush_once
        self.statements = []
        self.added = []
        self.flushes = 0
        self.commits = 0
        self.rollbacks = 0
        self.nested_entries = 0
        self.savepoint_rollbacks = 0

    async def execute(self, statement):
        self.statements.append(statement)
        values = self._execute_values.pop(0) if self._execute_values else []
        return _FakeExecuteResult(values)

    def add(self, value):
        self.added.append(value)

    async def flush(self):
        self.flushes += 1
        if self.fail_flush_once:
            self.fail_flush_once = False
            raise IntegrityError(
                "insert resume_optimization_runs",
                {},
                Exception("duplicate key"),
            )

    def begin_nested(self):
        return _FakeNestedTransaction(self)

    async def commit(self):
        self.commits += 1

    async def rollback(self):
        self.rollbacks += 1


def _start_request(*, resume_id: uuid.UUID = RESUME_A):
    return ResumeOptimizationStartRequest.model_validate(
        {
            "resume_id": str(resume_id),
            "evaluation_signature": "evaluation-signature",
            "expected_resume_updated_at": BASE_TIME.isoformat(),
            "include_bank_suggestions": True,
        }
    )


def _run(
    *,
    user_id: str = USER_A,
    resume_id: uuid.UUID = RESUME_A,
    status: ResumeOptimizationStatus = ResumeOptimizationStatus.PLANNING,
    request_hash: str | None = None,
    idempotency_key_hash: str | None = None,
    created_at: datetime = BASE_TIME,
) -> ResumeOptimizationRun:
    payload = _start_request(resume_id=resume_id)
    return ResumeOptimizationRun(
        id=uuid.uuid4(),
        user_id=user_id,
        resume_id=resume_id,
        status=status.value,
        optimizer_version=OPTIMIZER_VERSION,
        policy_version=POLICY_VERSION,
        prompt_version=PROMPT_VERSION,
        source_resume_updated_at=payload.expected_resume_updated_at,
        source_evaluation_signature=payload.evaluation_signature,
        source_jd_signature="jd-signature",
        source_snapshot_hash="snapshot-hash",
        idempotency_key_hash=idempotency_key_hash,
        request_hash=request_hash or run_service.build_start_request_hash(payload),
        before_snapshot={"resume": {"title": "Original"}},
        plan_json={"changes": [{"changeId": "CHG_1"}]},
        answers_json={"answers": []},
        result_json={"summary": {"safe": True}},
        after_snapshot={},
        post_evaluation_json={},
        error_json={},
        accepted_change_ids=[],
        created_at=created_at,
        updated_at=created_at,
    )


def _sql(statement) -> str:
    return str(statement).lower()


def _assert_owner_filtered(testcase: unittest.TestCase, statement) -> None:
    sql = _sql(statement)
    testcase.assertIn("resume_optimization_runs.user_id", sql)


def _assert_for_update(testcase: unittest.TestCase, statement) -> None:
    testcase.assertIsNotNone(getattr(statement, "_for_update_arg", None))


class ResumeOptimizationCanonicalHashTests(unittest.TestCase):
    def test_canonical_json_is_sorted_compact_and_preserves_utf8(self) -> None:
        value = {"z": "简历", "items": [3, 2], "a": {"β": 1}}

        encoded = run_service.canonical_json(value)

        self.assertEqual(
            encoded,
            '{"a":{"β":1},"items":[3,2],"z":"简历"}',
        )
        self.assertNotIn("\\u", encoded)

    def test_hash_canonical_json_uses_sha256_over_utf8(self) -> None:
        value = {"message": "六维", "value": 1}
        canonical = json.dumps(
            value,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        )

        self.assertEqual(
            run_service.hash_canonical_json(value),
            hashlib.sha256(canonical.encode("utf-8")).hexdigest(),
        )

    def test_canonical_json_rejects_all_non_finite_numbers(self) -> None:
        for value in (math.nan, math.inf, -math.inf):
            with self.subTest(value=value):
                with self.assertRaises(ValueError):
                    run_service.canonical_json({"value": value})

    def test_idempotency_hash_is_bound_to_user_and_raw_key(self) -> None:
        raw_key = "f28dc957-cbbb-4a77-84d2-83e5c084f70e"
        expected = run_service.hash_canonical_json(
            {"raw_key": raw_key, "user_id": USER_A}
        )

        self.assertEqual(
            run_service.build_idempotency_key_hash(USER_A, raw_key),
            expected,
        )
        self.assertNotEqual(
            run_service.build_idempotency_key_hash(USER_A, raw_key),
            run_service.build_idempotency_key_hash(USER_B, raw_key),
        )

    def test_start_request_hash_canonicalizes_pydantic_json_payload(self) -> None:
        payload = _start_request()

        self.assertEqual(
            run_service.build_start_request_hash(payload),
            run_service.hash_canonical_json(payload.model_dump(mode="json")),
        )


class ResumeOptimizationCreateOrLoadTests(unittest.IsolatedAsyncioTestCase):
    async def test_creates_user_owned_run_without_committing_caller_transaction(self) -> None:
        before_snapshot = {"resume": {"title": "Original"}}
        session = _FakeAsyncSession([[]])
        payload = _start_request()

        result = await run_service.create_or_load_run(
            session=session,
            user_id=USER_A,
            payload=payload,
            idempotency_key="key-1",
            source_snapshot_hash="snapshot-hash",
            source_jd_signature="jd-signature",
            before_snapshot=before_snapshot,
        )

        self.assertEqual(result.user_id, USER_A)
        self.assertEqual(result.resume_id, RESUME_A)
        self.assertEqual(result.status, ResumeOptimizationStatus.PLANNING.value)
        self.assertEqual(result.before_snapshot, before_snapshot)
        self.assertEqual(len(session.added), 1)
        stored = session.added[0]
        self.assertIsNot(result, stored)
        self.assertEqual(stored.user_id, USER_A)
        self.assertEqual(session.flushes, 1)
        self.assertEqual(session.commits, 0)
        self.assertEqual(session.rollbacks, 0)
        _assert_owner_filtered(self, session.statements[0])

        before_snapshot["resume"]["title"] = "Input mutated"
        result.before_snapshot["resume"]["title"] = "Output mutated"
        self.assertEqual(stored.before_snapshot["resume"]["title"], "Original")

    async def test_same_user_key_and_request_hash_returns_existing_run(self) -> None:
        payload = _start_request()
        key_hash = run_service.build_idempotency_key_hash(USER_A, "key-1")
        existing = _run(
            request_hash=run_service.build_start_request_hash(payload),
            idempotency_key_hash=key_hash,
        )
        session = _FakeAsyncSession([[existing]])

        result = await run_service.create_or_load_run(
            session=session,
            user_id=USER_A,
            payload=payload,
            idempotency_key="key-1",
            source_snapshot_hash="ignored-on-retry",
            before_snapshot={"ignored": True},
        )

        self.assertEqual(result.id, existing.id)
        self.assertIsNot(result, existing)
        self.assertEqual(session.added, [])
        self.assertEqual(session.flushes, 0)
        _assert_owner_filtered(self, session.statements[0])

        result.plan_json["changes"][0]["changeId"] = "mutated"
        self.assertEqual(existing.plan_json["changes"][0]["changeId"], "CHG_1")

    async def test_same_user_key_with_different_request_hash_is_typed_conflict(self) -> None:
        existing = _run(
            request_hash="different-request-hash",
            idempotency_key_hash=run_service.build_idempotency_key_hash(
                USER_A,
                "key-1",
            ),
        )
        session = _FakeAsyncSession([[existing]])

        with self.assertRaises(run_service.OptimizationIdempotencyConflictError):
            await run_service.create_or_load_run(
                session=session,
                user_id=USER_A,
                payload=_start_request(),
                idempotency_key="key-1",
                source_snapshot_hash="snapshot-hash",
            )

        self.assertEqual(session.added, [])
        self.assertEqual(session.flushes, 0)

    async def test_partial_unique_race_recovers_inside_savepoint_without_rollback(self) -> None:
        payload = _start_request()
        existing = _run(
            request_hash=run_service.build_start_request_hash(payload),
            idempotency_key_hash=run_service.build_idempotency_key_hash(
                USER_A,
                "key-1",
            ),
        )
        session = _FakeAsyncSession(
            [[], [existing]],
            fail_flush_once=True,
        )

        result = await run_service.create_or_load_run(
            session=session,
            user_id=USER_A,
            payload=payload,
            idempotency_key="key-1",
            source_snapshot_hash="snapshot-hash",
        )

        self.assertEqual(result.id, existing.id)
        self.assertEqual(session.nested_entries, 1)
        self.assertEqual(session.savepoint_rollbacks, 1)
        self.assertEqual(session.rollbacks, 0)
        self.assertEqual(session.commits, 0)
        _assert_owner_filtered(self, session.statements[0])
        _assert_owner_filtered(self, session.statements[1])

    async def test_unrelated_integrity_error_is_not_hidden(self) -> None:
        session = _FakeAsyncSession([[], []], fail_flush_once=True)

        with self.assertRaises(IntegrityError):
            await run_service.create_or_load_run(
                session=session,
                user_id=USER_A,
                payload=_start_request(),
                idempotency_key="key-1",
                source_snapshot_hash="snapshot-hash",
            )

        self.assertEqual(session.rollbacks, 0)
        self.assertEqual(session.commits, 0)

    async def test_create_rejects_non_finite_snapshot_before_add_or_flush(self) -> None:
        session = _FakeAsyncSession([[]])

        with self.assertRaises(ValueError):
            await run_service.create_or_load_run(
                session=session,
                user_id=USER_A,
                payload=_start_request(),
                idempotency_key="key-1",
                source_snapshot_hash="snapshot-hash",
                before_snapshot={"evaluation": {"score": math.nan}},
            )

        self.assertEqual(session.added, [])
        self.assertEqual(session.flushes, 0)


class ResumeOptimizationOwnerQueriesTests(unittest.IsolatedAsyncioTestCase):
    async def test_get_by_id_is_owner_filtered_and_returns_copy(self) -> None:
        stored = _run()
        session = _FakeAsyncSession([[stored]])

        result = await run_service.get_run_for_user(
            session=session,
            user_id=USER_A,
            run_id=str(stored.id),
        )

        self.assertEqual(result.id, stored.id)
        self.assertIsNot(result, stored)
        _assert_owner_filtered(self, session.statements[0])
        self.assertIn("resume_optimization_runs.id", _sql(session.statements[0]))

        result.result_json["summary"]["safe"] = False
        self.assertTrue(stored.result_json["summary"]["safe"])

    async def test_owner_mismatch_is_indistinguishable_from_not_found(self) -> None:
        session = _FakeAsyncSession([[]])

        with self.assertRaises(run_service.OptimizationRunNotFoundError):
            await run_service.get_run_for_user(
                session=session,
                user_id=USER_B,
                run_id=str(uuid.uuid4()),
            )

        _assert_owner_filtered(self, session.statements[0])

    async def test_invalid_run_id_is_not_found_without_querying(self) -> None:
        session = _FakeAsyncSession()

        with self.assertRaises(run_service.OptimizationRunNotFoundError):
            await run_service.get_run_for_user(
                session=session,
                user_id=USER_A,
                run_id="not-a-uuid",
            )

        self.assertEqual(session.statements, [])

    async def test_latest_is_scoped_to_owner_and_requested_resume(self) -> None:
        newest = _run(created_at=BASE_TIME + timedelta(minutes=2))
        session = _FakeAsyncSession([[newest]])

        result = await run_service.get_latest_run_for_resume(
            session=session,
            user_id=USER_A,
            resume_id=str(RESUME_A),
        )

        self.assertEqual(result.id, newest.id)
        statement = session.statements[0]
        sql = _sql(statement)
        _assert_owner_filtered(self, statement)
        self.assertIn("resume_optimization_runs.resume_id", sql)
        self.assertIn("order by resume_optimization_runs.created_at desc", sql)

    async def test_latest_uses_id_desc_as_equal_timestamp_tiebreaker(self) -> None:
        stable_winner = _run(created_at=BASE_TIME)
        stable_winner.id = uuid.UUID("ffffffff-ffff-ffff-ffff-ffffffffffff")
        session = _FakeAsyncSession([[stable_winner]])

        result = await run_service.get_latest_run_for_resume(
            session=session,
            user_id=USER_A,
            resume_id=str(RESUME_A),
        )

        self.assertEqual(result.id, stable_winner.id)
        self.assertEqual(
            [str(clause).lower() for clause in session.statements[0]._order_by_clauses],
            [
                "resume_optimization_runs.created_at desc",
                "resume_optimization_runs.id desc",
            ],
        )

    async def test_latest_returns_none_when_owner_has_no_run_for_resume(self) -> None:
        session = _FakeAsyncSession([[]])

        result = await run_service.get_latest_run_for_resume(
            session=session,
            user_id=USER_A,
            resume_id=str(RESUME_B),
        )

        self.assertIsNone(result)
        _assert_owner_filtered(self, session.statements[0])


class ResumeOptimizationMutationTests(unittest.IsolatedAsyncioTestCase):
    async def test_update_payload_locks_and_deep_copies_input_and_output(self) -> None:
        stored = _run()
        old_updated_at = stored.updated_at
        plan_json = {"changes": [{"changeId": "CHG_2"}]}
        accepted_change_ids = ["CHG_2"]
        session = _FakeAsyncSession([[stored]])

        result = await run_service.update_run_payload(
            session=session,
            user_id=USER_A,
            run_id=str(stored.id),
            plan_json=plan_json,
            accepted_change_ids=accepted_change_ids,
        )

        statement = session.statements[0]
        _assert_owner_filtered(self, statement)
        _assert_for_update(self, statement)
        self.assertEqual(session.flushes, 1)
        self.assertEqual(session.commits, 0)
        self.assertGreater(stored.updated_at, old_updated_at)
        self.assertIsNotNone(stored.updated_at.tzinfo)
        self.assertIsNone(stored.applied_at)
        self.assertIsNone(stored.completed_at)

        plan_json["changes"][0]["changeId"] = "input-mutated"
        accepted_change_ids.append("CHG_3")
        result.plan_json["changes"][0]["changeId"] = "output-mutated"
        result.accepted_change_ids.append("CHG_4")
        self.assertEqual(stored.plan_json["changes"][0]["changeId"], "CHG_2")
        self.assertEqual(stored.accepted_change_ids, ["CHG_2"])

    async def test_update_rejects_non_finite_json_before_mutation_or_flush(self) -> None:
        stored = _run()
        original_plan = deepcopy(stored.plan_json)
        session = _FakeAsyncSession([[stored]])

        with self.assertRaises(ValueError):
            await run_service.update_run_payload(
                session=session,
                user_id=USER_A,
                run_id=str(stored.id),
                plan_json={"changes": [{"score": math.inf}]},
            )

        self.assertEqual(stored.plan_json, original_plan)
        self.assertEqual(session.flushes, 0)

    async def test_update_rejects_non_json_nested_value_atomically(self) -> None:
        stored = _run()
        original_plan = deepcopy(stored.plan_json)
        original_answers = deepcopy(stored.answers_json)
        session = _FakeAsyncSession([[stored]])

        with self.assertRaises(TypeError):
            await run_service.update_run_payload(
                session=session,
                user_id=USER_A,
                run_id=str(stored.id),
                plan_json={"changes": [{"changeId": "CHG_valid"}]},
                answers_json={"answers": [{"value": object()}]},
            )

        self.assertEqual(stored.plan_json, original_plan)
        self.assertEqual(stored.answers_json, original_answers)
        self.assertEqual(session.flushes, 0)

    async def test_update_rejects_invalid_accepted_change_ids_atomically(self) -> None:
        invalid_values = (
            "CHG_1",
            ["CHG_1", 42],
            ["CHG_1", "   "],
            ["CHG_1", "CHG_1"],
        )

        for invalid_value in invalid_values:
            with self.subTest(accepted_change_ids=invalid_value):
                stored = _run()
                original_plan = deepcopy(stored.plan_json)
                session = _FakeAsyncSession([[stored]])

                with self.assertRaises(ValueError):
                    await run_service.update_run_payload(
                        session=session,
                        user_id=USER_A,
                        run_id=str(stored.id),
                        plan_json={"changes": [{"changeId": "CHG_new"}]},
                        accepted_change_ids=invalid_value,
                    )

                self.assertEqual(stored.plan_json, original_plan)
                self.assertEqual(stored.accepted_change_ids, [])
                self.assertEqual(session.flushes, 0)

    async def test_transition_calls_state_helper_and_uses_for_update(self) -> None:
        stored = _run(status=ResumeOptimizationStatus.PLANNING)
        session = _FakeAsyncSession([[stored]])

        with patch.object(
            run_service.state_machine,
            "require_status_transition",
            wraps=run_service.state_machine.require_status_transition,
        ) as require_transition:
            result = await run_service.transition_run(
                session=session,
                user_id=USER_A,
                run_id=str(stored.id),
                target=ResumeOptimizationStatus.PREVIEW_READY,
            )

        require_transition.assert_called_once_with(
            ResumeOptimizationStatus.PLANNING,
            ResumeOptimizationStatus.PREVIEW_READY,
            allow_rescore_retry=False,
        )
        self.assertEqual(result.status, ResumeOptimizationStatus.PREVIEW_READY.value)
        _assert_owner_filtered(self, session.statements[0])
        _assert_for_update(self, session.statements[0])

    async def test_invalid_transition_does_not_mutate_or_flush(self) -> None:
        stored = _run(status=ResumeOptimizationStatus.PLANNING)
        session = _FakeAsyncSession([[stored]])

        with self.assertRaises(InvalidOptimizationTransitionError):
            await run_service.transition_run(
                session=session,
                user_id=USER_A,
                run_id=str(stored.id),
                target=ResumeOptimizationStatus.COMPLETED,
            )

        self.assertEqual(stored.status, ResumeOptimizationStatus.PLANNING.value)
        self.assertEqual(session.flushes, 0)

    async def test_transition_timestamps_are_aware_and_state_specific(self) -> None:
        applied_time = BASE_TIME + timedelta(minutes=1)
        completed_time = BASE_TIME + timedelta(minutes=2)

        applying = _run(status=ResumeOptimizationStatus.APPLYING)
        applying_session = _FakeAsyncSession([[applying]])
        with patch.object(run_service, "utc_now_aware", return_value=applied_time):
            await run_service.transition_run(
                session=applying_session,
                user_id=USER_A,
                run_id=str(applying.id),
                target=ResumeOptimizationStatus.APPLIED,
            )
        self.assertEqual(applying.updated_at, applied_time)
        self.assertEqual(applying.applied_at, applied_time)
        self.assertIsNone(applying.completed_at)
        self.assertIsNotNone(applying.applied_at.tzinfo)

        rescoring = _run(status=ResumeOptimizationStatus.RESCORING)
        rescoring.applied_at = applied_time
        rescoring_session = _FakeAsyncSession([[rescoring]])
        with patch.object(run_service, "utc_now_aware", return_value=completed_time):
            await run_service.transition_run(
                session=rescoring_session,
                user_id=USER_A,
                run_id=str(rescoring.id),
                target=ResumeOptimizationStatus.COMPLETED,
            )
        self.assertEqual(rescoring.updated_at, completed_time)
        self.assertEqual(rescoring.applied_at, applied_time)
        self.assertEqual(rescoring.completed_at, completed_time)
        self.assertIsNotNone(rescoring.completed_at.tzinfo)

        planning = _run(status=ResumeOptimizationStatus.PLANNING)
        planning_session = _FakeAsyncSession([[planning]])
        with patch.object(run_service, "utc_now_aware", return_value=completed_time):
            await run_service.transition_run(
                session=planning_session,
                user_id=USER_A,
                run_id=str(planning.id),
                target=ResumeOptimizationStatus.FAILED,
            )
        self.assertEqual(planning.updated_at, completed_time)
        self.assertIsNone(planning.applied_at)
        self.assertIsNone(planning.completed_at)

    async def test_applied_self_transition_requires_explicit_rescore_retry_gate(self) -> None:
        applied_time = BASE_TIME + timedelta(minutes=1)
        stored = _run(status=ResumeOptimizationStatus.APPLIED)
        stored.applied_at = applied_time

        rejected_session = _FakeAsyncSession([[stored]])
        with self.assertRaises(InvalidOptimizationTransitionError):
            await run_service.transition_run(
                session=rejected_session,
                user_id=USER_A,
                run_id=str(stored.id),
                target=ResumeOptimizationStatus.APPLIED,
            )

        retry_time = BASE_TIME + timedelta(minutes=3)
        allowed_session = _FakeAsyncSession([[stored]])
        with patch.object(run_service, "utc_now_aware", return_value=retry_time):
            await run_service.transition_run(
                session=allowed_session,
                user_id=USER_A,
                run_id=str(stored.id),
                target=ResumeOptimizationStatus.APPLIED,
                allow_rescore_retry=True,
            )

        self.assertEqual(stored.applied_at, applied_time)
        self.assertEqual(stored.updated_at, retry_time)

    async def test_record_error_is_owner_locked_and_copies_safe_metadata(self) -> None:
        stored = _run(status=ResumeOptimizationStatus.PLANNING)
        error_json = {"code": "planner_failed", "details": {"retryable": True}}
        session = _FakeAsyncSession([[stored]])

        result = await run_service.record_run_error(
            session=session,
            user_id=USER_A,
            run_id=str(stored.id),
            error_json=error_json,
        )

        self.assertEqual(stored.status, ResumeOptimizationStatus.FAILED.value)
        self.assertEqual(stored.error_json, error_json)
        _assert_owner_filtered(self, session.statements[0])
        _assert_for_update(self, session.statements[0])
        error_json["details"]["retryable"] = False
        result.error_json["details"]["retryable"] = False
        self.assertTrue(stored.error_json["details"]["retryable"])


if __name__ == "__main__":
    unittest.main()

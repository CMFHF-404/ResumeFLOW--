"""Private, user-owned receipts for audited guidance evaluations.

The public report contains only opaque hashes.  Numeric scoring material and
the task/audit evidence remain on the AI usage event that paid for the audit.
"""
from __future__ import annotations

from copy import deepcopy
import hashlib
import json
import re
from typing import Any, Mapping


_HASH_RE = re.compile(r"^[0-9a-f]{64}$")
_RECEIPT_ID_RE = re.compile(r"^[0-9a-f]{32}$")
_PUBLIC_AUDIT_RECEIPT_KEYS = frozenset(
    {
        "receiptId",
        "inputHash",
        "tasksHash",
        "judgmentsHash",
        "rubricHash",
        "schemaHash",
        "auditVersion",
    }
)
_RECEIPT_BINDINGS = {
    "input_hash": lambda receipt: {
        "resume": receipt["input"]["resume"],
        "fact_metadata": receipt["input"]["fact_metadata"],
    },
    "tasks_hash": lambda receipt: receipt["tasks"],
    "judgments_hash": lambda receipt: receipt["judgments"],
    "rubric_hash": lambda receipt: receipt["rubric"],
    "schema_hash": lambda receipt: receipt["schema"],
}


class GuidanceReceiptError(RuntimeError):
    """Base class for receipt persistence and lookup failures."""


class GuidanceReceiptUnavailableError(GuidanceReceiptError):
    """The requested private receipt does not have one unambiguous owner row."""


class GuidanceReceiptInvalidError(GuidanceReceiptError, ValueError):
    """A stored receipt or its public binding was malformed or tampered."""


def canonical_json_hash(value: Any) -> str:
    try:
        payload = json.dumps(
            value,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        )
    except (TypeError, ValueError) as exc:
        raise GuidanceReceiptInvalidError("Guidance receipt is not canonical JSON") from exc
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def guidance_public_hash(report: Mapping[str, Any]) -> str:
    if not isinstance(report, Mapping):
        raise GuidanceReceiptInvalidError("Guidance report must be an object")
    public = deepcopy(dict(report))
    public.pop("auditReceipt", None)
    return canonical_json_hash(public)


def _require_non_empty_string(value: Any, name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise GuidanceReceiptInvalidError(f"{name} must be a non-empty string")
    return value


def _require_hash(value: Any, name: str) -> str:
    if not isinstance(value, str) or _HASH_RE.fullmatch(value) is None:
        raise GuidanceReceiptInvalidError(f"{name} must be a SHA-256 digest")
    return value


def _source_ids(raw: Any) -> set[str]:
    if isinstance(raw, Mapping):
        source_ids = set()
        for source_id, source in raw.items():
            normalized_id = _require_non_empty_string(source_id, "source ID")
            if not isinstance(source, Mapping):
                raise GuidanceReceiptInvalidError("Guidance source must be an object")
            embedded_id = source.get("sourceId", normalized_id)
            if embedded_id != normalized_id:
                raise GuidanceReceiptInvalidError("Guidance source identity is inconsistent")
            source_ids.add(normalized_id)
        return source_ids
    if isinstance(raw, list):
        source_ids = []
        for source in raw:
            if not isinstance(source, Mapping):
                raise GuidanceReceiptInvalidError("Guidance source must be an object")
            source_ids.append(_require_non_empty_string(source.get("sourceId"), "sourceId"))
        if len(source_ids) != len(set(source_ids)):
            raise GuidanceReceiptInvalidError("Guidance source IDs must be unique")
        return set(source_ids)
    raise GuidanceReceiptInvalidError("Guidance sources must be an object or array")


def _validate_tasks_and_audit(receipt: Mapping[str, Any]) -> None:
    tasks = receipt.get("tasks")
    judgments = receipt.get("judgments")
    audit = receipt.get("audit")
    if not isinstance(tasks, list) or not tasks:
        raise GuidanceReceiptInvalidError("Guidance receipt tasks must be a non-empty array")
    if not isinstance(judgments, Mapping):
        raise GuidanceReceiptInvalidError("Guidance receipt judgments must be an object")
    if not isinstance(audit, Mapping):
        raise GuidanceReceiptInvalidError("Guidance receipt audit must be an object")
    sources = _source_ids(receipt.get("sources"))
    source_rows = receipt.get("sources")
    if not isinstance(source_rows, Mapping):
        raise GuidanceReceiptInvalidError("Guidance sources must use the canonical mapping")
    raw_facts = receipt.get("input", {}).get("fact_metadata")
    if not isinstance(raw_facts, list):
        raise GuidanceReceiptInvalidError("Guidance receipt fact_metadata must be an array")
    facts: dict[str, dict[str, Any]] = {}
    for raw_fact in raw_facts:
        if not isinstance(raw_fact, Mapping):
            raise GuidanceReceiptInvalidError("Guidance receipt fact must be an object")
        fact_id = raw_fact.get("factId", raw_fact.get("fact_id"))
        fact_id = _require_non_empty_string(fact_id, "factId")
        if fact_id in facts:
            raise GuidanceReceiptInvalidError("Guidance receipt fact IDs must be unique")
        facts[fact_id] = {
            "factId": fact_id,
            "content": raw_fact.get("content"),
            "source": raw_fact.get("source"),
            "verificationStatus": raw_fact.get(
                "verificationStatus", raw_fact.get("verification_status")
            ),
        }
    if len(source_rows) != len(facts):
        raise GuidanceReceiptInvalidError("Guidance sources must cover every input fact")
    for source in source_rows.values():
        fact_id = source.get("factId")
        if fact_id not in facts or dict(source) != facts[fact_id]:
            raise GuidanceReceiptInvalidError("Guidance source does not match its input fact")

    task_ids: list[str] = []
    for task in tasks:
        if not isinstance(task, Mapping):
            raise GuidanceReceiptInvalidError("Guidance task must be an object")
        task_id = _require_non_empty_string(task.get("taskId"), "taskId")
        _require_non_empty_string(task.get("dimension"), "task dimension")
        _require_non_empty_string(task.get("criterion"), "task criterion")
        _require_non_empty_string(task.get("fieldPath"), "task fieldPath")
        allowed_sources = task.get("allowedSources")
        allowed_assessments = task.get("allowedAssessments")
        if (
            not isinstance(allowed_sources, list)
            or any(not isinstance(item, str) or item not in sources for item in allowed_sources)
            or len(allowed_sources) != len(set(allowed_sources))
        ):
            raise GuidanceReceiptInvalidError("Guidance task has invalid allowedSources")
        if (
            not isinstance(allowed_assessments, list)
            or not allowed_assessments
            or any(not isinstance(item, str) or not item for item in allowed_assessments)
            or len(allowed_assessments) != len(set(allowed_assessments))
        ):
            raise GuidanceReceiptInvalidError("Guidance task has invalid allowedAssessments")
        bands = task.get("assessmentBands")
        points = task.get("assessmentPoints")
        if (
            not isinstance(bands, Mapping)
            or not isinstance(points, Mapping)
            or set(bands) != set(allowed_assessments)
            or set(points) != set(allowed_assessments)
        ):
            raise GuidanceReceiptInvalidError("Guidance task assessment mappings are incomplete")
        max_score = task.get("maxScore")
        if isinstance(max_score, bool) or not isinstance(max_score, (int, float)) or max_score < 0:
            raise GuidanceReceiptInvalidError("Guidance task maxScore must be numeric")
        for point in points.values():
            if (
                isinstance(point, bool)
                or not isinstance(point, (int, float))
                or point < 0
                or point > 1
            ):
                raise GuidanceReceiptInvalidError("Guidance task assessmentPoints are invalid")
        task_ids.append(task_id)
    if len(task_ids) != len(set(task_ids)):
        raise GuidanceReceiptInvalidError("Guidance task IDs must be unique")
    if set(judgments) != set(task_ids):
        raise GuidanceReceiptInvalidError("Guidance judgments must cover every task exactly once")

    task_by_id = {str(task["taskId"]): task for task in tasks}
    for task_id, judgment in judgments.items():
        if not isinstance(judgment, Mapping):
            raise GuidanceReceiptInvalidError("Guidance judgment must be an object")
        task = task_by_id[str(task_id)]
        if judgment.get("assessment") not in task["allowedAssessments"]:
            raise GuidanceReceiptInvalidError("Guidance judgment assessment is not allowed")
        source_refs = judgment.get("sourceRefs")
        if (
            not isinstance(source_refs, list)
            or any(source not in task["allowedSources"] for source in source_refs)
            or len(source_refs) != len(set(source_refs))
        ):
            raise GuidanceReceiptInvalidError("Guidance judgment sourceRefs are invalid")

    if set(audit) != set(task_ids):
        raise GuidanceReceiptInvalidError("Guidance audit must cover every task exactly once")
    for task_id, item in audit.items():
        if not isinstance(item, Mapping):
            raise GuidanceReceiptInvalidError("Guidance audit task must be an object")
        if (
            item.get("verdict") != "approved"
            or item.get("sourceSupported") is not True
            or item.get("assessmentSupported") is not True
            or item.get("guidanceSafe") is not True
            or not isinstance(item.get("guidanceActionable"), bool)
        ):
            raise GuidanceReceiptInvalidError("Guidance task audit is not approved")
        if item.get("guidanceActionable") is False and not bool(
            task_by_id[str(task_id)].get("optional")
        ):
            raise GuidanceReceiptInvalidError(
                "Required guidance task must remain actionable"
            )


def validate_guidance_receipt(receipt: Mapping[str, Any]) -> dict[str, Any]:
    if not isinstance(receipt, Mapping):
        raise GuidanceReceiptInvalidError("Guidance receipt must be an object")
    copied = deepcopy(dict(receipt))
    receipt_id = _require_non_empty_string(copied.get("receipt_id"), "receipt_id")
    if _RECEIPT_ID_RE.fullmatch(receipt_id) is None:
        raise GuidanceReceiptInvalidError("receipt_id must be a 32-character hex ID")
    _require_non_empty_string(copied.get("audit_version"), "audit_version")
    _require_hash(copied.get("public_hash"), "public_hash")
    for key in _RECEIPT_BINDINGS:
        supplied = _require_hash(copied.get(key), key)
        try:
            expected = canonical_json_hash(_RECEIPT_BINDINGS[key](copied))
        except (KeyError, TypeError) as exc:
            raise GuidanceReceiptInvalidError(f"Guidance receipt {key} input is missing") from exc
        if supplied != expected:
            raise GuidanceReceiptInvalidError(f"Guidance receipt {key} does not match its payload")
    if not isinstance(copied.get("input"), Mapping):
        raise GuidanceReceiptInvalidError("Guidance receipt input must be an object")
    if set(copied["input"]) != {"resume", "fact_metadata"}:
        raise GuidanceReceiptInvalidError("Guidance receipt input has an invalid shape")
    if not isinstance(copied.get("rubric"), Mapping):
        raise GuidanceReceiptInvalidError("Guidance receipt rubric must be an object")
    if not isinstance(copied.get("schema"), Mapping):
        raise GuidanceReceiptInvalidError("Guidance receipt schema must be an object")
    internal = copied.get("internal_report")
    if (
        not isinstance(internal, Mapping)
        or internal.get("evaluationVersion") != "resume_flow_v1"
        or internal.get("scoringVersion") != "guidance_audit_v1"
    ):
        raise GuidanceReceiptInvalidError("Guidance internal report has an invalid version")
    _validate_tasks_and_audit(copied)
    return copied


def validate_public_receipt_binding(
    public_report: Mapping[str, Any],
    receipt: Mapping[str, Any],
) -> dict[str, Any]:
    validated = validate_guidance_receipt(receipt)
    raw_binding = public_report.get("auditReceipt")
    if not isinstance(raw_binding, Mapping) or set(raw_binding) != _PUBLIC_AUDIT_RECEIPT_KEYS:
        raise GuidanceReceiptInvalidError("Public guidance auditReceipt has an invalid shape")
    expected = {
        "receiptId": validated["receipt_id"],
        "inputHash": validated["input_hash"],
        "tasksHash": validated["tasks_hash"],
        "judgmentsHash": validated["judgments_hash"],
        "rubricHash": validated["rubric_hash"],
        "schemaHash": validated["schema_hash"],
        "auditVersion": validated["audit_version"],
    }
    if dict(raw_binding) != expected:
        raise GuidanceReceiptInvalidError("Public guidance auditReceipt does not match private receipt")
    if guidance_public_hash(public_report) != validated["public_hash"]:
        raise GuidanceReceiptInvalidError("Public guidance report does not match private receipt")
    return validated


async def persist_guidance_receipt(
    attempt_id: str,
    receipt: Mapping[str, Any],
) -> None:
    """Attach one private receipt to the latest usage event for this audit attempt.

    Offline tests and diagnostic-only callers may run without billing context;
    they intentionally receive a no-op.  Production optimization later fails
    closed because no receipt can be loaded.
    """

    attempt_id = _require_non_empty_string(attempt_id, "attempt_id")
    validated = validate_guidance_receipt(receipt)
    from ..billing.billing_service import get_current_billing_context

    context = get_current_billing_context()
    if context is None:
        return

    from sqlalchemy import desc
    from sqlmodel import select

    from ...database import AsyncSessionFactory
    from ...models import AITokenUsageEvent

    async with AsyncSessionFactory() as session:
        rows = (
            await session.execute(
                select(AITokenUsageEvent)
                .where(
                    AITokenUsageEvent.user_id == context.user_id,
                    AITokenUsageEvent.metadata_json[
                        "guidance_audit_attempt_id"
                    ].as_string()
                    == attempt_id,
                )
                .order_by(desc(AITokenUsageEvent.created_at), desc(AITokenUsageEvent.id))
            )
        ).scalars().all()
        if not rows:
            raise GuidanceReceiptUnavailableError(
                "Guidance audit usage event is unavailable"
            )
        target = rows[0]
        metadata = dict(target.metadata_json or {})
        existing = metadata.get("guidance_audit_receipts")
        receipts = list(existing) if isinstance(existing, list) else []
        same_id = [
            item
            for item in receipts
            if isinstance(item, Mapping)
            and item.get("receipt_id") == validated["receipt_id"]
        ]
        if same_id and any(dict(item) != validated for item in same_id):
            raise GuidanceReceiptInvalidError("Guidance receipt ID was reused")
        if not same_id:
            receipts.append(validated)
        metadata["guidance_receipt_id"] = validated["receipt_id"]
        metadata["guidance_audit_receipts"] = receipts
        target.metadata_json = metadata
        session.add(target)
        await session.commit()


async def load_guidance_receipt(
    *,
    receipt_id: str,
    user_id: str | None = None,
) -> dict[str, Any]:
    receipt_id = _require_non_empty_string(receipt_id, "receipt_id")
    if user_id is None:
        from ..billing.billing_service import get_current_billing_context

        context = get_current_billing_context()
        user_id = context.user_id if context is not None else None
    if not isinstance(user_id, str) or not user_id.strip():
        raise GuidanceReceiptUnavailableError("Guidance receipt owner is unavailable")

    from sqlmodel import select

    from ...database import AsyncSessionFactory
    from ...models import AITokenUsageEvent

    async with AsyncSessionFactory() as session:
        rows = (
            await session.execute(
                select(AITokenUsageEvent).where(
                    AITokenUsageEvent.user_id == user_id,
                    AITokenUsageEvent.metadata_json[
                        "guidance_receipt_id"
                    ].as_string()
                    == receipt_id,
                )
            )
        ).scalars().all()
    if len(rows) != 1:
        raise GuidanceReceiptUnavailableError(
            "Guidance receipt is missing or ambiguous"
        )
    raw_receipts = (rows[0].metadata_json or {}).get("guidance_audit_receipts")
    matches = [
        item
        for item in raw_receipts
        if isinstance(item, Mapping) and item.get("receipt_id") == receipt_id
    ] if isinstance(raw_receipts, list) else []
    if len(matches) != 1:
        raise GuidanceReceiptUnavailableError(
            "Guidance receipt is missing or ambiguous"
        )
    return validate_guidance_receipt(matches[0])

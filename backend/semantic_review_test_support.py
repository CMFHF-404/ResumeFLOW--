"""Explicit successful-review fixtures for tests outside the reviewer boundary.

These receipts simulate a model verdict; they do not assert semantic model quality.
"""
from app.domain.resume_optimization.safety import semantic_review_hash
from app.domain.resume_optimization.schemas import OptimizationSemanticReview, POLICY_VERSION


def with_supported_review(change, documents):
    change = change.model_copy(deep=True)
    try:
        input_hash = semantic_review_hash(change, documents)
    except (ValueError, KeyError, TypeError):
        return change  # Malformed source fixtures must reach deterministic rejection.
    change.semantic_review = OptimizationSemanticReview(
        input_hash=input_hash, policy_version=POLICY_VERSION,
        verdict='supported', reason='测试替身：来源支持候选文本',
    )
    return change


async def supported_plan_review(*, plan, source_documents):
    return plan.model_copy(update={'changes': [
        with_supported_review(change, source_documents) for change in plan.changes
    ]}, deep=True)


def review_run_fixture(run):
    from app.domain.resume_optimization.apply_service import _current_safety_source_documents
    from app.domain.resume_optimization.schemas import OptimizationPlan
    plan = OptimizationPlan.model_validate(run.result_json or run.plan_json)
    documents = _current_safety_source_documents(run, plan=plan)
    plan.changes = [with_supported_review(change, documents) for change in plan.changes]
    run.result_json = plan.model_dump(mode='json')

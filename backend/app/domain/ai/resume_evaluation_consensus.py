"""Select a coherent central report, never average scores away from their evidence."""
from __future__ import annotations
from typing import Any, Sequence


def select_central_evaluation(results: Sequence[dict[str, Any]]) -> dict[str, Any]:
    if not results:
        raise ValueError("at least one validated evaluation is required")
    vectors = [tuple(d["score"] for d in r["resumeEvaluation"]["dimensions"]) for r in results]
    # L1 medoid uses all dimensions; a stable total cannot hide compensating
    # dimension outliers. Return one whole report with its own evidence/issues.
    def rank(index: int):
        distance = sum(sum(abs(a-b) for a,b in zip(vectors[index], other)) for other in vectors)
        return distance, sum(vectors[index]), vectors[index], index
    return results[min(range(len(results)), key=rank)]

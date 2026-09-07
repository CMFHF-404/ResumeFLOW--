"""Select a coherent central report, never average scores away from their evidence."""
from __future__ import annotations
from typing import Any, Sequence
from contextvars import ContextVar


diagnostic_sink: ContextVar[list | None] = ContextVar('evaluation_diagnostic_sink', default=None)


def evaluation_dispersion(results: Sequence[dict[str, Any]]) -> dict[str, Any]:
    if len(results) < 3:
        return {'status': 'insufficient_samples', 'valid_samples': len(results),
                'total_range': None, 'dimension_ranges': None}
    vectors = [tuple(d['score'] for d in r['resumeEvaluation']['dimensions']) for r in results]
    totals = [int(sum(vector) / 6 + 0.5) for vector in vectors]
    ranges = [max(v[i] for v in vectors) - min(v[i] for v in vectors) for i in range(6)]
    total_range = max(totals) - min(totals)
    return {'status': 'stable' if total_range <= 5 and max(ranges) <= 10 else 'unstable',
            'valid_samples': len(results), 'total_range': total_range, 'dimension_ranges': ranges}


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

# Six-Dimension Resume Optimization — Gate A Rollout Record

- Record opened: 2026-09-01
- Gate A verification completed: 2026-09-02
- Scope: Gate A, Tasks 0–21 only
- Automated status: passed on the final Task 21 checkout described below
- Manual browser QA: passed with isolated synthetic fixtures; external-AI seam boundaries are recorded in the linked evidence
- Explicit exclusions: Gate B, Gate C, and every Task 22+ deliverable

## Gate A scope

Gate A delivers the default-off foundation for six-dimension resume optimization:

- additive PostgreSQL persistence in `resume_optimization_runs`, owner-scoped run access, idempotency, state transitions, and runtime schema setup;
- frozen optimization context, plan normalization, safety validation, question handling, apply/finalize/revert behavior, public errors, billing metadata, and the feature-gated FastAPI router;
- strict frontend wire normalization, service methods, cross-render flow state, workspace accessibility, overview/questions/preview/result surfaces, navigation, analytics allowlists, and the feature-gated report CTA;
- regression coverage for the optimization path and its shared resume-evaluation, JD-analysis, save-coordination, AI, runtime-schema, and startup boundaries.

This record does not authorize or document any Gate B or Gate C implementation.

## Feature flags

Both switches default to `false` and must be controlled independently.

| Layer | Flag | Kind | Disabled behavior |
| --- | --- | --- | --- |
| Backend | `ENABLE_RESUME_OPTIMIZATION` | Process-start environment variable; changing it requires a backend restart | The optimization router is not registered; requests receive FastAPI's native 404. |
| Frontend | `VITE_ENABLE_RESUME_OPTIMIZATION` | Vite build-time environment variable; changing it requires a rebuild and frontend deployment | The report CTA stays hidden while the hook remains safely disabled. |

The feature is user-accessible only when both flags are true. Gate A has no application-level per-user or cohort targeting. Any staged exposure must therefore use separate deployment environments or infrastructure routing; do not describe the two booleans as a cohort system.

## Deployment order

1. Deploy the backend with `ENABLE_RESUME_OPTIMIZATION=false` so the additive runtime schema can be created while all optimization routes remain unavailable.
2. Verify `resume_optimization_runs`, its constraints, and its indexes were created successfully; keep the backend flag off if schema verification fails.
3. Deploy the frontend built with `VITE_ENABLE_RESUME_OPTIMIZATION=false`; verify no optimization CTA is visible.
4. Enable `ENABLE_RESUME_OPTIMIZATION=true` in an internal or staging backend environment and verify authenticated route/error/billing behavior.
5. Build and deploy the internal frontend with `VITE_ENABLE_RESUME_OPTIMIZATION=true`.
6. Complete the manual QA checklist and inspect public error codes, retry behavior, and aggregate token/usage telemetry without recording resume, JD, answer, change, or source content.
7. If production exposure is approved, enable it only after the preceding evidence is complete. Inspect failure and token trends after the deployment. Gate A itself cannot target a small per-user cohort; staged exposure requires an independently configured deployment or infrastructure boundary.

## Rollback

1. Rebuild/deploy the frontend with `VITE_ENABLE_RESUME_OPTIMIZATION=false` to remove the entry point.
2. Set `ENABLE_RESUME_OPTIMIZATION=false` and restart the backend to unregister the router.
3. Leave the additive `resume_optimization_runs` table, constraints, indexes, and existing Run records in place.
4. Do not delete or rewrite Runs during rollback. Preserve them for idempotency, auditability, and a later safe re-enable.
5. Investigate and repair forward; a destructive schema rollback is not part of Gate A.

## Automated evidence

The Task 21 verification matrix completed on 2026-09-02 and was rerun after the final hardening commit:

| Verification | Result |
| --- | --- |
| Focused accessibility test | PASS — 10 tests |
| Focused public-error test | PASS — 15 tests |
| Gate A frontend optimization matrix | PASS — 100 tests |
| Gate A backend optimization matrix | PASS — 328 tests, 4 skipped by their documented environment gates |
| Save/preflight frontend regressions | PASS — 14 tests |
| Resume persistence backend regressions | PASS — 18 tests |
| Adjacent frontend regression matrix | PASS — 82 tests |
| Adjacent backend regression matrix | PASS — 424 tests |
| `npx tsc --noEmit --pretty false` | PASS |
| `npm run build` | PASS; Vite emitted only its existing Browserslist-age and chunk-size warnings |
| `git diff --check` | PASS; Git emitted only line-ending conversion warnings |

The exact commands are documented in `AGENTS.md`. These automated results do not replace browser acceptance.

## Manual QA evidence

The completed, content-sanitized browser record is [manual-qa.md](evidence/2026-09-01-six-dimension-resume-optimization/manual-qa.md). It covers the Task 21 high-evidence, low-evidence, conflict, refresh/reopen, revert, mobile, dark-mode, keyboard, focus-restoration, reduced-motion, retry, and public-error paths.

Disabled-route/hidden-CTA and quota-exhaustion behavior were verified by the exact deterministic HTTP and frontend matrices rather than by mutating the synthetic browser account's quota. The evidence bundle contains no resume text, JD text, answers, raw model payloads, internal paths, signatures, hashes, or source identifiers.

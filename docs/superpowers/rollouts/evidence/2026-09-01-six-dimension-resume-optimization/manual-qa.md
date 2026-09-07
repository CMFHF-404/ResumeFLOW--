# Six-Dimension Resume Optimization — Gate A QA Evidence

- Date: 2026-09-02
- Scope: Task 21 manual acceptance for Gate A only
- Environment: local frontend and backend with both default-off feature flags explicitly enabled
- Data boundary: isolated PostgreSQL database, synthetic account, synthetic resume, and synthetic JD; no production record was used

## Provider and harness boundary

A real-provider six-dimension evaluation completed successfully. The real-provider optimization request then reached the configured timeout after roughly 300 seconds; the UI exposed only the safe retry message and did not expose an upstream body, stack trace, prompt, or NDJSON parser detail.

To finish deterministic state-machine acceptance without repeatedly spending provider tokens, a temporary process-local QA seam replaced only external planning, answer-rewrite, and evaluation generation. Authentication, owner isolation, quota accounting, HTTP/NDJSON transport, frozen context, safety validation, PostgreSQL Run persistence, optimistic concurrency, apply, finalize, and revert continued through production code. The seam was stopped and removed after QA.

No raw resume content, JD content, answer text, Run identifiers, source identifiers, timestamps used as version tokens, signatures, hashes, model payloads, or internal filesystem paths are recorded here.

## Scenario results

| Scenario | Evidence | Result |
| --- | --- | --- |
| Low evidence | Responsibility and metric questions appeared. The metric answer used `no_data`; no percentage was introduced. Safe readability edits remained selectable. Two accepted edits were applied, exactly one post-score ran, and the aggregate score moved from 31 to 37. | PASS |
| High evidence | No unnecessary questions appeared. Two safe diff items were shown, one was deselected, one was applied, and exactly one post-score ran. The aggregate score remained 72. UI revert restored only the applied field and left the deselected field untouched. | PASS |
| Retry and resumability | A provider timeout remained retryable without rotating the planning idempotency key. Refresh/reopen restored awaiting-answers, preview-ready, applied-before-finalize, and completed states. | PASS |
| Concurrent conflict | After a Run reached preview, a second tab changed and auto-saved a layout setting. Applying the old preview was rejected with the stale/version-conflict message; the proposed STAR edits did not overwrite current content. | PASS |
| Mobile and dark mode | The complete deterministic path was exercised at 390 × 844. Primary footer controls measured 44 px high and remained inside the viewport; the sticky footer, scrolling, and dark contrast remained usable. | PASS |
| Keyboard and focus | Tab and Shift+Tab remained trapped inside the modal. Escape closed it, restored document scroll/accessibility state, and returned focus to the visible “return to optimization plan” control. | PASS |
| Reduced motion | With `prefers-reduced-motion: reduce` emulated, the media query matched and optimization navigation controls computed `transition-property: none`. | PASS |
| Public errors and logs | The live provider timeout used the safe public message. Browser warning/error logs contained no resume/JD/answer content, identifiers, authorization data, upstream bodies, or raw NDJSON. The HTTP matrix separately covered disabled feature, stale evaluation, resume conflict, missing Run, invalid transition, idempotency conflict, invalid AI payload, timeout, and quota exhaustion. | PASS |
| Default-off flags and quota | Default-off router/CTA behavior and quota exhaustion were exercised by deterministic backend HTTP and frontend structure/service tests. The synthetic browser account's quota was not modified solely for QA. | PASS |

## Regressions found by browser acceptance

The browser pass found and drove focused regressions for:

- a no-op resume-config save advancing the concurrency token;
- timezone-naive Resume ORM mappings against PostgreSQL `TIMESTAMPTZ` columns;
- a fresh six-dimension report being rejected solely because its separate JD analysis was marked outdated;
- ambiguous planning retries rotating their idempotency key or accepting an active `planning` replay as completed;
- focus falling back to the document body when the original report CTA was unmounted;
- string-form HTTP exception details reaching optimization NDJSON and persisted Run metadata.

Each issue received a failing regression first, a narrow repair, and inclusion in the final Task 21 matrices. The temporary viewport override was reset after QA.

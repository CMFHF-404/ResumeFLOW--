# Six-Dimension Resume Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不等待完整 Evidence Harness 的前提下，为 ResumeFlow 上线可收费的六维智能优化闭环：基于用户手动生成的六维报告，对当前简历进行安全重构；证据不足时询问；逐项预览和应用；完成一次优化后复评；同时为通用稿复用和完整证据架构保留稳定接口。

**Architecture:** 新增独立 `resume_optimization` 领域，服务端冻结当前简历、六维报告、JD 与已选经历源版本，生成四类优化动作并经过确定性薄安全层；所有状态持久化为 `ResumeOptimizationRun`。前端在现有六维报告中加入入口，通过独立状态机完成方案、提问、Diff、应用、复评与结果展示。首发只修改当前简历 override/config，不自动写回经历库，也不复制一键组装逻辑。

**Tech Stack:** React 19、TypeScript 5.8、Vite 6、Tailwind CSS、Lucide React、FastAPI、Pydantic、SQLModel、SQLAlchemy async、PostgreSQL JSONB、NDJSON streaming、Node test runner、Python `unittest`。

**Spec:** `docs/superpowers/specs/2026-08-31-six-dimension-resume-optimization-design.md`

## Global Constraints

- Audited design baseline is `main@bc9cb8c45ec3e96ccb250892e069bbb60e486f56`.
- Gate A execution baseline for this branch is `main@efa37abe737a2ef9aa7251f9a1bb441ccf46b3b4`; Task 0 baseline verification passed on 2026-09-01.
- Read and obey root `AGENTS.md` before editing.
- Gate A is the only release-blocking scope. Stop after Gate A is production-ready unless the task explicitly requests Gate B or Gate C.
- Six-dimensional scoring always evaluates the assembled current resume. Unselected bank content is not current-resume evidence.
- Optimization never changes the selected experience, certification, education, or skill set in Gate A.
- Use full source versions only for experiences already selected in the current resume.
- Unselected experiences produce deterministic suggestions only; never send their full STAR text to the rewrite model.
- Apply targeted text only to the current resume’s `ResumeExperienceLink.overrides_json` and `Resume.config`.
- Do not automatically update `MasterExperience` or create `ExperienceVersion` in Gate A.
- Every AI-generated change must pass server-side source, numeric, responsibility, causality, and introduced-term checks.
- Never make a model-generated string its own supporting source.
- A stale evaluation or stale resume snapshot cannot be optimized or applied.
- Preserve existing optimistic-concurrency behavior and owner isolation.
- Reuse existing AI billing, runtime budget, public error, streaming, and auth-owner patterns.
- Never expose raw private chain-of-thought. Stream progress nodes and brief status summaries only.
- Maintain light mode, dark mode, responsive layout, keyboard navigation, focus management, and reduced-motion support.
- Use test-first development. For each behavior: write the focused failing test, run it to confirm failure, implement the minimum code, rerun the focused test, then commit.
- Keep commits small and named exactly as suggested unless repository conventions require a harmless prefix.
- Do not combine unrelated refactors with this feature.
- Do not add a fixed-price optimization SKU in Gate A. Existing Token accounting is the billing authority.
- Do not weaken existing six-dimensional validation to make generated output pass.

---

## Release Gates

### Gate A — Monetizable launch

Ship after Tasks 0–21 pass. It includes:

```text
valid report CTA
+ persistent optimization run
+ direct rewrite / ask / bank suggestion / leave unchanged
+ one question round
+ diff preview
+ thin safety gate
+ transactional apply
+ one post-apply six-dimensional evaluation
+ result and safe revert
+ token billing
+ feature flag
+ analytics
```

### Gate B — Reusable general drafts

Tasks 22–23. Adds version-hashed `ExperienceOptimizationArtifact` caching without changing the L0 fact source.

### Gate C — Evidence-constrained Writing Harness

Tasks 24–25. Adds persistent Evidence Ledger, Claim IR, claim verification, conflict handling, and explicit fact synchronization.

---

## Public Contract Freeze for Gate A

Codex must implement these values exactly unless a compile-time conflict in the repository requires renaming. Any required rename must be applied consistently to backend schemas, frontend types, tests, and this plan’s contract tests.

### Versions

```python
OPTIMIZER_VERSION = "resume_optimization_v1"
POLICY_VERSION = "thin_safety_v1"
PROMPT_VERSION = "resume_optimization_prompt_v1"
```

### Server run statuses

```text
planning
awaiting_answers
preview_ready
applying
applied
rescoring
completed
failed
stale
cancelled
reverted
```

### Change actions

```text
rewrite_now
ask_user
suggest_from_bank
leave_unchanged
```

### Change scopes

```text
general
jd_targeted
```

### Supported module types

```text
experience_star
personal_summary
skills_order
section_order
bank_suggestion
```

### Answer states

```text
answered
no_data
unknown
not_my_work
skipped
```

### API routes

```text
POST /api/resume-optimizations/stream
GET  /api/resume-optimizations/{run_id}
GET  /api/resume-optimizations/latest?resume_id={resume_id}
POST /api/resume-optimizations/{run_id}/answers/stream
POST /api/resume-optimizations/{run_id}/apply
POST /api/resume-optimizations/{run_id}/finalize
POST /api/resume-optimizations/{run_id}/revert
POST /api/resume-optimizations/{run_id}/cancel
```

### Stream progress nodes

```text
freeze_snapshot
prepare_context
plan_changes
verify_changes
persist_run
rewrite_answers
```

---

# Phase 0 — Baseline and contract protection

## Task 0: Create an isolated branch and establish a green baseline

**Files:**
- Read: `AGENTS.md`
- Read: `package.json`
- Read: `backend/requirements.txt`
- No product-code changes

- [ ] **Step 1: Create the worktree or isolated branch**

Use the repository’s preferred worktree workflow. Name the branch:

```bash
git switch -c feat/six-dimension-resume-optimization-v1
```

If a worktree is used, create it from the audited main commit and perform all work there.

- [ ] **Step 2: Confirm the audited base**

```bash
git rev-parse HEAD
```

Expected:

```text
bc9cb8c45ec3e96ccb250892e069bbb60e486f56
```

If main has intentionally advanced, record the new base in the plan commit and rerun all baseline tests before editing.

- [ ] **Step 3: Install dependencies**

```bash
npm install
cd backend
pip install -r requirements.txt
cd ..
```

- [ ] **Step 4: Run focused frontend baseline checks**

```bash
node --test \
  tests/resumeEvaluationExecutionStructure.test.mjs \
  tests/resumeEvaluationNormalize.test.mjs \
  tests/resumeEvaluationReport.test.mjs \
  tests/resumeEvaluationSnapshot.test.mjs \
  tests/jdAnalysisDetailsSidebarStructure.test.mjs \
  tests/resumeConfigSaveCoordinator.test.mjs
```

Expected: all pass.

- [ ] **Step 5: Run focused backend baseline checks**

```bash
cd backend
python -m unittest \
  test_ai_service \
  test_resume_evaluation \
  test_runtime_schema \
  test_startup_imports
cd ..
```

Expected: all pass.

- [ ] **Step 6: Run compile baselines**

```bash
npx tsc --noEmit --pretty false
npm run build
```

Expected: both succeed.

- [ ] **Step 7: Record baseline only if a repository note is required**

Do not commit generated logs or caches. If no source change is required, do not create an empty commit.

---

## Task 1: Add the design and implementation documents to the repository

**Files:**
- Create: `docs/superpowers/specs/2026-08-31-six-dimension-resume-optimization-design.md`
- Create: `docs/superpowers/plans/2026-08-31-six-dimension-resume-optimization.md`

- [ ] **Step 1: Copy the approved design document into the spec path**

The spec content must match the companion design artifact, including Gate A/B/C boundaries and exact API contracts.

- [ ] **Step 2: Copy this implementation plan into the plan path**

Keep checkbox syntax intact so Codex can track execution.

- [ ] **Step 3: Verify there are no unresolved markers**

```bash
python - <<'PY'
from pathlib import Path

paths = [
    Path("docs/superpowers/specs/2026-08-31-six-dimension-resume-optimization-design.md"),
    Path("docs/superpowers/plans/2026-08-31-six-dimension-resume-optimization.md"),
]
markers = ["T" + "BD", "FI" + "XME", "PLACE" + "HOLDER", "<" + "fill", "later" + " decide"]
found = [
    (str(path), marker)
    for path in paths
    for marker in markers
    if marker.lower() in path.read_text(encoding="utf-8").lower()
]
if found:
    raise SystemExit(found)
PY
```

Expected: exit code 0.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-08-31-six-dimension-resume-optimization-design.md \
        docs/superpowers/plans/2026-08-31-six-dimension-resume-optimization.md
git commit -m "docs: define six-dimension resume optimization"
```

---

# Phase 1 — Domain contracts and persistence

## Task 2: Define backend schemas and state-transition rules

**Files:**
- Create: `backend/app/domain/resume_optimization/__init__.py`
- Create: `backend/app/domain/resume_optimization/schemas.py`
- Create: `backend/app/domain/resume_optimization/state_machine.py`
- Test: `backend/test_resume_optimization_schemas.py`

- [ ] **Step 1: Write failing enum and schema tests**

Create tests that assert:

```python
OptimizationAction("rewrite_now")
OptimizationScope("general")
OptimizationModuleType("experience_star")
OptimizationAnswerState("no_data")
ResumeOptimizationStatus("planning")
```

Assert invalid values raise validation errors.

Add transition tests for the exact legal transitions in the spec. Explicitly reject:

```text
planning -> completed
awaiting_answers -> applying
preview_ready -> completed
reverted -> applying
```

- [ ] **Step 2: Run the new test and confirm failure**

```bash
cd backend
python -m unittest test_resume_optimization_schemas
```

Expected: import/module failure.

- [ ] **Step 3: Implement enums and shared Pydantic schemas**

Use string enums. Define at minimum:

```python
class OptimizationChange(BaseModel):
    change_id: str
    issue_ids: list[str]
    dimension: str
    module_type: OptimizationModuleType
    module_id: str
    field_path: str
    action_kind: OptimizationAction
    scope: OptimizationScope
    before_value: Any
    general_value: Any | None = None
    targeted_value: Any | None = None
    source_refs: list[str]
    introduced_terms: list[str] = Field(default_factory=list)
    rationale: str
    expected_score_gain: int = Field(default=0, ge=0, le=100)
    default_selected: bool = True
    safety_status: Literal["pending", "allowed", "blocked"] = "pending"
    safety_findings: list[str] = Field(default_factory=list)
```

Also define:

```python
OptimizationQuestionChoice
OptimizationQuestion
OptimizationAnswer
BankSuggestion
OptimizationSafetySummary
OptimizationPlan
ResumeOptimizationRunRead
ResumeOptimizationStartRequest
ResumeOptimizationAnswersRequest
ResumeOptimizationApplyRequest
ResumeOptimizationFinalizeResponse
ResumeOptimizationApplyResponse
```

Validation rules:

- `change_id`, `question_id`, `module_id`, `field_path` non-empty;
- max 5 questions;
- max 3 bank suggestions;
- `source_refs` required for text-changing actions;
- `ask_user` changes may keep values empty until answers;
- order changes must contain arrays of existing IDs;
- answer value may be empty only for non-`answered` states.

- [ ] **Step 4: Implement the state transition helper**

Expose:

```python
def require_status_transition(
    current: ResumeOptimizationStatus,
    target: ResumeOptimizationStatus,
) -> None:
    ...
```

Raise a domain-specific `InvalidOptimizationTransitionError`.

- [ ] **Step 5: Run tests**

```bash
cd backend
python -m unittest test_resume_optimization_schemas
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add backend/app/domain/resume_optimization \
        backend/test_resume_optimization_schemas.py
git commit -m "feat: define resume optimization contracts"
```

---

## Task 3: Add the persistent `resume_optimization_runs` table across every schema path

**Files:**
- Create: `backend/app/domain/resume_optimization/models.py`
- Create: `backend/app/runtime_schema/resume_optimization_tables.py`
- Create: `backend/migrations/020_add_resume_optimization_runs.sql`
- Modify: `backend/schema.sql`
- Modify: `backend/app/database.py`
- Modify: `backend/test_runtime_schema.py`
- Test: `backend/test_resume_optimization_runtime_schema.py`

- [ ] **Step 1: Write failing runtime-schema alignment tests**

Test that the following fragments occur in all three schema authorities:

```text
CREATE TABLE IF NOT EXISTS resume_optimization_runs
source_evaluation_signature TEXT NOT NULL
source_snapshot_hash TEXT NOT NULL
before_snapshot JSONB NOT NULL
plan_json JSONB NOT NULL
accepted_change_ids TEXT[] NOT NULL
idx_resume_optimization_runs_resume_created
uniq_resume_optimization_runs_user_idempotency
```

Test that `database.ensure_runtime_schema()` invokes `ensure_resume_optimization_tables` in a deterministic position after AI token billing tables and before feedback-column repairs.

Test model columns and indexes exist.

- [ ] **Step 2: Run and confirm failure**

```bash
cd backend
python -m unittest \
  test_resume_optimization_runtime_schema \
  test_runtime_schema
```

- [ ] **Step 3: Implement the SQLModel**

Define `ResumeOptimizationRun` with timezone-aware timestamp columns and JSONB columns. Use the exact fields from the spec. Add SQLAlchemy indexes:

```python
Index(
    "idx_resume_optimization_runs_resume_created",
    "resume_id",
    sa_text("created_at DESC"),
)
Index(
    "uniq_resume_optimization_runs_user_idempotency",
    "user_id",
    "idempotency_key_hash",
    unique=True,
    postgresql_where=sa_text("idempotency_key_hash IS NOT NULL"),
)
```

Use `Text`, `DateTime(timezone=True)`, `JSONB`, `ARRAY(Text)`, and `PG_UUID(as_uuid=True)` explicitly.

- [ ] **Step 4: Implement runtime table statements**

Create `RESUME_OPTIMIZATION_TABLE_STATEMENTS` and:

```python
async def execute_resume_optimization_table_statements(
    *,
    execute: ExecuteStatement,
    text: TextFactory,
) -> None:
    ...
```

Include:

- pgcrypto extension;
- table;
- status check;
- JSON object checks;
- 4 MiB per-JSON-column size checks;
- indexes;
- partial idempotency unique index.

- [ ] **Step 5: Add bootstrap SQL and numbered migration**

Copy semantically identical DDL into:

```text
backend/schema.sql
backend/migrations/020_add_resume_optimization_runs.sql
```

The migration must be idempotent.

- [ ] **Step 6: Register runtime schema**

In `backend/app/database.py` add:

```python
async def ensure_resume_optimization_tables() -> None:
    ...
```

Call it from `ensure_runtime_schema()`.

Explicitly import the domain model in `init_db()` so SQLModel metadata registration does not depend on router import order:

```python
from .domain.resume_optimization import models as _resume_optimization_models  # noqa: F401
```

- [ ] **Step 7: Run schema tests**

```bash
cd backend
python -m unittest \
  test_resume_optimization_runtime_schema \
  test_runtime_schema \
  test_startup_imports
```

Expected: pass.

- [ ] **Step 8: Commit**

```bash
git add backend/app/domain/resume_optimization/models.py \
        backend/app/runtime_schema/resume_optimization_tables.py \
        backend/migrations/020_add_resume_optimization_runs.sql \
        backend/schema.sql \
        backend/app/database.py \
        backend/test_runtime_schema.py \
        backend/test_resume_optimization_runtime_schema.py
git commit -m "feat: persist resume optimization runs"
```

---

## Task 4: Implement run persistence, owner isolation, idempotency, and recovery queries

**Files:**
- Create: `backend/app/domain/resume_optimization/run_service.py`
- Test: `backend/test_resume_optimization_run_service.py`

- [ ] **Step 1: Write failing tests**

Cover:

1. create a run owned by user A;
2. get by ID for user A;
3. user B receives not found;
4. latest returns newest run for the requested resume;
5. same user + same idempotency key + same request hash returns existing run;
6. same key + different request hash raises `OptimizationIdempotencyConflictError`;
7. state transition uses the state machine helper;
8. JSON fields are deep-copied rather than shared;
9. `updated_at`, `applied_at`, and `completed_at` are set only in the appropriate states.

Use fake async sessions or repository test patterns; do not require PostgreSQL for unit behavior.

- [ ] **Step 2: Run and confirm failure**

```bash
cd backend
python -m unittest test_resume_optimization_run_service
```

- [ ] **Step 3: Implement canonical hashing**

Expose:

```python
def canonical_json(value: Any) -> str: ...
def hash_canonical_json(value: Any) -> str: ...
def build_idempotency_key_hash(user_id: str, raw_key: str) -> str: ...
def build_start_request_hash(payload: ResumeOptimizationStartRequest) -> str: ...
```

Use UTF-8, sorted keys, compact separators, and SHA-256.

- [ ] **Step 4: Implement persistence functions**

Expose:

```python
async def create_or_load_run(...)
async def get_run_for_user(...)
async def get_latest_run_for_resume(...)
async def update_run_payload(...)
async def transition_run(...)
async def record_run_error(...)
```

Every query includes `user_id`. Use `with_for_update()` for transitions and apply-related updates.

- [ ] **Step 5: Run tests**

```bash
cd backend
python -m unittest test_resume_optimization_run_service
```

- [ ] **Step 6: Commit**

```bash
git add backend/app/domain/resume_optimization/run_service.py \
        backend/test_resume_optimization_run_service.py
git commit -m "feat: add resume optimization run service"
```

---

# Phase 2 — Frozen context and deterministic suggestions

## Task 5: Build and validate the frozen optimization context

**Files:**
- Create: `backend/app/domain/resume_optimization/context_service.py`
- Test: `backend/test_resume_optimization_context.py`
- Read/Reuse: `backend/app/domain/agent/agent_service.py`
- Read/Reuse: `backend/app/domain/resume/resume_service.py`
- Read/Reuse: `backend/app/domain/ai/resume_evaluation_service.py`

- [ ] **Step 1: Write failing context tests**

Create fixtures for:

- current resume with a valid persisted six-dimensional report;
- current selected experience with a shorter resume override and a fuller source version;
- an unselected experience;
- stale evaluation;
- mismatched expected resume timestamp;
- mismatched evaluation signature;
- absent evaluation.

Assert a valid context contains:

```text
current_resume
selected_source_experiences
selected_master_experience_ids
evaluation
target_role
jd_signature
fact_metadata
snapshot_hash
```

Assert:

- selected full source is present;
- unselected full STAR text is absent from model context;
- stale/missing/mismatched reports raise domain errors;
- owner mismatch is not found;
- snapshot hash is deterministic.

- [ ] **Step 2: Run and confirm failure**

```bash
cd backend
python -m unittest test_resume_optimization_context
```

- [ ] **Step 3: Reuse the current full-resume snapshot builder**

Call:

```python
build_resume_analysis_text(
    session,
    user_id,
    resume,
    resume_items=resume_items,
    bank=bank,
    category_by_master_id=category_by_master_id,
    target_role=resume.target_role,
)
```

Parse the returned JSON. Do not duplicate its profile, section-order, candidate-pool, and fact-metadata rules in Gate A.

- [ ] **Step 4: Validate the persisted report**

Read from:

```text
resume.config.jdAnalysis.result.resumeEvaluation
resume.config.jdAnalysis.evaluationSignature
resume.config.jdAnalysis.evaluationIsOutdated
resume.config.jdAnalysis.jdInputSignature
```

Requirements:

- `evaluationVersion == "resume_flow_v1"`;
- `evaluationSignature == request.evaluation_signature`;
- `evaluationIsOutdated is not True`;
- `resume.updated_at == expected_resume_updated_at`.

Raise typed errors that the router can map to 400, 409, or 422.

- [ ] **Step 5: Filter selected source experiences**

Build `selected_source_experiences` keyed by master experience ID. Include:

```json
{
  "id": "...",
  "category": "work",
  "title": "...",
  "org": "...",
  "start_date": "...",
  "end_date": "...",
  "summary": "...",
  "star": {"s": "", "t": "", "a": "", "r": ""},
  "source_version_id": "..."
}
```

Never place an unselected source experience into this map.

- [ ] **Step 6: Build allowed source documents**

Create JSON-pointer-addressable roots:

```text
/currentResume
/selectedSourceExperiences
/userAnswers
```

`userAnswers` is empty during planning.

- [ ] **Step 7: Run tests**

```bash
cd backend
python -m unittest test_resume_optimization_context
```

- [ ] **Step 8: Commit**

```bash
git add backend/app/domain/resume_optimization/context_service.py \
        backend/test_resume_optimization_context.py
git commit -m "feat: freeze resume optimization context"
```

---

## Task 6: Generate bank suggestions without mixing in one-click assembly

**Files:**
- Create: `backend/app/domain/resume_optimization/bank_suggestion_service.py`
- Test: `backend/test_resume_optimization_bank_suggestions.py`

- [ ] **Step 1: Write failing deterministic tests**

Given `experienceMatches` and current selection, assert:

- selected IDs are excluded;
- scores are sorted descending;
- only positive-score entries are eligible;
- maximum is 3;
- tied scores preserve input order;
- title/org/category are resolved from candidate metadata;
- no STAR fields appear in `BankSuggestion`;
- missing metadata is skipped, not invented;
- capability labels are resolved from `capabilityAnalysis.experienceDiagnoses` when available.

- [ ] **Step 2: Run and confirm failure**

```bash
cd backend
python -m unittest test_resume_optimization_bank_suggestions
```

- [ ] **Step 3: Implement**

Expose:

```python
def build_bank_suggestions(
    *,
    analysis_result: dict[str, Any],
    selected_master_ids: set[str],
    bank_experience_metadata: dict[str, dict[str, Any]],
    limit: int = 3,
) -> list[BankSuggestion]:
    ...
```

Do not call an LLM.

- [ ] **Step 4: Run tests**

```bash
cd backend
python -m unittest test_resume_optimization_bank_suggestions
```

- [ ] **Step 5: Commit**

```bash
git add backend/app/domain/resume_optimization/bank_suggestion_service.py \
        backend/test_resume_optimization_bank_suggestions.py
git commit -m "feat: add resume bank optimization suggestions"
```

---

# Phase 3 — Planner and thin safety gate

## Task 7: Add the optimization prompt, strict result normalizer, and planner service

**Files:**
- Create: `backend/app/domain/resume_optimization/prompts.py`
- Create: `backend/app/domain/resume_optimization/normalizers.py`
- Create: `backend/app/domain/resume_optimization/planner_service.py`
- Test: `backend/test_resume_optimization_planner.py`
- Read/Reuse: `backend/app/domain/ai/llm_transport.py`
- Read/Reuse: `backend/app/domain/ai/runtime_budget.py`

- [ ] **Step 1: Write failing normalizer tests**

Test malformed model results:

- non-object root;
- duplicate `changeId`;
- unknown `issueId`;
- more than 5 questions;
- change that modifies selection;
- unsupported module type;
- text change with empty `sourceRefs`;
- a bank suggestion returned by the model;
- `ask_user` question referring to another project;
- oversized strings;
- order arrays containing new IDs.

Expected: invalid entries are rejected or normalized according to one documented rule; the normalizer never silently converts an unsafe action into a valid rewrite.

- [ ] **Step 2: Write prompt contract tests**

Static assertions must find all of these ideas in the system prompt:

```text
only current assembled resume is modified
selected full source versions may supplement the same experience
unselected experiences cannot support a rewrite
do not invent numbers, tools, methods, ownership, causality, courses, or skills
rewrite_now / ask_user / leave_unchanged
maximum five questions
no_data is valid
generalValue and targetedValue
each change references issue IDs and sourceRefs
```

- [ ] **Step 3: Run and confirm failure**

```bash
cd backend
python -m unittest test_resume_optimization_planner
```

- [ ] **Step 4: Implement the system prompt**

The prompt must:

1. Treat the six-dimensional report as the optimization instruction source.
2. Preserve issue IDs.
3. Route each issue to one action.
4. Generate both `generalValue` and `targetedValue` when a safe distinction exists.
5. Keep values equal when JD specialization provides no truthful benefit.
6. Never generate bank suggestions.
7. Ask only about the current selected experience/module.
8. Accept an empty question list.
9. Keep educational and certification content unchanged in Gate A.
10. Reorder only existing skill and section IDs.

- [ ] **Step 5: Implement strict normalizers**

Expose:

```python
def normalize_optimization_plan(
    raw: Any,
    *,
    known_issue_ids: set[str],
    selected_master_ids: set[str],
    selected_skill_ids: set[str],
    current_section_order: list[str],
) -> OptimizationPlan:
    ...
```

Generate stable IDs server-side when the model omits an ID only if the entry itself is otherwise valid. Reject duplicates.

- [ ] **Step 6: Implement planner calls**

Expose:

```python
@ai_wall_clock_limited
async def plan_resume_optimization(
    context: FrozenOptimizationContext,
) -> OptimizationPlan:
    ...
```

Call `_call_llm(..., json_mode=True, request_label="resume_optimization_plan")`.

The user payload includes:

- current resume;
- selected source experiences;
- six-dimensional evaluation;
- target role/JD summary;
- allowed source-root description;
- no unselected full experience content.

- [ ] **Step 7: Implement answer rewrite call**

Expose:

```python
@ai_wall_clock_limited
async def rewrite_answered_modules(
    *,
    context: FrozenOptimizationContext,
    existing_plan: OptimizationPlan,
    answers: list[OptimizationAnswer],
) -> list[OptimizationChange]:
    ...
```

Only include affected module IDs and affected change IDs. Use request label `resume_optimization_answer`.

- [ ] **Step 8: Run tests**

```bash
cd backend
python -m unittest test_resume_optimization_planner
```

- [ ] **Step 9: Commit**

```bash
git add backend/app/domain/resume_optimization/prompts.py \
        backend/app/domain/resume_optimization/normalizers.py \
        backend/app/domain/resume_optimization/planner_service.py \
        backend/test_resume_optimization_planner.py
git commit -m "feat: plan evidence-aware resume improvements"
```

---

## Task 8: Implement deterministic safety checks

**Files:**
- Create: `backend/app/domain/resume_optimization/safety.py`
- Test: `backend/test_resume_optimization_safety.py`

- [ ] **Step 1: Write the full safety test matrix first**

Required cases:

| Source | Candidate | Expected |
|---|---|---|
| `参与支付页面改版` | `主导支付系统重构` | blocked responsibility upgrade |
| `项目上线后转化率提高` | `通过我的优化使转化率提高` | blocked causality upgrade |
| no number | `提升 30%` | blocked new number |
| `完成 3 次迭代` | `效率提升 30%` | blocked metric substitution |
| `使用 React 开发表单` | `使用 React 开发表单` | allowed |
| `项目采用 React` | `熟练使用 React 独立开发` | blocked ownership/skill upgrade |
| no `A/B测试` | add `A/B测试` | blocked introduced method |
| user answer contains `30%` | add `提升 30%` | allowed when same metric context |
| answer `no_data` | qualitative result only | allowed |
| invalid source pointer | any rewrite | blocked |
| selected source version contains fact | current resume restores same fact | allowed |
| unselected bank item contains fact | current resume adopts fact | blocked |

- [ ] **Step 2: Run and confirm failure**

```bash
cd backend
python -m unittest test_resume_optimization_safety
```

- [ ] **Step 3: Implement source resolution**

Support JSON Pointer paths under:

```text
/currentResume
/selectedSourceExperiences
/userAnswers
```

Expose:

```python
def resolve_source_ref(documents: Mapping[str, Any], source_ref: str) -> Any:
    ...
```

Reject parent traversal, malformed escaping, unknown roots, and non-existent paths.

- [ ] **Step 4: Implement numeric extraction**

Normalize:

- Arabic and full-width digits;
- `%` and `％`;
- decimal values;
- common units such as 人、次、轮、页、项、家、小时、天、周、月、年、元、万、亿、用户、订单；
- time pairs such as `4分钟` and `2.5分钟`.

Require matching value and unit in allowed sources. For business results, require nearby matching metric text when the source has one.

- [ ] **Step 5: Implement responsibility and causality ranks**

Expose pure functions:

```python
def responsibility_rank(text: str) -> int: ...
def causality_rank(text: str) -> int: ...
```

Use conservative highest-signal matching. If the candidate rank exceeds the highest source rank, block.

- [ ] **Step 6: Implement introduced-term checks**

Maintain a protected term set including at minimum:

```text
A/B测试
用户画像
竞品分析
漏斗分析
MVP
PRD
SQL
Python
React
Vue
Next.js
Tableau
Power BI
Figma
Axure
用户调研
需求优先级
转化率
留存率
GMV
ROI
```

Also extract ASCII technical tokens and CamelCase terms. Every newly introduced protected term must exist in an allowed source.

- [ ] **Step 7: Implement per-change verification**

Expose:

```python
def verify_plan_changes(
    *,
    plan: OptimizationPlan,
    source_documents: Mapping[str, Any],
) -> tuple[list[OptimizationChange], OptimizationSafetySummary]:
    ...
```

For blocked changes:

- retain original `before_value`;
- set `general_value` and `targeted_value` to `before_value`;
- set `default_selected=False`;
- include human-readable findings.

- [ ] **Step 8: Run tests**

```bash
cd backend
python -m unittest test_resume_optimization_safety
```

- [ ] **Step 9: Commit**

```bash
git add backend/app/domain/resume_optimization/safety.py \
        backend/test_resume_optimization_safety.py
git commit -m "feat: enforce resume optimization safety policy"
```

---

# Phase 4 — Orchestration and API

## Task 9: Orchestrate planning and answer flows

**Files:**
- Create: `backend/app/domain/resume_optimization/orchestrator.py`
- Test: `backend/test_resume_optimization_orchestrator.py`
- Modify: `backend/app/domain/resume_optimization/run_service.py`

- [ ] **Step 1: Write failing orchestration tests**

Mock the planner and assert:

1. valid no-question plan results in `preview_ready`;
2. plan with questions results in `awaiting_answers`;
3. blocked changes remain in the result for UI explanation;
4. bank suggestions are added after model planning;
5. an exception records `failed` plus safe public error metadata;
6. context becoming stale before persistence records `stale`;
7. submitted answers only replace affected changes;
8. unanswered questions remain unresolved;
9. `no_data` and `not_my_work` do not invoke a second rewrite for unrelated modules.

- [ ] **Step 2: Run and confirm failure**

```bash
cd backend
python -m unittest test_resume_optimization_orchestrator
```

- [ ] **Step 3: Implement planning orchestration**

Expose:

```python
async def create_optimization_plan(
    *,
    session: AsyncSession,
    user_id: str,
    payload: ResumeOptimizationStartRequest,
    idempotency_key: str | None,
    progress_callback: ProgressCallback = None,
) -> ResumeOptimizationRun:
    ...
```

Sequence:

```text
freeze_snapshot
prepare_context
plan_changes
verify_changes
persist_run
```

At every boundary, preserve request ID and terminal AI runtime errors.

- [ ] **Step 4: Implement answer orchestration**

Expose:

```python
async def answer_optimization_questions(
    *,
    session: AsyncSession,
    user_id: str,
    run_id: str,
    payload: ResumeOptimizationAnswersRequest,
    progress_callback: ProgressCallback = None,
) -> ResumeOptimizationRun:
    ...
```

Validate run status, answer every submitted question once, augment `/userAnswers`, rewrite affected modules, rerun safety, and transition to `preview_ready`.

- [ ] **Step 5: Run tests**

```bash
cd backend
python -m unittest test_resume_optimization_orchestrator
```

- [ ] **Step 6: Commit**

```bash
git add backend/app/domain/resume_optimization/orchestrator.py \
        backend/app/domain/resume_optimization/run_service.py \
        backend/test_resume_optimization_orchestrator.py
git commit -m "feat: orchestrate resume optimization runs"
```

---

## Task 10: Add streaming and recovery API routes with billing

**Files:**
- Create: `backend/app/domain/resume_optimization/router.py`
- Modify: `backend/app/main.py`
- Test: `backend/test_resume_optimization_router.py`
- Test: `backend/test_startup_imports.py`

- [ ] **Step 1: Write failing route tests**

Cover:

- auth required;
- owner isolation;
- missing/invalid Idempotency-Key behavior;
- valid planning stream event order;
- valid answer stream event order;
- GET run;
- GET latest;
- cancel planning/awaiting/preview states;
- cancel rejected after apply;
- stale report maps to 409 or 422 with stable public code;
- quota exhausted maps to existing 402 contract;
- terminal runtime errors preserve current public error policy;
- client disconnect cancels producer and releases request lease.

- [ ] **Step 2: Run and confirm failure**

```bash
cd backend
python -m unittest \
  test_resume_optimization_router \
  test_startup_imports
```

- [ ] **Step 3: Implement router**

Use:

```python
router = APIRouter(
    prefix="/api/resume-optimizations",
    tags=["resume-optimization"],
    route_class=BoundedAiRequestBodyRoute,
)
```

For planning:

```python
request_lease = await billing_service.begin_ai_request(
    session,
    current_user.id,
    entrypoint="resume_optimization_plan",
)
```

Wrap the model call in:

```python
billing_service.ai_billing_context(
    session,
    current_user.id,
    entrypoint="resume_optimization_plan",
    metadata={"route": "/api/resume-optimizations/stream"},
    request_lease=request_lease,
    release_request_lease_on_exit=False,
)
```

Use `create_bounded_event_queue`, `finish_event_queue`, `new_ai_request_id`, and NDJSON.

Repeat with `entrypoint="resume_optimization_answer"` for answers.

- [ ] **Step 4: Implement read and cancel routes**

Read routes do not enter billing context. Cancel uses a locked state transition and never calls a model.

- [ ] **Step 5: Register router**

In `backend/app/main.py`:

```python
from .domain.resume_optimization.router import router as resume_optimization_router
...
app.include_router(resume_optimization_router)
```

- [ ] **Step 6: Run tests**

```bash
cd backend
python -m unittest \
  test_resume_optimization_router \
  test_startup_imports \
  test_ai_public_errors \
  test_ai_runtime_budget
```

- [ ] **Step 7: Commit**

```bash
git add backend/app/domain/resume_optimization/router.py \
        backend/app/main.py \
        backend/test_resume_optimization_router.py \
        backend/test_startup_imports.py
git commit -m "feat: expose resume optimization API"
```

---

# Phase 5 — Transactional apply, finalize, and revert

## Task 11: Implement transactional application to current-resume overrides and config

**Files:**
- Create: `backend/app/domain/resume_optimization/apply_service.py`
- Test: `backend/test_resume_optimization_apply.py`
- Read/Reuse: `backend/app/domain/resume/resume_service.py`
- Read/Reuse: `backend/app/constants.py`

- [ ] **Step 1: Write failing apply tests**

Required cases:

1. accepted experience changes merge into `overrides_json.star`;
2. unaccepted changes leave values untouched;
3. blocked changes cannot be accepted;
4. summary change writes `config.personalSummary`;
5. skill order only reorders existing selected skill IDs;
6. section order only reorders existing section IDs;
7. selected IDs are unchanged;
8. master experience/version rows are unchanged;
9. stale `expected_resume_updated_at` raises conflict;
10. changed source experience version makes run stale;
11. analysis and evaluation are marked outdated;
12. run transitions `preview_ready -> applying -> applied`;
13. after snapshot and applied content signature are recorded;
14. an exception rolls back resume and run together;
15. a second apply is rejected.

Use an isolated PostgreSQL integration test when `RUN_RESUME_OPTIMIZATION_POSTGRES_TESTS=1`; keep pure patch-building logic covered without PostgreSQL by default.

- [ ] **Step 2: Run and confirm failure**

```bash
cd backend
python -m unittest test_resume_optimization_apply
```

- [ ] **Step 3: Implement pure patch construction**

Expose:

```python
def build_apply_patch(
    *,
    run: ResumeOptimizationRun,
    accepted_change_ids: set[str],
    current_resume_config: dict[str, Any],
    current_link_overrides: dict[str, dict[str, Any]],
) -> OptimizationApplyPatch:
    ...
```

The patch contains:

```text
experience_star_by_link_id
next_resume_config
applied_change_ids
```

Reject:

- unknown ID;
- blocked change;
- duplicate field-path conflict;
- change that would add/remove selection;
- arbitrary config path.

- [ ] **Step 4: Implement transaction**

In one database transaction:

1. lock Run;
2. lock Resume;
3. validate owner and status;
4. compare `updated_at`;
5. validate frozen experience version IDs;
6. lock affected `ResumeExperienceLink` rows;
7. write STAR overrides;
8. write allowed config changes;
9. set both analysis stale flags;
10. update resume timestamp;
11. save after snapshot/signature;
12. set Run `applied`.

Do not call the public `update_assembly()` function because it commits independently. Reuse constants and normalization logic, but keep this mutation atomic.

- [ ] **Step 5: Run tests**

```bash
cd backend
python -m unittest \
  test_resume_optimization_apply \
  test_agent_generation_postgres
```

The second command may skip database-specific cases when its environment flag is absent; it must not regress.

- [ ] **Step 6: Commit**

```bash
git add backend/app/domain/resume_optimization/apply_service.py \
        backend/test_resume_optimization_apply.py
git commit -m "feat: apply resume optimization transactionally"
```

---

## Task 12: Implement post-evaluation finalization and safe revert

**Files:**
- Modify: `backend/app/domain/resume_optimization/apply_service.py`
- Modify: `backend/app/domain/resume_optimization/router.py`
- Modify: `backend/app/domain/resume_optimization/schemas.py`
- Test: `backend/test_resume_optimization_finalize.py`

- [ ] **Step 1: Write failing finalize tests**

Assert:

- applied run can enter `rescoring`;
- finalize reads the current persisted report from server-side resume config;
- report must have a non-stale evaluation signature matching the applied snapshot;
- finalization stores before score, after score, per-dimension deltas, issue counts, and safety summary;
- finalization transitions to `completed`;
- evaluation missing or stale leaves run `applied`, enabling retry;
- completed run can be read after reload.

- [ ] **Step 2: Write failing revert tests**

Assert:

- `applied` and `completed` may revert;
- revert only succeeds if current content signature equals `applied_content_signature`;
- revert restores exact frozen before overrides/config for touched fields;
- revert marks JD analysis and evaluation stale;
- later manual edit causes 409 and no overwrite;
- run becomes `reverted`;
- a reverted run cannot apply again.

- [ ] **Step 3: Run and confirm failure**

```bash
cd backend
python -m unittest test_resume_optimization_finalize
```

- [ ] **Step 4: Implement finalize**

Expose:

```python
async def finalize_run_from_persisted_evaluation(...)
```

Do not accept the evaluation object from the client. The client only supplies expected resume timestamp/run ID. Read the report from `Resume.config`.

- [ ] **Step 5: Implement revert**

Use the same locking and optimistic-concurrency pattern as apply. Restore only fields this Run changed.

- [ ] **Step 6: Add API handlers**

Add `/apply`, `/finalize`, and `/revert` routes and stable public error mapping.

- [ ] **Step 7: Run tests**

```bash
cd backend
python -m unittest \
  test_resume_optimization_finalize \
  test_resume_optimization_router
```

- [ ] **Step 8: Commit**

```bash
git add backend/app/domain/resume_optimization/apply_service.py \
        backend/app/domain/resume_optimization/router.py \
        backend/app/domain/resume_optimization/schemas.py \
        backend/test_resume_optimization_finalize.py
git commit -m "feat: finalize and revert resume optimization"
```

---

# Phase 6 — Frontend contracts and state machine

## Task 13: Add frontend types, stream service, and response guards

**Files:**
- Create: `types/resumeOptimization.ts`
- Create: `services/resumeOptimizationService.ts`
- Create: `utils/resumeOptimizationNormalize.mjs`
- Test: `tests/resumeOptimizationNormalize.test.mjs`
- Test: `tests/resumeOptimizationServiceStructure.test.mjs`
- Read/Reuse: `services/aiStreamUtils.ts`
- Read/Reuse: `services/resumeService.ts`

- [ ] **Step 1: Write failing normalizer tests**

Cover:

- unknown status;
- malformed changes;
- blocked change preservation;
- missing arrays default safely;
- maximum displayed questions and suggestions;
- before/after score parsing;
- dimension delta parsing;
- duplicated IDs rejected;
- source refs kept for display but never rendered as raw internal paths by default.

- [ ] **Step 2: Write service structure tests**

Assert the service:

- calls exact API paths;
- uses `postStreamRequest`;
- forwards `AbortSignal`;
- supports `expectedAuthCacheKey`;
- sends `Idempotency-Key`;
- exposes `start`, `answer`, `get`, `getLatest`, `apply`, `finalize`, `revert`, and `cancel`;
- never calls `resumeService.update` to apply a server Run.

- [ ] **Step 3: Run and confirm failure**

```bash
node --test \
  tests/resumeOptimizationNormalize.test.mjs \
  tests/resumeOptimizationServiceStructure.test.mjs
```

- [ ] **Step 4: Implement TypeScript types**

Mirror backend contracts with discriminated unions where useful. Include:

```typescript
export type ResumeOptimizationUiState =
  | 'closed'
  | 'starting'
  | 'awaiting_answers'
  | 'answering'
  | 'preview'
  | 'applying'
  | 'rescoring'
  | 'completed'
  | 'error'
  | 'stale';
```

- [ ] **Step 5: Implement service**

Use the current stream parser. Generate a UUID idempotency key once per user click and retain it across a retry of the same start request.

- [ ] **Step 6: Run tests and typecheck**

```bash
node --test \
  tests/resumeOptimizationNormalize.test.mjs \
  tests/resumeOptimizationServiceStructure.test.mjs
npx tsc --noEmit --pretty false
```

- [ ] **Step 7: Commit**

```bash
git add types/resumeOptimization.ts \
        services/resumeOptimizationService.ts \
        utils/resumeOptimizationNormalize.mjs \
        tests/resumeOptimizationNormalize.test.mjs \
        tests/resumeOptimizationServiceStructure.test.mjs
git commit -m "feat: add resume optimization client contracts"
```

---

## Task 14: Implement the frontend flow hook and reload recovery

**Files:**
- Create: `views/ResumeEditor/hooks/useResumeOptimizationFlow.ts`
- Test: `tests/resumeOptimizationFlowStructure.test.mjs`
- Modify: `views/ResumeEditor/index.tsx`
- Read/Reuse: `hooks/useAuthOwnerOperationGuard.ts`
- Read/Reuse: `hooks/useResumeEvaluation.ts`
- Read/Reuse: `hooks/useResumeData.ts`

- [ ] **Step 1: Write failing hook structure tests**

Assert the hook:

- owns an AbortController and run ID;
- uses `useAuthOwnerOperationGuard`;
- aborts on auth user, resume ID, evaluation signature, or source timestamp change;
- loads `getLatest(resumeId)` when the editor hydrates;
- does not reopen terminal completed/cancelled/reverted Runs automatically;
- prevents start while evaluation, polish, auto-assembly, or apply is active;
- exposes progress text, current Run, answer drafts, accepted change IDs, error, and all actions;
- calls `reloadResumeContext(resumeId)` after apply/revert;
- calls the existing `generateEvaluation()` exactly once after successful apply;
- calls finalize only after `generateEvaluation()` returns success;
- leaves state at applied/error with a rescore retry action when evaluation fails.

- [ ] **Step 2: Run and confirm failure**

```bash
node --test tests/resumeOptimizationFlowStructure.test.mjs
```

- [ ] **Step 3: Implement the hook API**

Return:

```typescript
{
  uiState,
  run,
  progressText,
  error,
  answerDrafts,
  acceptedChangeIds,
  canStart,
  disabledReason,
  startOptimization,
  setAnswer,
  submitAnswers,
  toggleChange,
  applyAcceptedChanges,
  retryRescore,
  revertRun,
  cancelRun,
  closeWorkspace,
  reopenLatestRun,
}
```

- [ ] **Step 4: Enforce state invariants**

- accepted IDs initialize from allowed `defaultSelected` changes;
- blocked changes can never become accepted;
- changing an answer after answer submission requires starting a new Run, not mutating history;
- closing the workspace does not cancel `preview_ready`;
- closing during active stream prompts confirmation and cancels only when confirmed;
- switching resume aborts and clears the visible Run.

- [ ] **Step 5: Wire into `ResumeEditor/index.tsx`**

Pass:

- `resumeId`;
- `resumeDetail?.resume.updated_at`;
- persisted evaluation signature;
- current evaluation;
- JD text;
- current busy states;
- `reloadResumeContext`;
- `generateEvaluation`;
- toast API.

Do not place orchestration logic directly in `index.tsx`.

- [ ] **Step 6: Run tests and typecheck**

```bash
node --test tests/resumeOptimizationFlowStructure.test.mjs
npx tsc --noEmit --pretty false
```

- [ ] **Step 7: Commit**

```bash
git add views/ResumeEditor/hooks/useResumeOptimizationFlow.ts \
        views/ResumeEditor/index.tsx \
        tests/resumeOptimizationFlowStructure.test.mjs
git commit -m "feat: orchestrate resume optimization UI flow"
```

---

# Phase 7 — Visual implementation

## Task 15: Add the report CTA and feature flags

**Files:**
- Modify: `views/ResumeEditor/components/ResumeEvaluationReport/ResumeEvaluationReport.tsx`
- Modify: `views/ResumeEditor/components/JDAnalysisPanel.tsx`
- Modify: `views/ResumeEditor/index.tsx`
- Modify: `.env.example`
- Modify: `backend/.env.example`
- Modify: `backend/app/config.py`
- Modify: `vite-env.d.ts`
- Test: `tests/resumeOptimizationEntryStructure.test.mjs`
- Test: `backend/test_resume_optimization_config.py`

- [ ] **Step 1: Write failing frontend entry tests**

Assert:

- valid report contains button text `根据报告优化`;
- `Wand2` icon is used;
- callback prop is threaded through report, details content, sidebar/modal, and editor;
- button is disabled when report is outdated or optimization is busy;
- disabled reason is visible;
- feature flag hides the CTA;
- “重新生成六维报告” remains available and unchanged.

- [ ] **Step 2: Write failing backend config tests**

Add:

```text
ENABLE_RESUME_OPTIMIZATION
RESUME_OPTIMIZATION_MAX_QUESTIONS
RESUME_OPTIMIZATION_MAX_BANK_SUGGESTIONS
```

Defaults:

```text
false
5
3
```

Validate bounded ranges:

```text
questions: 0..5
suggestions: 0..3
```

- [ ] **Step 3: Run and confirm failure**

```bash
node --test tests/resumeOptimizationEntryStructure.test.mjs
cd backend
python -m unittest test_resume_optimization_config
cd ..
```

- [ ] **Step 4: Implement feature flags**

Frontend:

```text
VITE_ENABLE_RESUME_OPTIMIZATION=false
```

Backend:

```text
ENABLE_RESUME_OPTIMIZATION=false
RESUME_OPTIMIZATION_MAX_QUESTIONS=5
RESUME_OPTIMIZATION_MAX_BANK_SUGGESTIONS=3
```

Backend routes return 404 or a stable disabled error while disabled. Prefer 404 to avoid exposing an unreleased capability.

- [ ] **Step 5: Implement CTA styling**

Inside the valid report summary card, add a primary button:

```text
inline-flex items-center justify-center gap-1.5
rounded-lg
bg-emerald-600
px-3 py-2
text-[11px] font-bold text-white
shadow-sm
hover:bg-emerald-700
focus-visible:ring-2 focus-visible:ring-emerald-500
disabled:opacity-50
```

Keep the report’s existing visual language.

- [ ] **Step 6: Run tests**

```bash
node --test \
  tests/resumeOptimizationEntryStructure.test.mjs \
  tests/resumeEvaluationReport.test.mjs \
  tests/jdAnalysisDetailsSidebarStructure.test.mjs
cd backend
python -m unittest test_resume_optimization_config
cd ..
npx tsc --noEmit --pretty false
```

- [ ] **Step 7: Commit**

```bash
git add views/ResumeEditor/components/ResumeEvaluationReport/ResumeEvaluationReport.tsx \
        views/ResumeEditor/components/JDAnalysisPanel.tsx \
        views/ResumeEditor/index.tsx \
        .env.example \
        backend/.env.example \
        backend/app/config.py \
        tests/resumeOptimizationEntryStructure.test.mjs \
        backend/test_resume_optimization_config.py
git commit -m "feat: add six-dimension optimization entry"
```

---

## Task 16: Build the accessible optimization workspace shell

**Files:**
- Create: `views/ResumeEditor/components/ResumeOptimization/ResumeOptimizationWorkspace.tsx`
- Create: `views/ResumeEditor/components/ResumeOptimization/ResumeOptimizationStepRail.tsx`
- Create: `views/ResumeEditor/components/ResumeOptimization/ResumeOptimizationProgress.tsx`
- Test: `tests/resumeOptimizationWorkspaceStructure.test.mjs`
- Modify: `views/ResumeEditor/index.tsx`

- [ ] **Step 1: Write failing structure tests**

Assert:

- `role="dialog"` and `aria-modal="true"`;
- labelled heading;
- `fixed inset-0 z-[100]`;
- desktop `max-w-6xl`;
- responsive mobile full-screen behavior;
- desktop step rail and mobile step chips;
- sticky footer;
- Escape handler;
- close button;
- `aria-live="polite"` progress region;
- reduced-motion classes or media support;
- no low-level source path appears in the shell.

- [ ] **Step 2: Run and confirm failure**

```bash
node --test tests/resumeOptimizationWorkspaceStructure.test.mjs
```

- [ ] **Step 3: Implement shell**

Desktop structure:

```text
backdrop
  dialog container
    header
    body
      step rail
      active content
    sticky footer
```

Mobile:

```text
full-height
header
horizontal steps
scrolling content
sticky footer
```

- [ ] **Step 4: Implement focus management**

- save active element on open;
- focus the dialog heading;
- trap Tab within the dialog;
- restore focus on close;
- disable Escape during `applying`;
- request confirmation during active planning/answer streams.

- [ ] **Step 5: Add loading/progress view**

Map nodes to Chinese titles:

```text
freeze_snapshot -> 冻结当前简历版本
prepare_context -> 整理六维问题与经历信息
plan_changes -> 生成优化方案
verify_changes -> 检查事实边界
persist_run -> 保存优化方案
rewrite_answers -> 根据补充信息更新方案
```

- [ ] **Step 6: Wire shell to the hook**

Render when `uiState !== "closed"` or when the user explicitly reopens a recoverable Run.

- [ ] **Step 7: Run tests and typecheck**

```bash
node --test tests/resumeOptimizationWorkspaceStructure.test.mjs
npx tsc --noEmit --pretty false
```

- [ ] **Step 8: Commit**

```bash
git add views/ResumeEditor/components/ResumeOptimization \
        views/ResumeEditor/index.tsx \
        tests/resumeOptimizationWorkspaceStructure.test.mjs
git commit -m "feat: build resume optimization workspace"
```

---

## Task 17: Implement the overview and evidence-question step

**Files:**
- Create: `views/ResumeEditor/components/ResumeOptimization/ResumeOptimizationOverview.tsx`
- Create: `views/ResumeEditor/components/ResumeOptimization/ResumeOptimizationQuestions.tsx`
- Create: `views/ResumeEditor/components/ResumeOptimization/ResumeOptimizationQuestionCard.tsx`
- Create: `views/ResumeEditor/components/ResumeOptimization/optimizationDisplayUtils.mjs`
- Test: `tests/resumeOptimizationQuestions.test.mjs`
- Test: `tests/resumeOptimizationDisplayUtils.test.mjs`

- [ ] **Step 1: Write failing display utility tests**

Test:

- counts for direct changes, questions, blocked changes, and bank opportunities;
- expected gain sorting;
- dimension label mapping;
- answer completeness;
- non-`answered` states may submit without text;
- `answered` requires non-empty text;
- no internal source pointer is shown as user copy.

- [ ] **Step 2: Write failing component structure tests**

Assert question cards render:

```text
为什么需要补充
明确回答
没有数据
记不清
不属于我的工作
跳过
```

Assert maximum 5 cards, accessible radio/textarea labels, and disabled submit until every question has a valid state.

- [ ] **Step 3: Run and confirm failure**

```bash
node --test \
  tests/resumeOptimizationQuestions.test.mjs \
  tests/resumeOptimizationDisplayUtils.test.mjs
```

- [ ] **Step 4: Implement overview**

Display four metric cards:

- 可直接优化；
- 需要确认；
- 安全阻断；
- 经历库机会。

Below, list priorities sorted by expected gain, with dimension and module names.

- [ ] **Step 5: Implement questions**

Use one-page form, not chat. Each card supports choices plus optional text. Persist answer drafts locally until submission.

- [ ] **Step 6: Implement no-question skip**

If `questions.length === 0`, the workspace must move directly from overview to preview without rendering an empty step.

- [ ] **Step 7: Run tests and typecheck**

```bash
node --test \
  tests/resumeOptimizationQuestions.test.mjs \
  tests/resumeOptimizationDisplayUtils.test.mjs
npx tsc --noEmit --pretty false
```

- [ ] **Step 8: Commit**

```bash
git add views/ResumeEditor/components/ResumeOptimization \
        tests/resumeOptimizationQuestions.test.mjs \
        tests/resumeOptimizationDisplayUtils.test.mjs
git commit -m "feat: collect truthful resume evidence"
```

---

## Task 18: Implement Diff preview and bank-suggestion presentation

**Files:**
- Create: `views/ResumeEditor/components/ResumeOptimization/ResumeOptimizationPreview.tsx`
- Create: `views/ResumeEditor/components/ResumeOptimization/ResumeOptimizationDiffCard.tsx`
- Create: `views/ResumeEditor/components/ResumeOptimization/ResumeOptimizationBankSuggestions.tsx`
- Test: `tests/resumeOptimizationPreviewStructure.test.mjs`

- [ ] **Step 1: Write failing preview tests**

Assert:

- before and after are visually separated;
- every change has a checkbox or “保留原文” control;
- blocked changes cannot be selected;
- labels render `通用优化`, `JD定向`, `来自补充信息`, `从总经历补回`, `安全阻断`;
- rationale and safe human-readable source labels render;
- bank suggestions have no apply checkbox;
- bank buttons call `onViewExperience` and `onOpenAutoAssembly`;
- desktop two-column Diff becomes vertical on mobile;
- order-change previews show list order rather than raw JSON.

- [ ] **Step 2: Run and confirm failure**

```bash
node --test tests/resumeOptimizationPreviewStructure.test.mjs
```

- [ ] **Step 3: Implement Diff cards**

Style:

- outer `rounded-xl border`;
- before panel: slate background;
- after panel: emerald background;
- blocked panel: rose border/background;
- source/reuse tags as compact pills;
- no raw JSON or source pointer.

For rich text, reuse safe existing rendering utilities. Do not use `dangerouslySetInnerHTML`.

- [ ] **Step 4: Implement order previews**

For `skills_order` and `section_order`, show:

```text
修改前：A → B → C
修改后：B → A → C
```

- [ ] **Step 5: Implement bank suggestions**

Use indigo tone and separate heading `经历库可补强素材`. Never include them in accepted change IDs.

- [ ] **Step 6: Wire navigation callbacks**

`查看经历` closes or minimizes the workspace and uses the existing experience-focus request.

`前往一键组装` closes the workspace and invokes the existing auto-assembly UI/action; it does not run automatically.

- [ ] **Step 7: Run tests and typecheck**

```bash
node --test tests/resumeOptimizationPreviewStructure.test.mjs
npx tsc --noEmit --pretty false
```

- [ ] **Step 8: Commit**

```bash
git add views/ResumeEditor/components/ResumeOptimization \
        tests/resumeOptimizationPreviewStructure.test.mjs
git commit -m "feat: preview six-dimension resume changes"
```

---

## Task 19: Implement apply, post-score result, retry, and revert UI

**Files:**
- Create: `views/ResumeEditor/components/ResumeOptimization/ResumeOptimizationResult.tsx`
- Create: `views/ResumeEditor/components/ResumeOptimization/ResumeOptimizationScoreDelta.tsx`
- Modify: `views/ResumeEditor/components/ResumeOptimization/ResumeOptimizationWorkspace.tsx`
- Modify: `views/ResumeEditor/hooks/useResumeOptimizationFlow.ts`
- Test: `tests/resumeOptimizationResultStructure.test.mjs`
- Test: `tests/resumeOptimizationPostScoreFlow.test.mjs`

- [ ] **Step 1: Write failing result tests**

Assert result displays:

- before score;
- after score when complete;
- delta;
- six dimension deltas;
- accepted count;
- blocked count;
- unresolved fact gaps;
- bank opportunity count;
- retry evaluation button when run remains `applied`;
- revert button only for `applied` or `completed`;
- “内容已应用，评分尚未完成” when post-score fails;
- predicted score is never rendered as final.

- [ ] **Step 2: Write failing flow tests**

Assert:

1. apply sends only accepted allowed IDs;
2. successful apply calls `reloadResumeContext`;
3. exactly one `generateEvaluation()` follows;
4. successful evaluation calls finalize;
5. evaluation error does not call revert;
6. retry calls evaluation again, then finalize;
7. successful revert reloads resume and closes result;
8. 409 sets stale UI and preserves current user content.

- [ ] **Step 3: Run and confirm failure**

```bash
node --test \
  tests/resumeOptimizationResultStructure.test.mjs \
  tests/resumeOptimizationPostScoreFlow.test.mjs
```

- [ ] **Step 4: Implement apply confirmation**

Before apply, show:

```text
将把 N 项修改应用到当前简历。不会改动总经历库，也不会更换已选内容。
```

Disable apply when zero changes are accepted.

- [ ] **Step 5: Implement score result**

Use compact bars or cards rather than another oversized radar. Keep current report colors:

- positive delta: emerald;
- unchanged: slate;
- negative delta: amber, not celebratory red unless it is an error.

- [ ] **Step 6: Implement retry and revert**

Surface server conflict messages clearly. Revert confirmation must state it works only before subsequent manual edits.

- [ ] **Step 7: Run tests, typecheck, and build**

```bash
node --test \
  tests/resumeOptimizationResultStructure.test.mjs \
  tests/resumeOptimizationPostScoreFlow.test.mjs
npx tsc --noEmit --pretty false
npm run build
```

- [ ] **Step 8: Commit**

```bash
git add views/ResumeEditor/components/ResumeOptimization \
        views/ResumeEditor/hooks/useResumeOptimizationFlow.ts \
        tests/resumeOptimizationResultStructure.test.mjs \
        tests/resumeOptimizationPostScoreFlow.test.mjs
git commit -m "feat: complete resume optimization result flow"
```

---

# Phase 8 — Commercial telemetry, hardening, and Gate A release

## Task 20: Add analytics and billing metadata without introducing a fixed SKU

**Files:**
- Modify: `utils/analyticsTracker.ts`
- Modify: frontend optimization components/hook
- Modify: backend planning/answer billing metadata
- Test: `tests/resumeOptimizationAnalytics.test.mjs`
- Test: `backend/test_resume_optimization_billing.py`

- [ ] **Step 1: Write failing analytics tests**

Require these event functions:

```text
trackResumeOptimizationCtaView
trackResumeOptimizationCtaClick
trackResumeOptimizationPlanStart
trackResumeOptimizationPlanResult
trackResumeOptimizationQuestionsView
trackResumeOptimizationQuestionsSubmit
trackResumeOptimizationChangeToggle
trackResumeOptimizationApplyStart
trackResumeOptimizationApplyResult
trackResumeOptimizationRescoreResult
trackResumeOptimizationRevertResult
trackResumeOptimizationBankSuggestionClick
```

Properties must omit full resume text and user answers.

- [ ] **Step 2: Write failing billing tests**

Assert:

- plan call uses `resume_optimization_plan`;
- answer call uses `resume_optimization_answer`;
- GET/apply/finalize/revert do not create AI billing contexts;
- idempotent retry does not call the planner twice;
- billing metadata includes route, run ID when available, optimizer version, and counts but no raw resume text.

- [ ] **Step 3: Run and confirm failure**

```bash
node --test tests/resumeOptimizationAnalytics.test.mjs
cd backend
python -m unittest test_resume_optimization_billing
cd ..
```

- [ ] **Step 4: Implement tracking**

Common safe properties:

```text
resumeId
runId
beforeScore
afterScore
scoreDelta
directChangeCount
questionCount
answeredCount
noDataCount
unknownCount
notMyWorkCount
skippedCount
acceptedChangeCount
blockedChangeCount
bankSuggestionCount
durationMs
failureCode
```

- [ ] **Step 5: Add clear Token copy**

Place before the first paid request:

> 本次优化按实际模型用量消耗 Token，包含一轮事实补充和一次应用后复评。

Do not show an estimated fixed token number unless the backend can guarantee it.

- [ ] **Step 6: Run tests**

```bash
node --test tests/resumeOptimizationAnalytics.test.mjs
cd backend
python -m unittest test_resume_optimization_billing
cd ..
```

- [ ] **Step 7: Commit**

```bash
git add utils/analyticsTracker.ts \
        views/ResumeEditor/components/ResumeOptimization \
        views/ResumeEditor/hooks/useResumeOptimizationFlow.ts \
        backend/app/domain/resume_optimization \
        tests/resumeOptimizationAnalytics.test.mjs \
        backend/test_resume_optimization_billing.py
git commit -m "feat: measure resume optimization funnel"
```

---

## Task 21: Run full Gate A verification and prepare a reversible rollout

**Files:**
- Modify as needed only to fix discovered regressions
- Update: `AGENTS.md` only if new test commands or env variables require documentation
- Create: `backend/test_resume_optimization_public_errors.py`
- Create: `tests/resumeOptimizationAccessibility.test.mjs`

- [ ] **Step 1: Add public-error tests**

Verify safe messages for:

```text
feature disabled
stale evaluation
resume version conflict
run not found
invalid transition
idempotency conflict
AI timeout
AI payload invalid
quota exhausted
```

No stack trace or raw model body reaches the client.

- [ ] **Step 2: Add accessibility structure tests**

Check:

- dialog semantics;
- heading linkage;
- focus-visible styles;
- close button labels;
- progress live region;
- keyboard-accessible question choices;
- no clickable `div` used as the only control;
- mobile controls at least 44px high in the primary footer;
- reduced-motion handling.

- [ ] **Step 3: Run all feature tests**

Frontend:

```bash
node --test \
  tests/resumeOptimizationNormalize.test.mjs \
  tests/resumeOptimizationServiceStructure.test.mjs \
  tests/resumeOptimizationFlowStructure.test.mjs \
  tests/resumeOptimizationEntryStructure.test.mjs \
  tests/resumeOptimizationWorkspaceStructure.test.mjs \
  tests/resumeOptimizationQuestions.test.mjs \
  tests/resumeOptimizationDisplayUtils.test.mjs \
  tests/resumeOptimizationPreviewStructure.test.mjs \
  tests/resumeOptimizationResultStructure.test.mjs \
  tests/resumeOptimizationPostScoreFlow.test.mjs \
  tests/resumeOptimizationAnalytics.test.mjs \
  tests/resumeOptimizationAccessibility.test.mjs
```

Backend:

```bash
cd backend
python -m unittest \
  test_resume_optimization_schemas \
  test_resume_optimization_runtime_schema \
  test_resume_optimization_run_service \
  test_resume_optimization_context \
  test_resume_optimization_bank_suggestions \
  test_resume_optimization_planner \
  test_resume_optimization_safety \
  test_resume_optimization_orchestrator \
  test_resume_optimization_router \
  test_resume_optimization_apply \
  test_resume_optimization_finalize \
  test_resume_optimization_config \
  test_resume_optimization_billing \
  test_resume_optimization_public_errors
cd ..
```

- [ ] **Step 4: Run regression suites**

Frontend:

```bash
node --test \
  tests/resumeEvaluationExecutionStructure.test.mjs \
  tests/resumeEvaluationNormalize.test.mjs \
  tests/resumeEvaluationReport.test.mjs \
  tests/resumeEvaluationSnapshot.test.mjs \
  tests/jdAnalysisDetailsSidebarStructure.test.mjs \
  tests/jdAnalysisPersistenceUtils.test.mjs \
  tests/jdAnalysisRequestRunner.test.mjs \
  tests/jdAnalysisResultAssemblyUtils.test.mjs \
  tests/jdAnalysisRunStateUtils.test.mjs \
  tests/resumeConfigSaveCoordinator.test.mjs \
  tests/resumeEditorDesktopWorkspaceStructure.test.mjs
```

Backend:

```bash
cd backend
python -m unittest \
  test_ai_service \
  test_resume_evaluation \
  test_agent_api \
  test_runtime_schema \
  test_startup_imports \
  test_ai_public_errors \
  test_ai_runtime_budget
cd ..
```

- [ ] **Step 5: Run full compile verification**

```bash
npx tsc --noEmit --pretty false
npm run build
```

- [ ] **Step 6: Perform manual QA with feature flag enabled**

Use one high-evidence and one low-evidence fixture.

High-evidence scenario:

1. manually generate six-dimensional report;
2. start optimization;
3. verify no unnecessary questions;
4. compare Diff;
5. deselect one change;
6. apply;
7. verify one post-score;
8. verify result and revert.

Low-evidence scenario:

1. use `参与项目，负责上线`-style text;
2. verify responsibility/metric questions;
3. choose `no_data` for result;
4. verify no percentage is generated;
5. verify safe readability changes remain;
6. apply and rescore.

Conflict scenario:

1. start optimization;
2. edit current resume in another tab;
3. attempt apply;
4. verify stale conflict and no overwrite.

Mobile/dark scenario:

1. 390px viewport;
2. complete the full path;
3. verify sticky footer, focus, scroll, and dark contrast.

- [ ] **Step 7: Document rollout**

Production sequence:

```text
deploy backend schema and disabled routes
verify runtime schema
deploy frontend with hidden CTA
enable backend for internal user IDs or staging
enable frontend flag for internal users
inspect errors and token costs
enable a small production cohort
expand gradually
```

Rollback:

```text
disable frontend flag
disable backend flag
leave additive table in place
do not delete Runs during rollback
```

- [ ] **Step 8: Commit final Gate A hardening**

```bash
git add .
git commit -m "test: harden six-dimension optimization launch"
```

- [ ] **Step 9: Run verification-before-completion**

Before reporting Gate A complete, rerun the exact commands from Steps 3–5 and record their output. Do not claim completion from earlier cached results.

---

# Gate A Acceptance Checklist

- [ ] Valid current report exposes the CTA.
- [ ] Stale report cannot start optimization.
- [ ] Current selected content is the only formal optimization target.
- [ ] Selected source versions supplement only the same experience.
- [ ] Unselected full STAR text never reaches the planner.
- [ ] Four action routes are represented.
- [ ] Maximum five questions.
- [ ] `no_data`, `unknown`, `not_my_work`, and `skipped` are valid.
- [ ] Every text-changing item has resolvable source references.
- [ ] New unsupported numbers are blocked.
- [ ] Responsibility upgrades are blocked.
- [ ] Direct-causality upgrades are blocked.
- [ ] New tools and methods are blocked.
- [ ] User can deselect each allowed change.
- [ ] Bank suggestions cannot be accidentally applied.
- [ ] Apply changes current resume only.
- [ ] Selection sets remain unchanged.
- [ ] Apply is transactional and version guarded.
- [ ] One post-apply evaluation runs.
- [ ] Final score uses accepted applied content.
- [ ] Evaluation failure leaves content applied and retryable.
- [ ] Revert is content-signature guarded.
- [ ] Refresh restores an unfinished Run.
- [ ] Token usage records plan, answer, and evaluation calls.
- [ ] Network retry does not double-charge planning.
- [ ] Feature flag provides instant rollback.
- [ ] Frontend typecheck and build pass.
- [ ] Feature and regression tests pass.
- [ ] Desktop, mobile, dark mode, and keyboard QA pass.

---

# Phase 9 — Gate B: Reusable general optimization artifacts

Gate B begins only after Gate A has production usage and no critical data-pollution issue.

## Task 22: Persist and resolve version-hashed general drafts

**Files:**
- Create: `backend/app/domain/resume_optimization/artifact_models.py`
- Create: `backend/app/domain/resume_optimization/artifact_service.py`
- Create: `backend/app/runtime_schema/resume_optimization_artifact_tables.py`
- Create: `backend/migrations/021_add_experience_optimization_artifacts.sql`
- Modify: `backend/schema.sql`
- Modify: `backend/app/database.py`
- Modify: `backend/app/domain/resume_optimization/context_service.py`
- Test: `backend/test_resume_optimization_artifacts.py`
- Modify: frontend result/preview components

- [ ] **Step 1: Define cache identity**

Hash the exact L0 source payload:

```text
master_experience_id
source_version_id
title
org
dates
summary
star
```

Cache key also includes:

```text
optimizer_version
policy_version
language
```

Never hash a targeted resume override as the L0 source.

- [ ] **Step 2: Add schema and alignment tests**

Use `experience_optimization_artifacts` from the spec. Add unique index and JSON-object checks across migration, bootstrap, runtime schema, and model.

- [ ] **Step 3: Add artifact service tests**

Cover:

- hit for identical source/version/policy/language;
- miss after source version changes;
- miss after policy version changes;
- owner isolation;
- upsert without duplicate rows;
- update `last_used_at`;
- no targeted JD text stored in `general_star`.

- [ ] **Step 4: Integrate planner context**

On hit:

```text
L0 source
+ cached general_star
-> generate targeted layer only
```

On miss:

```text
L0 source
-> generate general + targeted
-> store general only after safety passes
```

- [ ] **Step 5: Add UI provenance**

Labels:

```text
复用通用优化稿
本次重新生成
```

Show neither as “verified fact”.

- [ ] **Step 6: Add analytics**

Track hit rate, token savings proxy, and cache invalidation reasons.

- [ ] **Step 7: Verify and commit**

Suggested commit:

```bash
git commit -m "feat: reuse versioned general experience drafts"
```

---

## Task 23: Add explicit new-fact synchronization without automatic overwrite

**Files:**
- Create: `backend/app/domain/resume_optimization/fact_sync_service.py`
- Modify: optimization result UI
- Test: `backend/test_resume_optimization_fact_sync.py`
- Test: `tests/resumeOptimizationFactSyncStructure.test.mjs`

- [ ] **Step 1: Restrict sync candidates**

Only answers with:

```text
state == answered
and explicit user text
and linked selected master experience
```

are candidates. Generated wording, inferred terms, no-data states, and targeted values are not candidates.

- [ ] **Step 2: Present a separate confirmation**

Result page action:

```text
将本次确认的新事实同步到总经历
```

Default off. Show exact new facts before confirmation.

- [ ] **Step 3: Create a new ExperienceVersion**

Merge only confirmed facts into a user-editable draft. Require the user to review the full resulting STAR before saving. Use the existing experience version creation/update flow.

- [ ] **Step 4: Invalidate artifact cache naturally**

Because a new source version ID and hash are created, old general artifacts stop matching. Do not delete old artifacts immediately; retain lineage.

- [ ] **Step 5: Verify and commit**

Suggested commit:

```bash
git commit -m "feat: sync confirmed optimization facts explicitly"
```

---

# Phase 10 — Gate C: Full Evidence-constrained Writing Harness

Gate C is a separate architectural program, not a prerequisite for Gate A revenue.

## Task 24: Introduce a persistent Evidence Ledger

**Files:**
- Create domain: `backend/app/domain/evidence/`
- Add tables:
  - `evidence_bundles`
  - `evidence_items`
  - `evidence_confirmation_events`
  - `evidence_conflict_groups`
- Add migrations and runtime schema
- Add frontend evidence provenance types and UI

- [ ] **Step 1: Define immutable evidence identities**

Each evidence item stores:

```text
evidence_id
master_experience_id
source_version_id
kind
content
normalized_value
source_type
source_path
source_span
verification_status
confirmation_state
publishable
confidence
contradiction_group_id
```

- [ ] **Step 2: Migrate legacy experiences conservatively**

Convert existing fields to:

```text
verification_status=user_claimed
confirmation_state=unreviewed
```

Do not infer missing facts.

- [ ] **Step 3: Make user answers first-class evidence**

A confirmed answer becomes an evidence item. A rejected answer remains in the audit trail but is not publishable.

- [ ] **Step 4: Add conflict detection**

Detect contradictory dates, metrics, responsibility claims, and duplicated facts. Block writing when a selected claim depends on an unresolved conflict.

- [ ] **Step 5: Add provenance UI**

Users can inspect which source statement supports a proposed sentence without seeing internal model prompts.

---

## Task 25: Introduce Claim IR and a shared Writing Compiler

**Files:**
- Create domain: `backend/app/domain/writing/`
- Extract shared policy from six-dimensional evaluation
- Integrate all writing entry points

- [ ] **Step 1: Define Claim IR**

Every rendered statement contains:

```text
claim_id
field
text
evidence_ids
claim_type
responsibility_level
causality_level
support_status
numeric_evidence_ids
```

- [ ] **Step 2: Separate planning from rendering**

```text
Evidence Ledger
-> Gap Planner
-> Question Planner
-> Claim Plan
-> Constrained Renderer
-> Claim Verifier
-> Resume text
```

- [ ] **Step 3: Enforce semantic claim verification**

Use deterministic checks plus a separate verifier call. A failed claim is downgraded, removed, or returned to a question state.

- [ ] **Step 4: Eliminate evidence laundering**

Final evaluation must reference pre-generation Evidence IDs. Never rebuild positive evidence from generated text and label it `user_claimed`.

- [ ] **Step 5: Integrate every writing entry point**

Use the same policy for:

```text
single experience polish
batch polish
six-dimension optimization
personal summary
Boss greeting
Agent-generated resume
assistant draft cards
```

- [ ] **Step 6: Preserve backward compatibility**

Legacy content remains usable while claim lineage is absent. New writes use Claim IR. Add a gradual migration rather than a flag-day rewrite.

---

# Phase 11 — Commercial expansion after real usage

## Task 26: Decide whether to introduce a fixed optimization product

Do not implement this task until Gate A has enough production samples to calculate cost and conversion.

- [ ] **Step 1: Produce a cost report**

Calculate:

```text
p50/p90 prompt tokens
p50/p90 completion tokens
question-round incidence
post-score incidence
provider cost
failure/retry rate
support burden
refund/revert proxy
```

- [ ] **Step 2: Compare pricing strategies**

Evaluate:

```text
Token-only
one-time optimization package
monthly quota
premium plan included runs
hybrid base fee + excess Token
```

- [ ] **Step 3: Choose a price with margin guardrails**

Price must cover p90 successful-flow model cost, payment fees, support, and retry allowance. Do not price from competitor display prices alone.

- [ ] **Step 4: Add product entitlements only after selection**

Reuse the existing payment and wallet architecture. Keep the optimizer’s internal billing entrypoints unchanged so cost attribution remains available.

---

# Final Verification Commands

Run from repository root unless noted.

```bash
node --test \
  tests/resumeOptimizationNormalize.test.mjs \
  tests/resumeOptimizationServiceStructure.test.mjs \
  tests/resumeOptimizationFlowStructure.test.mjs \
  tests/resumeOptimizationEntryStructure.test.mjs \
  tests/resumeOptimizationWorkspaceStructure.test.mjs \
  tests/resumeOptimizationQuestions.test.mjs \
  tests/resumeOptimizationDisplayUtils.test.mjs \
  tests/resumeOptimizationPreviewStructure.test.mjs \
  tests/resumeOptimizationResultStructure.test.mjs \
  tests/resumeOptimizationPostScoreFlow.test.mjs \
  tests/resumeOptimizationAnalytics.test.mjs \
  tests/resumeOptimizationAccessibility.test.mjs \
  tests/resumeEvaluationExecutionStructure.test.mjs \
  tests/resumeEvaluationNormalize.test.mjs \
  tests/resumeEvaluationReport.test.mjs \
  tests/resumeEvaluationSnapshot.test.mjs \
  tests/jdAnalysisDetailsSidebarStructure.test.mjs \
  tests/resumeConfigSaveCoordinator.test.mjs

cd backend
python -m unittest \
  test_resume_optimization_schemas \
  test_resume_optimization_runtime_schema \
  test_resume_optimization_run_service \
  test_resume_optimization_context \
  test_resume_optimization_bank_suggestions \
  test_resume_optimization_planner \
  test_resume_optimization_safety \
  test_resume_optimization_orchestrator \
  test_resume_optimization_router \
  test_resume_optimization_apply \
  test_resume_optimization_finalize \
  test_resume_optimization_config \
  test_resume_optimization_billing \
  test_resume_optimization_public_errors \
  test_ai_service \
  test_resume_evaluation \
  test_agent_api \
  test_runtime_schema \
  test_startup_imports \
  test_ai_public_errors \
  test_ai_runtime_budget
cd ..

npx tsc --noEmit --pretty false
npm run build
git status --short
```

Expected final state:

```text
all focused tests pass
typecheck succeeds
Vite production build succeeds
no generated caches or logs are staged
feature remains disabled by default
Gate A can be enabled independently on backend and frontend
```

# Execution Handoff

Codex should execute Gate A using `superpowers:subagent-driven-development` in the current session when independent tasks can be reviewed one by one. For a separate execution session with explicit checkpoints, use `superpowers:executing-plans`. Do not begin Gate B or Gate C until Gate A verification is complete and the release owner explicitly expands scope.

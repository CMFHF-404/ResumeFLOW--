# ResumeFLOW

The root is Vite + React + TypeScript (npm / `package-lock.json`). `backend/` is an independent FastAPI service. `magic-resume-inspect/` is an independent Next.js app (pnpm / `pnpm-lock.yaml`); do not mix their package managers or scripts.

## Local development

- Frontend: `npm run dev`, `npm run build`, `npm run preview`; type check: `npx tsc --noEmit --pretty false`.
- Backend: install `backend/requirements.txt`; from `backend/`, run `uvicorn app.main:app --host 0.0.0.0 --port 8000`. `sh prestart.sh` also initializes the configured database before starting.
- Inspector: from `magic-resume-inspect/`, use `pnpm dev`, `pnpm build`, `pnpm lint` or `pnpm start`. Pages helpers are `pages:build`, `preview`, `deploy`.
- Use the respective `.env.example` for configuration. Vite listens on port 5173 and proxies `/api` to `VITE_API_BASE_URL`, default `http://localhost:8000`. Start frontend and backend separately.
- Logto uses frontend ID tokens: do not set `VITE_LOGTO_RESOURCE`; backend `LOGTO_APP_ID` is the SPA app ID, not `LOGTO_AUDIENCE`. Account-center configuration uses `VITE_LOGTO_ACCOUNT_CENTER_URL`; local sign-out needs `http://localhost:5173` in Logto's post-sign-out redirects.
- Resume optimization requires both `ENABLE_RESUME_OPTIMIZATION=true` on the backend and `VITE_ENABLE_RESUME_OPTIMIZATION=true` in the frontend build. Enable the backend first.

## Behavior and verification

Select checks for the changed behavior and risk. Root tests use `node --test tests/<file>.test.mjs`; backend tests use `python -B -m unittest <module>` from `backend/`. Build/type checks are useful for frontend code and build changes; documentation-only edits need document and scope checks. Consult [feature test references](docs/agent-verification.md) only for the area being changed. Run broader suites when the impact warrants them or the task requests them.

Current scoring is `resume_score_v2` / `single_pass_v1`; optimization is `json_structure_v1`. Preserve one scoring call, one selected-module planning call, at most one answered-module rewrite, no audit/repair calls or automatic post-apply scoring, and zero calls for empty selections or skipped answers. `resumeScore.test.mjs` and backend `test_resume_score` cover current entrypoints; historical compatibility tests must not restore model audits or content regex gates. Preserve auth, save/version, HTML sanitization and scoped writes.

## Data and generated output

- `verify_ai.py` calls real providers; environment/database/timeout probes use configured services. Local mocked tests do not establish live-provider, browser, device, or production acceptance.
- Database initialization, first-admin grants and redemption mutations need a known target and matching user intent. `migrate_postgres_best_effort.py` is a manual high-impact tool requiring explicit `SOURCE_DATABASE_URL` and `TARGET_DATABASE_URL`; it is not setup. Do not export plaintext redemption codes without explicit intent.
- PostgreSQL payment migration tests require isolated `PAYMENT_MIGRATION_TEST_DATABASE_URL` and `RUN_PAYMENT_MIGRATION_POSTGRES_TESTS=1`.
- Do not hand-edit `dist/`, `backend/__pycache__/`, `backend/.assistant_attachment_cache/`, `vite-dev.log`, `vite-dev.err.log`, `git-status.txt`, or `git-diff.txt`. Template thumbnails are generated with `npm run templates:previews`.

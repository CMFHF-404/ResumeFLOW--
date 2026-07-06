# Repository Guidelines

## Repo Layout

- The root app is a Vite + React + TypeScript frontend. Use the root `package.json` scripts for this app only.
- `backend/` is a separate FastAPI service with its own Python dependencies in `backend/requirements.txt`.
- `magic-resume-inspect/` is a separate Next.js app with its own `package.json` and `pnpm-lock.yaml`. Treat it as an independent workspace.

## Local Workflows

- Root frontend:
  - Install with `npm install`
  - Start with `npm run dev`
  - Build with `npm run build`
  - Preview with `npm run preview`
  - Copy settings from `.env.example` when local env vars are needed.
  - The frontend uses Logto ID tokens for backend auth; do not configure `VITE_LOGTO_RESOURCE`.
  - For Logto account management, set `VITE_LOGTO_ACCOUNT_CENTER_URL` to the hosted Logto Account Center URL and add `http://localhost:5173` to the Logto "Post Sign-out Redirect URI" list for local logout.
- The Vite dev server binds to `0.0.0.0:5173` and proxies `/api` to `VITE_API_BASE_URL`, falling back to `http://localhost:8000`.
- Backend:
  - Install with `pip install -r requirements.txt` from `backend/`
  - Copy settings from `backend/.env.example` to `backend/.env`
  - Set `LOGTO_APP_ID` to the Logto SPA application ID; do not use `LOGTO_AUDIENCE` for backend auth.
  - Initialize a local PostgreSQL database with `python init_local_db.py` when you need the default `localhost:5432/resumeflow` setup.
  - Grant the first admin role with `python set_first_admin.py <logto-user-id>`, or set `FIRST_ADMIN_USER_ID` before running `python set_first_admin.py`.
  - Start from `backend/` with `sh prestart.sh` or `uvicorn app.main:app --host 0.0.0.0 --port 8000`
  - `prestart.sh` runs `python app/init_db.py` before starting Uvicorn
  - Manage token packages and redemption codes from `backend/` with `python manage_redemption_codes.py --help`; the CLI requires the configured backend environment, including `DATABASE_URL` and `REDEMPTION_CODE_ENCRYPTION_KEY`.
- `magic-resume-inspect/`:
  - Install with `pnpm install`
  - Start with `pnpm dev`
  - Build with `pnpm build`
  - Serve a production build with `pnpm start`
  - Lint with `pnpm lint`
  - Cloudflare Pages helpers are already defined: `pnpm pages:build`, `pnpm preview`, `pnpm deploy`

## Verification

- Frontend: `npm run build`
- Frontend type-only checks: `npx tsc --noEmit --pretty false`
- Frontend targeted tests are plain Node test files under `tests/`. Run focused checks with `node --test tests/<file>.test.mjs`; for example `node --test tests/account-management-static.test.mjs` for account management, `node --test tests/experienceBankDrafts.test.mjs tests/experienceSimpleModeParser.test.mjs` for experience draft/simple-mode work, `node --test tests/dashboardStructure.test.mjs tests/dashboardUtils.test.mjs` for Dashboard list/filter work, or `node --test tests/appDevLoggingStructure.test.mjs` for app-shell development logging.
- AI thinking and JD-analysis UI checks commonly use `node --test tests/aiStopHandlingStructure.test.mjs tests/jdAnalysisThinkingText.test.mjs tests/jdAnalysisToastThinking.test.mjs`; assistant thinking persistence commonly uses `node --test tests/assistantMessageSendUtils.test.mjs tests/assistantThinkingDisplay.test.mjs`.
- Assistant sidebar and selected-resume context checks commonly use `node --test tests/assistantSidebarStructure.test.mjs tests/assistantSkillPresetPanelStructure.test.mjs tests/assistantResumeSelectionUtils.test.mjs tests/assistantContextRailRender.test.mjs tests/assistantSidebarContextPersistence.test.mjs`.
- Resume factory desktop sidebar checks commonly use `node --test tests/resumeEditorDesktopWorkspaceStructure.test.mjs tests/resumeEditorToolbarStructure.test.mjs tests/jdAnalysisDetailsSidebarStructure.test.mjs`.
- Rich text editor clipboard/caret checks commonly use `node --test tests/richTextEditorCaret.test.mjs`; API auth timeout checks commonly use `node --test tests/apiClientAuthTimeout.test.mjs`.
- Billing and quota UI checks commonly use `node --test tests/billing-ui-structure.test.mjs tests/tokenQuotaModalStatic.test.mjs`.
- Backend env and connectivity checks from `backend/`:
  - `python verify_env.py`
  - `python verify_db.py`
  - `python verify_ai.py`
  - `python verify_timeout.py`
- Backend tests are `unittest`-style files under `backend/`. Prefer `python -m unittest <module>` from `backend/` for targeted runs, for example `python -m unittest test_assistant_features` or `python -m unittest test_parser_service`.
- Agent and AI backend checks commonly use `python -m unittest test_agent_api` and `python -m unittest test_ai_service` from `backend/`.
- Account and experience draft backend checks commonly use `python -m unittest test_account_verification_cooldown` and `python -m unittest test_experience_drafts` from `backend/`.
- Billing and redemption backend checks commonly use `python -m unittest test_billing_service test_redemption_code_service test_redemption_router` from `backend/`.

## Guardrails

- Do not hand-edit generated artifacts or caches: `dist/`, `backend/__pycache__/`, `backend/.assistant_attachment_cache/`, `vite-dev.log`, `vite-dev.err.log`, `git-status.txt`, `git-diff.txt`.
- Do not mix package managers across workspaces: the repo root uses npm and `package-lock.json`; `magic-resume-inspect/` uses pnpm and `pnpm-lock.yaml`.
- Treat `backend/migrate_postgres_best_effort.py` as a manual high-impact database migration tool. It requires explicit `SOURCE_DATABASE_URL` and `TARGET_DATABASE_URL`; do not run it as part of default setup.
- Treat `backend/manage_redemption_codes.py` as a manual admin tool for token packages and card codes. Do not run mutating subcommands or export plaintext redemption codes unless the target database and operator intent are explicit.
- TODO: There is no repo-owned command yet that starts the root frontend and `backend/` together. If a unified local workflow is added later, document it here instead of guessing.

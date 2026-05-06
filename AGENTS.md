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
- The Vite dev server binds to `0.0.0.0:5173` and proxies `/api` to `VITE_API_BASE_URL`, falling back to `http://localhost:8000`.
- Backend:
  - Install with `pip install -r requirements.txt` from `backend/`
  - Copy settings from `backend/.env.example` to `backend/.env`
  - Start from `backend/` with `sh prestart.sh` or `uvicorn app.main:app --host 0.0.0.0 --port 8000`
  - `prestart.sh` runs `python app/init_db.py` before starting Uvicorn
- `magic-resume-inspect/`:
  - Install with `pnpm install`
  - Start with `pnpm dev`
  - Build with `pnpm build`
  - Cloudflare Pages helpers are already defined: `pnpm pages:build`, `pnpm preview`, `pnpm deploy`

## Verification

- Frontend: `npm run build`
- Backend env and connectivity checks from `backend/`:
  - `python verify_env.py`
  - `python verify_db.py`
  - `python verify_ai.py`
  - `python verify_timeout.py`
- Backend tests are `unittest`-style files under `backend/`. Prefer `python -m unittest <module>` from `backend/` for targeted runs, for example `python -m unittest test_assistant_features` or `python -m unittest test_parser_service`.

## Guardrails

- Do not hand-edit generated artifacts or caches: `dist/`, `backend/__pycache__/`, `backend/.assistant_attachment_cache/`, `vite-dev.log`, `git-status.txt`, `git-diff.txt`.
- Do not mix package managers across workspaces: the repo root uses npm and `package-lock.json`; `magic-resume-inspect/` uses pnpm and `pnpm-lock.yaml`.
- TODO: There is no repo-owned command yet that starts the root frontend and `backend/` together. If a unified local workflow is added later, document it here instead of guessing.

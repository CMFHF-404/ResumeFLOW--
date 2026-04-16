## Summary

Move the frontend Umami tracker configuration from hardcoded values in `index.html` to Vite build-time environment variables.

This change will introduce:

- `VITE_UMAMI_HOST`
- `VITE_UMAMI_WEBSITE_ID`

The frontend will continue to load the Umami tracker from `index.html`, but the script source and `data-website-id` will be injected at build time from environment variables. `UMAMI_PASSWORD` will not be exposed to the frontend because it is only relevant for Umami administration and would be leaked if bundled into client code.

## Current State

- `index.html` hardcodes the Umami script host and website id.
- The project already uses Vite environment variables for API and Logto configuration.
- The Docker build already forwards selected `VITE_*` values into the build stage.

## Proposed Design

### Environment Variables

Add two frontend build variables:

- `VITE_UMAMI_HOST`
- `VITE_UMAMI_WEBSITE_ID`

These variables will be defined in the local `.env.local` file for development, documented in a checked-in `.env.example` template, and passed through Docker build arguments so Zeabur can provide them at deploy time for non-local environments.

### Frontend Integration

Update `index.html` so the Umami script tag becomes:

- `src="%VITE_UMAMI_HOST%/script.js"`
- `data-website-id="%VITE_UMAMI_WEBSITE_ID%"`

`data-auto-track="false"` will remain unchanged because the app already uses manual page and event tracking.

### Type Safety

Update the Vite env typings to document the two new `VITE_*` variables used by the frontend build.

### Docker Build Path

Extend the existing Docker build args and env passthrough so the builder stage receives:

- `VITE_UMAMI_HOST`
- `VITE_UMAMI_WEBSITE_ID`

This keeps Umami configuration aligned with the existing `VITE_API_BASE_URL` and `VITE_LOGTO_*` pattern.

## Security Constraints

- Do not expose `UMAMI_PASSWORD` in any `VITE_*` variable.
- Do not reference `UMAMI_PASSWORD` from `index.html`, client code, or generated assets.
- Keep secrets limited to server-side deployment settings only.

## Error Handling

- If `VITE_UMAMI_HOST` or `VITE_UMAMI_WEBSITE_ID` is missing during a production build, the tracker tag would be incomplete.
- This change will keep behavior simple and rely on deployment configuration correctness rather than adding runtime fallback logic.
- Verification will include checking the built HTML output to confirm the correct host and website id are injected.

## Testing and Verification

Verify with:

- local build succeeds
- generated `dist/index.html` contains the configured Umami host
- generated `dist/index.html` contains the configured website id
- generated assets do not include `UMAMI_PASSWORD`

## Scope Boundaries

This change does not:

- modify current tracking event names or page-view logic
- switch the app to runtime config injection
- change Umami backend deployment settings
- expose administrative credentials to the browser

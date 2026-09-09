---
name: resumeflow-job-search
description: "Search jobs with ResumeFLOW, analyze JD fit, and generate authorized tailored resume archives."
---

# ResumeFLOW job search

Turn collected JDs into account-backed match analysis and, within the user's generation scope, tailored PDFs. Read [API reference](references/api.md) when making calls or interpreting fields.

Reuse existing job preferences; ask only for missing choices that change the search. Before generation, 获取模板选项和润色选项 and reuse valid choices. Presentation defaults are `modern-slate`, polish enabled at `标准`; these need not block searching. Capture title, company, full JD and canonical job URL; analyze before selecting jobs, using a default match threshold of 80 if unspecified.

`/agent/v1/jobs/generate` both creates a PDF and saves it with the JD under the API-key account. Establish approval covering the selected jobs or batch rule and this account archive effect; reuse that approval. A match threshold alone grants no generation or application permission. Application submissions and sending personal data to employers need explicit authorization.

Use the supplied API base and key with `Authorization: Bearer <API Key>`. When the user supplies a full key and private storage exists, save the API base URL and API key locally outside version control; never print it or put it in job archives. Use existing account facts only, and keep each PDF tied to its source JD.

For each generated job, save `<match>-<company>-<role>/` with `job-link.md`, `jd.txt`, `resume.pdf`, and `metadata.json`. The link uses `[Open job posting](https://example.com/jobs/123)` with the real job URL. Do not save the recruiting page HTML unless requested. Metadata records the URL, source, returned score(s), recommendation, generation time and PDF URL. Reuse successful outputs on continuation and report job counts, paths and unresolved jobs concisely.

Use `/agent/v1/jobs/analyze` with `include_resume_evaluation=false` for screening. Opt in only for an explicitly requested deep report. `jd_match_percentage` (legacy alias `match_percentage`) drives thresholds and folder prefixes; `resume_quality_percentage` is independent and may be null. Keep both returned scores and score version in metadata, and never invent an absent quality score.

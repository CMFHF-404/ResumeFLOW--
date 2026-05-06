---
name: resumeflow-job-search
description: "Use when Codex or another agent needs to run a job-search workflow with ResumeFLOW: confirm job preferences, search and filter job boards, collect JD content, call ResumeFLOW Agent APIs to analyze job match and generate tailored resume PDFs, then archive each high-match job locally with the job page HTML, JD, and generated resume."
---

# ResumeFLOW Job Search

## Overview

Use this skill to coordinate a user-approved job search that turns job descriptions into ResumeFLOW match scores and tailored resume PDFs. Read `references/api.md` before calling ResumeFLOW APIs or explaining request and response fields.

## Workflow

1. Confirm preferences before searching: city, role direction, salary range, seniority, education or experience threshold, industry preference, minimum match score, remote/on-site preference, and whether internship, contractor, outsourcing, or staffing roles are acceptable.
2. Search job boards with those preferences first. Respect site access limits, login requirements, robots/terms, and privacy boundaries; ask the user before submitting applications or sending personal data.
3. For each candidate job, capture at minimum `job_title`, `company_name`, full `jd_text`, canonical `job_url`, and optional `source`.
4. Batch jobs through ResumeFLOW analysis first. Prefer `/agent/v1/jobs/analyze` for screening many JDs, then call `/agent/v1/jobs/generate` only for jobs that meet the user's threshold and hard filters.
5. Present a shortlist before application actions. Include match score, recommendation, strengths, gaps, missing keywords, source URL, and the planned local folder path.
6. For each approved high-match job, create one local folder named `match-company-role`, using the numeric match score first. Save the direct page HTML, JD text or attachment, and the generated ResumeFLOW PDF in that folder.

## ResumeFLOW Rules

- Use only the API base URL and API key supplied by the user or current task. Never invent credentials.
- Send `Authorization: Bearer <API Key>` on every ResumeFLOW Agent API request.
- Do not fabricate companies, projects, education, certificates, awards, or experience. ResumeFLOW should only rewrite and select from the user's existing server-side resume data.
- Keep generated resumes tied to the source JD. Do not reuse a generated PDF for unrelated jobs.
- Treat `/agent/v1/jobs/generate` as both a PDF generator and an account archive action: it saves the tailored resume and source JD under the user's ResumeFLOW account.
- If the user does not set a threshold, default to analyzing all collected jobs and generating only for scores of 80 or above.

## Local Archive

Create one folder per generated job:

```text
<match_percentage>-<company_name>-<job_title>/
  job.html
  jd.txt
  resume.pdf
  metadata.json
```

Sanitize folder and file names for the local OS. Put the original `job_url`, `source`, match score, API recommendation, generation time, and ResumeFLOW PDF URL in `metadata.json`.

## Output To User

Report concise batches:

- Jobs searched and sites covered
- Jobs skipped by hard filters
- Jobs analyzed with match score and recommendation
- Jobs generated with local folder paths
- Any blockers, such as inaccessible pages, missing JD text, failed API calls, or jobs needing user confirmation

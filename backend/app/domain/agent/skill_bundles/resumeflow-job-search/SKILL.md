---
name: resumeflow-job-search
description: "Use when Codex or another agent needs to run a job-search workflow with ResumeFLOW: confirm job preferences, search and filter job boards, collect JD content, call ResumeFLOW Agent APIs to analyze job match and generate tailored resume PDFs, then archive each high-match job locally with the job page HTML, JD, and generated resume."
---

# ResumeFLOW Job Search

## Overview

Use this skill to coordinate a user-approved job search that turns job descriptions into ResumeFLOW match scores and tailored resume PDFs. Read `references/api.md` before calling ResumeFLOW APIs or explaining request and response fields.

## Workflow

1. Confirm preferences before searching: city, role direction, salary range, seniority, education or experience threshold, industry preference, minimum match score, remote/on-site preference, and whether internship, contractor, outsourcing, or staffing roles are acceptable.
2. Before the first job search in each session, read `references/api.md`, call ResumeFLOW to 获取模板选项和润色选项, then ask the user to choose a resume `template_id`, whether output polish is enabled, and the polish level. Explain the polish levels briefly. If the user does not choose a template, use `modern-slate`; if the user cannot answer the polish question, record the assumption and use enabled `标准`.
3. Search job boards with those preferences first. Respect site access limits, login requirements, robots/terms, and privacy boundaries; ask the user before submitting applications or sending personal data.
4. For each candidate job, capture at minimum `job_title`, `company_name`, full `jd_text`, canonical `job_url`, and optional `source`.
5. Batch jobs through ResumeFLOW analysis first. Prefer `/agent/v1/jobs/analyze` for screening many JDs, then call `/agent/v1/jobs/generate` only for jobs that meet the user's threshold and hard filters.
6. Present a shortlist before application actions. Include match score, recommendation, strengths, gaps, missing keywords, source URL, selected template, polish setting, and the planned local folder path.
7. For each approved high-match job, create one local folder named `match-company-role`, using the numeric match score first. Save the direct page HTML, JD text or attachment, and the generated ResumeFLOW PDF in that folder.

## ResumeFLOW Rules

- Use only the API base URL and API key supplied by the user or current task. Never invent credentials.
- When the user supplies a full API key and the runtime has a local secret store or user-private config outside version control, save the API base URL and API key locally so future ResumeFLOW job-search sessions on the same machine can reuse them without asking again. Never commit the key, include it in archives, or print it in normal output.
- Send `Authorization: Bearer <API Key>` on every ResumeFLOW Agent API request.
- Treat the API key as bound to the API Key 对应的 ResumeFLOW 用户账号. Analysis uses that account's resume data, generated resumes are saved under that account, and future token accounting can be associated with that user id server-side.
- Treat the API key as stable until the user refreshes it in ResumeFLOW. The web app stores one reusable Agent API key per user and includes it when copying Agent instructions.
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

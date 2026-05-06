# ResumeFLOW Agent API

Use the API base URL and API key from the user's ResumeFLOW Agent API configuration.

## Authentication

Send this header on every Agent API call:

```http
Authorization: Bearer <API Key>
Content-Type: application/json
```

## Analyze A Job

`POST <apiBaseUrl>/agent/v1/jobs/analyze`

Use this endpoint to screen many jobs before generating resume PDFs.

Request body:

```json
{
  "job_title": "AI Product Intern",
  "company_name": "Example Company",
  "jd_text": "Full job description text...",
  "job_url": "https://example.com/jobs/123",
  "source": "optional job board name",
  "resume_id": "optional ResumeFLOW resume id"
}
```

Response fields:

- `match_percentage`: 0-100 match score.
- `evaluation`: short natural-language fit summary.
- `strengths`: matching resume strengths.
- `gaps`: risks or missing experience.
- `missing_keywords`: keywords that appear important in the JD but are weak or absent in the resume.
- `recommendation`: `skip`, `review`, or `generate`.
- `suggested_folder_name`: ResumeFLOW's server-side safe folder suggestion. The local archive still uses `match-company-role` unless the user requests otherwise.

## Generate A Tailored Resume

`POST <apiBaseUrl>/agent/v1/jobs/generate`

Use this endpoint only after the job passes the user's threshold and hard filters. The request accepts the same fields as analyze, plus optional overrides:

```json
{
  "job_title": "AI Product Intern",
  "company_name": "Example Company",
  "jd_text": "Full job description text...",
  "job_url": "https://example.com/jobs/123",
  "source": "optional job board name",
  "resume_id": "optional ResumeFLOW resume id",
  "template_id": "optional template id",
  "polish_before_output": true,
  "polish_level": "标准"
}
```

If the optional override fields are omitted, ResumeFLOW uses the user's saved server-side Agent plugin configuration: resume template and polish settings. Generated resumes are saved under the user's ResumeFLOW account with the source JD and default to the smart one-page layout for export.

Response fields include all analyze fields, plus:

- `resume_pdf.download_url`: URL for downloading the generated PDF.
- `resume_pdf.file_name`: suggested PDF file name.
- `resume_pdf.generated_resume_id`: ResumeFLOW resume id saved under the user's account.
- `job_link_url`: direct job URL.
- `job_metadata`: job title, company, JD text, URL, source, generation time, folder name, and match score.

## Failure Handling

- If authentication fails, ask the user to refresh or provide a valid full API key.
- If a job URL is rejected, use the canonical public URL for the posting.
- If JD text is incomplete or hidden behind login, mark the job as blocked instead of guessing.
- If generation succeeds but PDF download fails, keep `metadata.json` with the `download_url` and report the failure.

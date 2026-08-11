from .models import Resume
from .resume_schema import ResumeRead


def resume_to_read(resume: Resume) -> ResumeRead:
    return ResumeRead(
        id=str(resume.id),
        user_id=str(resume.user_id),
        title=resume.title,
        target_role=resume.target_role,
        config=resume.config or {},
        created_at=resume.created_at,
        updated_at=resume.updated_at,
    )

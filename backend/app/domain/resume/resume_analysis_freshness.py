from datetime import datetime

from sqlalchemy import text
from sqlmodel.ext.asyncio.session import AsyncSession


async def acquire_user_resume_analysis_lock(
    session: AsyncSession,
    user_id: str,
) -> None:
    """Serialize bank mutations with final Agent freshness attestation."""
    execute = getattr(session, "execute", None)
    if not callable(execute):
        return
    await execute(
        text(
            "SELECT pg_advisory_xact_lock("
            "hashtext('resumeflow_resume_analysis'), hashtext(:user_id))"
        ),
        {"user_id": user_id},
    )


async def invalidate_user_resume_analyses(
    session: AsyncSession,
    user_id: str,
    *,
    updated_at: datetime,
) -> None:
    """Mark persisted analyses stale when shared resume-bank data changes."""
    await acquire_user_resume_analysis_lock(session, user_id)
    await session.execute(
        text(
            """
            UPDATE resumes
            SET config = jsonb_set(
                    jsonb_set(
                        COALESCE(config, '{}'::jsonb),
                        '{jdAnalysis,isOutdated}',
                        'true'::jsonb,
                        true
                    ),
                    '{jdAnalysis,evaluationIsOutdated}',
                    'true'::jsonb,
                    true
                ),
                updated_at = :updated_at
            WHERE user_id = :user_id
              AND jsonb_typeof(COALESCE(config, '{}'::jsonb) -> 'jdAnalysis') = 'object'
              AND (
                    COALESCE(
                        COALESCE(config, '{}'::jsonb) -> 'jdAnalysis' -> 'isOutdated',
                        'false'::jsonb
                    ) <> 'true'::jsonb
                    OR COALESCE(
                        COALESCE(config, '{}'::jsonb) -> 'jdAnalysis' -> 'evaluationIsOutdated',
                        'false'::jsonb
                    ) <> 'true'::jsonb
                  )
            """
        ),
        {
            "user_id": user_id,
            "updated_at": updated_at,
        },
    )

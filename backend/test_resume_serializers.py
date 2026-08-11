import unittest
from datetime import datetime, timezone
from uuid import UUID

from app import serializers as legacy_serializers
from app.domain.resume import resume_router
from app.domain.resume.models import Resume
from app.domain.resume.serializers import resume_to_read


class ResumeSerializerTests(unittest.TestCase):
    def test_resume_projection_preserves_response_fields_and_empty_config(self) -> None:
        resume_id = UUID("11111111-1111-4111-8111-111111111111")
        created_at = datetime(2026, 8, 10, 8, 30, tzinfo=timezone.utc)
        updated_at = datetime(2026, 8, 10, 9, 45, tzinfo=timezone.utc)
        resume = Resume(
            id=resume_id,
            user_id="logto-user-id",
            title="后端工程师",
            target_role=None,
            config={},
            created_at=created_at,
            updated_at=updated_at,
        )

        result = resume_to_read(resume)

        self.assertEqual(result.id, str(resume_id))
        self.assertEqual(result.user_id, "logto-user-id")
        self.assertEqual(result.title, "后端工程师")
        self.assertIsNone(result.target_role)
        self.assertEqual(result.config, {})
        self.assertEqual(result.created_at, created_at)
        self.assertEqual(result.updated_at, updated_at)

        resume.config = None
        self.assertEqual(resume_to_read(resume).config, {})

    def test_legacy_and_router_projection_names_reference_domain_authority(self) -> None:
        self.assertIs(legacy_serializers.resume_to_read, resume_to_read)
        self.assertIs(resume_router._resume_to_read, resume_to_read)


if __name__ == "__main__":
    unittest.main()

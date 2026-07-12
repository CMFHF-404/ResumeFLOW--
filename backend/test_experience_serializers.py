import unittest
from datetime import date, datetime, timezone
from uuid import UUID

from app import serializers as legacy_serializers
from app.domain.experience import serializers as experience_serializers
from app.models import ExperienceCategory, ExperienceVersion, MasterExperience


class ExperienceSerializerTests(unittest.TestCase):
    def test_master_experience_projection_preserves_all_response_fields(self) -> None:
        master_id = UUID("11111111-1111-4111-8111-111111111111")
        version_id = UUID("22222222-2222-4222-8222-222222222222")
        created_at = datetime(2026, 7, 11, 8, 30, tzinfo=timezone.utc)
        updated_at = datetime(2026, 7, 12, 9, 45, tzinfo=timezone.utc)
        master = MasterExperience(
            id=master_id,
            user_id="logto-user-id",
            category=ExperienceCategory.PROJECT,
            latest_version_id=version_id,
            is_archived=True,
            created_at=created_at,
            updated_at=updated_at,
        )

        result = experience_serializers.master_experience_to_read(master)

        self.assertEqual(result.id, str(master_id))
        self.assertEqual(result.category, ExperienceCategory.PROJECT)
        self.assertEqual(result.latest_version_id, str(version_id))
        self.assertTrue(result.is_archived)
        self.assertEqual(result.created_at, created_at)
        self.assertEqual(result.updated_at, updated_at)

        master.latest_version_id = None
        result_without_latest_version = experience_serializers.master_experience_to_read(master)
        self.assertIsNone(result_without_latest_version.latest_version_id)

    def test_experience_version_projection_preserves_all_response_fields(self) -> None:
        master_id = UUID("33333333-3333-4333-8333-333333333333")
        version_id = UUID("44444444-4444-4444-8444-444444444444")
        created_at = datetime(2026, 7, 12, 10, 15, tzinfo=timezone.utc)
        version = ExperienceVersion(
            id=version_id,
            master_experience_id=master_id,
            version=3,
            title="平台重构",
            org="ResumeFLOW",
            location="Remote",
            start_date=date(2026, 1, 1),
            end_date=date(2026, 6, 30),
            is_current=False,
            summary="统一经历响应投影。",
            highlights=["保持 API 字段一致"],
            tags=["backend", "refactor"],
            star={"s": "重复映射", "a": "收敛到 domain serializer"},
            created_at=created_at,
        )

        result = experience_serializers.experience_version_to_read(version)

        self.assertEqual(result.id, str(version_id))
        self.assertEqual(result.master_experience_id, str(master_id))
        self.assertEqual(result.version, 3)
        self.assertEqual(result.title, "平台重构")
        self.assertEqual(result.org, "ResumeFLOW")
        self.assertEqual(result.location, "Remote")
        self.assertEqual(result.start_date, date(2026, 1, 1))
        self.assertEqual(result.end_date, date(2026, 6, 30))
        self.assertFalse(result.is_current)
        self.assertEqual(result.summary, "统一经历响应投影。")
        self.assertEqual(result.highlights, ["保持 API 字段一致"])
        self.assertEqual(result.tags, ["backend", "refactor"])
        self.assertEqual(result.star, {"s": "重复映射", "a": "收敛到 domain serializer"})
        self.assertEqual(result.created_at, created_at)

        version.org = None
        version.location = None
        version.start_date = None
        version.end_date = None
        version.summary = None
        version.highlights = []
        version.tags = []
        version.star = {}
        result_with_empty_optional_fields = experience_serializers.experience_version_to_read(version)
        self.assertIsNone(result_with_empty_optional_fields.org)
        self.assertIsNone(result_with_empty_optional_fields.location)
        self.assertIsNone(result_with_empty_optional_fields.start_date)
        self.assertIsNone(result_with_empty_optional_fields.end_date)
        self.assertIsNone(result_with_empty_optional_fields.summary)
        self.assertEqual(result_with_empty_optional_fields.highlights, [])
        self.assertEqual(result_with_empty_optional_fields.tags, [])
        self.assertEqual(result_with_empty_optional_fields.star, {})

    def test_legacy_serializer_imports_reexport_domain_implementation(self) -> None:
        self.assertIs(
            legacy_serializers.master_experience_to_read,
            experience_serializers.master_experience_to_read,
        )
        self.assertIs(
            legacy_serializers.experience_version_to_read,
            experience_serializers.experience_version_to_read,
        )


if __name__ == "__main__":
    unittest.main()

"""Exercise real default binding rather than mocking the onboarding session."""
import unittest

from sqlalchemy import create_engine, insert, select

from app.models import User


class ModelDatetimeCompatibilityTests(unittest.TestCase):
    def test_user_default_round_trips_with_existing_naive_utc_schema(self):
        engine = create_engine("sqlite:///:memory:")
        try:
            User.__table__.create(engine)
            with engine.begin() as connection:
                connection.execute(insert(User).values(id="datetime-regression"))
                created_at = connection.execute(select(User.created_at)).scalar_one()
            self.assertIsNone(created_at.tzinfo)
            self.assertFalse(User.__table__.c.created_at.type.timezone)
        finally:
            engine.dispose()


if __name__ == "__main__":
    unittest.main()

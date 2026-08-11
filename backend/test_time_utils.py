from datetime import datetime, timezone
import unittest
from unittest.mock import patch

from app.utils import time_utils


class UtcNowTests(unittest.TestCase):
    def test_utc_now_derives_naive_value_from_aware_utc_clock(self) -> None:
        aware_utc = datetime(2026, 8, 10, 7, 30, 45, tzinfo=timezone.utc)

        with patch.object(time_utils, "datetime") as clock:
            clock.now.return_value = aware_utc

            value = time_utils.utc_now()

        clock.now.assert_called_once_with(timezone.utc)
        self.assertEqual(value, datetime(2026, 8, 10, 7, 30, 45))
        self.assertIsNone(value.tzinfo)

import unittest
from app.domain.ai import response_normalizers as parsing
from app.domain.ai.public_errors import AiProviderPayloadError


class GuidanceJSONTests(unittest.TestCase):
    def test_duplicate_task_and_nested_verdict_are_never_last_value_wins(self):
        token = parsing.strict_response_objects.set(True)
        try:
            for payload in ['{"T": {}, "T": {}}', '{"T":{"verdict":true,"verdict":false}}',
                            '{"T": {}} {"T": {}}', '{"T": {}}}', '{"T": NaN}']:
                with self.subTest(payload=payload), self.assertRaises(AiProviderPayloadError):
                    parsing._parse_json_content(payload)
        finally: parsing.strict_response_objects.reset(token)

    def test_strict_mode_does_not_change_legacy_recovery(self):
        self.assertEqual(parsing._parse_json_content('{"T": {}}}'), {'T': {}})

    def test_one_markdown_json_envelope_does_not_relax_task_uniqueness(self):
        token = parsing.strict_response_objects.set(True)
        try:
            self.assertEqual(parsing._parse_json_content('```json\n{"T": {}}\n```'), {'T': {}})
            with self.assertRaises(AiProviderPayloadError):
                parsing._parse_json_content('```json\n{"T": {}, "T": {}}\n```')
            for raw in ('extra\n```json\n{"T": {}}\n```', '```json\n{"T": {}}\n```\nextra'):
                with self.assertRaises(AiProviderPayloadError): parsing._parse_json_content(raw)
        finally: parsing.strict_response_objects.reset(token)

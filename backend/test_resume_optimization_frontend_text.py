import subprocess
import sys
from pathlib import Path
import textwrap
import unittest


class FrontendTextDependencyTests(unittest.TestCase):
    def test_text_consumers_do_not_load_apply_or_context_services(self) -> None:
        # A fresh interpreter catches delayed imports reached only when helpers
        # run, even if another test already loaded the transaction services.
        script = textwrap.dedent(
            """
            import sys
            from types import SimpleNamespace
            from app.domain.resume_optimization import frontend_text, local_actions, skill_text

            item = {'id': 'education-1', 'notes': 'old'}
            config = {'educationOverrides': {'education-1': {'notes': '<b>old</b>'}}}
            assert local_actions.education(item, config)['notes'] == 'old'
            change = SimpleNamespace(
                module_type='education_notes', module_id='education-1',
                before_value='old', targeted_value='<b>new</b>',
            )
            local_actions.update_config(config, change, {'educations': [item]}, 'run')
            assert config['educationOverrides']['education-1']['notes'] == 'new'
            assert local_actions.restructured_star({}, '<strong>new</strong>') == {
                's': '', 't': '', 'a': '<b>new</b>', 'r': '',
            }
            assert skill_text.value({'name': '<b>Python</b>', 'category': 'Code'}) == {
                'name': 'Python', 'category': 'Code',
            }
            assert frontend_text._frontend_star_value('&lt;b&gt;new&lt;/b&gt;') == '<b>new</b>'
            assert frontend_text._frontend_year_month('2026-09-28') == '2026.09'
            for name in ('apply_service', 'context_service'):
                assert 'app.domain.resume_optimization.' + name not in sys.modules, name
            """
        )
        result = subprocess.run(
            [sys.executable, '-B', '-c', script],
            cwd=Path(__file__).resolve().parent,
            capture_output=True,
            text=True,
            timeout=30,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == '__main__':
    unittest.main()

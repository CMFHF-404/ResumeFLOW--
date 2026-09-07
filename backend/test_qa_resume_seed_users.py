import copy
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import qa_resume_blind_benchmark as benchmark
from app.domain.resume.models import Resume, ResumeExperienceLink
from app.models import ExperienceVersion, MasterExperience, Skill, UserSkill


class MemorySession:
    """Observe the seed graph without connecting to any database."""
    def __init__(self):
        self.rows = {}
        self.flush = AsyncMock()
        self.commit = AsyncMock()

    async def get(self, model, identity, **kwargs):
        return self.rows.get((model, identity))

    def add(self, row):
        self.rows[type(row), row.id] = row


def session_factory(session):
    factory = MagicMock()
    factory.return_value.__aenter__ = AsyncMock(return_value=session)
    factory.return_value.__aexit__ = AsyncMock(return_value=False)
    return factory


class SeedUserTests(unittest.IsolatedAsyncioTestCase):
    async def test_seeded_selection_matches_account_api_without_selecting_extra_skills(self):
        from app.domain.skills.skill_router import _to_read

        with tempfile.TemporaryDirectory() as directory, patch.object(benchmark, 'OUT', Path(directory)):
            benchmark.prepare()
            samples = json.loads((Path(directory) / 'fixtures.json').read_text(encoding='utf-8'))['samples'][:1]
            owner = 'existing-browser-user'
            session = MemorySession()
            extra = Skill(name='Extra unrelated skill')
            extra_user_skill = UserSkill(user_id=owner, skill_id=extra.id)
            session.add(extra)
            session.add(extra_user_skill)
            await benchmark.seed_samples(owner, samples, session=session)
            resume = next(row for (model, _), row in session.rows.items() if model is Resume)
            api_skills = [_to_read(row, session.rows[Skill, row.skill_id])
                          for (model, _), row in session.rows.items() if model is UserSkill]
            selected = resume.config['selection']['skillIds']
            api_by_id = {skill.id: skill for skill in api_skills}
            self.assertTrue(set(selected) <= set(api_by_id))
            self.assertEqual([api_by_id[identity].name for identity in selected],
                             [skill['name'] for skill in samples[0]['resume']['skills']])
            self.assertNotIn(str(extra_user_skill.id), selected)

            # Repair only the precise legacy seed selection, keeping other fields.
            legacy = [skill['id'] for skill in samples[0]['resume']['skills']]
            expected_selection = list(selected)
            resume.config['selection']['skillIds'] = legacy
            resume.config['personalSummary'] = 'User-edited summary'
            resume.config['jdAnalysis'].update(isOutdated=False, evaluationIsOutdated=False)
            previous_timestamp = resume.updated_at
            await benchmark.seed_samples(owner, samples, session=session)
            self.assertEqual(resume.config['selection']['skillIds'], expected_selection)
            self.assertEqual(resume.config['personalSummary'], 'User-edited summary')
            self.assertTrue(resume.config['jdAnalysis']['isOutdated'])
            self.assertTrue(resume.config['jdAnalysis']['evaluationIsOutdated'])
            self.assertGreater(resume.updated_at, previous_timestamp)

            # Subsequent runs must retain intentional valid or empty selections.
            for user_selection in ([str(extra_user_skill.id)], []):
                resume.config['selection']['skillIds'] = user_selection
                before = copy.deepcopy(resume.config)
                previous_timestamp = resume.updated_at
                await benchmark.seed_samples(owner, samples, session=session)
                self.assertEqual(resume.config, before)
                self.assertEqual(resume.updated_at, previous_timestamp)

            # Never repair an unmarked record or write dangling account-skill IDs.
            resume.config['selection']['skillIds'] = legacy
            resume.config.pop('qaBenchmark')
            before = copy.deepcopy(resume.config)
            await benchmark.seed_samples(owner, samples, session=session)
            self.assertEqual(resume.config, before)
            resume.config['qaBenchmark'] = '2026-09-06-blind'
            import uuid
            missing_key = (UserSkill, uuid.UUID(expected_selection[0]))
            session.rows.pop(missing_key)
            before = copy.deepcopy(resume.config)
            previous_timestamp = resume.updated_at
            with self.assertRaisesRegex(RuntimeError, 'QA account skill'):
                await benchmark.seed_samples(owner, samples, session=session)
            self.assertEqual(resume.config, before)
            self.assertEqual(resume.updated_at, previous_timestamp)

    async def test_accounts_have_separate_idempotent_seed_graphs_and_unchanged_fixtures(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            with patch.object(benchmark, 'OUT', output):
                benchmark.prepare()
                samples = json.loads((output / 'fixtures.json').read_text(encoding='utf-8'))['samples'][:2]
                original = copy.deepcopy(samples)
                session = MemorySession()
                with patch('app.database.AsyncSessionFactory', session_factory(session)):
                    for owner in ('qa-blind-20260906', 'browser-test-user', 'another-browser-user'):
                        await benchmark.seed_samples(owner, samples)
                        before = set(session.rows)
                        await benchmark.seed_samples(owner, samples)
                        self.assertEqual(set(session.rows), before)
                        saved = json.loads((output / 'seeded-resumes.json').read_text(encoding='utf-8'))
                        resumes = [r for (model, _), r in session.rows.items()
                                   if model is Resume and r.user_id == owner]
                        self.assertEqual({str(r.id) for r in resumes}, {r['resume_id'] for r in saved})
                        self.assertEqual(len(resumes), len(samples))
                        for resume in resumes:
                            links = [r for (model, _), r in session.rows.items()
                                     if model is ResumeExperienceLink and r.resume_id == resume.id]
                            masters = []
                            for link in links:
                                version = session.rows[ExperienceVersion, link.experience_version_id]
                                master = session.rows[MasterExperience, version.master_experience_id]
                                self.assertEqual(master.user_id, owner)
                                self.assertEqual(master.latest_version_id, version.id)
                                masters.append(str(master.id))
                            selected = resume.config['selection']
                            self.assertEqual(set(masters), set(selected['experienceIds'] + selected['educationIds']))
                            self.assertEqual(len(selected['experienceIds']), 2)
                            self.assertEqual(len(selected['educationIds']), 1)
                self.assertEqual(samples, original)
                user_skills = [r for (model, _), r in session.rows.items() if model is UserSkill]
                self.assertEqual(len(user_skills), 9)
                # Existing internal QA rows keep their IDs; browser seeding does not replace them.
                legacy_ids = {benchmark.uid(s['id']) for s in samples}
                self.assertEqual(legacy_ids, {str(r.id) for (model, _), r in session.rows.items()
                                             if model is Resume and r.user_id == 'qa-blind-20260906'})

    async def test_seed_conflict_prevents_entitlement_grant_and_commit(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            (output / 'fixtures.json').write_text('{"samples":[]}', encoding='utf-8')
            session = MagicMock()
            session.get = AsyncMock(return_value=SimpleNamespace(id='browser-test-user'))
            session.commit = AsyncMock()
            grant = AsyncMock(return_value=SimpleNamespace(wallet=SimpleNamespace(
                unlimited_tokens_expires_at=SimpleNamespace(isoformat=lambda: 'later'))))
            settings = SimpleNamespace(database_url='postgresql://localhost/resumeflow',
                                       ai_route_profile='test', gemini_model='test')
            with (patch.object(benchmark, 'OUT', output),
                  patch('app.config.load_settings', return_value=settings),
                  patch('app.database.AsyncSessionFactory', session_factory(session)),
                  patch('app.domain.billing.entitlement_service.grant_entitlement', grant),
                  patch.object(benchmark, 'validate_frozen_run', return_value={'samples': []}),
                  patch.object(benchmark, 'seed_samples', AsyncMock(side_effect=RuntimeError('seed conflict')))):
                with self.assertRaisesRegex(RuntimeError, 'seed conflict'):
                    await benchmark.run('browser-test-user')
            grant.assert_not_awaited()
            session.commit.assert_not_awaited()
            self.assertFalse((output / 'account.json').exists())

    async def test_entitlement_failure_leaves_seed_transaction_uncommitted(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            (output / 'fixtures.json').write_text('{"samples":[]}', encoding='utf-8')
            session = MemorySession()
            session.get = AsyncMock(return_value=SimpleNamespace(id='browser-test-user'))
            factory = session_factory(session)
            settings = SimpleNamespace(database_url='postgresql://localhost/resumeflow',
                                       ai_route_profile='test', gemini_model='test')
            seed = AsyncMock(return_value=[{'sample': 'R7K2', 'resume_id': 'seeded'}])
            with (patch.object(benchmark, 'OUT', output),
                  patch('app.config.load_settings', return_value=settings),
                  patch('app.database.AsyncSessionFactory', factory),
                  patch.object(benchmark, 'validate_frozen_run', return_value={'samples': []}),
                  patch.object(benchmark, 'seed_samples', seed),
                  patch('app.domain.billing.entitlement_service.grant_entitlement',
                        AsyncMock(side_effect=RuntimeError('grant failed')))):
                with self.assertRaisesRegex(RuntimeError, 'grant failed'):
                    await benchmark.run('browser-test-user')
            seed.assert_awaited_once_with('browser-test-user', [], session=session)
            session.commit.assert_not_awaited()
            self.assertIs(factory.return_value.__aexit__.await_args.args[0], RuntimeError)
            self.assertFalse((output / 'account.json').exists())
            self.assertFalse((output / 'seeded-resumes.json').exists())

    async def test_caller_owns_seed_commit_and_artifact_publication(self):
        with tempfile.TemporaryDirectory() as directory:
            session = MemorySession()
            with patch.object(benchmark, 'OUT', Path(directory)):
                self.assertEqual(await benchmark.seed_samples('browser-test-user', [], session=session), [])
            session.commit.assert_not_awaited()
            self.assertEqual(list(Path(directory).iterdir()), [])


def setUpModule():
    # Exercise historical cache/account contracts with a mocked numeric service.
    # Current CLI rejection is covered without this mock in test_qa_numeric_contract_guard.
    gate = patch("qa_resume_blind_benchmark.reject_retired_numeric_run")
    gate.start()
    unittest.addModuleCleanup(gate.stop)

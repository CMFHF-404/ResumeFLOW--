import json
import tempfile
import unittest
from pathlib import Path
import evaluate_resume_review_v4 as experiment
from test_evidence_resume_score import snapshot


class ReviewProfileExperimentTests(unittest.TestCase):
    def test_freeze_preserves_original_input_and_builds_text_equivalent(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);input_dir=root/'inputs';input_dir.mkdir()
            data={'id':'A','snapshot':snapshot(),'jd':''}
            experiment.write_new(input_dir/'input-A.json',data)
            before=experiment.sha(input_dir/'input-A.json')
            target=root/'experiment'/'manifest.json'
            experiment.freeze(input_dir,target,True)
            manifest=experiment.read(target)
            self.assertEqual(len(manifest['samples']),2)
            self.assertEqual(experiment.sha(input_dir/'input-A.json'),before)
            equivalent=experiment.read(root/'experiment'/'A-equivalent.json')
            self.assertEqual(equivalent['snapshot']['resume']['experiences'][0]['star']['a'],'核查费用\n对账清单获采纳')
            with self.assertRaises(FileExistsError):experiment.freeze(input_dir,target,False)

    def test_incomplete_or_duplicate_runs_cannot_be_selected(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            experiment.write_new(root/'run-manifest.json',dict(profiles=['low'],repetitions=3,samples=[{'id':'A','kind':'primary'}]))
            row=dict(profile='low',sampleId='A',kind='primary',repetition=1,status='success',elapsedSeconds=2,usage=[],report={'overallScore':75,'suggestions':[]})
            experiment.write_new(root/'low-A-1.json',row)
            result=experiment.summarize(root)
            self.assertIsNone(result['developmentCandidate'])
            self.assertFalse(result['productionEligible'])
            self.assertEqual(result['profiles'][0]['qualityStatus'],'runtime_failed')
            self.assertIsNone(result['profiles'][0]['totalTokens'])
            experiment.write_new(root/'duplicate.json',row)
            with self.assertRaises(ValueError):experiment.summarize(root)

    def test_useful_coverage_can_pass_despite_score_variation_but_quantity_alone_cannot(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            experiment.write_new(root/'run-manifest.json',dict(profiles=['medium'],repetitions=3,samples=[{'id':'A','kind':'primary'}]))
            suggestions=[dict(moduleType='experience_star',moduleId=str(i),primaryCriterionId='contribution_2',severity='medium',action='rewrite') for i in range(9)]
            for rep,score in enumerate([40,90,55],1):
                experiment.write_new(root/f'medium-A-{rep}.json',dict(profile='medium',sampleId='A',kind='primary',repetition=rep,status='success',elapsedSeconds=2,usage=[],report={'overallScore':score,'suggestions':suggestions}))
            review=dict(completeCheckpoints=22,checkpointCount=27,falsePositives=0,reviewedDiagnostics=27,actionableDiagnostics=27,severeErrors=0)
            label_file=root/'review-labels.json'
            try:
                label_file.write_text(json.dumps(dict(runManifestHash=experiment.sha(root/'run-manifest.json'),profiles={'medium':review})),encoding='utf-8')
                result=experiment.summarize(root,label_file)
                self.assertEqual(result['developmentCandidate'],'medium')
                self.assertEqual(result['profiles'][0]['ranges']['A'],50)
                self.assertEqual(result['profiles'][0]['recommendationCounts']['A'],[9,9,9])
                review['actionableDiagnostics']=0
                label_file.write_text(json.dumps(dict(runManifestHash=experiment.sha(root/'run-manifest.json'),profiles={'medium':review})),encoding='utf-8')
                self.assertIsNone(experiment.summarize(root,label_file)['developmentCandidate'])
            finally:label_file.unlink(missing_ok=True)

    def test_repeated_timeouts_record_unstarted_members_instead_of_retrying(self):
        import asyncio
        from types import SimpleNamespace
        from unittest.mock import AsyncMock,patch
        from app.domain.ai import resume_score
        from app.domain.ai.runtime_budget import AiRuntimeTimeoutError
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);inputs=root/'inputs';inputs.mkdir()
            experiment.write_new(inputs/'input-A.json',dict(id='A',snapshot=snapshot(),jd=''))
            manifest=root/'manifest.json';experiment.freeze(inputs,manifest)
            error=RuntimeError('fixture timeout');error.__cause__=AiRuntimeTimeoutError('timeout')
            args=SimpleNamespace(live=True,manifest=str(manifest),output=str(root/'output'),model=None,profiles=['high'],repeat=3)
            call=AsyncMock(side_effect=error)
            with patch.object(resume_score,'generate_review_score',call):asyncio.run(experiment.run(args))
            self.assertEqual(call.await_count,2)
            summary=experiment.summarize(root/'output')['profiles'][0]
            self.assertEqual(summary['calls'],2);self.assertEqual(summary['notRun'],1)
            self.assertEqual(summary['missingMembers'],0);self.assertEqual(summary['successful'],0)


if __name__=='__main__':unittest.main()

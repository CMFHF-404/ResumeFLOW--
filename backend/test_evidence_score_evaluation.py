import json
import tempfile
import unittest
from pathlib import Path
import evaluate_evidence_score as evaluation


class EvaluationHarnessTests(unittest.TestCase):
    def test_scaffold_is_balanced_but_cannot_fake_author_confirmation(self):
        with tempfile.TemporaryDirectory() as tmp:
            evaluation.scaffold(tmp)
            manifest=Path(tmp)/'manifest.json'
            samples=evaluation.read(manifest)['samples']
            self.assertEqual(len(samples),32)
            self.assertEqual(sum(s['split']=='holdout' for s in samples),16)
            from collections import Counter
            counts=Counter(s['role'] for s in samples)
            self.assertEqual(counts,dict(product=4,technology=4,finance=4,operations=4,data_analysis=8,industry_research=8))
            with self.assertRaises(ValueError):evaluation.validate_manifest(manifest)
            with self.assertRaises(FileExistsError):evaluation.scaffold(tmp)

    def test_incomplete_or_unlabelled_runs_cannot_pass_quality_gate(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'results.jsonl'
            records=[dict(runId=f'one:A:{i}',baseId='one',variant='A',split='holdout',baseline=False,
                          manifestHash='hash',status='success',elapsedSeconds=i,usage=[{'total_tokens':100}],report={'overallScore':75}) for i in (1,2,3)]
            path.write_text('\n'.join(json.dumps(r) for r in records),encoding='utf-8')
            result=evaluation.summarize(path)
            self.assertFalse(result['completeHoldout'])
            self.assertEqual(result['status'],'engineering_results_only')
            self.assertEqual(result['p95Seconds'],3)
            self.assertEqual(result['stableFraction'],1)
            self.assertEqual(result['meanTotalTokens'],100)
            self.assertIsNone(result['polishWithinFiveFraction'])

    def test_duplicate_or_mismatched_judgments_are_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'results.jsonl'
            record=dict(runId='one:A:1',baseId='one',variant='A',split='dev',baseline=False,manifestHash='hash',status='success',elapsedSeconds=1,usage=[],report={'overallScore':75})
            path.write_text(json.dumps(record),encoding='utf-8')
            labels=Path(tmp)/'labels.json'
            evaluation.write_new(labels,{'reviewers':['same','same'],'resolved':True})
            with self.assertRaises(ValueError):evaluation.summarize(path,labels)
            labels.write_text(json.dumps({'reviewers':['hr1','hr2'],'resolved':True,'resultHash':'incorrect','manifestHash':'hash'}),encoding='utf-8')
            with self.assertRaises(ValueError):evaluation.summarize(path,labels)

    def test_advice_first_acceptance_does_not_gate_on_score_spread_or_gradient_order(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'results.jsonl'; records=[];judgments=[];gradients=[]
            for base in range(16):
                identity=f'base-{base}'
                gradients.append(dict(baseId=identity,expectedOrder=['A','C','D']))
                for variant in 'ABCD':
                    for rep,score in enumerate([40,90,55],1):
                        run_id=f'{identity}:{variant}:{rep}'
                        records.append(dict(runId=run_id,baseId=identity,variant=variant,repetition=rep,split='holdout',baseline=False,
                            manifestHash='fixture-hash',status='success',elapsedSeconds=1,usage=[],report={'overallScore':score}))
                        judgments.append(dict(runId=run_id,expectedHigh=1,truePositiveHigh=1,falsePositiveHigh=0,importantDiagnostics=1,
                            correctSources=1,shouldKeep=1,incorrectlyChanged=0,severeErrors=0,reviewedDiagnostics=1,actionableDiagnostics=1))
            path.write_text('\n'.join(json.dumps(r) for r in records),encoding='utf-8')
            labels=Path(tmp)/'review.json'
            evaluation.write_new(labels,dict(resultHash=evaluation.file_hash(path),manifestHash='fixture-hash',reviewers=['fixture-hr1','fixture-hr2'],resolved=True,judgments=judgments,gradients=gradients))
            result=evaluation.summarize(path,labels)
            self.assertEqual(result['stableFraction'],0)
            self.assertEqual(result['gradientAccuracy'],0)
            self.assertEqual(result['adviceActionability'],1)
            self.assertEqual(result['status'],'quality_thresholds_met')
            self.assertTrue(result['scoreMetricsAreObservational'])


if __name__=='__main__':unittest.main()

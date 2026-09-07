import asyncio
import copy
import json
import runpy
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import qa_resume_blind_benchmark as benchmark
from app.domain.ai import resume_evaluation_service as evaluation_service


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value), encoding="utf-8")


def snapshot(folder):
    return {p.name: p.read_bytes() for p in folder.iterdir() if p.is_file()}


class FrozenRunTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.original = Path(self.temp.name) / "benchmark"
        self.sample = {"id": "R3V6", "resume": {
            "personal_summary": "Original text", "experiences": [],
        }, "sources": {}}
        self.fixture = {"samples": [self.sample]}
        write_json(self.original / "fixtures.json", self.fixture)
        write_json(self.original / "key-R3V6.json", {})
        write_json(self.original.with_name("benchmark-holdout4") / "fixtures.json",
                   {"samples": []})
        previous = self.original.with_name("benchmark-final4")
        write_json(previous / "fixtures.json", self.fixture)
        write_json(previous / "key-R3V6.json", {})
        write_json(previous / "baseline-R3V6-1.json", {
            "ok": True, "value": {"resumeEvaluation": {"overallScore": 1}},
        })
        for index in (1, 2):
            write_json(previous / f"optimization-R3V6-{index}.json", {
                "value": {"initial_plan": {"changes": [], "questions": []}},
            })

    def load(self, script, tag):
        with (patch.object(benchmark, "OUT", self.original),
              patch.object(benchmark, "IDS", benchmark.IDS.copy()),
              patch.object(evaluation_service, "_analyze_resume_evaluation_once",
                           evaluation_service._analyze_resume_evaluation_once),
              patch("sys.argv", [script, tag]),
              patch.object(asyncio, "run", side_effect=lambda coro: coro.close())):
            return runpy.run_path(str(Path(__file__).with_name(script)), run_name="__main__")

    def test_interrupted_member_attempts_append_without_replacing_prior_evidence(self):
        self.load("qa_resume_blind_final.py", "interrupted")
        output = self.original.with_name("benchmark-interrupted")
        prior_path = output / "member-baseline-R3V6-1-1.json"
        prior = {"ok": False, "error_type": "HistoricalFailure"}
        write_json(prior_path, prior)
        original_bytes = prior_path.read_bytes()
        # No complete baseline file exists, so restarting must attempt this case.
        for outcome in ({"report": "new"}, ValueError("new failure")):
            namespace = self.load("qa_resume_blind_final.py", "interrupted")
            model = AsyncMock(side_effect=outcome) if isinstance(outcome, Exception) else AsyncMock(return_value=outcome)
            token = namespace["case"].set("baseline-R3V6-1")
            try:
                with (patch.object(benchmark, "OUT", output),
                      patch.dict(namespace["observe_member"].__globals__, {"once": model})):
                    if isinstance(outcome, Exception):
                        with self.assertRaises(ValueError):
                            asyncio.run(namespace["observe_member"]("JD", "resume"))
                    else:
                        asyncio.run(namespace["observe_member"]("JD", "resume"))
            finally:
                namespace["case"].reset(token)
            self.assertEqual(prior_path.read_bytes(), original_bytes)
        rows = [json.loads(p.read_text(encoding="utf-8")) for p in output.glob("member-*.json")]
        self.assertEqual(len(rows), 3)
        self.assertEqual(sum(row["ok"] for row in rows), 1)
        self.assertEqual({row["error_type"] for row in rows if not row["ok"]},
                         {"HistoricalFailure", "ValueError"})

    def test_timed_out_and_cancelled_members_are_recorded_and_still_propagate(self):
        namespace = self.load("qa_resume_blind_final.py", "cancelled")
        output = self.original.with_name("benchmark-cancelled")

        async def exercise():
            started = asyncio.Event()

            async def stalled(*args, **kwargs):
                started.set()
                await asyncio.Event().wait()

            with (patch.object(benchmark, "OUT", output),
                  patch.dict(namespace["observe_member"].__globals__, {"once": stalled})):
                with self.assertRaises(TimeoutError):
                    await asyncio.wait_for(namespace["observe_member"]("JD", "resume"), 0.02)
                self.assertTrue(started.is_set())
                started.clear()
                task = asyncio.create_task(namespace["observe_member"]("JD", "resume"))
                await started.wait()
                task.cancel()
                with self.assertRaises(asyncio.CancelledError):
                    await task

        asyncio.run(exercise())
        rows = [json.loads(p.read_text(encoding="utf-8")) for p in output.glob("member-*.json")]
        self.assertEqual(len(rows), 2)
        self.assertTrue(all(row == {"ok": False, "error_type": "CancelledError"} for row in rows))

    def test_both_entrypoints_reject_changed_resolved_model_configuration(self):
        from app.domain.ai import llm_transport

        settings = SimpleNamespace(
            ai_route_profile="gemini_primary", gemini_model="gemini-test-a",
            gemini_api_key="PRIVATE_API_KEY", gemini_base_url="https://provider.invalid/v1",
            ai_timeout_seconds=60, ai_model="other-model", ai_api_key="OTHER_SECRET",
            ai_base_url="https://other.invalid/v1",
        )
        for script, tag in (("qa_resume_blind_final.py", "configfinal"),
                            ("qa_resume_summary_feedback_probe.py", "configsummary")):
            with self.subTest(script=script):
                with patch.object(llm_transport, "settings", settings):
                    self.load(script, tag)
                output = self.original.with_name("benchmark-" + tag)
                before = snapshot(output)
                for field, value in (("gemini_model", "gemini-test-b"),
                                     ("gemini_base_url", "https://another.invalid/v1"),
                                     ("ai_route_profile", "openai_primary"),
                                     ("ai_timeout_seconds", 90)):
                    changed = copy.copy(settings)
                    setattr(changed, field, value)
                    with self.subTest(field=field), patch.object(llm_transport, "settings", changed):
                        with self.assertRaisesRegex(SystemExit, "NEW run tag"):
                            self.load(script, tag)
                    self.assertEqual(snapshot(output), before)

    def test_member_id_collision_cannot_overwrite_an_existing_record(self):
        namespace = self.load("qa_resume_blind_final.py", "collision")
        output = self.original.with_name("benchmark-collision")
        path = output / "member-baseline-R3V6-1-existing.json"
        write_json(path, {"ok": False, "error_type": "OriginalFailure"})
        before = path.read_bytes()
        with (patch.object(benchmark, "OUT", output),
              patch.object(namespace["uuid"], "uuid4", return_value=SimpleNamespace(hex="existing"))):
            with self.assertRaises(FileExistsError):
                namespace["record_member"]("baseline-R3V6-1", {"ok": True})
        self.assertEqual(path.read_bytes(), before)

    def test_runtime_fingerprint_omits_credentials_but_binds_endpoint_and_budget(self):
        from app.domain.ai import llm_transport, runtime_budget

        settings = SimpleNamespace(
            ai_route_profile="gemini_primary", gemini_model="gemini-test",
            gemini_api_key="PRIVATE_API_KEY",
            gemini_base_url="https://PRIVATE_USER:PRIVATE_PASSWORD@provider.invalid/PRIVATE_PATH?key=PRIVATE_QUERY",
            ai_timeout_seconds=60,
        )
        with patch.object(llm_transport, "settings", settings):
            with patch.object(runtime_budget, "get_ai_runtime_budget", return_value=runtime_budget.AiRuntimeBudget(max_output_tokens=1000)):
                first = benchmark.qa_runtime_fingerprint()
                rotated = copy.copy(settings)
                rotated.gemini_api_key = "ROTATED_PRIVATE_KEY"
                with patch.object(llm_transport, "settings", rotated):
                    self.assertEqual(benchmark.qa_runtime_fingerprint(), first)
            with patch.object(runtime_budget, "get_ai_runtime_budget", return_value=runtime_budget.AiRuntimeBudget(max_output_tokens=2000)):
                second = benchmark.qa_runtime_fingerprint()
        self.assertNotIn("PRIVATE_", json.dumps(first))
        self.assertNotIn("api_key", json.dumps(first))
        self.assertNotEqual(first, second)

    def test_final_rejects_changed_samples_before_replacing_metadata_or_cache(self):
        self.load("qa_resume_blind_final.py", "review")
        output = self.original.with_name("benchmark-review")
        write_json(output / "baseline-R3V6-1.json", {"ok": True, "source": "old"})
        before = snapshot(output)
        changed = copy.deepcopy(self.fixture)
        changed["samples"][0]["resume"]["personal_summary"] = "Different text"
        write_json(self.original / "fixtures.json", changed)
        with self.assertRaisesRegex(SystemExit, "NEW run tag"):
            self.load("qa_resume_blind_final.py", "review")
        self.assertEqual(snapshot(output), before)

    def test_final_matching_resume_preserves_metadata_and_cached_result(self):
        self.load("qa_resume_blind_final.py", "review")
        output = self.original.with_name("benchmark-review")
        cached = {"ok": True, "source": "original"}
        write_json(output / "baseline-R3V6-1.json", cached)
        before = snapshot(output)
        namespace = self.load("qa_resume_blind_final.py", "review")
        operation = AsyncMock()
        with patch.object(benchmark, "OUT", output):
            actual = asyncio.run(namespace["run_case"]("baseline-R3V6-1", operation))
        self.assertEqual(actual, cached)
        operation.assert_not_called()
        self.assertEqual(snapshot(output), before)

    def test_summary_rejects_existing_unattributed_evidence_before_any_write(self):
        output = self.original.with_name("benchmark-summaryfeedback")
        write_json(output / "algorithm-hashes.json", {"old.py": "old"})
        write_json(output / "post-1.json", {"ok": True, "historical": True})
        before = snapshot(output)
        with self.assertRaisesRegex(SystemExit, "NEW run tag"):
            self.load("qa_resume_summary_feedback_probe.py", "summaryfeedback")
        self.assertEqual(snapshot(output), before)

    def test_frozen_contract_rejects_algorithm_protocol_and_input_changes(self):
        output = self.original.with_name("benchmark-contract")
        artifacts = {"fixtures.json": self.fixture, "protocol.json": {"repeats": 3}}
        hashes = {"scorer.py": "original"}
        with patch.object(benchmark, "OUT", output):
            benchmark.prepare_frozen_wave_output(hashes, artifacts)
            before = snapshot(output)
            changed = copy.deepcopy(artifacts)
            changed["protocol.json"]["repeats"] = 4
            for other_hashes, other_artifacts in (({"scorer.py": "new"}, artifacts),
                                                 (hashes, changed)):
                with self.assertRaisesRegex(SystemExit, "NEW run tag"):
                    benchmark.prepare_frozen_wave_output(other_hashes, other_artifacts)
                self.assertEqual(snapshot(output), before)

    def test_frozen_contract_rejects_corrupt_metadata(self):
        output = self.original.with_name("benchmark-contract")
        artifacts = {"fixtures.json": self.fixture, "protocol.json": {"repeats": 3}}
        with patch.object(benchmark, "OUT", output):
            benchmark.prepare_frozen_wave_output({"scorer.py": "original"}, artifacts)
            (output / "fixtures.json").write_text("invalid JSON", encoding="utf-8")
            before = snapshot(output)
            with self.assertRaisesRegex(SystemExit, "NEW run tag"):
                benchmark.prepare_frozen_wave_output({"scorer.py": "original"}, artifacts)
            self.assertEqual(snapshot(output), before)

    def test_summary_uses_fresh_baseline_and_reuses_only_the_same_run(self):
        from app.domain.ai.resume_evaluation import SCORING_VERSION

        namespace = self.load("qa_resume_summary_feedback_probe.py", "summarynew")
        output = self.original.with_name("benchmark-summarynew")
        before = snapshot(output)
        evaluations = [{"resumeEvaluation": {
            "scoringVersion": SCORING_VERSION, "overallScore": score,
            "dimensions": [{"dimension": "test", "score": score}],
        }} for score in (40, 90, 60, 70, 70, 70)]
        evaluate = AsyncMock(side_effect=evaluations)
        optimize = AsyncMock(return_value={"resume": {"personal_summary": "After"}})
        replay = AsyncMock(return_value={"reviewed": True})
        judge = AsyncMock(return_value={"preferredId": "Q81"})

        async def record(name, operation, user_id):
            result = {"ok": True, "value": await operation()}
            benchmark.save(name + ".json", result)
            return result

        with (patch.object(benchmark, "OUT", output),
              patch.object(benchmark, "IDS", ["R3V6"]),
              patch.object(benchmark, "evaluate", evaluate),
              patch.object(benchmark, "optimize", optimize),
              patch.object(benchmark, "call_record", side_effect=record),
              patch.dict(namespace["main"].__globals__, {
                  "replay": replay, "judge": judge,
                  "engine": SimpleNamespace(dispose=AsyncMock()),
              })):
            asyncio.run(namespace["main"]())
            self.assertEqual(evaluate.await_count, 6)
            for call in optimize.await_args_list:
                self.assertEqual(call.args[1], evaluations[0]["resumeEvaluation"])
            self.assertEqual(replay.await_count, 2)
            summary = json.loads((output / "summary.json").read_text(encoding="utf-8"))
            self.assertEqual(summary[0]["baseline"]["scores"], [40, 90, 60])
            self.assertEqual(summary[0]["post"]["scores"], [70, 70, 70])
            asyncio.run(namespace["main"]())
            self.assertEqual(evaluate.await_count, 6)
            self.assertEqual(optimize.await_count, 2)
            self.assertEqual(replay.await_count, 2)
        self.assertTrue((output / "finished.json").exists())
        for name, data in before.items():
            self.assertEqual((output / name).read_bytes(), data)

    def test_summary_stops_before_optimization_without_valid_current_baseline(self):
        for case, baselines in (
            ("failed", [{"ok": False}] * 3),
            ("old", [{"ok": True, "value": {"resumeEvaluation": {
                "scoringVersion": "coverage_consensus_v1", "overallScore": 99,
            }}}]),
        ):
            with self.subTest(case=case):
                namespace = self.load("qa_resume_summary_feedback_probe.py", "summary" + case)
                output = self.original.with_name("benchmark-summary" + case)
                optimize = AsyncMock()
                calls = AsyncMock(side_effect=[{"ok": True}, {"ok": True}, *baselines])
                with (patch.object(benchmark, "OUT", output),
                      patch.object(benchmark, "optimize", optimize),
                      patch.dict(namespace["main"].__globals__, {
                          "run_case": calls, "engine": SimpleNamespace(dispose=AsyncMock()),
                      })):
                    with self.assertRaises(SystemExit):
                        asyncio.run(namespace["main"]())
                optimize.assert_not_called()
                self.assertFalse((output / "finished.json").exists())

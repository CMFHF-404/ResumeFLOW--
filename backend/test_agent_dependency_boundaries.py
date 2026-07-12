import os
import subprocess
import sys
import textwrap
import unittest


class AgentDependencyBoundaryTests(unittest.TestCase):
    def test_generated_resume_config_executes_without_loading_legacy_pdf_facade(self) -> None:
        script = textwrap.dedent(
            """
            import sys

            from app.domain.agent.agent_generated_resume_config import _build_agent_generated_resume_config
            from app.domain.agent.schemas import AgentJobAnalysisResponse, AgentJobGenerateRequest
            from app.domain.export.schemas import ResumeEditorProfileSnapshot, ResumePdfRenderSnapshot

            snapshot = ResumePdfRenderSnapshot(
                resumeName="示例公司_产品实习_90",
                profile=ResumeEditorProfileSnapshot(name="张三"),
                lineHeight=1.6,
                fontSize=16,
                listSpacingValue="1em",
                bulletSpacingValue="1em",
                topPaddingPx=75.59,
                sectionSpacingClass="mb-6",
                listSpacingClass="space-y-2",
                sectionOrder=[],
                selectedWorkItems=[],
                selectedProjectItems=[],
                educations=[],
            )
            payload = AgentJobGenerateRequest(
                job_title="产品实习",
                company_name="示例公司",
                jd_text="产品 JD",
                job_url="https://example.com/jobs/1",
            )
            analysis = AgentJobAnalysisResponse(
                match_percentage=90,
                evaluation="匹配",
                strengths=[],
                gaps=[],
                missing_keywords=[],
                recommendation="generate",
                suggested_folder_name="示例公司_产品实习_90",
            )

            config = _build_agent_generated_resume_config({}, snapshot, payload, analysis)
            assert config["jdAnalysis"]["jdText"] == "产品 JD"
            assert "app.domain.agent.agent_pdf_helpers" not in sys.modules
            """
        )
        env = os.environ.copy()
        env.setdefault(
            "DATABASE_URL",
            "postgresql+asyncpg://user:password@localhost:5432/resumeflow",
        )

        result = subprocess.run(
            [sys.executable, "-c", script],
            cwd=os.path.dirname(__file__),
            env=env,
            text=True,
            capture_output=True,
            check=False,
        )

        self.assertEqual(
            result.returncode,
            0,
            msg=f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}",
        )

    def test_legacy_facade_reexports_focused_layout_and_projection_helpers(self) -> None:
        from app.domain.agent import (
            agent_pdf_fit_service,
            agent_pdf_helpers,
            agent_pdf_layout_service,
            agent_pdf_snapshot_projection,
            agent_score_projection,
        )

        for name in (
            "CSS_PX_PER_MM",
            "PREVIEW_PADDING_MM",
            "SMART_PAGE_ITEM_SPACING_DEFAULT",
            "_apply_snapshot_layout",
            "_expand_snapshot_layout_candidates",
            "_hard_fallback_snapshot_layout",
            "_layout_float",
            "_layout_section_spacing_key",
        ):
            self.assertIs(
                getattr(agent_pdf_helpers, name),
                getattr(agent_pdf_layout_service, name),
            )
        self.assertIs(
            agent_pdf_helpers._snapshot_skill_ids,
            agent_pdf_snapshot_projection._snapshot_skill_ids,
        )
        self.assertIs(
            agent_pdf_fit_service._layout_float,
            agent_pdf_layout_service._layout_float,
        )
        self.assertIs(
            agent_pdf_helpers._score_entry_id,
            agent_score_projection._score_entry_id,
        )
        self.assertIs(
            agent_pdf_helpers._score_entry_score,
            agent_score_projection._score_entry_score,
        )

    def test_pdf_trim_executes_without_loading_legacy_pdf_facade(self) -> None:
        script = textwrap.dedent(
            """
            import sys

            from app.domain.agent.agent_pdf_trim_service import _analysis_score_map

            assert _analysis_score_map([{"id": "skill-1", "score": 91}]) == {"skill-1": 91}
            assert "app.domain.agent.agent_pdf_helpers" not in sys.modules
            """
        )
        env = os.environ.copy()
        env.setdefault(
            "DATABASE_URL",
            "postgresql+asyncpg://user:password@localhost:5432/resumeflow",
        )

        result = subprocess.run(
            [sys.executable, "-c", script],
            cwd=os.path.dirname(__file__),
            env=env,
            text=True,
            capture_output=True,
            check=False,
        )

        self.assertEqual(
            result.returncode,
            0,
            msg=f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}",
        )


if __name__ == "__main__":
    unittest.main()

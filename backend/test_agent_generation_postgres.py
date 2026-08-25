"""Opt-in PostgreSQL coverage for atomic/idempotent Agent generation.

Run only with ``RUN_AGENT_GENERATION_POSTGRES_TESTS=1`` and an isolated
``AGENT_GENERATION_TEST_DATABASE_URL``. Each test creates and drops its own
schema and never falls back to the application database URL.
"""

from __future__ import annotations

import asyncio
import json
import os
from types import SimpleNamespace
import unittest
import uuid
from unittest.mock import AsyncMock, patch

import asyncpg
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.domain.agent import agent_service
from app.domain.agent.schemas import AgentJobAnalysisResponse, AgentJobGenerateRequest
from app.domain.export import snapshot_service
from app.domain.export.schemas import ResumeEditorProfileSnapshot, ResumePdfRenderSnapshot
from app.domain.export.snapshot_service import SnapshotCapacityExceededError


RUN_ENV = "RUN_AGENT_GENERATION_POSTGRES_TESTS"
DATABASE_URL_ENV = "AGENT_GENERATION_TEST_DATABASE_URL"


def _normalize_async_url(value: str) -> str:
    if value.startswith("postgresql+asyncpg://"):
        return value
    if value.startswith("postgresql://"):
        return value.replace("postgresql://", "postgresql+asyncpg://", 1)
    if value.startswith("postgres://"):
        return value.replace("postgres://", "postgresql+asyncpg://", 1)
    raise AssertionError(f"{DATABASE_URL_ENV} must use PostgreSQL")


def _normalize_asyncpg_url(value: str) -> str:
    return _normalize_async_url(value).replace(
        "postgresql+asyncpg://", "postgresql://", 1
    )


def _snapshot() -> ResumePdfRenderSnapshot:
    return ResumePdfRenderSnapshot(
        resumeName="Agent generated",
        profile=ResumeEditorProfileSnapshot(name="Test User"),
        lineHeight=1.4,
        fontSize=13,
        listSpacingValue="0.3em",
        bulletSpacingValue="0.15em",
        topPaddingPx=42,
        sectionSpacingClass="mb-3",
        listSpacingClass="space-y-2",
    )


def _payload() -> AgentJobGenerateRequest:
    return AgentJobGenerateRequest(
        job_title="Product Intern",
        company_name="Example Company",
        jd_text="Product requirements and user research",
        job_url="https://example.com/jobs/1",
        force_one_page=False,
    )


def _analysis() -> AgentJobAnalysisResponse:
    return AgentJobAnalysisResponse(
        match_percentage=82,
        jd_match_percentage=82,
        resume_quality_percentage=90,
        evaluation="Strong fit",
        recommendation="generate",
        suggested_folder_name="82_Example Company_Product Intern",
    )


@unittest.skipUnless(
    os.environ.get(RUN_ENV) == "1" and os.environ.get(DATABASE_URL_ENV),
    f"requires {RUN_ENV}=1 and isolated {DATABASE_URL_ENV}",
)
class AgentGenerationPostgresTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.database_url = _normalize_async_url(os.environ[DATABASE_URL_ENV])
        self.schema_name = f"rf_agent_generation_{uuid.uuid4().hex}"
        connection = await asyncpg.connect(_normalize_asyncpg_url(self.database_url))
        try:
            await connection.execute(f'CREATE SCHEMA "{self.schema_name}"')
            await connection.execute(
                f'''
                CREATE TABLE "{self.schema_name}".users (
                    id TEXT PRIMARY KEY
                );
                CREATE TABLE "{self.schema_name}".resumes (
                    id UUID PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    title TEXT NOT NULL,
                    target_role TEXT,
                    config JSONB NOT NULL DEFAULT '{{}}'::jsonb,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
                );
                CREATE TABLE "{self.schema_name}".resume_experiences (
                    id UUID PRIMARY KEY,
                    resume_id UUID NOT NULL,
                    experience_version_id UUID NOT NULL,
                    overrides_json JSONB NOT NULL DEFAULT '{{}}'::jsonb,
                    display_order INTEGER NOT NULL DEFAULT 0,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
                );
                CREATE TABLE "{self.schema_name}".export_render_snapshots (
                    id UUID PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    payload_json JSONB NOT NULL DEFAULT '{{}}'::jsonb,
                    expires_at TIMESTAMPTZ NOT NULL,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                    consumed_at TIMESTAMPTZ,
                    render_claim_id UUID,
                    render_claim_expires_at TIMESTAMPTZ,
                    rendered_pdf BYTEA,
                    rendered_pdf_expires_at TIMESTAMPTZ
                );
                INSERT INTO "{self.schema_name}".users (id) VALUES ('user-1');
                '''
            )
        finally:
            await connection.close()

        self.engine = create_async_engine(
            self.database_url,
            connect_args={
                "statement_cache_size": 0,
                "server_settings": {"search_path": self.schema_name},
            },
            pool_size=2,
            max_overflow=0,
            pool_timeout=2,
        )
        self.sessions = async_sessionmaker(self.engine, expire_on_commit=False)

    async def asyncTearDown(self) -> None:
        await self.engine.dispose()
        connection = await asyncpg.connect(_normalize_asyncpg_url(self.database_url))
        try:
            await connection.execute(
                f'DROP SCHEMA IF EXISTS "{self.schema_name}" CASCADE'
            )
        finally:
            await connection.close()

    def _pipeline_patches(self, snapshot: ResumePdfRenderSnapshot):
        source_resume = SimpleNamespace(
            id=uuid.uuid4(),
            title="Source",
            target_role="Product",
            config={},
        )
        empty_bank = {
            "profile": None,
            "experiences": [],
            "certifications": [],
            "skills": [],
        }
        options = agent_service.AgentGenerateOptions(
            template_id="modern-slate",
            polish_before_output=False,
            polish_level="standard",
            force_one_page=False,
        )
        return (
            patch.object(
                agent_service,
                "resolve_agent_generate_options",
                AsyncMock(return_value=options),
            ),
            patch.object(
                agent_service,
                "resolve_agent_resume_detail",
                AsyncMock(return_value=(source_resume, [])),
            ),
            patch.object(
                agent_service,
                "_load_agent_bank",
                AsyncMock(return_value=empty_bank),
            ),
            patch.object(
                agent_service,
                "_load_resume_item_categories",
                AsyncMock(return_value={}),
            ),
            patch.object(
                agent_service,
                "_build_personal_summary",
                AsyncMock(return_value=""),
            ),
            patch.object(
                agent_service,
                "_build_resume_pdf_snapshot",
                return_value=snapshot,
            ),
            patch.object(
                agent_service,
                "_polish_snapshot_experiences",
                AsyncMock(return_value=snapshot),
            ),
            patch.object(
                agent_service,
                "_fit_snapshot_to_one_page",
                AsyncMock(return_value=snapshot),
            ),
        )

    async def _counts(self) -> tuple[int, int]:
        async with self.sessions() as session:
            resumes = (await session.execute(text("SELECT count(*) FROM resumes"))).scalar_one()
            snapshots = (
                await session.execute(text("SELECT count(*) FROM export_render_snapshots"))
            ).scalar_one()
        return int(resumes), int(snapshots)

    async def test_concurrent_retries_commit_one_resume_and_one_snapshot(self) -> None:
        payload = _payload()
        snapshot = _snapshot()
        context = agent_service.build_agent_idempotency_context(
            "user-1",
            "same-retry-key",
            payload,
            "legacy-v1",
        )
        start = asyncio.Event()

        async def generate():
            async with self.sessions() as session:
                await start.wait()
                return await agent_service.build_agent_resume_pdf(
                    SimpleNamespace(),
                    session,
                    "user-1",
                    payload,
                    _analysis(),
                    idempotency_context=context,
                )

        patches = self._pipeline_patches(snapshot)
        with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5], patches[6], patches[7]:
            tasks = [asyncio.create_task(generate()) for _ in range(2)]
            start.set()
            first, second = await asyncio.wait_for(asyncio.gather(*tasks), timeout=5)

        self.assertEqual(first.generated_resume_id, second.generated_resume_id)
        self.assertEqual(first.download_url, second.download_url)
        self.assertEqual(await self._counts(), (1, 1))
        connection = await asyncpg.connect(_normalize_asyncpg_url(self.database_url))
        try:
            config = await connection.fetchval(
                f'SELECT config FROM "{self.schema_name}".resumes LIMIT 1'
            )
        finally:
            await connection.close()
        parsed_config = json.loads(config) if isinstance(config, str) else config
        metadata = parsed_config["agentJob"]["idempotency"]
        self.assertEqual(metadata["keyHash"], context.key_hash)
        self.assertNotIn("same-retry-key", str(parsed_config))

    async def test_snapshot_capacity_failure_rolls_back_generated_resume(self) -> None:
        payload = _payload()
        snapshot = _snapshot()
        patches = self._pipeline_patches(snapshot)
        with (
            patches[0], patches[1], patches[2], patches[3],
            patches[4], patches[5], patches[6], patches[7],
            patch.object(
                snapshot_service,
                "MAX_ACTIVE_EXPORT_SNAPSHOTS_PER_USER",
                0,
            ),
        ):
            async with self.sessions() as session:
                with self.assertRaises(SnapshotCapacityExceededError):
                    await agent_service.build_agent_resume_pdf(
                        SimpleNamespace(),
                        session,
                        "user-1",
                        payload,
                        _analysis(),
                    )

        self.assertEqual(await self._counts(), (0, 0))

from __future__ import annotations

import logging
from typing import Annotated, Optional

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from sqlmodel.ext.asyncio.session import AsyncSession
from starlette.status import (
    HTTP_401_UNAUTHORIZED,
    HTTP_502_BAD_GATEWAY,
    HTTP_503_SERVICE_UNAVAILABLE,
    HTTP_504_GATEWAY_TIMEOUT,
)

from ...database import get_session
from ...dependencies import get_current_user
from ...auth_middleware import BEARER_PREFIX
from ..export.browser_pdf_service import BrowserPdfRenderError, BrowserPdfRenderTimeoutError
from .agent_service import (
    AgentAuthenticatedUser,
    AgentJobAnalysisBuild,
    build_agent_polish_options,
    build_agent_resume_template_options,
    authenticate_agent_api_key,
    build_agent_job_analysis_detail,
    build_agent_job_metadata,
    build_agent_resume_pdf,
    build_agent_skill_bundle,
    create_agent_api_key,
    get_agent_plugin_config,
    list_agent_api_keys,
    revoke_agent_api_key,
    upsert_agent_plugin_config,
)
from .schemas import (
    AgentApiKeyCreate,
    AgentApiKeyCreateResponse,
    AgentApiKeyRead,
    AgentApiKeyRevokeResponse,
    AgentPolishOption,
    AgentPolishOptionsResponse,
    AgentPluginConfigRead,
    AgentPluginConfigUpdate,
    AgentResumeTemplateOption,
    AgentResumeTemplateOptionsResponse,
    AgentSkillBundleResponse,
    AgentJobAnalysisResponse,
    AgentJobGenerateRequest,
    AgentJobGenerateResponse,
    AgentJobRequest,
    AgentResumePdf,
)

router = APIRouter(prefix="/agent", tags=["agent"])
logger = logging.getLogger(__name__)


async def get_agent_user(
    authorization: Annotated[Optional[str], Header()] = None,
    session: AsyncSession = Depends(get_session),
) -> AgentAuthenticatedUser:
    if not authorization or not authorization.startswith(BEARER_PREFIX):
        raise HTTPException(status_code=HTTP_401_UNAUTHORIZED, detail="Missing Agent API key")
    key = authorization[len(BEARER_PREFIX) :].strip()
    return await authenticate_agent_api_key(session, key)


async def build_agent_job_analysis_or_raise(
    session: AsyncSession,
    user_id: str,
    payload: AgentJobRequest,
) -> AgentJobAnalysisResponse:
    return (await build_agent_job_analysis_detail_or_raise(session, user_id, payload)).response


async def build_agent_job_analysis_detail_or_raise(
    session: AsyncSession,
    user_id: str,
    payload: AgentJobRequest,
) -> AgentJobAnalysisBuild:
    try:
        return await build_agent_job_analysis_detail(session, user_id, payload)
    except HTTPException:
        raise
    except ValueError as exc:
        logger.warning("Agent job analysis returned invalid AI payload.", exc_info=True)
        raise HTTPException(
            status_code=HTTP_502_BAD_GATEWAY,
            detail="AI analysis returned invalid JSON. Please retry the job analysis.",
        ) from exc
    except httpx.HTTPError as exc:
        logger.warning("Agent job analysis AI request failed.", exc_info=True)
        raise HTTPException(
            status_code=HTTP_503_SERVICE_UNAVAILABLE,
            detail="AI analysis service is temporarily unavailable. Please retry later.",
        ) from exc


@router.get("/config", response_model=AgentPluginConfigRead)
async def get_agent_config(
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
):
    return await get_agent_plugin_config(session, current_user.id)


@router.put("/config", response_model=AgentPluginConfigRead)
async def update_agent_config(
    payload: AgentPluginConfigUpdate,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
):
    return await upsert_agent_plugin_config(session, current_user.id, payload)


@router.get("/api-keys", response_model=list[AgentApiKeyRead])
async def list_agent_keys(
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
):
    return await list_agent_api_keys(session, current_user.id)


@router.post("/api-keys", response_model=AgentApiKeyCreateResponse)
async def create_agent_key(
    payload: AgentApiKeyCreate,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
):
    created = await create_agent_api_key(
        session,
        current_user.id,
        payload.name,
        rotate=payload.rotate,
    )
    return AgentApiKeyCreateResponse(key=created.plaintext_key, api_key=created.read)


@router.delete("/api-keys/{api_key_id}", response_model=AgentApiKeyRevokeResponse)
async def revoke_agent_key(
    api_key_id: str,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
):
    record = await revoke_agent_api_key(session, current_user.id, api_key_id)
    return AgentApiKeyRevokeResponse(id=str(record.id), revoked_at=record.revoked_at)


@router.get("/v1/skills/resumeflow-job-search", response_model=AgentSkillBundleResponse)
async def get_agent_skill_bundle(
    agent_user: AgentAuthenticatedUser = Depends(get_agent_user),
):
    return build_agent_skill_bundle()


@router.get("/v1/resume-templates", response_model=AgentResumeTemplateOptionsResponse)
async def get_agent_resume_templates(
    agent_user: AgentAuthenticatedUser = Depends(get_agent_user),
):
    return build_agent_resume_template_options()


@router.get("/v1/polish-options", response_model=AgentPolishOptionsResponse)
async def get_agent_polish_options(
    agent_user: AgentAuthenticatedUser = Depends(get_agent_user),
):
    return build_agent_polish_options()


@router.post("/v1/jobs/analyze", response_model=AgentJobAnalysisResponse)
async def analyze_agent_job(
    payload: AgentJobRequest,
    session: AsyncSession = Depends(get_session),
    agent_user: AgentAuthenticatedUser = Depends(get_agent_user),
):
    return await build_agent_job_analysis_or_raise(session, agent_user.id, payload)


@router.post("/v1/jobs/generate", response_model=AgentJobGenerateResponse)
async def generate_agent_job_resume(
    payload: AgentJobGenerateRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
    agent_user: AgentAuthenticatedUser = Depends(get_agent_user),
):
    analysis_build = await build_agent_job_analysis_detail_or_raise(session, agent_user.id, payload)
    analysis = analysis_build.response
    try:
        resume_pdf: AgentResumePdf = await build_agent_resume_pdf(
            request,
            session,
            agent_user.id,
            payload,
            analysis,
            analysis_result=analysis_build.raw_result,
        )
    except BrowserPdfRenderTimeoutError as exc:
        logger.warning("Agent resume PDF render timed out.", exc_info=True)
        raise HTTPException(status_code=HTTP_504_GATEWAY_TIMEOUT, detail=str(exc)) from exc
    except BrowserPdfRenderError as exc:
        logger.warning("Agent resume PDF render failed.", exc_info=True)
        raise HTTPException(status_code=HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    metadata = await build_agent_job_metadata(payload, analysis)
    return AgentJobGenerateResponse(
        **analysis.model_dump(),
        resume_pdf=resume_pdf,
        job_link_url=str(payload.job_url),
        job_metadata=metadata,
    )

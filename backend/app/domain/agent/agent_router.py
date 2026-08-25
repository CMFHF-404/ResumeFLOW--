from __future__ import annotations

import logging
from typing import Annotated, Optional

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, Response
from sqlmodel.ext.asyncio.session import AsyncSession
from starlette.status import (
    HTTP_400_BAD_REQUEST,
    HTTP_401_UNAUTHORIZED,
    HTTP_409_CONFLICT,
    HTTP_502_BAD_GATEWAY,
    HTTP_503_SERVICE_UNAVAILABLE,
    HTTP_504_GATEWAY_TIMEOUT,
)

from ...database import get_session
from ...dependencies import get_current_user
from ...auth_middleware import (
    BEARER_PREFIX,
    MAX_AUTHORIZATION_HEADER_CHARACTERS,
    MAX_BEARER_TOKEN_CHARACTERS,
)
from ..ai.runtime_budget import (
    BoundedAiRequestBodyRoute,
    TERMINAL_AI_RUNTIME_ERRORS,
    ai_wall_clock_limited,
    ai_runtime_http_exception,
)
from ..billing import billing_service
from ..export.browser_pdf_service import (
    BrowserPdfRenderError,
    BrowserPdfRenderTimeoutError,
    render_resume_pdf,
)
from ..export.export_router import (
    PDF_DOWNLOAD_RESPONSES,
    _decode_download_filename_header,
    _read_export_mode,
    _read_legacy_download_token,
    render_legacy_snapshot_pdf_download_response,
    render_owned_snapshot_pdf_download_response,
)
from ..export.download_contract import (
    EXPORT_MODE_HEADER,
    MAX_EXPORT_FILE_NAME_CHARACTERS,
    MAX_EXPORT_FILE_NAME_ENCODED_CHARACTERS,
)
from ..export.schemas import ResumePdfRenderSnapshot
from .agent_service import (
    AgentBankChangedError,
    AgentIdempotencyConflictError,
    AgentAuthenticatedUser,
    AgentJobAnalysisBuild,
    build_agent_polish_options,
    build_agent_resume_template_options,
    authenticate_agent_api_key,
    build_agent_job_analysis_detail,
    build_agent_job_metadata,
    build_agent_idempotency_context,
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

router = APIRouter(
    prefix="/agent",
    tags=["agent"],
    route_class=BoundedAiRequestBodyRoute,
)
logger = logging.getLogger(__name__)
IDEMPOTENCY_KEY_HEADER = "Idempotency-Key"
MAX_IDEMPOTENCY_KEY_CHARACTERS = 200


def _read_idempotency_key(request: Request) -> str | None:
    headers = getattr(request, "headers", None)
    values = headers.getlist(IDEMPOTENCY_KEY_HEADER) if headers is not None else []
    if not values:
        return None
    if len(values) != 1:
        raise HTTPException(
            status_code=HTTP_400_BAD_REQUEST,
            detail="Conflicting Idempotency-Key headers.",
        )
    value = values[0]
    if (
        not value
        or len(value) > MAX_IDEMPOTENCY_KEY_CHARACTERS
        or value != value.strip()
        or any(ord(character) < 0x20 or ord(character) == 0x7F for character in value)
    ):
        raise HTTPException(
            status_code=HTTP_400_BAD_REQUEST,
            detail="Invalid Idempotency-Key header.",
        )
    return value


async def get_agent_user(
    authorization: Annotated[Optional[str], Header()] = None,
    session: AsyncSession = Depends(get_session),
) -> AgentAuthenticatedUser:
    if (
        not authorization
        or len(authorization) > MAX_AUTHORIZATION_HEADER_CHARACTERS
        or not authorization.startswith(BEARER_PREFIX)
    ):
        raise HTTPException(status_code=HTTP_401_UNAUTHORIZED, detail="Missing Agent API key")
    key = authorization[len(BEARER_PREFIX) :].strip()
    if not key or len(key) > MAX_BEARER_TOKEN_CHARACTERS:
        raise HTTPException(status_code=HTTP_401_UNAUTHORIZED, detail="Invalid Agent API key")
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
    except TERMINAL_AI_RUNTIME_ERRORS as exc:
        raise ai_runtime_http_exception(exc) from exc
    except ValueError as exc:
        logger.warning("Agent job analysis returned invalid AI payload.")
        raise HTTPException(
            status_code=HTTP_502_BAD_GATEWAY,
            detail="AI analysis returned invalid JSON. Please retry the job analysis.",
        ) from exc
    except httpx.HTTPError as exc:
        logger.warning("Agent job analysis AI request failed.")
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
        expected_active_key_id=payload.expected_active_key_id,
        enforce_expected_active_key=(
            "expected_active_key_id" in payload.model_fields_set
        ),
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


@router.get(
    "/v1/exports/resume-pdf/{snapshot_id}",
    response_class=Response,
    responses=PDF_DOWNLOAD_RESPONSES,
)
async def download_agent_resume_pdf(
    request: Request,
    snapshot_id: str,
    token: str | None = Query(
        default=None,
        description="Legacy signed-link compatibility token.",
        deprecated=True,
    ),
    fileName: str | None = Query(
        default=None,
        max_length=MAX_EXPORT_FILE_NAME_CHARACTERS,
        description="Legacy download filename.",
        deprecated=True,
    ),
    file_name: Annotated[
        Optional[str],
        Header(
            alias="X-ResumeFlow-File-Name",
            max_length=MAX_EXPORT_FILE_NAME_ENCODED_CHARACTERS,
        ),
    ] = None,
    authorization: Annotated[Optional[str], Header()] = None,
    session: AsyncSession = Depends(get_session),
) -> Response:
    legacy_token = _read_legacy_download_token(request, token)
    if legacy_token is not None:
        return await render_legacy_snapshot_pdf_download_response(
            snapshot_id,
            legacy_token,
            ResumePdfRenderSnapshot,
            render_resume_pdf,
            fileName,
        )
    agent_user = await get_agent_user(authorization, session)
    return await render_owned_snapshot_pdf_download_response(
        snapshot_id,
        agent_user.id,
        ResumePdfRenderSnapshot,
        render_resume_pdf,
        _decode_download_filename_header(file_name),
    )


@router.post("/v1/jobs/analyze", response_model=AgentJobAnalysisResponse)
async def analyze_agent_job(
    payload: AgentJobRequest,
    session: AsyncSession = Depends(get_session),
    agent_user: AgentAuthenticatedUser = Depends(get_agent_user),
):
    async with billing_service.ai_billing_context(
        session,
        agent_user.id,
        entrypoint="agent_job_analysis",
        metadata={"route": "/agent/v1/jobs/analyze"},
    ):
        await billing_service.ensure_current_quota()
        return await build_agent_job_analysis_or_raise(session, agent_user.id, payload)


@router.post("/v1/jobs/generate", response_model=AgentJobGenerateResponse)
@ai_wall_clock_limited
async def generate_agent_job_resume(
    payload: AgentJobGenerateRequest,
    request: Request,
    response: Response,
    idempotency_key_header: str | None = Header(
        default=None,
        alias=IDEMPOTENCY_KEY_HEADER,
        max_length=MAX_IDEMPOTENCY_KEY_CHARACTERS,
        description="Optional retry key. Reusing it with a different request returns 409.",
    ),
    export_mode_header: str | None = Header(
        default=None,
        alias=EXPORT_MODE_HEADER,
        description="Export link contract version. Defaults to legacy-v1.",
    ),
    session: AsyncSession = Depends(get_session),
    agent_user: AgentAuthenticatedUser = Depends(get_agent_user),
):
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"
    response.headers["Referrer-Policy"] = "no-referrer"
    del export_mode_header, idempotency_key_header  # OpenAPI declarations; duplicates use Request.
    export_mode = _read_export_mode(request)
    idempotency_key = _read_idempotency_key(request)
    idempotency_context = (
        build_agent_idempotency_context(
            agent_user.id,
            idempotency_key,
            payload,
            export_mode,
        )
        if idempotency_key is not None
        else None
    )
    async with billing_service.ai_billing_context(
        session,
        agent_user.id,
        entrypoint="agent_job_generate",
        metadata={"route": "/agent/v1/jobs/generate"},
    ):
        await billing_service.ensure_current_quota()
        analysis_build = await build_agent_job_analysis_detail_or_raise(session, agent_user.id, payload)
        analysis = analysis_build.response
        try:
            build_options = (
                {"idempotency_context": idempotency_context}
                if idempotency_context is not None
                else {}
            )
            resume_pdf: AgentResumePdf = await build_agent_resume_pdf(
                request,
                session,
                agent_user.id,
                payload,
                analysis,
                analysis_result=analysis_build.raw_result,
                export_mode=export_mode,
                **build_options,
            )
        except BrowserPdfRenderTimeoutError as exc:
            logger.warning("Agent resume PDF render timed out.", exc_info=True)
            raise HTTPException(status_code=HTTP_504_GATEWAY_TIMEOUT, detail=str(exc)) from exc
        except BrowserPdfRenderError as exc:
            logger.warning("Agent resume PDF render failed.", exc_info=True)
            raise HTTPException(status_code=HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
        except AgentBankChangedError as exc:
            logger.info("Agent resume bank changed during generation.")
            raise HTTPException(status_code=HTTP_409_CONFLICT, detail=str(exc)) from exc
        except AgentIdempotencyConflictError as exc:
            raise HTTPException(status_code=HTTP_409_CONFLICT, detail=str(exc)) from exc
        except TERMINAL_AI_RUNTIME_ERRORS as exc:
            raise ai_runtime_http_exception(exc) from exc
        except ValueError as exc:
            logger.warning("Agent generated resume evaluation was invalid.")
            raise HTTPException(
                status_code=HTTP_502_BAD_GATEWAY,
                detail="AI analysis returned invalid JSON. Please retry.",
            ) from exc
        except httpx.HTTPError as exc:
            logger.warning("Agent final resume analysis request failed.")
            raise HTTPException(
                status_code=HTTP_503_SERVICE_UNAVAILABLE,
                detail="AI analysis service is temporarily unavailable. Please retry later.",
            ) from exc
        metadata = await build_agent_job_metadata(payload, analysis)
        return AgentJobGenerateResponse(
            **analysis.model_dump(),
            resume_pdf=resume_pdf,
            job_link_url=str(payload.job_url),
            job_metadata=metadata,
        )

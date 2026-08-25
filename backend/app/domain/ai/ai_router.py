import asyncio
from datetime import datetime
import logging
from typing import Any, Awaitable, Dict, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, model_validator
from sqlmodel.ext.asyncio.session import AsyncSession
from starlette.status import HTTP_400_BAD_REQUEST

from ...database import get_session
from ...dependencies import get_current_user
from ...utils.ndjson import ndjson_line as _ndjson_line
from ..billing import billing_service
from ..resume.resume_service import (
    ConcurrencyConflictError,
    NotFoundError,
    persist_resume_boss_greeting,
)
from .ai_service import (
    analyze_jd,
    analyze_jd_with_image_thoughts,
    analyze_jd_with_thoughts,
    analyze_jd_with_image,
    analyze_resume_evaluation,
    analyze_resume_evaluation_with_thoughts,
    generate_personal_summary,
    generate_personal_summary_with_thoughts,
    generate_boss_greeting,
    generate_boss_greeting_with_thoughts,
    generate_tags,
    polish_experience,
    polish_experience_with_thoughts,
    split_experience_text,
)
from . import jd_attachment_service
from .public_errors import resolve_ai_public_response
from .runtime_budget import (
    BoundedAiRequestBodyRoute,
    build_public_stream_error_event,
    create_bounded_event_queue,
    finish_event_queue,
    new_ai_request_id,
    validate_ai_text_field,
)

router = APIRouter(
    prefix="/api",
    tags=["ai"],
    route_class=BoundedAiRequestBodyRoute,
)
logger = logging.getLogger(__name__)


async def _resolve_jd_analysis_response(
    operation: Awaitable[Dict[str, Any]],
) -> Dict[str, Any]:
    return await resolve_ai_public_response(operation)

def _stream_error_event(
    exc: Exception,
    request_id: str | None = None,
    *,
    preserve_value_error: bool = False,
) -> Dict[str, Any]:
    resolved_request_id = request_id or new_ai_request_id()
    known_exceptions = (
        HTTPException,
        NotFoundError,
        ConcurrencyConflictError,
    )
    if preserve_value_error:
        known_exceptions = (*known_exceptions, ValueError)
    if isinstance(exc, known_exceptions):
        logger.warning(
            "AI stream request failed request_id=%s error_type=%s",
            resolved_request_id,
            type(exc).__name__,
        )
    else:
        logger.error(
            "AI stream request crashed request_id=%s error_type=%s",
            resolved_request_id,
            type(exc).__name__,
        )
    return build_public_stream_error_event(
        exc,
        request_id=resolved_request_id,
        preserve_value_error=preserve_value_error,
        preserve_exceptions=known_exceptions,
    )


class _AiTextBudgetRequest(BaseModel):
    @model_validator(mode="after")
    def _validate_direct_text_fields(self):
        for field_name in type(self).model_fields:
            value = getattr(self, field_name, None)
            if isinstance(value, str):
                validate_ai_text_field(value, field_name)
        return self


class AnalyzeJDRequest(_AiTextBudgetRequest):
    text: str
    resume_text: Optional[str] = None
    prev_result: Optional[Dict[str, Any]] = None
    experience_text: Optional[str] = None
    prev_experience_text: Optional[str] = None


class ResumeEvaluationRequest(_AiTextBudgetRequest):
    text: str = ""
    resume_text: str
    jd_match_percentage: Optional[int] = Field(default=None, ge=0, le=100)


class PolishTextRequest(_AiTextBudgetRequest):
    content: Dict[str, Any]
    target_field: Optional[str] = None
    jd_text: Optional[str] = None
    mode: Optional[str] = None
    custom_prompt: Optional[str] = None
    entry_source: Optional[str] = None


class SplitExperienceTextRequest(_AiTextBudgetRequest):
    raw_text: str
    category: str
    org: Optional[str] = None
    title: Optional[str] = None


class GenerateTagsRequest(_AiTextBudgetRequest):
    text: str


class GenerateBossGreetingRequest(_AiTextBudgetRequest):
    jd_text: str
    analysis_summary: str
    job_title: Optional[str] = None
    company: Optional[str] = None
    resume_text: Optional[str] = None
    resume_id: Optional[str] = None
    signature: Optional[str] = None
    expected_updated_at: Optional[datetime] = None


class GeneratePersonalSummaryRequest(_AiTextBudgetRequest):
    mode: str
    profile: Optional[Dict[str, Any]] = None
    work_experiences: Optional[list[Dict[str, Any]]] = None
    project_experiences: Optional[list[Dict[str, Any]]] = None
    education_experiences: Optional[list[Dict[str, Any]]] = None
    certifications: Optional[list[Dict[str, Any]]] = None
    skills: Optional[list[Dict[str, Any]]] = None
    jd_text: Optional[str] = None


def _validate_form_text_fields(**values: str | None) -> None:
    for field_name, value in values.items():
        validate_ai_text_field(value, field_name)


@router.post("/analyze-jd", response_model=Dict[str, Any])
async def analyze_jd_endpoint(
    payload: AnalyzeJDRequest,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
):
    async with billing_service.ai_billing_context(
        session,
        current_user.id,
        entrypoint="jd_analysis",
        metadata={"route": "/api/analyze-jd"},
    ):
        await billing_service.ensure_current_quota()
        return await _resolve_jd_analysis_response(
            analyze_jd(
                payload.text,
                payload.resume_text,
                payload.prev_result,
                payload.experience_text,
                payload.prev_experience_text,
            )
        )


@router.post("/analyze-jd/stream")
async def analyze_jd_stream_endpoint(
    payload: AnalyzeJDRequest,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
):
    request_lease = await billing_service.begin_ai_request(
        session,
        current_user.id,
        entrypoint="jd_analysis",
    )

    async def event_stream():
        queue = create_bounded_event_queue()

        async def emit(payload: Dict[str, Any]) -> None:
            await queue.put(payload)

        async def run_analysis() -> None:
            try:
                async with billing_service.ai_billing_context(
                    session,
                    current_user.id,
                    entrypoint="jd_analysis",
                    metadata={"route": "/api/analyze-jd/stream"},
                    request_lease=request_lease,
                    release_request_lease_on_exit=False,
                ):
                    await emit({"type": "progress", "node": "prepare_context", "title": "准备分析上下文"})
                    await emit({"type": "progress", "node": "request_ai", "title": "调用 AI 进行分析"})
                    result = await analyze_jd_with_thoughts(
                        payload.text,
                        payload.resume_text,
                        payload.prev_result,
                        payload.experience_text,
                        payload.prev_experience_text,
                        thought_callback=emit,
                    )
                await emit({"type": "progress", "node": "merge_result", "title": "合并分析结果"})
                await emit({"type": "progress", "node": "apply_score", "title": "生成 JD 匹配分与建议"})
                await emit({"type": "progress", "node": "persist_result", "title": "完成结果输出"})
                await emit({"type": "final", "result": result})
            except ValueError as exc:
                await emit(_stream_error_event(exc, preserve_value_error=True))
            except Exception as exc:
                await emit(_stream_error_event(exc))
            finally:
                await finish_event_queue(queue)

        producer = asyncio.create_task(run_analysis())
        try:
            while True:
                event = await queue.get()
                if event is None:
                    break
                yield _ndjson_line(event)
        finally:
            if not producer.done():
                producer.cancel()
            try:
                await producer
            except asyncio.CancelledError:
                pass
            if request_lease is not None:
                await request_lease.release()

    return StreamingResponse(event_stream(), media_type="application/x-ndjson")


@router.post("/resume-evaluation", response_model=Dict[str, Any])
async def resume_evaluation_endpoint(
    payload: ResumeEvaluationRequest,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
):
    async with billing_service.ai_billing_context(
        session,
        current_user.id,
        entrypoint="resume_evaluation",
        metadata={"route": "/api/resume-evaluation"},
    ):
        await billing_service.ensure_current_quota()
        return await _resolve_jd_analysis_response(
            analyze_resume_evaluation(
                payload.text,
                payload.resume_text,
                payload.jd_match_percentage,
            )
        )


@router.post("/resume-evaluation/stream")
async def resume_evaluation_stream_endpoint(
    payload: ResumeEvaluationRequest,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
):
    request_lease = await billing_service.begin_ai_request(
        session,
        current_user.id,
        entrypoint="resume_evaluation",
    )

    async def event_stream():
        queue = create_bounded_event_queue()

        async def emit(event: Dict[str, Any]) -> None:
            await queue.put(event)

        async def run_evaluation() -> None:
            try:
                async with billing_service.ai_billing_context(
                    session,
                    current_user.id,
                    entrypoint="resume_evaluation",
                    metadata={"route": "/api/resume-evaluation/stream"},
                    request_lease=request_lease,
                    release_request_lease_on_exit=False,
                ):
                    await emit({"type": "progress", "node": "prepare_context", "title": "准备六维评估上下文"})
                    await emit({"type": "progress", "node": "request_ai", "title": "生成深度六维报告"})
                    result = await analyze_resume_evaluation_with_thoughts(
                        payload.text,
                        payload.resume_text,
                        payload.jd_match_percentage,
                        thought_callback=emit,
                    )
                await emit({"type": "progress", "node": "validate_report", "title": "校验六维报告"})
                await emit({"type": "final", "result": result})
            except ValueError as exc:
                await emit(_stream_error_event(exc, preserve_value_error=True))
            except Exception as exc:
                await emit(_stream_error_event(exc))
            finally:
                await finish_event_queue(queue)

        producer = asyncio.create_task(run_evaluation())
        try:
            while True:
                event = await queue.get()
                if event is None:
                    break
                yield _ndjson_line(event)
        finally:
            if not producer.done():
                producer.cancel()
            try:
                await producer
            except asyncio.CancelledError:
                pass
            if request_lease is not None:
                await request_lease.release()

    return StreamingResponse(event_stream(), media_type="application/x-ndjson")


@router.post("/analyze-jd-attachment/stream")
async def analyze_jd_attachment_stream_endpoint(
    file: UploadFile = File(...),
    jd_text: Optional[str] = Form(None),
    resume_text: Optional[str] = Form(None),
    experience_text: Optional[str] = Form(None),
    prev_result: Optional[str] = Form(None),
    prev_experience_text: Optional[str] = Form(None),
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
):
    _validate_form_text_fields(
        jd_text=jd_text,
        resume_text=resume_text,
        experience_text=experience_text,
        prev_result=prev_result,
        prev_experience_text=prev_experience_text,
    )
    request_lease = await billing_service.begin_ai_request(
        session,
        current_user.id,
        entrypoint="jd_attachment_analysis",
    )

    async def event_stream():
        queue = create_bounded_event_queue()

        async def emit(payload: Dict[str, Any]) -> None:
            await queue.put(payload)

        async def run_analysis() -> None:
            try:
                async with billing_service.ai_billing_context(
                    session,
                    current_user.id,
                    entrypoint="jd_attachment_analysis",
                    metadata={"route": "/api/analyze-jd-attachment/stream"},
                    request_lease=request_lease,
                    release_request_lease_on_exit=False,
                ):
                    await emit({"type": "progress", "node": "prepare_context", "title": "解析 JD 附件"})
                    attachment = await jd_attachment_service.extract_jd_from_attachment(file)

                    prev_result_dict: Optional[Dict[str, Any]] = None
                    if prev_result:
                        import json as _json
                        try:
                            prev_result_dict = _json.loads(prev_result)
                        except Exception:
                            prev_result_dict = None

                    supplemental_jd_text = (jd_text or "").strip()
                    await emit({"type": "progress", "node": "request_ai", "title": "调用 AI 进行分析"})

                    if attachment.is_image:
                        result = await analyze_jd_with_image_thoughts(
                            image_b64=attachment.image_b64,
                            mime_type=attachment.mime_type,
                            resume_text=resume_text,
                            prev_result=prev_result_dict,
                            experience_text=experience_text,
                            prev_experience_text=prev_experience_text,
                            jd_text=supplemental_jd_text or None,
                            thought_callback=emit,
                        )
                        extracted_jd_text = result.pop("extractedJdText", None)
                        if isinstance(extracted_jd_text, str) and extracted_jd_text.strip():
                            result["extracted_jd_text"] = extracted_jd_text.strip()
                    else:
                        extracted_jd_text = (attachment.text or "").strip()
                        combined_jd_text = extracted_jd_text
                        if supplemental_jd_text:
                            combined_jd_text = (
                                f"{extracted_jd_text}\n\n补充 JD 说明：\n{supplemental_jd_text}"
                                if extracted_jd_text
                                else supplemental_jd_text
                            )
                        result = await analyze_jd_with_thoughts(
                            text=combined_jd_text,
                            resume_text=resume_text,
                            prev_result=prev_result_dict,
                            experience_text=experience_text,
                            prev_experience_text=prev_experience_text,
                            thought_callback=emit,
                        )
                        if extracted_jd_text:
                            result["extracted_jd_text"] = extracted_jd_text

                await emit({"type": "progress", "node": "merge_result", "title": "合并分析结果"})
                await emit({"type": "progress", "node": "apply_score", "title": "生成 JD 匹配分与建议"})
                await emit({"type": "progress", "node": "persist_result", "title": "完成结果输出"})
                await emit({"type": "final", "result": result})
            except ValueError as exc:
                await emit(_stream_error_event(exc, preserve_value_error=True))
            except Exception as exc:
                await emit(_stream_error_event(exc))
            finally:
                await finish_event_queue(queue)

        producer = asyncio.create_task(run_analysis())
        try:
            while True:
                event = await queue.get()
                if event is None:
                    break
                yield _ndjson_line(event)
        finally:
            if not producer.done():
                producer.cancel()
            try:
                await producer
            except asyncio.CancelledError:
                pass
            if request_lease is not None:
                await request_lease.release()

    return StreamingResponse(event_stream(), media_type="application/x-ndjson")


@router.post("/polish-text", response_model=Dict[str, Any])
async def polish_text_endpoint(
    payload: PolishTextRequest,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
):
    async with billing_service.ai_billing_context(
        session,
        current_user.id,
        entrypoint=payload.entry_source or "experience_polish",
        metadata={"route": "/api/polish-text"},
    ):
        await billing_service.ensure_current_quota()
        return await resolve_ai_public_response(
            polish_experience(
                payload.content,
                payload.target_field,
                payload.jd_text,
                payload.mode,
                payload.custom_prompt,
            )
        )


@router.post("/split-experience-text", response_model=Dict[str, str])
async def split_experience_text_endpoint(
    payload: SplitExperienceTextRequest,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
):
    async with billing_service.ai_billing_context(
        session,
        current_user.id,
        entrypoint="experience_split",
        metadata={"route": "/api/split-experience-text"},
    ):
        await billing_service.ensure_current_quota()
        return await resolve_ai_public_response(
            split_experience_text(
                payload.raw_text,
                payload.category,
                payload.org,
                payload.title,
            )
        )


@router.post("/polish-text/stream")
async def polish_text_stream_endpoint(
    payload: PolishTextRequest,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
):
    request_lease = await billing_service.begin_ai_request(
        session,
        current_user.id,
        entrypoint=payload.entry_source or "experience_polish",
    )

    async def event_stream():
        queue = create_bounded_event_queue()

        async def emit(event: Dict[str, Any]) -> None:
            await queue.put(event)

        async def run_polish() -> None:
            try:
                async with billing_service.ai_billing_context(
                    session,
                    current_user.id,
                    entrypoint=payload.entry_source or "experience_polish",
                    metadata={"route": "/api/polish-text/stream"},
                    request_lease=request_lease,
                    release_request_lease_on_exit=False,
                ):
                    await emit({"type": "progress", "node": "prepare_context", "title": "准备润色上下文"})
                    await emit({"type": "progress", "node": "request_ai", "title": "调用 AI 进行润色"})
                    result = await polish_experience_with_thoughts(
                        payload.content,
                        payload.target_field,
                        payload.jd_text,
                        payload.mode,
                        payload.custom_prompt,
                        thought_callback=emit,
                    )
                await emit({"type": "progress", "node": "persist_result", "title": "整理润色结果"})
                await emit({"type": "final", "result": result})
            except ValueError as exc:
                await emit(_stream_error_event(exc, preserve_value_error=True))
            except Exception as exc:
                await emit(_stream_error_event(exc))
            finally:
                await finish_event_queue(queue)

        producer = asyncio.create_task(run_polish())
        try:
            while True:
                event = await queue.get()
                if event is None:
                    break
                yield _ndjson_line(event)
        finally:
            if not producer.done():
                producer.cancel()
            try:
                await producer
            except asyncio.CancelledError:
                pass
            if request_lease is not None:
                await request_lease.release()

    return StreamingResponse(event_stream(), media_type="application/x-ndjson")


@router.post("/generate-tags", response_model=Dict[str, Any])
async def generate_tags_endpoint(
    payload: GenerateTagsRequest,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
):
    async with billing_service.ai_billing_context(
        session,
        current_user.id,
        entrypoint="tag_generation",
        metadata={"route": "/api/generate-tags"},
    ):
        await billing_service.ensure_current_quota()
        return await resolve_ai_public_response(generate_tags(payload.text))


@router.post("/generate-boss-greeting", response_model=Dict[str, Any])
async def generate_boss_greeting_endpoint(
    payload: GenerateBossGreetingRequest,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
):
    async with billing_service.ai_billing_context(
        session,
        current_user.id,
        entrypoint="boss_greeting",
        metadata={"route": "/api/generate-boss-greeting"},
    ):
        await billing_service.ensure_current_quota()
        result = await resolve_ai_public_response(
            generate_boss_greeting(
                payload.jd_text,
                payload.analysis_summary,
                payload.job_title,
                payload.company,
                payload.resume_text,
            )
        )
    if payload.resume_id and result.get("greeting"):
        try:
            updated_resume = await persist_resume_boss_greeting(
                session,
                current_user.id,
                payload.resume_id,
                result["greeting"],
                payload.signature,
                payload.expected_updated_at,
            )
            result["resume_updated_at"] = updated_resume.updated_at.isoformat()
        except NotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except ConcurrencyConflictError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
    return result


@router.post("/generate-boss-greeting/stream")
async def generate_boss_greeting_stream_endpoint(
    payload: GenerateBossGreetingRequest,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
):
    request_lease = await billing_service.begin_ai_request(
        session,
        current_user.id,
        entrypoint="boss_greeting",
    )

    async def event_stream():
        queue = create_bounded_event_queue()

        async def emit(event: Dict[str, Any]) -> None:
            await queue.put(event)

        async def run_generate() -> None:
            try:
                async with billing_service.ai_billing_context(
                    session,
                    current_user.id,
                    entrypoint="boss_greeting",
                    metadata={"route": "/api/generate-boss-greeting/stream"},
                    request_lease=request_lease,
                    release_request_lease_on_exit=False,
                ):
                    await emit({"type": "progress", "node": "prepare_context", "title": "准备 BOSS 招呼语上下文"})
                    await emit({"type": "progress", "node": "request_ai", "title": "调用 AI 生成 BOSS 招呼语"})
                    result = await generate_boss_greeting_with_thoughts(
                        payload.jd_text,
                        payload.analysis_summary,
                        payload.job_title,
                        payload.company,
                        payload.resume_text,
                        thought_callback=emit,
                    )
                if payload.resume_id and result.get("greeting"):
                    updated_resume = await persist_resume_boss_greeting(
                        session,
                        current_user.id,
                        payload.resume_id,
                        result["greeting"],
                        payload.signature,
                        payload.expected_updated_at,
                    )
                    result["resume_updated_at"] = updated_resume.updated_at.isoformat()
                await emit({"type": "progress", "node": "persist_result", "title": "整理 BOSS 招呼语结果"})
                await emit({"type": "final", "result": result})
            except NotFoundError as exc:
                await emit(_stream_error_event(exc))
            except ConcurrencyConflictError as exc:
                await emit(_stream_error_event(exc))
            except ValueError as exc:
                await emit(_stream_error_event(exc, preserve_value_error=True))
            except Exception as exc:
                await emit(_stream_error_event(exc))
            finally:
                await finish_event_queue(queue)

        producer = asyncio.create_task(run_generate())
        try:
            while True:
                event = await queue.get()
                if event is None:
                    break
                yield _ndjson_line(event)
        finally:
            if not producer.done():
                producer.cancel()
            try:
                await producer
            except asyncio.CancelledError:
                pass
            if request_lease is not None:
                await request_lease.release()

    return StreamingResponse(event_stream(), media_type="application/x-ndjson")


@router.post("/generate-personal-summary", response_model=Dict[str, Any])
async def generate_personal_summary_endpoint(
    payload: GeneratePersonalSummaryRequest,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
):
    async with billing_service.ai_billing_context(
        session,
        current_user.id,
        entrypoint="personal_summary",
        metadata={"route": "/api/generate-personal-summary"},
    ):
        await billing_service.ensure_current_quota()
        return await resolve_ai_public_response(
            generate_personal_summary(
                mode=payload.mode,
                profile=payload.profile,
                work_experiences=payload.work_experiences,
                project_experiences=payload.project_experiences,
                education_experiences=payload.education_experiences,
                certifications=payload.certifications,
                skills=payload.skills,
                jd_text=payload.jd_text,
            )
        )


@router.post("/generate-personal-summary/stream")
async def generate_personal_summary_stream_endpoint(
    payload: GeneratePersonalSummaryRequest,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
):
    request_lease = await billing_service.begin_ai_request(
        session,
        current_user.id,
        entrypoint="personal_summary",
    )

    async def event_stream():
        queue = create_bounded_event_queue()

        async def emit(event: Dict[str, Any]) -> None:
            await queue.put(event)

        async def run_generate() -> None:
            try:
                async with billing_service.ai_billing_context(
                    session,
                    current_user.id,
                    entrypoint="personal_summary",
                    metadata={"route": "/api/generate-personal-summary/stream"},
                    request_lease=request_lease,
                    release_request_lease_on_exit=False,
                ):
                    await emit({"type": "progress", "node": "prepare_context", "title": "准备个人评价上下文"})
                    await emit({"type": "progress", "node": "request_ai", "title": "调用 AI 生成个人评价"})
                    result = await generate_personal_summary_with_thoughts(
                        mode=payload.mode,
                        profile=payload.profile,
                        work_experiences=payload.work_experiences,
                        project_experiences=payload.project_experiences,
                        education_experiences=payload.education_experiences,
                        certifications=payload.certifications,
                        skills=payload.skills,
                        jd_text=payload.jd_text,
                        thought_callback=emit,
                    )
                await emit({"type": "progress", "node": "persist_result", "title": "整理个人评价结果"})
                await emit({"type": "final", "result": result})
            except ValueError as exc:
                await emit(_stream_error_event(exc, preserve_value_error=True))
            except Exception as exc:
                await emit(_stream_error_event(exc))
            finally:
                await finish_event_queue(queue)

        producer = asyncio.create_task(run_generate())
        try:
            while True:
                event = await queue.get()
                if event is None:
                    break
                yield _ndjson_line(event)
        finally:
            if not producer.done():
                producer.cancel()
            try:
                await producer
            except asyncio.CancelledError:
                pass
            if request_lease is not None:
                await request_lease.release()

    return StreamingResponse(event_stream(), media_type="application/x-ndjson")


@router.post("/analyze-jd-attachment", response_model=Dict[str, Any])
async def analyze_jd_attachment_endpoint(
    file: UploadFile = File(...),
    jd_text: Optional[str] = Form(None),
    resume_text: Optional[str] = Form(None),
    experience_text: Optional[str] = Form(None),
    prev_result: Optional[str] = Form(None),
    prev_experience_text: Optional[str] = Form(None),
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
):
    """
    附件 JD 分析端点。
    - 图像（jpg/png/webp）→ vision 路径，模型直接解读图像
    - PDF/DOCX → 文本提取后走现有分析路径
    """
    _validate_form_text_fields(
        jd_text=jd_text,
        resume_text=resume_text,
        experience_text=experience_text,
        prev_result=prev_result,
        prev_experience_text=prev_experience_text,
    )
    try:
        attachment = await jd_attachment_service.extract_jd_from_attachment(file)
    except ValueError as exc:
        raise HTTPException(
            status_code=HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from exc

    prev_result_dict: Optional[Dict[str, Any]] = None
    if prev_result:
        import json as _json
        try:
            prev_result_dict = _json.loads(prev_result)
        except Exception:
            prev_result_dict = None

    supplemental_jd_text = (jd_text or "").strip()

    async with billing_service.ai_billing_context(
        session,
        current_user.id,
        entrypoint="jd_attachment_analysis",
        metadata={"route": "/api/analyze-jd-attachment"},
    ):
        await billing_service.ensure_current_quota()
        if attachment.is_image:
            result = await _resolve_jd_analysis_response(
                analyze_jd_with_image(
                    image_b64=attachment.image_b64,
                    mime_type=attachment.mime_type,
                    resume_text=resume_text,
                    prev_result=prev_result_dict,
                    experience_text=experience_text,
                    prev_experience_text=prev_experience_text,
                    jd_text=supplemental_jd_text or None,
                )
            )
            extracted_jd_text = result.pop("extractedJdText", None)
            if isinstance(extracted_jd_text, str) and extracted_jd_text.strip():
                result["extracted_jd_text"] = extracted_jd_text.strip()
            return result

        # 文本路径：将文档提取的文字与手动输入拼接
        extracted_jd_text = (attachment.text or "").strip()
        combined_jd_text = extracted_jd_text
        if supplemental_jd_text:
            combined_jd_text = (
                f"{extracted_jd_text}\n\n补充 JD 说明：\n{supplemental_jd_text}"
                if extracted_jd_text
                else supplemental_jd_text
            )
        result = await _resolve_jd_analysis_response(
            analyze_jd(
                text=combined_jd_text,
                resume_text=resume_text,
                prev_result=prev_result_dict,
                experience_text=experience_text,
                prev_experience_text=prev_experience_text,
            )
        )
        if extracted_jd_text:
            result["extracted_jd_text"] = extracted_jd_text
        return result


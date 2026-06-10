import asyncio
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlmodel.ext.asyncio.session import AsyncSession
from starlette.status import HTTP_400_BAD_REQUEST

from ...database import get_session
from ...dependencies import get_current_user
from ..resume.resume_service import NotFoundError, persist_resume_boss_greeting
from .ai_service import (
    analyze_jd,
    analyze_jd_with_image_thoughts,
    analyze_jd_with_thoughts,
    analyze_jd_with_image,
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

router = APIRouter(prefix="/api", tags=["ai"])




def _ndjson_line(payload: Dict[str, Any]) -> str:
    import json as _json

    return _json.dumps(payload, ensure_ascii=False) + "\n"


class AnalyzeJDRequest(BaseModel):
    text: str
    resume_text: Optional[str] = None
    prev_result: Optional[Dict[str, Any]] = None
    experience_text: Optional[str] = None
    prev_experience_text: Optional[str] = None


class PolishTextRequest(BaseModel):
    content: Dict[str, Any]
    target_field: Optional[str] = None
    jd_text: Optional[str] = None
    mode: Optional[str] = None
    custom_prompt: Optional[str] = None
    entry_source: Optional[str] = None


class SplitExperienceTextRequest(BaseModel):
    raw_text: str
    category: str
    org: Optional[str] = None
    title: Optional[str] = None


class GenerateTagsRequest(BaseModel):
    text: str


class GenerateBossGreetingRequest(BaseModel):
    jd_text: str
    analysis_summary: str
    job_title: Optional[str] = None
    company: Optional[str] = None
    resume_text: Optional[str] = None
    resume_id: Optional[str] = None
    signature: Optional[str] = None


class GeneratePersonalSummaryRequest(BaseModel):
    mode: str
    profile: Optional[Dict[str, Any]] = None
    work_experiences: Optional[list[Dict[str, Any]]] = None
    project_experiences: Optional[list[Dict[str, Any]]] = None
    education_experiences: Optional[list[Dict[str, Any]]] = None
    certifications: Optional[list[Dict[str, Any]]] = None
    skills: Optional[list[Dict[str, Any]]] = None
    jd_text: Optional[str] = None


@router.post("/analyze-jd", response_model=Dict[str, Any])
async def analyze_jd_endpoint(
    payload: AnalyzeJDRequest,
    current_user=Depends(get_current_user),
):
    return await analyze_jd(
        payload.text,
        payload.resume_text,
        payload.prev_result,
        payload.experience_text,
        payload.prev_experience_text,
    )


@router.post("/analyze-jd/stream")
async def analyze_jd_stream_endpoint(
    payload: AnalyzeJDRequest,
    current_user=Depends(get_current_user),
):
    async def event_stream():
        queue: asyncio.Queue[Dict[str, Any] | None] = asyncio.Queue()

        async def emit(payload: Dict[str, Any]) -> None:
            await queue.put(payload)

        async def run_analysis() -> None:
            try:
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
                await emit({"type": "progress", "node": "apply_score", "title": "生成匹配分与建议"})
                await emit({"type": "progress", "node": "persist_result", "title": "完成结果输出"})
                await emit({"type": "final", "result": result})
            except Exception as exc:
                await emit({"type": "error", "message": str(exc)})
            finally:
                await queue.put(None)

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

    return StreamingResponse(event_stream(), media_type="application/x-ndjson")


@router.post("/analyze-jd-attachment/stream")
async def analyze_jd_attachment_stream_endpoint(
    file: UploadFile = File(...),
    jd_text: Optional[str] = Form(None),
    resume_text: Optional[str] = Form(None),
    experience_text: Optional[str] = Form(None),
    prev_result: Optional[str] = Form(None),
    prev_experience_text: Optional[str] = Form(None),
    current_user=Depends(get_current_user),
):
    async def event_stream():
        queue: asyncio.Queue[Dict[str, Any] | None] = asyncio.Queue()

        async def emit(payload: Dict[str, Any]) -> None:
            await queue.put(payload)

        async def run_analysis() -> None:
            try:
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
                await emit({"type": "progress", "node": "apply_score", "title": "生成匹配分与建议"})
                await emit({"type": "progress", "node": "persist_result", "title": "完成结果输出"})
                await emit({"type": "final", "result": result})
            except ValueError as exc:
                await emit({"type": "error", "message": str(exc)})
            except Exception as exc:
                await emit({"type": "error", "message": str(exc)})
            finally:
                await queue.put(None)

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

    return StreamingResponse(event_stream(), media_type="application/x-ndjson")


@router.post("/polish-text", response_model=Dict[str, Any])
async def polish_text_endpoint(
    payload: PolishTextRequest,
    current_user=Depends(get_current_user),
):
    return await polish_experience(
        payload.content,
        payload.target_field,
        payload.jd_text,
        payload.mode,
        payload.custom_prompt,
    )


@router.post("/split-experience-text", response_model=Dict[str, str])
async def split_experience_text_endpoint(
    payload: SplitExperienceTextRequest,
    current_user=Depends(get_current_user),
):
    return await split_experience_text(
        payload.raw_text,
        payload.category,
        payload.org,
        payload.title,
    )


@router.post("/polish-text/stream")
async def polish_text_stream_endpoint(
    payload: PolishTextRequest,
    current_user=Depends(get_current_user),
):
    async def event_stream():
        queue: asyncio.Queue[Dict[str, Any] | None] = asyncio.Queue()

        async def emit(event: Dict[str, Any]) -> None:
            await queue.put(event)

        async def run_polish() -> None:
            try:
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
            except Exception as exc:
                await emit({"type": "error", "message": str(exc)})
            finally:
                await queue.put(None)

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

    return StreamingResponse(event_stream(), media_type="application/x-ndjson")


@router.post("/generate-tags", response_model=Dict[str, Any])
async def generate_tags_endpoint(
    payload: GenerateTagsRequest,
    current_user=Depends(get_current_user),
):
    return await generate_tags(payload.text)


@router.post("/generate-boss-greeting", response_model=Dict[str, Any])
async def generate_boss_greeting_endpoint(
    payload: GenerateBossGreetingRequest,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
):
    result = await generate_boss_greeting(
        payload.jd_text,
        payload.analysis_summary,
        payload.job_title,
        payload.company,
        payload.resume_text,
    )
    if payload.resume_id and result.get("greeting"):
        try:
            await persist_resume_boss_greeting(
                session,
                current_user.id,
                payload.resume_id,
                result["greeting"],
                payload.signature,
            )
        except NotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
    return result


@router.post("/generate-boss-greeting/stream")
async def generate_boss_greeting_stream_endpoint(
    payload: GenerateBossGreetingRequest,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
):
    async def event_stream():
        queue: asyncio.Queue[Dict[str, Any] | None] = asyncio.Queue()

        async def emit(event: Dict[str, Any]) -> None:
            await queue.put(event)

        async def run_generate() -> None:
            try:
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
                    await persist_resume_boss_greeting(
                        session,
                        current_user.id,
                        payload.resume_id,
                        result["greeting"],
                        payload.signature,
                    )
                await emit({"type": "progress", "node": "persist_result", "title": "整理 BOSS 招呼语结果"})
                await emit({"type": "final", "result": result})
            except NotFoundError as exc:
                await emit({"type": "error", "message": str(exc)})
            except Exception as exc:
                await emit({"type": "error", "message": str(exc)})
            finally:
                await queue.put(None)

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

    return StreamingResponse(event_stream(), media_type="application/x-ndjson")


@router.post("/generate-personal-summary", response_model=Dict[str, Any])
async def generate_personal_summary_endpoint(
    payload: GeneratePersonalSummaryRequest,
    current_user=Depends(get_current_user),
):
    return await generate_personal_summary(
        mode=payload.mode,
        profile=payload.profile,
        work_experiences=payload.work_experiences,
        project_experiences=payload.project_experiences,
        education_experiences=payload.education_experiences,
        certifications=payload.certifications,
        skills=payload.skills,
        jd_text=payload.jd_text,
    )


@router.post("/generate-personal-summary/stream")
async def generate_personal_summary_stream_endpoint(
    payload: GeneratePersonalSummaryRequest,
    current_user=Depends(get_current_user),
):
    async def event_stream():
        queue: asyncio.Queue[Dict[str, Any] | None] = asyncio.Queue()

        async def emit(event: Dict[str, Any]) -> None:
            await queue.put(event)

        async def run_generate() -> None:
            try:
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
            except Exception as exc:
                await emit({"type": "error", "message": str(exc)})
            finally:
                await queue.put(None)

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

    return StreamingResponse(event_stream(), media_type="application/x-ndjson")


@router.post("/analyze-jd-attachment", response_model=Dict[str, Any])
async def analyze_jd_attachment_endpoint(
    file: UploadFile = File(...),
    jd_text: Optional[str] = Form(None),
    resume_text: Optional[str] = Form(None),
    experience_text: Optional[str] = Form(None),
    prev_result: Optional[str] = Form(None),
    prev_experience_text: Optional[str] = Form(None),
    current_user=Depends(get_current_user),
):
    """
    附件 JD 分析端点。
    - 图像（jpg/png/webp）→ vision 路径，模型直接解读图像
    - PDF/DOCX → 文本提取后走现有分析路径
    """
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

    if attachment.is_image:
        result = await analyze_jd_with_image(
            image_b64=attachment.image_b64,
            mime_type=attachment.mime_type,
            resume_text=resume_text,
            prev_result=prev_result_dict,
            experience_text=experience_text,
            prev_experience_text=prev_experience_text,
            jd_text=supplemental_jd_text or None,
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
    result = await analyze_jd(
        text=combined_jd_text,
        resume_text=resume_text,
        prev_result=prev_result_dict,
        experience_text=experience_text,
        prev_experience_text=prev_experience_text,
    )
    if extracted_jd_text:
        result["extracted_jd_text"] = extracted_jd_text
    return result


import asyncio
from typing import Any, Dict
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlmodel.ext.asyncio.session import AsyncSession
from starlette.status import HTTP_204_NO_CONTENT, HTTP_400_BAD_REQUEST, HTTP_404_NOT_FOUND

from ...database import get_session as get_db_session
from ...dependencies import get_current_user
from ..ai.ai_service import run_assistant_turn_with_thoughts
from .assistant_service import (
    InvalidMessageError,
    NotFoundError,
    create_session,
    delete_session,
    get_session_detail,
    get_session as get_assistant_session,
    list_sessions,
    mark_message_applied,
    persist_assistant_turn,
    update_session,
)
from .schemas import (
    AssistantMessageApplyRead,
    AssistantMessageRead,
    AssistantSessionCreate,
    AssistantSessionDetail,
    AssistantSessionRead,
    AssistantSessionStreamRequest,
    AssistantSessionUpdate,
)

router = APIRouter(prefix="/api/assistant", tags=["assistant"])


def _ndjson_line(payload: Dict[str, Any]) -> str:
    import json as _json

    return _json.dumps(payload, ensure_ascii=False) + "\n"


def _to_session_read(session) -> AssistantSessionRead:
    return AssistantSessionRead(
        id=str(session.id),
        user_id=session.user_id,
        title=session.title,
        mode=session.mode,
        entry_source=session.entry_source,
        context_json=session.context_json,
        latest_preview=session.latest_preview,
        created_at=session.created_at,
        updated_at=session.updated_at,
    )


def _to_message_read(message) -> AssistantMessageRead:
    return AssistantMessageRead(
        id=str(message.id),
        role=message.role,
        message_type=message.message_type,
        content_json=message.content_json,
        created_at=message.created_at,
    )


@router.get("/sessions", response_model=list[AssistantSessionRead])
async def list_assistant_sessions(
    session: AsyncSession = Depends(get_db_session),
    current_user=Depends(get_current_user),
):
    rows = await list_sessions(session, current_user.id)
    return [_to_session_read(row) for row in rows]


@router.post("/sessions", response_model=AssistantSessionRead)
async def create_assistant_session(
    payload: AssistantSessionCreate,
    session: AsyncSession = Depends(get_db_session),
    current_user=Depends(get_current_user),
):
    created = await create_session(session, current_user.id, payload)
    return _to_session_read(created)


@router.get("/sessions/{session_id}", response_model=AssistantSessionDetail)
async def get_assistant_session_detail(
    session_id: UUID,
    session: AsyncSession = Depends(get_db_session),
    current_user=Depends(get_current_user),
):
    try:
        assistant_session, messages = await get_session_detail(
            session,
            current_user.id,
            session_id,
        )
    except NotFoundError as exc:
        raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return AssistantSessionDetail(
        session=_to_session_read(assistant_session),
        messages=[_to_message_read(message) for message in messages],
    )


@router.delete("/sessions/{session_id}", status_code=HTTP_204_NO_CONTENT)
async def delete_assistant_session(
    session_id: UUID,
    session: AsyncSession = Depends(get_db_session),
    current_user=Depends(get_current_user),
):
    try:
        await delete_session(session, current_user.id, session_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.patch("/sessions/{session_id}", response_model=AssistantSessionRead)
async def update_assistant_session(
    session_id: UUID,
    payload: AssistantSessionUpdate,
    session: AsyncSession = Depends(get_db_session),
    current_user=Depends(get_current_user),
):
    try:
        updated = await update_session(session, current_user.id, session_id, payload)
        return _to_session_read(updated)
    except NotFoundError as exc:
        raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.post(
    "/sessions/{session_id}/messages/{message_id}/apply",
    response_model=AssistantMessageApplyRead,
)
async def mark_assistant_message_applied(
    session_id: UUID,
    message_id: UUID,
    skip_apply: bool = False,
    session: AsyncSession = Depends(get_db_session),
    current_user=Depends(get_current_user),
):
    try:
        message = await mark_message_applied(
            session,
            current_user.id,
            session_id,
            message_id,
            skip_apply=skip_apply,
        )
    except NotFoundError as exc:
        raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except InvalidMessageError as exc:
        raise HTTPException(status_code=HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return AssistantMessageApplyRead(message=_to_message_read(message))


@router.post("/sessions/{session_id}/stream")
async def stream_assistant_session_turn(
    session_id: UUID,
    payload: AssistantSessionStreamRequest,
    session: AsyncSession = Depends(get_db_session),
    current_user=Depends(get_current_user),
):
    async def event_stream():
        queue: asyncio.Queue[Dict[str, Any] | None] = asyncio.Queue()

        async def emit(event: Dict[str, Any]) -> None:
            await queue.put(event)

        async def run_turn() -> None:
            try:
                assistant_session = await get_assistant_session(session, current_user.id, session_id)
                messages = (await get_session_detail(session, current_user.id, session_id))[1]
                await emit({"type": "progress", "node": "prepare_context", "title": "准备对话上下文"})
                await emit({"type": "progress", "node": "request_ai", "title": "调用 AI 助理"})
                result = await run_assistant_turn_with_thoughts(
                    mode=payload.mode or assistant_session.mode,
                    user_message=payload.user_message,
                    session_title=assistant_session.title,
                    entry_source=assistant_session.entry_source,
                    context_json=assistant_session.context_json,
                    history=[
                        {
                            "role": message.role,
                            "message_type": message.message_type,
                            "content_json": message.content_json,
                        }
                        for message in messages
                    ],
                    thought_callback=emit,
                )
                await persist_assistant_turn(
                    session,
                    assistant_session,
                    user_message=payload.user_message,
                    assistant_text=result["assistantText"],
                    draft_card=result.get("draftCard"),
                    title=result.get("title"),
                )
                await emit({"type": "progress", "node": "persist_result", "title": "保存会话记录"})
                await emit({"type": "final", "result": result})
            except NotFoundError as exc:
                await emit({"type": "error", "message": str(exc)})
            except Exception as exc:
                await emit({"type": "error", "message": str(exc)})
            finally:
                await queue.put(None)

        producer = asyncio.create_task(run_turn())
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

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional
import uuid

from sqlalchemy import CheckConstraint, Column, DateTime, ForeignKey, Index, Text
from sqlalchemy import text as sa_text
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID as PG_UUID
from sqlmodel import Field, SQLModel

from ...utils.time_utils import utc_now_aware


_JSON_COLUMNS = (
    "before_snapshot",
    "plan_json",
    "answers_json",
    "result_json",
    "after_snapshot",
    "post_evaluation_json",
    "error_json",
)

_JSON_CHECK_CONSTRAINTS = tuple(
    constraint
    for column_name in _JSON_COLUMNS
    for constraint in (
        CheckConstraint(
            f"jsonb_typeof({column_name}) = 'object'",
            name=f"ck_resume_optimization_runs_{column_name}_object",
        ),
        CheckConstraint(
            f"octet_length({column_name}::text) <= 4194304",
            name=f"ck_resume_optimization_runs_{column_name}_size",
        ),
    )
)


class ResumeOptimizationRun(SQLModel, table=True):
    __tablename__ = "resume_optimization_runs"
    __table_args__ = (
        CheckConstraint(
            "status IN ("
            "'planning', "
            "'awaiting_answers', "
            "'preview_ready', "
            "'applying', "
            "'applied', "
            "'rescoring', "
            "'completed', "
            "'failed', "
            "'stale', "
            "'cancelled', "
            "'reverted'"
            ")",
            name="ck_resume_optimization_runs_status",
        ),
        *_JSON_CHECK_CONSTRAINTS,
        Index("idx_resume_optimization_runs_user_id", "user_id"),
        Index(
            "idx_resume_optimization_runs_resume_created",
            "resume_id",
            sa_text("created_at DESC"),
        ),
        Index("idx_resume_optimization_runs_status", "status"),
        Index(
            "uniq_resume_optimization_runs_user_idempotency",
            "user_id",
            "idempotency_key_hash",
            unique=True,
            postgresql_where=sa_text("idempotency_key_hash IS NOT NULL"),
        ),
    )

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(
            PG_UUID(as_uuid=True),
            primary_key=True,
            server_default=sa_text("gen_random_uuid()"),
        ),
    )
    user_id: str = Field(
        sa_column=Column(
            Text,
            ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        )
    )
    resume_id: uuid.UUID = Field(
        sa_column=Column(
            PG_UUID(as_uuid=True),
            ForeignKey("resumes.id", ondelete="CASCADE"),
            nullable=False,
        )
    )

    status: str = Field(sa_column=Column(Text, nullable=False))
    optimizer_version: str = Field(sa_column=Column(Text, nullable=False))
    policy_version: str = Field(sa_column=Column(Text, nullable=False))
    prompt_version: str = Field(sa_column=Column(Text, nullable=False))

    source_resume_updated_at: datetime = Field(
        sa_column=Column(DateTime(timezone=True), nullable=False)
    )
    source_evaluation_signature: str = Field(
        sa_column=Column(Text, nullable=False)
    )
    source_jd_signature: str = Field(
        default="",
        sa_column=Column(Text, nullable=False, server_default=sa_text("''")),
    )
    source_snapshot_hash: str = Field(sa_column=Column(Text, nullable=False))

    idempotency_key_hash: Optional[str] = Field(
        default=None,
        sa_column=Column(Text, nullable=True),
    )
    request_hash: str = Field(sa_column=Column(Text, nullable=False))

    before_snapshot: Dict[str, Any] = Field(
        default_factory=dict,
        sa_column=Column(
            JSONB,
            nullable=False,
            server_default=sa_text("'{}'::jsonb"),
        ),
    )
    plan_json: Dict[str, Any] = Field(
        default_factory=dict,
        sa_column=Column(
            JSONB,
            nullable=False,
            server_default=sa_text("'{}'::jsonb"),
        ),
    )
    answers_json: Dict[str, Any] = Field(
        default_factory=dict,
        sa_column=Column(
            JSONB,
            nullable=False,
            server_default=sa_text("'{}'::jsonb"),
        ),
    )
    result_json: Dict[str, Any] = Field(
        default_factory=dict,
        sa_column=Column(
            JSONB,
            nullable=False,
            server_default=sa_text("'{}'::jsonb"),
        ),
    )
    after_snapshot: Dict[str, Any] = Field(
        default_factory=dict,
        sa_column=Column(
            JSONB,
            nullable=False,
            server_default=sa_text("'{}'::jsonb"),
        ),
    )
    post_evaluation_json: Dict[str, Any] = Field(
        default_factory=dict,
        sa_column=Column(
            JSONB,
            nullable=False,
            server_default=sa_text("'{}'::jsonb"),
        ),
    )
    error_json: Dict[str, Any] = Field(
        default_factory=dict,
        sa_column=Column(
            JSONB,
            nullable=False,
            server_default=sa_text("'{}'::jsonb"),
        ),
    )

    accepted_change_ids: List[str] = Field(
        default_factory=list,
        sa_column=Column(
            ARRAY(Text),
            nullable=False,
            server_default=sa_text("'{}'::text[]"),
        ),
    )
    applied_content_signature: Optional[str] = Field(
        default=None,
        sa_column=Column(Text, nullable=True),
    )

    created_at: datetime = Field(
        default_factory=utc_now_aware,
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            server_default=sa_text("now()"),
        ),
    )
    updated_at: datetime = Field(
        default_factory=utc_now_aware,
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            server_default=sa_text("now()"),
        ),
    )
    applied_at: Optional[datetime] = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    completed_at: Optional[datetime] = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )

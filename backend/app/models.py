from __future__ import annotations

from datetime import date, datetime
from enum import Enum
from typing import Any, Dict, List, Optional
import uuid

from sqlalchemy import Column, DateTime, Text, Enum as SAEnum, UniqueConstraint
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlmodel import Field, SQLModel

from .utils.time_utils import utc_now


def utc_now_aware() -> datetime:
    from datetime import timezone

    return datetime.now(timezone.utc)


class ExperienceCategory(str, Enum):
    WORK = "work"
    PROJECT = "project"
    EDUCATION = "education"


class User(SQLModel, table=True):
    __tablename__ = "users"

    id: str = Field(primary_key=True, index=True)
    is_admin: bool = Field(default=False, nullable=False)
    created_at: datetime = Field(default_factory=utc_now, nullable=False)


class Profile(SQLModel, table=True):
    __tablename__ = "profiles"

    user_id: str = Field(primary_key=True, foreign_key="users.id")
    full_name: Optional[str] = None
    title: Optional[str] = None
    summary: Optional[str] = None
    location: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    social_links: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSONB))
    extra_json: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSONB))
    updated_at: datetime = Field(default_factory=utc_now, nullable=False)


class ProfileLink(SQLModel, table=True):
    __tablename__ = "profile_links"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    user_id: str = Field(foreign_key="profiles.user_id", index=True)
    label: str
    url: str
    position: int = 0


class MasterExperience(SQLModel, table=True):
    __tablename__ = "master_experiences"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    user_id: str = Field(foreign_key="users.id", index=True)
    category: ExperienceCategory = Field(
        sa_column=Column(
            SAEnum(
                ExperienceCategory,
                name="experience_category",
                create_type=False,
                values_callable=lambda enum_cls: [item.value for item in enum_cls],
            ),
            nullable=False,
        )
    )
    latest_version_id: Optional[uuid.UUID] = Field(
        default=None, foreign_key="experience_versions.id", index=True
    )
    is_archived: bool = False
    created_at: datetime = Field(default_factory=utc_now, nullable=False)
    updated_at: datetime = Field(default_factory=utc_now, nullable=False)


class ExperienceVersion(SQLModel, table=True):
    __tablename__ = "experience_versions"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    master_experience_id: uuid.UUID = Field(foreign_key="master_experiences.id", index=True)
    version: int
    title: str
    org: Optional[str] = None
    location: Optional[str] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    is_current: bool = False
    summary: Optional[str] = None
    highlights: List[str] = Field(default_factory=list, sa_column=Column(ARRAY(Text)))
    tags: List[str] = Field(default_factory=list, sa_column=Column(ARRAY(Text)))
    star: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSONB))
    created_at: datetime = Field(default_factory=utc_now, nullable=False)


class Skill(SQLModel, table=True):
    __tablename__ = "skills"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    name: str
    category: Optional[str] = None


class UserSkill(SQLModel, table=True):
    __tablename__ = "user_skills"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    user_id: str = Field(foreign_key="users.id", index=True)
    skill_id: uuid.UUID = Field(foreign_key="skills.id", index=True)
    proficiency: Optional[int] = None


class ExperienceVersionSkill(SQLModel, table=True):
    __tablename__ = "experience_version_skills"

    experience_version_id: uuid.UUID = Field(
        foreign_key="experience_versions.id", primary_key=True
    )
    skill_id: uuid.UUID = Field(foreign_key="skills.id", primary_key=True)


class ExperienceDraft(SQLModel, table=True):
    __tablename__ = "experience_drafts"
    __table_args__ = (
        UniqueConstraint("user_id", "category", "client_draft_key", name="uq_experience_drafts_user_category_key"),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    user_id: str = Field(foreign_key="users.id", index=True)
    category: ExperienceCategory = Field(
        sa_column=Column(
            SAEnum(
                ExperienceCategory,
                name="experience_category",
                create_type=False,
                values_callable=lambda enum_cls: [item.value for item in enum_cls],
            ),
            nullable=False,
        )
    )
    client_draft_key: str = Field(sa_column=Column(Text, nullable=False))
    mode: str = Field(default="simple", sa_column=Column(Text, nullable=False))
    simple_text: str = Field(default="", sa_column=Column(Text, nullable=False))
    card_data: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSONB, nullable=False))
    target_master_id: Optional[uuid.UUID] = Field(default=None, foreign_key="master_experiences.id", index=True)
    created_at: datetime = Field(default_factory=utc_now, nullable=False)
    updated_at: datetime = Field(default_factory=utc_now, nullable=False)


class ResumeSkill(SQLModel, table=True):
    __tablename__ = "resume_skills"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    resume_id: uuid.UUID = Field(foreign_key="resumes.id", index=True)
    skill_name_snapshot: str
    position: int = 0


class Certification(SQLModel, table=True):
    __tablename__ = "certifications"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    user_id: str = Field(foreign_key="users.id", index=True)
    name: str
    issuer: Optional[str] = None
    issue_date: Optional[date] = None
    expiry_date: Optional[date] = None
    credential_id: Optional[str] = None
    credential_url: Optional[str] = None
    description: Optional[str] = None
    created_at: datetime = Field(default_factory=utc_now, nullable=False)
    updated_at: datetime = Field(default_factory=utc_now, nullable=False)


class Feedback(SQLModel, table=True):
    __tablename__ = "feedback"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    user_id: str = Field(foreign_key="users.id", index=True)
    category: str
    content: str = Field(sa_column=Column(Text, nullable=False))
    contact_type: Optional[str] = None
    contact: Optional[str] = None
    context_json: Dict[str, Any] = Field(
        default_factory=dict, sa_column=Column(JSONB, nullable=False)
    )
    # 存储用户上传的图片，每项为 base64 编码字符串（含 data URI 前缀）
    image_base64_list: List[str] = Field(
        default_factory=list, sa_column=Column(ARRAY(Text), nullable=False, server_default="{}")
    )
    created_at: datetime = Field(default_factory=utc_now, nullable=False)


class AgentApiKey(SQLModel, table=True):
    __tablename__ = "agent_api_keys"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    user_id: str = Field(foreign_key="users.id", index=True)
    name: str
    key_prefix: str = Field(index=True)
    key_hash: str = Field(sa_column=Column(Text, nullable=False))
    key_plaintext: Optional[str] = Field(default=None, sa_column=Column(Text, nullable=True))
    created_at: datetime = Field(default_factory=utc_now, nullable=False)
    last_used_at: Optional[datetime] = None
    revoked_at: Optional[datetime] = None


class AgentPluginConfig(SQLModel, table=True):
    __tablename__ = "agent_plugin_configs"

    user_id: str = Field(primary_key=True, foreign_key="users.id")
    selected_template_id: str = Field(default="modern-slate")
    polish_before_output: bool = Field(default=True, nullable=False)
    polish_level: str = Field(default="标准")
    force_one_page: bool = Field(default=True, nullable=False)
    updated_at: datetime = Field(default_factory=utc_now, nullable=False)


class AITokenWallet(SQLModel, table=True):
    __tablename__ = "ai_token_wallets"

    user_id: str = Field(primary_key=True, foreign_key="users.id")
    token_limit: int = Field(default=0, nullable=False)
    remaining_tokens: int = Field(default=0, nullable=False)
    used_tokens: int = Field(default=0, nullable=False)
    unlimited_tokens_expires_at: Optional[datetime] = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    unlimited_tokens_plan_name: Optional[str] = Field(default=None, sa_column=Column(Text, nullable=True))
    last_purchase_id: Optional[uuid.UUID] = Field(default=None, index=True)
    last_purchase_tokens: int = Field(default=0, nullable=False)
    last_purchase_at: Optional[datetime] = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    created_at: datetime = Field(
        default_factory=utc_now_aware,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=utc_now_aware,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


class AITokenUsageEvent(SQLModel, table=True):
    __tablename__ = "ai_token_usage_events"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    user_id: str = Field(foreign_key="users.id", index=True)
    entrypoint: str = Field(default="unknown", sa_column=Column(Text, nullable=False))
    request_label: str = Field(default="ai_request", sa_column=Column(Text, nullable=False))
    provider: str = Field(default="unknown", sa_column=Column(Text, nullable=False))
    model: str = Field(default="", sa_column=Column(Text, nullable=False))
    status: str = Field(default="success", sa_column=Column(Text, nullable=False))
    prompt_tokens: int = Field(default=0, nullable=False)
    completion_tokens: int = Field(default=0, nullable=False)
    total_tokens: int = Field(default=0, nullable=False)
    metadata_json: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSONB, nullable=False))
    created_at: datetime = Field(
        default_factory=utc_now_aware,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


class AITokenPurchaseEvent(SQLModel, table=True):
    __tablename__ = "ai_token_purchase_events"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    user_id: str = Field(foreign_key="users.id", index=True)
    option_id: str = Field(sa_column=Column(Text, nullable=False))
    label: str = Field(sa_column=Column(Text, nullable=False))
    tokens: int = Field(nullable=False)
    status: str = Field(default="placeholder_succeeded", sa_column=Column(Text, nullable=False))
    before_remaining_tokens: int = Field(default=0, nullable=False)
    after_remaining_tokens: int = Field(default=0, nullable=False)
    before_token_limit: int = Field(default=0, nullable=False)
    after_token_limit: int = Field(default=0, nullable=False)
    source: str = Field(default="placeholder_purchase", sa_column=Column(Text, nullable=False))
    source_id: Optional[str] = Field(default=None, sa_column=Column(Text, nullable=True))
    metadata_json: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSONB, nullable=False))
    created_at: datetime = Field(
        default_factory=utc_now_aware,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


class RedemptionPackage(SQLModel, table=True):
    __tablename__ = "redemption_packages"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    name: str = Field(sa_column=Column(Text, nullable=False))
    token_amount: int = Field(default=0, nullable=False)
    benefit_type: str = Field(default="tokens", sa_column=Column(Text, nullable=False))
    unlimited_duration_days: Optional[int] = Field(default=None)
    unlimited_duration_hours: Optional[int] = Field(default=None)
    is_active: bool = Field(default=True, nullable=False)
    notes: str = Field(default="", sa_column=Column(Text, nullable=False))
    created_at: datetime = Field(
        default_factory=utc_now_aware,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=utc_now_aware,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


class RedemptionBatch(SQLModel, table=True):
    __tablename__ = "redemption_batches"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    package_id: Optional[uuid.UUID] = Field(default=None, foreign_key="redemption_packages.id", index=True)
    name: str = Field(sa_column=Column(Text, nullable=False))
    channel: str = Field(default="", sa_column=Column(Text, nullable=False))
    package_name: str = Field(sa_column=Column(Text, nullable=False))
    token_amount: int = Field(default=0, nullable=False)
    benefit_type: str = Field(default="tokens", sa_column=Column(Text, nullable=False))
    unlimited_duration_days: Optional[int] = Field(default=None)
    unlimited_duration_hours: Optional[int] = Field(default=None)
    code_count: int = Field(nullable=False)
    status: str = Field(default="active", sa_column=Column(Text, nullable=False))
    created_by_user_id: str = Field(sa_column=Column(Text, nullable=False))
    exported_at: Optional[datetime] = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    created_at: datetime = Field(
        default_factory=utc_now_aware,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=utc_now_aware,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


class RedemptionCode(SQLModel, table=True):
    __tablename__ = "redemption_codes"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    batch_id: Optional[uuid.UUID] = Field(default=None, foreign_key="redemption_batches.id", index=True)
    package_id: Optional[uuid.UUID] = Field(default=None, foreign_key="redemption_packages.id", index=True)
    code_hash: str = Field(sa_column=Column(Text, nullable=False, unique=True))
    code_ciphertext: str = Field(sa_column=Column(Text, nullable=False))
    code_prefix: str = Field(default="", sa_column=Column(Text, nullable=False, index=True))
    token_amount: int = Field(default=0, nullable=False)
    package_name: str = Field(sa_column=Column(Text, nullable=False))
    benefit_type: str = Field(default="tokens", sa_column=Column(Text, nullable=False))
    unlimited_duration_days: Optional[int] = Field(default=None)
    unlimited_duration_hours: Optional[int] = Field(default=None)
    status: str = Field(default="unused", sa_column=Column(Text, nullable=False, index=True))
    redeemed_by_user_id: Optional[str] = Field(default=None, foreign_key="users.id", index=True)
    redeemed_at: Optional[datetime] = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    revoked_by_user_id: Optional[str] = Field(default=None, foreign_key="users.id", index=True)
    revoked_at: Optional[datetime] = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    created_at: datetime = Field(
        default_factory=utc_now_aware,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=utc_now_aware,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


class ExportRenderSnapshot(SQLModel, table=True):
    __tablename__ = "export_render_snapshots"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    user_id: str = Field(foreign_key="users.id", index=True)
    payload_json: Dict[str, Any] = Field(
        default_factory=dict,
        sa_column=Column(JSONB, nullable=False),
    )
    expires_at: datetime = Field(
        sa_column=Column(DateTime(timezone=True), nullable=False)
    )
    created_at: datetime = Field(
        default_factory=utc_now_aware,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    consumed_at: Optional[datetime] = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )


class AIAssistantSession(SQLModel, table=True):
    __tablename__ = "ai_assistant_sessions"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    user_id: str = Field(foreign_key="users.id", index=True)
    title: str
    mode: str
    entry_source: str = Field(default="direct")
    context_json: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSONB))
    latest_preview: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSONB))
    created_at: datetime = Field(default_factory=utc_now, nullable=False)
    updated_at: datetime = Field(default_factory=utc_now, nullable=False)


class AIAssistantMessage(SQLModel, table=True):
    __tablename__ = "ai_assistant_messages"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    session_id: uuid.UUID = Field(foreign_key="ai_assistant_sessions.id", index=True)
    role: str
    message_type: str
    content_json: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSONB))
    created_at: datetime = Field(default_factory=utc_now, nullable=False)


class AIAssistantImageBlob(SQLModel, table=True):
    __tablename__ = "ai_assistant_image_blobs"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    session_id: uuid.UUID = Field(foreign_key="ai_assistant_sessions.id", index=True)
    mime_type: str = Field(default="", nullable=False)
    payload_base64: str = Field(sa_column=Column(Text, nullable=False))
    created_at: datetime = Field(default_factory=utc_now, nullable=False)


from .domain.resume.models import Resume, ResumeExperienceLink

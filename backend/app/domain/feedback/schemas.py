from datetime import datetime
from typing import Any, Dict, Optional

from pydantic import BaseModel


class FeedbackCreate(BaseModel):
    category: str
    content: str
    contact_type: Optional[str] = None
    contact: Optional[str] = None
    context_json: Optional[Dict[str, Any]] = None


class FeedbackRead(BaseModel):
    id: str
    user_id: str
    category: str
    content: str
    contact_type: Optional[str] = None
    contact: Optional[str] = None
    context_json: Dict[str, Any]
    # 仅返回图片数量，不返回原始 base64 内容（避免接口负载过大）
    image_count: int = 0
    created_at: datetime

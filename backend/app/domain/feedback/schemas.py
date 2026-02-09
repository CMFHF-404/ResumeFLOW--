from datetime import datetime
from typing import Any, Dict, Optional

from pydantic import BaseModel


class FeedbackCreate(BaseModel):
    category: str
    content: str
    contact: Optional[str] = None
    context_json: Optional[Dict[str, Any]] = None


class FeedbackRead(BaseModel):
    id: str
    user_id: str
    category: str
    content: str
    contact: Optional[str] = None
    context_json: Dict[str, Any]
    created_at: datetime

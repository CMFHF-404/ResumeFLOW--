from typing import List, Optional

from pydantic import BaseModel


class UserSkillCreate(BaseModel):
    name: str
    category: Optional[str] = None
    proficiency: Optional[int] = None


class UserSkillUpdate(BaseModel):
    name: Optional[str] = None
    category: Optional[str] = None
    proficiency: Optional[int] = None


class UserSkillRead(BaseModel):
    id: str
    user_id: str
    skill_id: str
    name: str
    category: Optional[str] = None
    proficiency: Optional[int] = None

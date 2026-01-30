from typing import List, Optional
from uuid import UUID

from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from ...models import Skill, UserSkill
from .schemas import UserSkillCreate, UserSkillUpdate


class NotFoundError(Exception):
    pass


async def list_user_skills(session: AsyncSession, user_id: str) -> List[tuple]:
    """获取用户的技能列表(包含技能详情)"""
    query = (
        select(UserSkill, Skill)
        .join(Skill, UserSkill.skill_id == Skill.id)
        .where(UserSkill.user_id == user_id)
    )
    result = await session.execute(query)
    return list(result.all())


async def _get_or_create_skill(
    session: AsyncSession, name: str, category: Optional[str] = None
) -> Skill:
    """获取或创建技能"""
    query = select(Skill).where(Skill.name == name)
    if category is not None:
        query = query.where(Skill.category == category)
    result = await session.execute(query)
    skill = result.scalars().one_or_none()
    if not skill:
        skill = Skill(name=name, category=category)
        session.add(skill)
        await session.flush()
    return skill


async def create_user_skill(
    session: AsyncSession, user_id: str, payload: UserSkillCreate
) -> tuple:
    """为用户添加技能"""
    skill = await _get_or_create_skill(session, payload.name, payload.category)
    user_skill = UserSkill(
        user_id=user_id, skill_id=skill.id, proficiency=payload.proficiency
    )
    session.add(user_skill)
    await session.commit()
    await session.refresh(user_skill)
    await session.refresh(skill)
    return user_skill, skill


async def get_user_skill(
    session: AsyncSession, user_id: str, user_skill_id: UUID
) -> tuple:
    """获取单个用户技能详情"""
    query = (
        select(UserSkill, Skill)
        .join(Skill, UserSkill.skill_id == Skill.id)
        .where(UserSkill.id == user_skill_id, UserSkill.user_id == user_id)
    )
    result = await session.execute(query)
    row = result.one_or_none()
    if not row:
        raise NotFoundError(f"UserSkill {user_skill_id} not found")
    return row


async def update_user_skill(
    session: AsyncSession, user_id: str, user_skill_id: UUID, payload: UserSkillUpdate
) -> tuple:
    """更新用户技能"""
    user_skill, skill = await get_user_skill(session, user_id, user_skill_id)
    
    # 如果名称或类别改变,需要获取或创建新的skill
    if payload.name or payload.category:
        new_name = payload.name or skill.name
        new_category = payload.category if payload.category is not None else skill.category
        skill = await _get_or_create_skill(session, new_name, new_category)
        user_skill.skill_id = skill.id
    
    if payload.proficiency is not None:
        user_skill.proficiency = payload.proficiency
    
    session.add(user_skill)
    await session.commit()
    await session.refresh(user_skill)
    await session.refresh(skill)
    return user_skill, skill


async def delete_user_skill(
    session: AsyncSession, user_id: str, user_skill_id: UUID
) -> None:
    """删除用户技能"""
    user_skill, _ = await get_user_skill(session, user_id, user_skill_id)
    await session.delete(user_skill)
    await session.commit()

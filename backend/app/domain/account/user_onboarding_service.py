from __future__ import annotations

from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlmodel.ext.asyncio.session import AsyncSession

from ...models import User
from ..billing import billing_service


async def ensure_user_with_signup_bonus(session: AsyncSession, user_id: str) -> bool:
    stmt = (
        pg_insert(User)
        .values(id=user_id)
        .on_conflict_do_nothing(index_elements=[User.id])
        .returning(User.id)
    )
    result = await session.execute(stmt)
    created_user_id = result.scalar_one_or_none()
    if created_user_id is None:
        return False

    await billing_service.grant_signup_bonus(session, user_id)
    return True

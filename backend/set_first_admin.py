import argparse
import asyncio
import os
import sys

sys.path.insert(0, "app")

from sqlalchemy import select, update  # noqa: E402

from app.database import AsyncSessionFactory  # noqa: E402
from app.models import User  # noqa: E402

ENV_FIRST_ADMIN_USER_ID = "FIRST_ADMIN_USER_ID"


def _resolve_user_id() -> str:
    parser = argparse.ArgumentParser(description="Set the first admin user.")
    parser.add_argument("user_id", nargs="?", help="Logto user id to grant admin role")
    args = parser.parse_args()
    return args.user_id or os.getenv(ENV_FIRST_ADMIN_USER_ID, "").strip()


async def _apply_admin(user_id: str) -> bool:
    async with AsyncSessionFactory() as session:
        result = await session.execute(select(User).where(User.id == user_id))
        user = result.scalar_one_or_none()
        if not user:
            return False
        await session.execute(update(User).where(User.id == user_id).values(is_admin=True))
        await session.commit()
        return True


def main() -> None:
    user_id = _resolve_user_id()
    if not user_id:
        print("❌ 缺少用户 ID，请传入参数或设置 FIRST_ADMIN_USER_ID")
        return
    success = asyncio.run(_apply_admin(user_id))
    if success:
        print(f"✅ 已设置管理员: {user_id}")
        return
    print(f"❌ 用户不存在: {user_id}")


if __name__ == "__main__":
    main()

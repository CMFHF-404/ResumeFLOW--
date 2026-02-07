"""
管理员权限验证工具模块

提供基于数据库的管理员权限验证功能，包括:
- 查询用户是否为管理员
- FastAPI 依赖注入：要求当前用户必须是管理员
- 修改用户管理员权限
"""

from typing import Annotated
from fastapi import Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.status import HTTP_403_FORBIDDEN

from ..database import get_async_session
from ..dependencies import get_current_user
from ..auth_middleware import AuthenticatedUser
from ..models import User


async def is_admin(user_id: str, session: AsyncSession) -> bool:
    """
    查询用户是否为管理员
    
    Args:
        user_id: 用户 ID
        session: 数据库会话
        
    Returns:
        True 如果用户是管理员，否则 False
    """
    result = await session.execute(
        select(User.is_admin).where(User.id == user_id)
    )
    admin_status = result.scalar_one_or_none()
    return admin_status is True


async def require_admin(
    current_user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_async_session)]
) -> AuthenticatedUser:
    """
    FastAPI 依赖注入：验证当前用户是否为管理员
    
    如果用户不是管理员，抛出 403 Forbidden 异常
    
    Args:
        current_user: 当前认证用户（通过依赖注入获取）
        session: 数据库会话（通过依赖注入获取）
        
    Returns:
        当前用户对象
        
    Raises:
        HTTPException: 403 - 用户不是管理员
    """
    user_is_admin = await is_admin(current_user.id, session)
    
    if not user_is_admin:
        raise HTTPException(
            status_code=HTTP_403_FORBIDDEN,
            detail={
                "error": {
                    "code": "forbidden",
                    "message": "Admin privileges required"
                }
            }
        )
    
    return current_user


async def set_admin_status(
    user_id: str, 
    admin_status: bool, 
    session: AsyncSession
) -> bool:
    """
    设置用户的管理员权限
    
    Args:
        user_id: 用户 ID
        admin_status: True 设置为管理员，False 取消管理员
        session: 数据库会话
        
    Returns:
        True 如果操作成功，False 如果用户不存在
    """
    from sqlalchemy import update
    
    # 检查用户是否存在
    result = await session.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    
    if not user:
        return False
    
    # 更新 is_admin 字段
    stmt = update(User).where(User.id == user_id).values(is_admin=admin_status)
    await session.execute(stmt)
    await session.commit()
    
    return True

from typing import List
from uuid import UUID

from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from ...models import Certification
from ...utils.time_utils import utc_now
from .schemas import CertificationCreate, CertificationUpdate


class NotFoundError(Exception):
    pass


async def list_certifications(
    session: AsyncSession, user_id: str
) -> List[Certification]:
    """获取用户的证书列表"""
    result = await session.execute(
        select(Certification)
        .where(Certification.user_id == user_id)
        .order_by(Certification.issue_date.desc())
    )
    return list(result.scalars().all())


async def create_certification(
    session: AsyncSession, user_id: str, payload: CertificationCreate
) -> Certification:
    """创建新证书"""
    cert = Certification(user_id=user_id, **payload.model_dump())
    session.add(cert)
    await session.commit()
    await session.refresh(cert)
    return cert


async def get_certification(
    session: AsyncSession, user_id: str, cert_id: UUID
) -> Certification:
    """获取单个证书详情"""
    result = await session.execute(
        select(Certification).where(
            Certification.id == cert_id, Certification.user_id == user_id
        )
    )
    cert = result.scalars().one_or_none()
    if not cert:
        raise NotFoundError(f"Certification {cert_id} not found")
    return cert


async def update_certification(
    session: AsyncSession, user_id: str, cert_id: UUID, payload: CertificationUpdate
) -> Certification:
    """更新证书信息"""
    cert = await get_certification(session, user_id, cert_id)
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(cert, key, value)
    cert.updated_at = utc_now()
    session.add(cert)
    await session.commit()
    await session.refresh(cert)
    return cert


async def delete_certification(
    session: AsyncSession, user_id: str, cert_id: UUID
) -> None:
    """删除证书"""
    cert = await get_certification(session, user_id, cert_id)
    await session.delete(cert)
    await session.commit()

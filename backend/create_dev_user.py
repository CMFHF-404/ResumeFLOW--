import asyncio
import sys
sys.path.insert(0, 'app')

from app.database import AsyncSessionFactory
from app.models import User
from sqlalchemy.dialects.postgresql import insert as pg_insert

async def create_dev_user():
    async with AsyncSessionFactory() as session:
        stmt = pg_insert(User).values(id='dev-user-test-123').on_conflict_do_nothing(index_elements=[User.id])
        await session.execute(stmt)
        await session.commit()
        print('✅ Dev user created: dev-user-test-123')

if __name__ == '__main__':
    asyncio.run(create_dev_user())

import asyncio
import sys
import traceback
sys.path.insert(0, 'app')

from app.database import AsyncSessionFactory
from app.domain.experience.experience_service import list_experiences

async def test_list():
    try:
        async with AsyncSessionFactory() as session:
            results = await list_experiences(
                session=session,
                user_id='dev-user-test-123',
                category='work',
                keyword=None,
                limit=30,
                offset=0
            )
            print(f'✅ Success! Found {len(results)} experiences')
            for master, version in results:
                print(f'  - {master.id}: {version.title if version else "No version"}')
    except Exception as e:
        print(f'❌ Error: {type(e).__name__}: {e}')
        print('\n=== Full Traceback ===')
        traceback.print_exc()
        print('\n=== Error String ===')
        print(str(e))

if __name__ == '__main__':
    asyncio.run(test_list())

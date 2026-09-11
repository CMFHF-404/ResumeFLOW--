import unittest
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from app import auth_middleware
from app.domain.export import export_router
from app.domain.export.schemas import ResumePdfPageConstraint
from app.domain.export.snapshot_service import SnapshotConsumedError, build_render_snapshot_token
import test_export_http_compatibility as compat
from test_export_http_compatibility import _record, _snapshot, _SnapshotSession, _SessionContext
from test_resume_pdf_page_constraint import make_pdf

class ResumePdfConstraintHttpTests(unittest.IsolatedAsyncioTestCase):
    _build_app = compat.ExportHttpCompatibilityTests._build_app
    _request = compat.ExportHttpCompatibilityTests._request
    assert_no_store = compat.ExportHttpCompatibilityTests.assert_no_store

    async def test_render_cache_recovery_direct_and_legacy(self):
        for mode in ('owned','legacy','direct','owned-cache','legacy-cache','owned-recovery','legacy-recovery'):
            for pages, constrained in ((1,True),(2,True),(2,False)):
                with self.subTest(mode=mode,pages=pages,constrained=constrained):
                    snapshot = _snapshot()
                    if constrained:
                        snapshot.pageConstraint = ResumePdfPageConstraint(maxPages=1)
                    record = _record()
                    record.payload_json = snapshot.model_dump(mode='json')
                    session = _SnapshotSession(record)
                    app = self._build_app(session)
                    pdf = make_pdf(pages)
                    token = build_render_snapshot_token(record)
                    cached, recovery = 'cache' in mode, 'recovery' in mode
                    record.rendered_pdf = pdf if cached else None
                    record.rendered_pdf_expires_at = datetime.now(timezone.utc) + timedelta(minutes=5)
                    recovered = SimpleNamespace(**vars(record))
                    recovered.rendered_pdf = pdf
                    def lookup():
                        return AsyncMock(side_effect=[(record,snapshot),(recovered,snapshot)] if recovery else None, return_value=(record,snapshot))
                    claim = AsyncMock(return_value=(record,snapshot,uuid.uuid4()))
                    if recovery:
                        claim.side_effect = SnapshotConsumedError('consumed')
                    with (
                        patch.object(auth_middleware,'_verify_token',new=AsyncMock(return_value={'sub':'user-1'})),
                        patch.object(auth_middleware,'_ensure_user_exists',new=AsyncMock()),
                        patch.object(export_router,'AsyncSessionFactory',side_effect=lambda: _SessionContext(session)),
                        patch.object(export_router,'create_render_snapshot',new=AsyncMock(return_value=(record,token))),
                        patch.object(export_router,'delete_temporary_render_snapshot',new=AsyncMock()),
                        patch.object(export_router,'get_render_snapshot_by_owner',new=lookup()),
                        patch.object(export_router,'get_render_snapshot_by_token',new=lookup()),
                        patch.object(export_router,'claim_render_snapshot_by_owner',new=claim),
                        patch.object(export_router,'claim_render_snapshot_by_token',new=claim),
                        patch.object(export_router,'_render_with_claim_heartbeat',new=AsyncMock(return_value=pdf)) as render,
                        patch.object(export_router,'finalize_render_snapshot_claim',new=AsyncMock()) as finalize,
                        patch.object(export_router,'release_render_snapshot_claim',new=AsyncMock()) as release,
                    ):
                        if mode == 'direct':
                            response = await self._request(app,'POST','/exports/resume-pdf',headers={'Authorization':'Bearer token'},json={'snapshot':snapshot.model_dump(mode='json')})
                        else:
                            legacy = mode.startswith('legacy')
                            response = await self._request(app,'GET',f'/exports/download/resume-pdf/{record.id}',headers={} if legacy else {'Authorization':'Bearer token'},params={'token':token} if legacy else {})
                        mismatch = constrained and pages > 1
                        self.assertEqual(response.status_code,422 if mismatch else 200,response.text if mismatch else mode)
                        self.assert_no_store(response)
                        if mismatch:
                            self.assertEqual(response.json()['detail']['code'],'PDF_PAGE_COUNT_MISMATCH')
                            self.assertEqual(response.json()['detail']['actualPages'],2)
                            finalize.assert_not_awaited()
                            if not cached and not recovery:
                                release.assert_awaited_once()
                        if cached or recovery:
                            render.assert_not_awaited()

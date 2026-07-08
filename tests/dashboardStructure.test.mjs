import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const readIfExists = (path) => {
  const url = new URL(`../${path}`, import.meta.url);
  return existsSync(url) ? readFileSync(url, 'utf8') : '';
};

test('Dashboard delegates dropdown state and global listeners to useDashboardDropdown', () => {
  const dashboard = read('views/Dashboard.tsx');
  const dropdownHook = read('views/Dashboard/useDashboardDropdown.ts');

  assert.match(dashboard, /useDashboardDropdown/);
  assert.doesNotMatch(dashboard, /setOpenDropdownId/);
  assert.doesNotMatch(dashboard, /setDropdownAnchor/);
  assert.doesNotMatch(dashboard, /setDropdownPos/);
  assert.match(dashboard, /openDropdown\(id, rect\)/);
  assert.match(dashboard, /ref=\{dropdownRef\}/);
  assert.match(dashboard, /style=\{\{\s*top: dropdownPos\.top,\s*left: dropdownPos\.left\s*\}\}/);
  assert.match(dropdownHook, /resolveDropdownPosition/);
  assert.match(dropdownHook, /document\.addEventListener\('mousedown'/);
});

test('Dashboard derives visible resumes for search, filters, sort, and rendering', () => {
  const dashboard = read('views/Dashboard.tsx');

  assert.match(dashboard, /getVisibleDashboardResumes/);
  assert.match(dashboard, /const visibleResumes = useMemo/);
  assert.match(dashboard, /searchQuery/);
  assert.match(dashboard, /sortMode/);
  assert.match(dashboard, /timeFilter/);
  assert.match(dashboard, /matchFilter/);
  assert.match(dashboard, /visibleResumes\.map/);
  assert.doesNotMatch(dashboard, /resumes\.map\(resume => \(/);
});

test('Dashboard batch select all and empty results target filtered visible resumes', () => {
  const dashboard = read('views/Dashboard.tsx');

  assert.match(dashboard, /allVisibleSelected \? \[\] : visibleResumes\.map\(\(resume\) => resume\.id\)/);
  assert.match(dashboard, /allVisibleSelected/);
  assert.match(dashboard, /搜索简历名称/);
  assert.match(dashboard, /清空筛选/);
  assert.match(dashboard, /没有找到匹配的简历/);
});

test('Dashboard keeps search in the header and opens filters from a search-side button', () => {
  const dashboard = read('views/Dashboard.tsx');

  assert.match(dashboard, /const \[isFilterToolbarOpen, setIsFilterToolbarOpen\]/);
  assert.match(dashboard, /data-dashboard-search="top"/);
  assert.match(dashboard, /aria-label="筛选简历"/);
  assert.match(dashboard, /setIsFilterToolbarOpen\(\(prev\) => !prev\)/);
  assert.match(dashboard, /data-dashboard-filter-popover="advanced"/);
  assert.match(dashboard, /absolute right-0 top-full/);
  assert.match(dashboard, /flex flex-col gap-3/);
});

test('Dashboard shows custom filter inputs only after custom presets are selected', () => {
  const dashboard = read('views/Dashboard.tsx');

  assert.match(dashboard, /timeFilter\.preset === 'custom' && \(/);
  assert.match(dashboard, /matchFilter\.preset === 'custom' && \(/);
  assert.doesNotMatch(dashboard, /data-dashboard-filter-toolbar="advanced"/);
});

test('Dashboard preview preserves explicit empty certification and skill selections', () => {
  const modal = read('views/Dashboard/components/ResumePreviewModal.tsx');
  const previewState = read('views/Dashboard/resumePreviewState.ts');
  const match = modal.match(/const resolveFallbackSelection = \([\s\S]*?\n\};/);
  assert.equal(match, null, 'preview selection hydration should live in the shared preview state module');
  assert.match(previewState, /const resolveFallbackSelection = \(/);
  assert.match(previewState, /config\.selection\?\.certificationIds,[\s\S]*?orderedCerts\.map\(\(item\) => item\.id\),\s*true/);
  assert.match(previewState, /config\.selection\?\.skillIds,[\s\S]*?skills\.map\(\(skill\) => skill\.id\),\s*true/);

  const resolveSelectionSet = (ids) => new Set((ids || []).map((value) => String(value)).filter(Boolean));
  const sharedMatch = previewState.match(/const resolveFallbackSelection = \([\s\S]*?\n\};/);
  assert.ok(sharedMatch, 'resolveFallbackSelection should stay available for preview selection hydration');
  const functionSource = sharedMatch[0]
    .replace('ids: Array<string | number> | undefined', 'ids')
    .replace('fallbackIds: string[]', 'fallbackIds');
  const resolveFallbackSelection = Function(
    'resolveSelectionSet',
    `${functionSource.replace('const resolveFallbackSelection =', 'return')}`
  )(resolveSelectionSet);

  assert.deepEqual([...resolveFallbackSelection([], ['cert-1', 'cert-2'], true)], []);
  assert.deepEqual([...resolveFallbackSelection(undefined, ['skill-1', 'skill-2'])], ['skill-1', 'skill-2']);
});

test('Dashboard renders real resume thumbnails through a shared preview cache', () => {
  const dashboard = read('views/Dashboard.tsx');
  const thumbnail = read('views/Dashboard/components/DashboardResumeThumbnail.tsx');
  const previewHook = read('views/Dashboard/useDashboardResumePreviewCache.ts');

  assert.match(dashboard, /DashboardResumeThumbnail/);
  assert.match(dashboard, /useDashboardResumePreviewCache/);
  assert.match(dashboard, /variant="grid"/);
  assert.match(dashboard, /grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6/);
  assert.doesNotMatch(dashboard, /variant="row"/);
  assert.doesNotMatch(dashboard, /variant="mobile"/);
  assert.match(thumbnail, /data-dashboard-resume-thumbnail-grid/);
  assert.match(thumbnail, /ResumePreview/);
  assert.match(thumbnail, /dashboard-card/);
  assert.match(thumbnail, /dashboard-preview-fade-in/);
  assert.match(thumbnail, /bg-white\/90/);
  assert.match(thumbnail, /backdrop-blur-md/);
  assert.doesNotMatch(thumbnail, /bg-white\/92/);
  assert.doesNotMatch(thumbnail, /dark:bg-gray-800\/92/);
  assert.doesNotMatch(thumbnail, /buildStatusLabel/);
  assert.doesNotMatch(thumbnail, /absolute left-2 top-2/);
  assert.match(thumbnail, /IntersectionObserver/);
  assert.match(thumbnail, /isBatchEditMode/);
  assert.match(previewHook, /loadDashboardResumePreviewGlobalData/);
  assert.match(previewHook, /buildDashboardResumePreviewCacheKey/);
});

test('Dashboard preview thumbnails define a loaded-state fade-in animation', () => {
  const html = read('index.html');

  assert.match(html, /@keyframes dashboardPreviewFadeIn/);
  assert.match(html, /\.dashboard-preview-fade-in/);
  assert.match(html, /animation:\s*dashboardPreviewFadeIn 220ms ease-out both/);
});

test('Dashboard preview cache clears failed shared data loads before retrying', () => {
  const previewHook = read('views/Dashboard/useDashboardResumePreviewCache.ts');

  assert.match(previewHook, /const request = loadDashboardResumePreviewGlobalData\(\)[\s\S]*?\.catch\(\(error\) => \{/);
  assert.match(previewHook, /if \(globalDataPromiseRef\.current === request\) \{[\s\S]*?globalDataPromiseRef\.current = null;/);
  assert.match(previewHook, /throw error;/);
});

test('Dashboard preview cache listens for source data revision changes', () => {
  const previewHook = read('views/Dashboard/useDashboardResumePreviewCache.ts');
  const cache = read('views/Dashboard/dashboardResumePreviewCache.ts');
  const revision = readIfExists('services/resumePreviewDataRevision.ts');

  assert.match(cache, /previewDataRevision/);
  assert.match(previewHook, /getResumePreviewDataRevision/);
  assert.match(previewHook, /subscribeResumePreviewDataRevision/);
  assert.match(previewHook, /clearDashboardResumePreviewSnapshotCache\(\);/);
  assert.match(revision, /bumpResumePreviewDataRevision/);
});

test('Dashboard preview cache keys include the auth owner', () => {
  const previewHook = read('views/Dashboard/useDashboardResumePreviewCache.ts');
  const cache = read('views/Dashboard/dashboardResumePreviewCache.ts');

  assert.match(cache, /ownerKey/);
  assert.match(previewHook, /previewSnapshotCacheOwnerKey/);
  assert.match(previewHook, /ensureDashboardResumePreviewSnapshotCacheOwner/);
  assert.match(previewHook, /buildDashboardResumePreviewCacheKey\([\s\S]*?authUserKey/);
  assert.match(previewHook, /resolveDashboardResumePreviewEntry\([\s\S]*?authUserKey/);
  assert.match(previewHook, /ensureDashboardResumePreviewSnapshotCacheOwner\(authUserKey\)/);
  assert.match(previewHook, /\}, \[authUserKey, ensureGlobalData, entries, isAuthenticated, previewDataRevision\]\);/);
});

test('Dashboard preview source data mutations bump the shared preview revision', () => {
  [
    'services/profileService.ts',
    'services/experienceService.ts',
    'services/certificationsService.ts',
    'services/skillsService.ts',
  ].forEach((path) => {
    const source = read(path);
    assert.match(source, /bumpResumePreviewDataRevision/, `${path} should invalidate dashboard preview snapshots after source data mutations`);
  });
});

test('Dashboard preview resume mutations bump the shared preview revision', () => {
  const source = read('services/resumeService.ts');

  assert.match(source, /bumpResumePreviewDataRevision/);
  assert.match(
    source,
    /async update\([\s\S]*?bumpResumePreviewDataRevision\(\);[\s\S]*?return response\.data;/,
    'resume updates should invalidate dashboard preview snapshots after config/title changes'
  );
  assert.match(
    source,
    /async updateAssembly\([\s\S]*?bumpResumePreviewDataRevision\(\);[\s\S]*?return response\.data;/,
    'resume assembly changes should invalidate dashboard preview snapshots after selection/override changes'
  );
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

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
  const match = modal.match(/const resolveFallbackSelection = \([\s\S]*?\n\};/);
  assert.ok(match, 'resolveFallbackSelection should stay available for preview selection hydration');
  assert.match(modal, /config\.selection\?\.certificationIds,[\s\S]*?orderedCerts\.map\(\(item\) => item\.id\),\s*true/);
  assert.match(modal, /config\.selection\?\.skillIds,[\s\S]*?skills\.map\(\(skill\) => skill\.id\),\s*true/);

  const resolveSelectionSet = (ids) => new Set((ids || []).map((value) => String(value)).filter(Boolean));
  const functionSource = match[0]
    .replace('ids: Array<string | number> | undefined', 'ids')
    .replace('fallbackIds: string[]', 'fallbackIds');
  const resolveFallbackSelection = Function(
    'resolveSelectionSet',
    `${functionSource.replace('const resolveFallbackSelection =', 'return')}`
  )(resolveSelectionSet);

  assert.deepEqual([...resolveFallbackSelection([], ['cert-1', 'cert-2'], true)], []);
  assert.deepEqual([...resolveFallbackSelection(undefined, ['skill-1', 'skill-2'])], ['skill-1', 'skill-2']);
});

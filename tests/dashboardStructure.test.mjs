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

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import { chromium } from 'playwright';
import tailwindConfig from '../tailwind.config.cjs';

// Exercise the production sidebar, experience editing lifecycle, and motion CSS.
// Account-dependent leaf content is replaced; this does not exercise persistence.
const fixture = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import Sidebar from './views/ResumeEditor/components/EditorSidebar';
function Fixture() {
  const [tab, setTab] = useState('experience');
  const [editing, setEditing] = useState(null);
  const [company, setCompany] = useState('动画验证经历');
  const noop = () => {};
  const experience = {
    editingExpId: editing, editingDraft: editing ? { company, star: {} } : null,
    syncToMaster: false, startEditingExperience: () => setEditing('work-1'),
    cancelEditingExperience: () => setEditing(null),
    handleSaveExperience: () => { window.savedCompany = company; setEditing(null); },
    updateEditingMeta: (_, value) => setCompany(value),
  };
  return <div style={{height: '100dvh', maxWidth: 600}}><Sidebar
    sidebarTab={tab} onSelectTab={setTab} onProfileTabSelected={noop}
    layoutMode={window.innerWidth < 768 ? 'drawer' : 'inline'} showJDPanel={false}
    editingSuggestion={{staleExperienceIds: new Set()}} profileTabProps={{}}
    experienceTabProps={{ experience, certification: {}, skill: {}, selection: {},
      workItems: [{id: 'work-1'}], projectItems: [], sortedCertifications: [], skillGroups: [],
      selectedExpIds: new Set(), selectedCertIds: new Set(), selectedSkillIds: new Set(),
      staleExperienceIds: new Set(), certificationMatchScores: new Map(), certificationMatchTrends: new Map(),
      skillMatchScores: new Map(), skillMatchTrends: new Map(), matchScoreFilter: 70,
      onMatchScoreFilterChange: noop,
    }} /></div>;
}
createRoot(document.getElementById('root')).render(<React.StrictMode><Fixture /></React.StrictMode>);
`;

test('sidebar slides in both directions and experience exit retains the draft until completion', async () => {
  const mocks = {
    './ProfileTab': `export default () => <input aria-label="档案草稿" defaultValue="" />;`,
    './JDAnalysisPanel': `export default () => null;`,
    './ExperienceList/ListSection': `export default p => p.items.length ? <div style={{height: 1200}}><button onClick={() => p.onEditItem('work-1')}>编辑测试经历</button></div> : null;`,
    './PersonalSummaryPanel': `export default () => null;`,
    './SkillListSection': `export default () => null;`,
    './CertificationListSection': `export default () => null;`,
    '../../../components/MonthPicker': `export default () => null;`,
    '../../../components/RichTextEditor': `export default p => <textarea aria-label={p.ariaLabel} defaultValue={p.value} />;`,
  };
  const [{ outputFiles }, css] = await Promise.all([
    build({ stdin: { contents: fixture, loader: 'tsx', resolveDir: process.cwd() },
      bundle: true, write: false, format: 'iife', platform: 'browser',
      define: { 'process.env.NODE_ENV': '"development"' },
      plugins: [{ name: 'account-free-leaves', setup(build) {
        build.onResolve({ filter: /.*/ }, args => mocks[args.path] ? { path: args.path, namespace: 'fixture' } : undefined);
        build.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({
          contents: "import React from 'react'; " + mocks[args.path], loader: 'tsx', resolveDir: process.cwd(),
        }));
      } }],
    }),
    postcss([tailwindcss(tailwindConfig)]).process(readFileSync('styles/tailwind.css', 'utf8'), { from: 'styles/tailwind.css' }),
  ]);
  const browser = await chromium.launch({ headless: true });
  try {
    for (const width of [344, 1355]) {
      const page = await browser.newPage({ viewport: { width, height: 745 } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.setContent('<!doctype html><title>侧栏动画验证</title><div id="root"></div>');
      await page.addStyleTag({ content: css.css });
      await page.addScriptTag({ content: outputFiles[0].text });
      await page.getByRole('button', { name: '个人档案', exact: true }).evaluate(el => el.click());
      await page.waitForFunction(() => document.querySelector('.rf-sidebar-profile').getAnimations().length > 0);
      assert.equal(await page.locator('.rf-sidebar-experience').getAttribute('inert'), '');
      await page.getByRole('textbox', { name: '档案草稿' }).fill('切换后保留');
      await page.getByRole('button', { name: '经历库', exact: true }).click();
      await page.waitForTimeout(280);
      assert.equal(await page.getByRole('textbox', { name: '档案草稿' }).count(), 0);
      await page.getByRole('button', { name: '个人档案', exact: true }).click();
      assert.equal(await page.getByRole('textbox', { name: '档案草稿' }).inputValue(), '切换后保留');
      await page.getByRole('button', { name: '经历库', exact: true }).click();
      for (const closeLabel of ['返回列表', '取消', '保存']) {
        await page.getByRole('button', { name: '编辑测试经历' }).click();
        const field = page.getByPlaceholder('公司 / 项目名称');
        await field.fill('退出时仍显示草稿');
        if (width < 768) assert.equal(await page.locator('.rf-experience-enter').evaluate(el => getComputedStyle(el).animationName), 'rf-experience-enter');
        // Programmatic DOM click observes the immediate exit state before Playwright's settling delay.
        await page.getByRole('button', { name: closeLabel, exact: true }).evaluate(el => el.click());
        await page.waitForFunction(() => !!document.querySelector('.rf-experience-exit'));
        assert.equal(await page.locator('.rf-experience-exit').getAttribute('inert'), '');
        assert.equal(await field.inputValue(), '退出时仍显示草稿');
        await page.getByRole('button', { name: '编辑测试经历' }).waitFor();
        assert.equal(await page.locator('.rf-experience-exit').count(), 0);
      }
      assert.equal(await page.evaluate(() => window.savedCompany), '退出时仍显示草稿');
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.getByRole('button', { name: '编辑测试经历' }).click();
      assert.equal(await page.locator('.rf-experience-enter').evaluate(el => getComputedStyle(el).animationName), 'none');
      assert.equal(await page.locator('.rf-sidebar-experience').evaluate(el => getComputedStyle(el).transitionDuration), '0s');
      if (process.env.QA_MOTION_SCREENSHOT_DIR) await page.screenshot({ path: process.env.QA_MOTION_SCREENSHOT_DIR + '/sidebar-' + width + '.png' });
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally { await browser.close(); }
});

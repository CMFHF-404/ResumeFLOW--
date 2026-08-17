import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';

const importSectionRenderPlan = async () => {
  const result = await build({
    entryPoints: ['views/ResumeEditor/components/ResumePreview/sectionRenderPlan.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  });
  const encoded = Buffer.from(result.outputFiles[0].text).toString('base64');
  return import(`data:text/javascript;base64,${encoded}`);
};

test('resume preview section plans keep split and page variants explicit', async () => {
  const { resolveResumePreviewSectionPlan } = await importSectionRenderPlan();
  const layouts = ['split', 'page'];
  const expectedByLayout = {
    split: {
      summary: { kind: 'summary' },
      work: { kind: 'experience', experienceKind: 'work', title: '工作经历' },
      project: { kind: 'experience', experienceKind: 'project', title: '项目经历' },
      education: { kind: 'education', variant: 'split', includeOverflowState: false },
      certifications: { kind: 'certifications', variant: 'split', includeOverflowState: false },
      skills: { kind: 'skills', includeOverflowState: false },
    },
    page: {
      summary: { kind: 'summary' },
      work: { kind: 'experience', experienceKind: 'work', title: '工作经历' },
      project: { kind: 'experience', experienceKind: 'project', title: '项目经历' },
      education: { kind: 'education', variant: 'page', includeOverflowState: true },
      certifications: { kind: 'certifications', variant: 'page', includeOverflowState: true },
      skills: { kind: 'skills', includeOverflowState: true },
    },
  };

  for (const layout of layouts) {
    for (const [sectionId, expected] of Object.entries(expectedByLayout[layout])) {
      assert.deepEqual(
        resolveResumePreviewSectionPlan(sectionId, layout),
        expected,
        `${sectionId} should preserve its ${layout} render contract`,
      );
    }
    assert.equal(resolveResumePreviewSectionPlan('unknown', layout), null);
  }
});

test('ResumePreview routes split and page layouts through the shared section plan', () => {
  const source = readFileSync('views/ResumeEditor/components/ResumePreview.tsx', 'utf8');

  assert.match(source, /resolveResumePreviewSectionPlan/);
  assert.match(source, /renderOrderedSections\(splitColumnSectionIds\.sidebar, 'split'\)/);
  assert.match(source, /renderOrderedSections\(splitColumnSectionIds\.main, 'split'\)/);
  assert.match(source, /renderOrderedSections\(visibleSectionOrder, 'page'\)/);
  assert.doesNotMatch(source, /visibleSectionOrder\.map\(\(sectionId\)/);
});

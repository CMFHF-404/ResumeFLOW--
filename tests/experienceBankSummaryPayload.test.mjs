import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { test } from 'node:test';
import { build } from 'esbuild';

const importSummaryPayloadUtils = async () => {
  const result = await build({
    entryPoints: ['views/ExperienceBank/summaryPayloadUtils.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  });
  const source = result.outputFiles[0].text;
  const encoded = Buffer.from(source).toString('base64');
  return import(`data:text/javascript;base64,${encoded}`);
};

const experienceItem = (id, version = {}) => ({
  master: { id, user_id: 'user-1', category: 'work', created_at: '2026-01-01' },
  latest_version: {
    id: `${id}-v1`,
    master_id: id,
    title: `${id} title`,
    org: `${id} org`,
    start_date: '2024-01',
    end_date: '2024-12',
    is_current: false,
    star: { situation: `${id} situation` },
    summary: `${id} summary`,
    created_at: '2026-01-01',
    ...version,
  },
});

test('buildExperienceBankSummaryPayload maps sorted bank snapshot data for AI summaries', async () => {
  const { buildExperienceBankSummaryPayload } = await importSummaryPayloadUtils();
  const payload = buildExperienceBankSummaryPayload(
    {
      full_name: 'Ada Lovelace',
      email: 'ada@example.com',
      phone: '123456',
      location: 'London',
      social_links: {
        linkedin: { url: 'https://linkedin.com/in/ada', position: 1 },
      },
    },
    {
      profile: null,
      workItems: [experienceItem('work-b'), experienceItem('work-a')],
      projectItems: [experienceItem('project-a', { is_current: true, end_date: undefined })],
      educationItems: [experienceItem('education-a', { org: 'University', title: 'Math' })],
      certifications: [
        { id: 'cert-b', name: 'B Cert', issuer: 'Org B', issue_date: '2025-02' },
        { id: 'cert-a', name: 'A Cert', issuer: '', issue_date: '' },
      ],
      skills: [
        { id: 'skill-b', name: 'TypeScript', category: 'Frontend' },
        { id: 'skill-a', name: 'Python', category: null },
      ],
    }
  );

  assert.equal(payload.mode, 'bank');
  assert.deepEqual(payload.profile, {
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    phone: '123456',
    location: 'London',
    linkedin: 'https://linkedin.com/in/ada',
  });
  assert.deepEqual(payload.workExperiences.map((item) => item.id), ['work-a', 'work-b']);
  assert.deepEqual(payload.certifications.map((item) => item.id), ['cert-a', 'cert-b']);
  assert.deepEqual(payload.skills, [
    { id: 'skill-a', name: 'Python', category: '' },
    { id: 'skill-b', name: 'TypeScript', category: 'Frontend' },
  ]);
  assert.deepEqual(payload.projectExperiences[0], {
    id: 'project-a',
    title: 'project-a title',
    org: 'project-a org',
    start_date: '2024-01',
    end_date: undefined,
    is_current: true,
    star: { situation: 'project-a situation' },
    summary: 'project-a summary',
  });
});

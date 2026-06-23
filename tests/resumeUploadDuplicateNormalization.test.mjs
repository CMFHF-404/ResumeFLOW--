import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { test } from 'node:test';
import { build } from 'esbuild';

const importDerivedData = async () => {
  const result = await build({
    entryPoints: ['components/ResumeUploadModal/derivedData.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    define: {
      'import.meta.env.DEV': 'false',
      'import.meta.env.VITE_API_BASE_URL': '""',
      'import.meta.env.VITE_LOGTO_APP_ID': 'undefined',
    },
    plugins: [
      {
        name: 'resume-upload-service-stubs',
        setup(build) {
          build.onResolve({ filter: /services\/certificationsService$/ }, (args) => ({
            path: args.path,
            namespace: 'service-stub',
          }));
          build.onResolve({ filter: /services\/skillsService$/ }, (args) => ({
            path: args.path,
            namespace: 'service-stub',
          }));
          build.onLoad({ filter: /.*/, namespace: 'service-stub' }, (args) => {
            if (args.path.endsWith('certificationsService')) {
              return {
                contents: 'export const certificationsService = { list: async () => [] };',
                loader: 'js',
              };
            }
            return {
              contents: 'export const skillsService = { list: async () => [] };',
              loader: 'js',
            };
          });
        },
      },
    ],
  });
  const source = result.outputFiles[0].text;
  const encoded = Buffer.from(source).toString('base64');
  return import(`data:text/javascript;base64,${encoded}`);
};

test('parsed skill duplicates normalize CJK compatibility characters', async () => {
  const { buildParsedSkillGroups, buildSkillDuplicateIds } = await importDerivedData();
  const groups = buildParsedSkillGroups([
    { category: '产品能⼒', tags: ['了解项⽬管理与业务逻辑建模'] },
  ]);
  const duplicateIds = buildSkillDuplicateIds(groups, [
    {
      id: 'skill-1',
      user_id: 'user-1',
      skill_id: 'skill-def-1',
      name: '了解项目管理与业务逻辑建模',
      category: '产品能力',
    },
  ]);

  assert.deepEqual([...duplicateIds], ['产品能力::了解项目管理与业务逻辑建模']);
});

test('parsed skill duplicates tolerate model-added proficiency prefixes and category drift', async () => {
  const { buildParsedSkillGroups, buildSkillDuplicateIds } = await importDerivedData();
  const groups = buildParsedSkillGroups([
    { category: '核心产品能力', tags: ['了解项目管理与业务逻辑建模', '熟练掌握 PRD 撰写'] },
  ]);
  const duplicateIds = buildSkillDuplicateIds(groups, [
    {
      id: 'skill-1',
      user_id: 'user-1',
      skill_id: 'skill-def-1',
      name: '业务逻辑建模',
      category: '产品能力',
    },
    {
      id: 'skill-2',
      user_id: 'user-1',
      skill_id: 'skill-def-2',
      name: 'PRD文档撰写',
      category: '产品能力',
    },
  ]);

  assert.deepEqual(
    [...duplicateIds],
    ['核心产品能力::了解项目管理与业务逻辑建模', '核心产品能力::熟练掌握 prd 撰写']
  );
});

test('parsed certification duplicates normalize CJK compatibility characters', async () => {
  const { buildParsedCertifications, buildCertificationDuplicateIds } = await importDerivedData();
  const parsed = buildParsedCertifications([
    { name: '产品经理创造营结业证书', issuer: '腾讯公司', issue_date: '2024-08' },
  ]);
  const duplicateIds = buildCertificationDuplicateIds(parsed, [
    {
      id: 'cert-1',
      user_id: 'user-1',
      name: '产品经理创造营结业证书',
      issuer: '腾讯公司',
      issue_date: '2024.08',
      expiry_date: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
  ]);

  assert.deepEqual([...duplicateIds], ['cert-0-产品经理创造营结业证书']);
});

test('parsed certification duplicates tolerate issuer suffix drift', async () => {
  const { buildParsedCertifications, buildCertificationDuplicateIds } = await importDerivedData();
  const parsed = buildParsedCertifications([
    { name: '产品经理创造营结业证书', issuer: '腾讯公司', issue_date: '2024-08' },
  ]);

  const duplicateIds = buildCertificationDuplicateIds(parsed, [
    {
      id: 'cert-1',
      user_id: 'user-1',
      name: '产品经理创造营结业证书',
      issuer: '腾讯',
      issue_date: '2024-08-01',
      created_at: '',
      updated_at: '',
    },
  ]);

  assert.deepEqual([...duplicateIds], ['cert-0-产品经理创造营结业证书']);
});

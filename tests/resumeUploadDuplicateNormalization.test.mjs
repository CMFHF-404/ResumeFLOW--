import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { test } from 'node:test';
import { build } from 'esbuild';

const importDerivedData = async (existingCertifications = []) => {
  const result = await build({
    stdin: {
      contents: `
        export * from './components/ResumeUploadModal/derivedData';
        export { certificationListCalls } from './services/certificationsService';
      `,
      resolveDir: process.cwd(),
      loader: 'js',
    },
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
          build.onResolve({ filter: /services\/certificationsService$/ }, () => ({
            path: 'certificationsService',
            namespace: 'service-stub',
          }));
          build.onResolve({ filter: /services\/skillsService$/ }, () => ({
            path: 'skillsService',
            namespace: 'service-stub',
          }));
          build.onLoad({ filter: /.*/, namespace: 'service-stub' }, (args) => {
            if (args.path.endsWith('certificationsService')) {
              return {
                contents: `
                  export const certificationListCalls = [];
                  export const certificationsService = {
                    list: async (options) => {
                      certificationListCalls.push(options);
                      return ${JSON.stringify(existingCertifications)};
                    },
                  };
                `,
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

test('certification import refreshes the owner list and matches preview duplicate signatures', async () => {
  const existing = [
    { name: '产品证书', issuer: '腾讯集团', issue_date: '2024-08-01' },
    { name: '无日期证书', issuer: '测试公司', issue_date: null },
  ];
  const {
    buildParsedCertifications,
    buildCertificationDuplicateIds,
    buildCertificationImportPayloads,
    certificationListCalls,
  } = await importDerivedData(existing);
  const parsed = buildParsedCertifications([
    { name: '产品证书', issuer: '腾讯有限公司', issue_date: '2024.08' },
    { name: '无日期证书', issuer: '测试', issue_date: '' },
    { name: '新证书', issuer: '新机构', issue_date: '2025-06' },
    { name: '新证书', issuer: '新机构公司', issue_date: '2025-06-01' },
  ]);

  assert.deepEqual([...buildCertificationDuplicateIds(parsed, existing)], [
    parsed[0].id,
    parsed[1].id,
  ]);
  const payloads = await buildCertificationImportPayloads(parsed, {
    expectedAuthCacheKey: 'owner-a',
  });
  assert.deepEqual(certificationListCalls, [{ force: true, expectedAuthCacheKey: 'owner-a' }]);
  assert.equal(payloads.length, 1);
  assert.equal(payloads[0].name, '新证书');
  assert.equal(payloads[0].issuer, '新机构');
  assert.equal(payloads[0].issue_date, '2025-06-01');
});

test('certification import with no valid names does not fetch the existing list', async () => {
  const { buildCertificationImportPayloads, certificationListCalls } = await importDerivedData();
  assert.deepEqual(await buildCertificationImportPayloads([{ id: 'blank', name: '  ' }]), []);
  assert.deepEqual(certificationListCalls, []);
});

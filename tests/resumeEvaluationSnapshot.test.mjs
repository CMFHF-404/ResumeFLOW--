import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { test } from 'node:test';
import { build } from 'esbuild';

const importSnapshotUtils = async () => {
  const result = await build({
    entryPoints: ['hooks/jdAnalysisSignatureUtils.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  });
  const encoded = Buffer.from(result.outputFiles[0].text).toString('base64');
  return import(`data:text/javascript;base64,${encoded}`);
};

const importAssistantContextUtils = async () => {
  const result = await build({
    entryPoints: ['utils/assistantResumeContext.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  });
  const encoded = Buffer.from(result.outputFiles[0].text).toString('base64');
  return import(`data:text/javascript;base64,${encoded}`);
};

const experiences = [
  { id: 'exp-selected', title: '产品实习生', company: '原子科技', startDate: '2025-01', endDate: '2025-06', category: 'work', star: { s: '用户流失', t: '定位原因', a: '<b>访谈 20 人</b>', r: '形成方案' } },
  { id: 'exp-unselected', title: '隐藏经历', company: '其他公司', startDate: '2024-01', endDate: '2024-02', category: 'project', star: { s: '隐藏事实', t: '', a: '', r: '' } },
];
const certifications = [
  { id: 'cert-selected', name: 'PMP', issuer: 'PMI', date: '2025-03' },
  { id: 'cert-unselected', name: '隐藏证书', issuer: '机构', date: '2024-03' },
];
const skillGroups = [{
  id: 'group-1',
  name: '工具',
  skills: [{ id: 'skill-selected', name: 'Figma' }, { id: 'skill-unselected', name: '隐藏技能' }],
}];
const educations = [
  { id: 'edu-selected', school: '原子大学', major: '信息管理', degree: '本科', startDate: '2022-09', endDate: '2026-06' },
  { id: 'edu-unselected', school: '隐藏学校', major: '隐藏专业', degree: '本科', startDate: '2020-09', endDate: '2021-06' },
];
const profile = {
  name: '范鼎',
  email: 'fan@example.com',
  phone: '',
  location: '杭州',
  linkedin: '',
  summary: '全局总结',
  avatarDataUrl: 'data:image/png;base64,ignored',
};

const context = {
  profile,
  personalSummary: '当前简历总结',
  hasPersonalSummaryOverride: true,
  isSummaryVisible: true,
  targetRole: '产品经理',
  educations,
  selectedExperienceIds: new Set(['exp-selected']),
  selectedEducationIds: new Set(['edu-selected']),
  selectedCertificationIds: new Set(['cert-selected']),
  selectedSkillIds: new Set(['skill-selected']),
  sectionOrder: ['summary', 'education', 'work', 'project', 'certifications', 'skills'],
};

test('full-resume snapshot separates selected resume content from independent match candidates', async () => {
  const { buildAnalyzePayload } = await importSnapshotUtils();
  const snapshot = buildAnalyzePayload(experiences, certifications, skillGroups, context);

  assert.equal(snapshot.evaluation_scope, 'full_resume');
  assert.equal(snapshot.target_role, '产品经理');
  assert.deepEqual(snapshot.resume.experiences.map((item) => item.id), ['exp-selected']);
  assert.equal(snapshot.resume.experiences[0].category, 'work');
  assert.deepEqual(snapshot.resume.section_order, context.sectionOrder);
  assert.deepEqual(snapshot.resume.educations.map((item) => item.id), ['edu-selected']);
  assert.deepEqual(snapshot.resume.certifications.map((item) => item.id), ['cert-selected']);
  assert.deepEqual(snapshot.resume.skills.map((item) => item.id), ['skill-selected']);
  assert.deepEqual(snapshot.experience_atoms.map((item) => item.id), ['exp-selected', 'exp-unselected']);
  assert.deepEqual(snapshot.match_candidates.certifications.map((item) => item.id), ['cert-selected', 'cert-unselected']);
  assert.deepEqual(snapshot.match_candidates.skills.map((item) => item.id), ['skill-selected', 'skill-unselected']);
  assert.equal(snapshot.resume.experiences[0].star.a, '访谈 20 人');

  assert.ok(snapshot.fact_metadata.length > 0);
  assert.ok(snapshot.fact_metadata.every((fact) => fact.verification_status === 'user_claimed'));
  assert.ok(snapshot.fact_metadata.every((fact) => fact.confidence === 1 && fact.source));
  const factText = snapshot.fact_metadata.map((fact) => fact.content).join('\n');
  assert.match(factText, /当前简历总结/);
  assert.match(factText, /原子大学/);
  assert.doesNotMatch(factText, /隐藏经历|隐藏证书|隐藏技能|隐藏学校/);
  assert.ok(!JSON.stringify(snapshot.resume).includes('avatarDataUrl'));
});

test('evaluation signature changes for profile and selection while match-candidate signature stays stable', async () => {
  const { buildAnalyzeSignature, buildMatchCandidateSignature } = await importSnapshotUtils();
  const candidateSignature = buildMatchCandidateSignature(experiences, certifications, skillGroups);
  const profileSignature = buildAnalyzeSignature(experiences, certifications, skillGroups, context);
  const renamedSignature = buildAnalyzeSignature(experiences, certifications, skillGroups, {
    ...context,
    profile: { ...profile, name: '新姓名' },
  });
  const selectionSignature = buildAnalyzeSignature(experiences, certifications, skillGroups, {
    ...context,
    selectedExperienceIds: new Set(['exp-unselected']),
  });

  assert.notEqual(profileSignature, renamedSignature);
  assert.notEqual(profileSignature, selectionSignature);
  assert.equal(candidateSignature, buildMatchCandidateSignature(experiences, certifications, skillGroups));
});

test('evaluation signature tracks rendered section order while match candidates remain stable', async () => {
  const { buildAnalyzePayload, buildAnalyzeSignature, buildMatchCandidateSignature } = await importSnapshotUtils();
  const reorderedContext = {
    ...context,
    sectionOrder: ['summary', 'work', 'project', 'education', 'certifications', 'skills'],
  };

  const original = buildAnalyzePayload(experiences, certifications, skillGroups, context);
  const reordered = buildAnalyzePayload(experiences, certifications, skillGroups, reorderedContext);

  assert.deepEqual(original.resume.section_order, context.sectionOrder);
  assert.deepEqual(reordered.resume.section_order, reorderedContext.sectionOrder);
  assert.notEqual(
    buildAnalyzeSignature(experiences, certifications, skillGroups, context),
    buildAnalyzeSignature(experiences, certifications, skillGroups, reorderedContext),
  );
  assert.equal(
    buildMatchCandidateSignature(experiences, certifications, skillGroups),
    buildMatchCandidateSignature(experiences, certifications, skillGroups),
  );
});

test('explicitly empty personal-summary override does not fall back to the global summary', async () => {
  const { buildAnalyzePayload, buildAnalyzeSignature } = await importSnapshotUtils();
  const inheritedContext = {
    ...context,
    personalSummary: '',
    hasPersonalSummaryOverride: false,
  };
  const clearedContext = {
    ...inheritedContext,
    hasPersonalSummaryOverride: true,
  };

  const inherited = buildAnalyzePayload(experiences, certifications, skillGroups, inheritedContext);
  const cleared = buildAnalyzePayload(experiences, certifications, skillGroups, clearedContext);

  assert.equal(inherited.resume.personal_summary, '全局总结');
  assert.equal(cleared.resume.personal_summary, '');
  assert.match(inherited.fact_metadata.map((fact) => fact.content).join('\n'), /全局总结/);
  assert.doesNotMatch(cleared.fact_metadata.map((fact) => fact.content).join('\n'), /全局总结/);
  assert.notEqual(
    buildAnalyzeSignature(experiences, certifications, skillGroups, inheritedContext),
    buildAnalyzeSignature(experiences, certifications, skillGroups, clearedContext),
  );
});

test('quality-only analysis cannot become JD polish or capability context', async () => {
  const {
    buildJDCapabilityContext,
    buildJDIntentSummary,
    buildJDPolishContext,
  } = await importAssistantContextUtils();
  const qualityOnlyResult = {
    summary: '简历质量良好，但成果量化仍可加强。',
    resumeEvaluation: { jdMatch: null },
    capabilityAnalysis: {
      overallEvidenceCompleteness: 80,
      coreCapabilities: [],
      scoreWarnings: ['仅有通用质量诊断'],
    },
  };

  assert.equal(buildJDPolishContext('', qualityOnlyResult, false), '');
  assert.equal(buildJDCapabilityContext(qualityOnlyResult, false), '');
  assert.equal(buildJDIntentSummary(qualityOnlyResult), '');
  assert.equal(
    buildJDPolishContext('真实 JD', qualityOnlyResult, false),
    '真实 JD'
  );
});

test('JD fallbacks use role intent and never relabel the resume-quality summary', async () => {
  const { buildJDIntentSummary, buildJDPolishContext } = await importAssistantContextUtils();
  const result = {
    summary: '简历质量良好，但成果量化仍可加强。',
    jobTitle: '产品经理',
    resumeEvaluation: { jdMatch: 82 },
    jdInterpretation: {
      roleIntent: '负责从用户研究到产品落地的完整闭环。',
    },
  };

  assert.equal(
    buildJDIntentSummary(result),
    '负责从用户研究到产品落地的完整闭环。'
  );
  const fallbackContext = buildJDPolishContext('', result, false);
  assert.match(fallbackContext, /岗位诉求：负责从用户研究到产品落地的完整闭环。/);
  assert.doesNotMatch(fallbackContext, /简历质量良好/);
});

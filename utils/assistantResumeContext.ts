import type { AssistantSelectedResume, JDAnalysisResult } from '../services/aiService';
import type { Certification } from '../services/certificationsService';
import type { ExperienceListItem } from '../services/experienceService';
import type { Resume, ResumeDetail } from '../services/resumeService';
import type { UserSkill } from '../services/skillsService';
import type { ResumeEditorConfig, ResumeJDAnalysis } from '../types/resume';
import {
  buildStarFields,
  normalizeEducationStar,
  type ResumeAISnapshot,
} from './resumeHelpers';
import { canonicalStringify } from './canonicalStringify';

const normalizeResumeConfig = (config: unknown): ResumeEditorConfig => {
  if (!config || typeof config !== 'object') {
    return {};
  }
  return config as ResumeEditorConfig;
};

export const buildJDPolishContext = (
  jdText: string,
  analysisResult: JDAnalysisResult | null,
  isOutdated: boolean
) => {
  const trimmedJdText = jdText.trim();
  if (trimmedJdText) {
    return trimmedJdText;
  }
  if (!analysisResult || isOutdated) {
    return '';
  }
  if (analysisResult.extractedJdText?.trim()) {
    return analysisResult.extractedJdText.trim();
  }
  const contextLines = [
    analysisResult.jobTitle?.trim() ? `目标岗位：${analysisResult.jobTitle.trim()}` : '',
    analysisResult.company?.trim() ? `目标公司：${analysisResult.company.trim()}` : '',
    analysisResult.summary?.trim() ? `岗位摘要：${analysisResult.summary.trim()}` : '',
    analysisResult.jobKeywords?.length ? `岗位关键词：${analysisResult.jobKeywords.join('、')}` : '',
    analysisResult.missingKeywords?.length ? `重点补强：${analysisResult.missingKeywords.join('、')}` : '',
  ].filter(Boolean);
  return contextLines.join('\n');
};

export const buildJDCapabilityContext = (
  analysisResult: JDAnalysisResult | null,
  isOutdated: boolean
) => {
  const currentAnalysis = !isOutdated ? analysisResult : null;
  const capabilityAnalysis = currentAnalysis?.capabilityAnalysis;
  const coreCapabilities = Array.isArray(capabilityAnalysis?.coreCapabilities)
    ? capabilityAnalysis.coreCapabilities
    : [];
  const scoreWarnings = Array.isArray(capabilityAnalysis?.scoreWarnings)
    ? capabilityAnalysis.scoreWarnings
    : [];
  const weakCapabilities = coreCapabilities
    .filter((item) => item.resumeEvidenceLevel <= 2 || item.risk !== 'none')
    .map((item) => item.name)
    .filter(Boolean)
    .slice(0, 6);
  const followUpQuestions = coreCapabilities
    .flatMap((item) => Array.isArray(item.followUpQuestions) ? item.followUpQuestions : [])
    .filter(Boolean)
    .slice(0, 5);
  const capabilityLines = [
    capabilityAnalysis ? `证据完整度：${capabilityAnalysis.overallEvidenceCompleteness}%` : '',
    scoreWarnings.length ? `证据风险：${scoreWarnings.join('；')}` : '',
    weakCapabilities.length ? `弱证据能力：${weakCapabilities.join('、')}` : '',
    followUpQuestions.length ? `建议先追问补充：${followUpQuestions.join('；')}` : '',
  ].filter(Boolean);
  return capabilityLines.length
    ? ['能力证据诊断：', capabilityLines.join('\n')].join('\n')
    : '';
};

const resolveSelectedIds = (value: unknown) => {
  if (!Array.isArray(value)) {
    return null;
  }
  return new Set(
    value
      .map((item) => String(item).trim())
      .filter(Boolean),
  );
};

const sortSnapshotEntriesById = <T extends { id: string }>(items: T[]) => (
  [...items].sort((left, right) => left.id.localeCompare(right.id))
);

const buildExperienceSignature = (snapshot: ResumeAISnapshot) => canonicalStringify({
  experiences: sortSnapshotEntriesById(snapshot.experiences),
  certifications: sortSnapshotEntriesById(snapshot.certifications),
  skills: sortSnapshotEntriesById(snapshot.skills),
});

const isJDAnalysisOutdated = (jdAnalysis: ResumeJDAnalysis | null, snapshot: ResumeAISnapshot) => {
  if (!jdAnalysis) {
    return true;
  }
  // Picker context only has the persisted resume payload, not the original uploaded JD file.
  // Re-check content drift against the stored analysis, and keep attachment-backed JD context
  // when the underlying resume snapshot hasn't changed.
  return jdAnalysis.experienceSignature !== buildExperienceSignature(snapshot);
};

const buildResumeSnapshot = (
  detail: ResumeDetail,
  educations: ExperienceListItem[],
  certifications: Certification[],
  skills: UserSkill[],
) => {
  const config = normalizeResumeConfig(detail.resume.config);
  const selectedExperienceIds = resolveSelectedIds(config.selection?.experienceIds);
  const selectedEducationIds = resolveSelectedIds(config.selection?.educationIds);
  const selectedCertificationIds = resolveSelectedIds(config.selection?.certificationIds);
  const selectedSkillIds = resolveSelectedIds(config.selection?.skillIds);
  const educationMasterIds = new Set(
    educations.map((item) => item.master.id),
  );

  return {
    experiences: detail.experiences
      .filter((item) => !educationMasterIds.has(item.experience.master_experience_id))
      .filter((item) => !selectedExperienceIds || selectedExperienceIds.has(item.experience.master_experience_id))
      .map((item) => ({
        id: item.experience.master_experience_id,
        title: item.experience.title || '',
        org: item.experience.org || '',
        start_date: item.experience.start_date || undefined,
        end_date: item.experience.end_date || undefined,
        star: buildStarFields(item.experience.star),
      })),
    educations: educations
      .filter((item) => !selectedEducationIds || selectedEducationIds.has(item.master.id))
      .map((item) => {
        const normalizedEducationStar = normalizeEducationStar(item.latest_version?.star);
        return {
          id: item.master.id,
          school: item.latest_version?.org || '',
          major: item.latest_version?.title || '',
          degree: normalizedEducationStar.degree,
          start_date: item.latest_version?.start_date || undefined,
          end_date: item.latest_version?.end_date || undefined,
          gpa: normalizedEducationStar.gpa || undefined,
          courses: normalizedEducationStar.courses || undefined,
        };
      }),
    certifications: certifications
      .filter((item) => !selectedCertificationIds || selectedCertificationIds.has(item.id))
      .map((item) => ({
        id: item.id,
        name: item.name || '',
        issuer: item.issuer || undefined,
        issue_date: item.issue_date || '',
      })),
    skills: skills
      .filter((item) => !selectedSkillIds || selectedSkillIds.has(item.id))
      .map((item) => ({
        id: item.id,
        name: item.name || '',
        category: item.category || '',
      })),
  } satisfies ResumeAISnapshot;
};

export const buildSelectedResumeFromResources = (
  resume: Resume,
  detail: ResumeDetail,
  educations: ExperienceListItem[],
  certifications: Certification[],
  skills: UserSkill[],
): AssistantSelectedResume => {
  const config = normalizeResumeConfig(detail.resume.config ?? resume.config);
  const snapshot = buildResumeSnapshot(detail, educations, certifications, skills);
  const jdAnalysis = config.jdAnalysis ?? null;
  const jdContext = buildJDPolishContext(
    jdAnalysis?.jdText ?? '',
    jdAnalysis?.result ?? null,
    isJDAnalysisOutdated(jdAnalysis, snapshot),
  );

  return {
    resumeId: detail.resume.id,
    resumeName: detail.resume.title || resume.title || '未命名简历',
    snapshot,
    ...(jdContext ? { jdContext } : {}),
  };
};

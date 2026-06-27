import type {
  AssistantMessage,
  AssistantSelectedExperience,
  AssistantSelectedResume,
  AssistantSkillId,
  AssistantSuggestedFollowup,
} from '../../services/aiService';
import type { ExperienceListItem } from '../../services/experienceService';
import type { Resume } from '../../services/resumeService';
import { stripRichTextToText } from '../../utils/richText';

const SELECTED_EXPERIENCE_TEXT_LIMIT = 300;
const SELECTED_EXPERIENCE_SUMMARY_LIMIT = 300;
const SELECTED_EXPERIENCE_STAR_LIMIT = 500;
const SELECTED_RESUME_TEXT_LIMIT = 300;
const SELECTED_RESUME_NAME_LIMIT = 160;
const SELECTED_RESUME_JD_LIMIT = 4000;
const SELECTED_RESUME_SELECTION_ID_LIMIT = 120;
const ASSISTANT_SKILL_IDS = new Set<AssistantSkillId>(['star_guidance', 'experience_completion', 'mock_interview']);
const EXPERIENCE_CATEGORY_SET = new Set<AssistantSelectedExperience['category']>([
  'work',
  'project',
  'education',
]);

export const normalizeAssistantSuggestedFollowups = (value: unknown): AssistantSuggestedFollowup[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  const normalized: AssistantSuggestedFollowup[] = [];
  const seenPrompts = new Set<string>();
  value.forEach((item) => {
    if (!item || typeof item !== 'object') {
      return;
    }
    const record = item as Record<string, unknown>;
    const label = typeof record.label === 'string' ? record.label.trim() : '';
    const prompt = typeof record.prompt === 'string' ? record.prompt.trim() : '';
    const skillId = typeof record.skillId === 'string' ? record.skillId : (
      typeof record.skill_id === 'string' ? record.skill_id : ''
    );
    if (!label || !prompt || !ASSISTANT_SKILL_IDS.has(skillId as AssistantSkillId)) {
      return;
    }
    const promptKey = prompt.replace(/\s+/g, '');
    if (seenPrompts.has(promptKey)) {
      return;
    }
    seenPrompts.add(promptKey);
    normalized.push({ label, prompt, skillId: skillId as AssistantSkillId });
  });
  return normalized.slice(0, 3);
};

const extractLastAssistantQuestion = (text: string) => {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return '';
  }
  const questionMatches = normalized.match(/[^。！？?!]*[？?]/g) ?? [];
  const lastQuestion = questionMatches.at(-1)?.trim();
  if (lastQuestion) {
    return lastQuestion;
  }
  const segments = normalized.split(/[。！？?!]/).map((item) => item.trim()).filter(Boolean);
  return segments.at(-1) ?? '';
};

export const buildFallbackSuggestedFollowups = (message: AssistantMessage): AssistantSuggestedFollowup[] => {
  const text = typeof message.content_json?.text === 'string' ? message.content_json.text : '';
  const question = extractLastAssistantQuestion(text);
  if (!question) {
    return [];
  }
  if (
    typeof message.content_json?.skill_id !== 'string'
    || !ASSISTANT_SKILL_IDS.has(message.content_json.skill_id as AssistantSkillId)
  ) {
    return [];
  }
  const skillId = message.content_json.skill_id as AssistantSkillId;
  return [
    {
      label: '回答这个问题',
      prompt: `我来补充这个问题：${question}`,
      skillId,
    },
  ];
};

const clipSelectedExperienceText = (value: string, limit: number) => {
  const normalized = value.trim();
  if (!normalized) {
    return '';
  }
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, limit).trimEnd()}...`;
};

export const buildSelectedExperienceSummary = (item: ExperienceListItem) => {
  const latest = item.latest_version;
  const summary = clipSelectedExperienceText(
    stripRichTextToText(latest?.summary || ''),
    SELECTED_EXPERIENCE_SUMMARY_LIMIT,
  );
  if (summary) {
    return summary;
  }
  const star = latest?.star || {};
  return (
    clipSelectedExperienceText(
      stripRichTextToText(typeof star.s === 'string' ? star.s : ''),
      SELECTED_EXPERIENCE_STAR_LIMIT,
    )
    || clipSelectedExperienceText(
      stripRichTextToText(typeof star.a === 'string' ? star.a : ''),
      SELECTED_EXPERIENCE_STAR_LIMIT,
    )
    || ''
  );
};

export const buildSelectedExperience = (item: ExperienceListItem): AssistantSelectedExperience => {
  const latest = item.latest_version;
  const star = latest?.star || {};
  return {
    masterId: item.master.id,
    category: item.master.category,
    org: clipSelectedExperienceText(latest?.org || '', SELECTED_EXPERIENCE_TEXT_LIMIT),
    title: clipSelectedExperienceText(latest?.title || '', SELECTED_EXPERIENCE_TEXT_LIMIT),
    startDate: clipSelectedExperienceText(latest?.start_date || '', SELECTED_EXPERIENCE_TEXT_LIMIT),
    endDate: clipSelectedExperienceText(latest?.end_date || '', SELECTED_EXPERIENCE_TEXT_LIMIT),
    isCurrent: Boolean(latest?.is_current),
    summary: buildSelectedExperienceSummary(item),
    star: {
      s: clipSelectedExperienceText(
        typeof star.s === 'string' ? star.s : '',
        SELECTED_EXPERIENCE_STAR_LIMIT,
      ),
      t: clipSelectedExperienceText(
        typeof star.t === 'string' ? star.t : '',
        SELECTED_EXPERIENCE_STAR_LIMIT,
      ),
      a: clipSelectedExperienceText(
        typeof star.a === 'string' ? star.a : '',
        SELECTED_EXPERIENCE_STAR_LIMIT,
      ),
      r: clipSelectedExperienceText(
        typeof star.r === 'string' ? star.r : '',
        SELECTED_EXPERIENCE_STAR_LIMIT,
      ),
    },
  };
};

const normalizeSelectedExperienceText = (value: unknown, limit = SELECTED_EXPERIENCE_TEXT_LIMIT): string => {
  if (typeof value !== 'string') {
    return '';
  }
  return clipSelectedExperienceText(value, limit);
};

const normalizeSelectedExperienceStar = (value: unknown): AssistantSelectedExperience['star'] | undefined => {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const rawStar = value as Record<string, unknown>;
  const star = {
    s: normalizeSelectedExperienceText(rawStar.s, SELECTED_EXPERIENCE_STAR_LIMIT),
    t: normalizeSelectedExperienceText(rawStar.t, SELECTED_EXPERIENCE_STAR_LIMIT),
    a: normalizeSelectedExperienceText(rawStar.a, SELECTED_EXPERIENCE_STAR_LIMIT),
    r: normalizeSelectedExperienceText(rawStar.r, SELECTED_EXPERIENCE_STAR_LIMIT),
  };
  if (!star.s && !star.t && !star.a && !star.r) {
    return undefined;
  }
  return star;
};

const clipSelectedResumeText = (value: string, limit: number) => {
  const normalized = value.trim();
  if (!normalized) {
    return '';
  }
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, limit).trimEnd()}...`;
};

const normalizeSelectedResumeText = (value: unknown, limit = SELECTED_RESUME_TEXT_LIMIT): string => {
  if (typeof value !== 'string') {
    return '';
  }
  return clipSelectedResumeText(value, limit);
};

const normalizeSelectedResumeSnapshot = (value: unknown): AssistantSelectedResume['snapshot'] => {
  if (!value || typeof value !== 'object') {
    return { experiences: [], educations: [], certifications: [], skills: [] };
  }
  const rawSnapshot = value as Record<string, unknown>;
  const rawExperiences = Array.isArray(rawSnapshot.experiences) ? rawSnapshot.experiences : [];
  const rawEducations = Array.isArray(rawSnapshot.educations) ? rawSnapshot.educations : [];
  const rawCertifications = Array.isArray(rawSnapshot.certifications) ? rawSnapshot.certifications : [];
  const rawSkills = Array.isArray(rawSnapshot.skills) ? rawSnapshot.skills : [];

  return {
    experiences: rawExperiences.flatMap((item) => {
      if (!item || typeof item !== 'object') {
        return [];
      }
      const candidate = item as Record<string, unknown>;
      const id = normalizeSelectedResumeText(candidate.id);
      if (!id) {
        return [];
      }
      return [{
        id,
        title: normalizeSelectedResumeText(candidate.title),
        org: normalizeSelectedResumeText(candidate.org),
        start_date: normalizeSelectedResumeText(candidate.start_date) || undefined,
        end_date: normalizeSelectedResumeText(candidate.end_date) || undefined,
        star: {
          s: normalizeSelectedExperienceText((candidate.star as Record<string, unknown> | undefined)?.s, SELECTED_EXPERIENCE_STAR_LIMIT),
          t: normalizeSelectedExperienceText((candidate.star as Record<string, unknown> | undefined)?.t, SELECTED_EXPERIENCE_STAR_LIMIT),
          a: normalizeSelectedExperienceText((candidate.star as Record<string, unknown> | undefined)?.a, SELECTED_EXPERIENCE_STAR_LIMIT),
          r: normalizeSelectedExperienceText((candidate.star as Record<string, unknown> | undefined)?.r, SELECTED_EXPERIENCE_STAR_LIMIT),
        },
      }];
    }),
    educations: rawEducations.flatMap((item) => {
      if (!item || typeof item !== 'object') {
        return [];
      }
      const candidate = item as Record<string, unknown>;
      const id = normalizeSelectedResumeText(candidate.id);
      if (!id) {
        return [];
      }
      return [{
        id,
        school: normalizeSelectedResumeText(candidate.school),
        major: normalizeSelectedResumeText(candidate.major),
        degree: normalizeSelectedResumeText(candidate.degree),
        start_date: normalizeSelectedResumeText(candidate.start_date) || undefined,
        end_date: normalizeSelectedResumeText(candidate.end_date) || undefined,
        gpa: normalizeSelectedResumeText(candidate.gpa) || undefined,
        courses: normalizeSelectedResumeText(candidate.courses) || undefined,
      }];
    }),
    certifications: rawCertifications.flatMap((item) => {
      if (!item || typeof item !== 'object') {
        return [];
      }
      const candidate = item as Record<string, unknown>;
      const id = normalizeSelectedResumeText(candidate.id);
      if (!id) {
        return [];
      }
      return [{
        id,
        name: normalizeSelectedResumeText(candidate.name),
        issuer: normalizeSelectedResumeText(candidate.issuer) || undefined,
        issue_date: normalizeSelectedResumeText(candidate.issue_date),
      }];
    }),
    skills: rawSkills.flatMap((item) => {
      if (!item || typeof item !== 'object') {
        return [];
      }
      const candidate = item as Record<string, unknown>;
      const id = normalizeSelectedResumeText(candidate.id);
      if (!id) {
        return [];
      }
      return [{
        id,
        name: normalizeSelectedResumeText(candidate.name),
        category: normalizeSelectedResumeText(candidate.category),
      }];
    }),
  };
};

const normalizeSelectedResumeSelection = (value: unknown): AssistantSelectedResume['selection'] | undefined => {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const candidate = value as Record<string, unknown>;
  const mode = candidate.mode === 'subset' ? 'subset' : candidate.mode === 'all' ? 'all' : null;
  const rawIds = Array.isArray(candidate.experienceIds)
    ? candidate.experienceIds
    : Array.isArray(candidate.experience_ids)
      ? candidate.experience_ids
      : [];
  const experienceIds = Array.from(new Set(rawIds
    .map((item) => normalizeSelectedResumeText(item, SELECTED_RESUME_SELECTION_ID_LIMIT))
    .filter(Boolean)));
  if (!mode || (mode === 'subset' && experienceIds.length === 0)) {
    return undefined;
  }
  return {
    mode,
    experienceIds,
  };
};

export const normalizeSelectedResume = (value: unknown): AssistantSelectedResume | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  const resumeId = normalizeSelectedResumeText(candidate.resumeId ?? candidate.resume_id);
  const resumeName = normalizeSelectedResumeText(candidate.resumeName ?? candidate.resume_name, SELECTED_RESUME_NAME_LIMIT);
  if (!resumeId || !resumeName) {
    return null;
  }
  const normalized: AssistantSelectedResume = {
    resumeId,
    resumeName,
    snapshot: normalizeSelectedResumeSnapshot(candidate.snapshot),
  };
  const masterId = normalizeSelectedResumeText(candidate.masterId ?? candidate.master_id);
  if (masterId) {
    normalized.masterId = masterId;
  }
  const jdContext = normalizeSelectedResumeText(candidate.jdContext ?? candidate.jd_context, SELECTED_RESUME_JD_LIMIT);
  if (jdContext) {
    normalized.jdContext = jdContext;
  }
  const selection = normalizeSelectedResumeSelection(candidate.selection);
  if (selection) {
    normalized.selection = selection;
  }
  return normalized;
};

export const hasResumeJDContext = (resume: Resume) => {
  const jdAnalysis = resume.config?.jdAnalysis;
  if (!jdAnalysis || typeof jdAnalysis !== 'object') {
    return false;
  }
  const jdText = typeof jdAnalysis.jdText === 'string' ? jdAnalysis.jdText.trim() : '';
  if (jdText) {
    return true;
  }
  const result = jdAnalysis.result;
  if (!result || typeof result !== 'object') {
    return false;
  }
  const extractedJdText = (typeof (result as Record<string, unknown>).extractedJdText === 'string'
    ? (result as Record<string, unknown>).extractedJdText
    : typeof (result as Record<string, unknown>).extracted_jd_text === 'string'
      ? (result as Record<string, unknown>).extracted_jd_text
      : '') as string;
  const summary = (typeof (result as Record<string, unknown>).summary === 'string'
    ? (result as Record<string, unknown>).summary
    : '') as string;
  return Boolean(extractedJdText.trim() || summary.trim());
};

export const readMessageSelectedExperiences = (message: AssistantMessage): AssistantSelectedExperience[] => {
  const rawSelections = message.content_json?.selected_experiences;
  if (!Array.isArray(rawSelections)) {
    return [];
  }
  return rawSelections.flatMap((item) => {
    if (!item || typeof item !== 'object') {
      return [];
    }
    const candidate = item as Record<string, unknown>;
    const masterId = normalizeSelectedExperienceText(candidate.masterId);
    const category = candidate.category;
    if (!masterId || typeof category !== 'string' || !EXPERIENCE_CATEGORY_SET.has(category as AssistantSelectedExperience['category'])) {
      return [];
    }
    const normalized: AssistantSelectedExperience = {
      masterId,
      category: category as AssistantSelectedExperience['category'],
      org: normalizeSelectedExperienceText(candidate.org),
      title: normalizeSelectedExperienceText(candidate.title),
      startDate: normalizeSelectedExperienceText(candidate.startDate),
      endDate: normalizeSelectedExperienceText(candidate.endDate),
      isCurrent: Boolean(candidate.isCurrent),
      summary: normalizeSelectedExperienceText(candidate.summary, SELECTED_EXPERIENCE_SUMMARY_LIMIT) || undefined,
      star: normalizeSelectedExperienceStar(candidate.star),
    };
    return [normalized];
  });
};

export const readMessageSelectedResume = (message: AssistantMessage): AssistantSelectedResume | null => {
  return normalizeSelectedResume(message.content_json?.selected_resume);
};

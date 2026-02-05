import type {
    CertificationEditDraft,
    CertificationView,
    DatePayloadFallback,
    EducationEditDraft,
    EducationView,
    ExperienceEditDraft,
    ProfileSyncMode,
    ResumeEditorConfig,
    ResumeEditorProfile,
    ResumeExperienceView,
    SkillGroupView,
    StarFields,
} from '../../types/resume';
import type { ExperienceListItem } from '../../services/experienceService';
import type { Certification as CertificationRecord } from '../../services/certificationsService';
import type { ResumeDetail, ResumeExperienceItem } from '../../services/resumeService';
import type { UserSkill } from '../../services/skillsService';
import type { Profile } from '../../services/profileService';
import { buildExperienceDate, formatYearMonth, normalizeDateInput } from '../../utils/dateUtils';
import { buildStarFields, normalizeStarValue } from '../../utils/resumeHelpers';
import { parseYearMonthValue } from '../experienceUtils';
import { resolveLinkedInLink } from '../profileUtils';
import {
    CERT_META_PREFIX,
    DEFAULT_CERTIFICATION_NAME,
    DEFAULT_EDUCATION_MAJOR,
    DEFAULT_EDUCATION_SCHOOL,
    DEFAULT_EXPERIENCE_COMPANY_BY_CATEGORY,
    DEFAULT_EXPERIENCE_TITLE_BY_CATEGORY,
    DEFAULT_PROFILE,
    DEFAULT_SECTION_ORDER,
    DEFAULT_SKILL_CATEGORY,
    EXPERIENCE_CATEGORY_ORDER,
    PROFILE_SYNC_MODES,
    RESUME_SECTION_IDS,
    A4_HEIGHT_MM,
    SMART_PAGE_MIN_SCALE,
} from './constants';

export const normalizeJobKeywords = (keywords?: string[]): string[] => {
    return (keywords || [])
        .map((keyword) => keyword.trim())
        .filter(Boolean);
};

export const mergeStarFields = (base: StarFields, updates: Partial<StarFields>) => ({
    s: typeof updates.s === 'string' ? updates.s : base.s,
    t: typeof updates.t === 'string' ? updates.t : base.t,
    a: typeof updates.a === 'string' ? updates.a : base.a,
    r: typeof updates.r === 'string' ? updates.r : base.r,
});

export const normalizeEducationStar = (star?: Record<string, any>) => ({
    degree: normalizeStarValue(star?.degree),
    gpa: normalizeStarValue(star?.gpa),
    courses: normalizeStarValue(star?.courses),
});

export const isPresentLabel = (value?: string) => value === '至今' || value === 'Present';

export const resolveSafeDateRange = (start: string, end: string) => {
    const startValue = parseYearMonthValue(start);
    const endValue = parseYearMonthValue(end);
    if (startValue !== null && endValue !== null && startValue > endValue) {
        return { start, end: '' };
    }
    return { start, end };
};

const resolveDatePayload = (
    startDate: string,
    endDate: string,
    baseIsCurrent: boolean,
    fallback?: DatePayloadFallback
) => {
    const normalizedStart = normalizeDateInput(startDate);
    const normalizedEnd = normalizeDateInput(endDate);
    const resolvedIsCurrent = isPresentLabel(endDate) || (baseIsCurrent && !normalizedEnd);
    return {
        startDate: normalizedStart ?? fallback?.start_date,
        endDate: resolvedIsCurrent ? undefined : normalizedEnd ?? fallback?.end_date,
        isCurrent: resolvedIsCurrent,
    };
};

export const resolveExperienceDatePayload = (
    draft: ExperienceEditDraft,
    fallback?: DatePayloadFallback
) => {
    const baseIsCurrent = draft.isCurrent ?? fallback?.is_current ?? false;
    return resolveDatePayload(draft.startDate, draft.endDate, baseIsCurrent, fallback);
};

export const resolveEducationDatePayload = (
    draft: EducationEditDraft,
    fallback?: DatePayloadFallback
) => {
    const baseIsCurrent = fallback?.is_current ?? false;
    return resolveDatePayload(draft.startDate, draft.endDate, baseIsCurrent, fallback);
};

export const buildEducationView = (item: ExperienceListItem): EducationView => {
    const latest = item.latest_version;
    const star = normalizeEducationStar(latest?.star);
    const isCurrent = latest?.is_current ?? false;
    return {
        id: item.master.id,
        school: latest?.org || '',
        major: latest?.title || '',
        degree: star.degree || '',
        startDate: formatYearMonth(latest?.start_date),
        endDate: formatYearMonth(latest?.end_date),
        isCurrent,
        gpa: star.gpa || undefined,
        courses: star.courses || undefined,
    };
};

export const buildDraftEducationView = (
    draftId: string,
    draft: EducationEditDraft
): EducationView => ({
    id: draftId,
    school: draft.school,
    major: draft.major,
    degree: draft.degree,
    startDate: draft.startDate,
    endDate: draft.endDate,
    isCurrent: isPresentLabel(draft.endDate),
    gpa: draft.gpa || undefined,
    courses: draft.courses || undefined,
    isDraft: true,
});

export const buildEducationDraft = (
    source?: ExperienceListItem,
    draftId?: string
): EducationEditDraft => {
    const latest = source?.latest_version;
    const star = normalizeEducationStar(latest?.star);
    const endDate = latest?.is_current ? '至今' : (latest?.end_date || '');
    return {
        id: draftId ?? source?.master.id,
        school: latest?.org || DEFAULT_EDUCATION_SCHOOL,
        major: latest?.title || DEFAULT_EDUCATION_MAJOR,
        degree: star.degree || '',
        startDate: latest?.start_date || '',
        endDate,
        gpa: star.gpa || '',
        courses: star.courses || '',
    };
};

export const buildCertificationDraft = (source?: CertificationRecord): CertificationEditDraft => ({
    id: source?.id,
    name: source?.name || DEFAULT_CERTIFICATION_NAME,
    issuer: source?.issuer || '',
    issueDate: source?.issue_date || '',
});

export const buildDraftCertificationView = (
    draftId: string,
    draft: CertificationEditDraft
): CertificationView => ({
    id: draftId,
    name: draft.name,
    issuer: draft.issuer,
    date: formatYearMonth(draft.issueDate),
    isDraft: true,
});

export const parseCertificationMatchRate = (description?: string): number => {
    if (!description || !description.startsWith(CERT_META_PREFIX)) {
        return 0;
    }
    try {
        const raw = description.slice(CERT_META_PREFIX.length);
        const parsed = JSON.parse(raw);
        const value = Number(parsed?.matchRate);
        if (!Number.isFinite(value)) {
            return 0;
        }
        return Math.min(100, Math.max(0, Math.round(value)));
    } catch {
        return 0;
    }
};

export const buildCertificationView = (cert: CertificationRecord): CertificationView => ({
    id: cert.id,
    name: cert.name || '',
    issuer: cert.issuer || '',
    date: formatYearMonth(cert.issue_date),
    matchRate: parseCertificationMatchRate(cert.description),
});

export const buildEducationVersionPayload = (
    source: ExperienceListItem | null,
    draft: EducationEditDraft
) => {
    const latest = source?.latest_version;
    const dates = resolveEducationDatePayload(draft, latest);
    return {
        title: draft.major.trim() || DEFAULT_EDUCATION_MAJOR,
        org: draft.school.trim() || DEFAULT_EDUCATION_SCHOOL,
        location: latest?.location,
        start_date: dates.startDate,
        end_date: dates.endDate,
        is_current: dates.isCurrent,
        summary: latest?.summary,
        highlights: latest?.highlights || [],
        tags: latest?.tags || [],
        star: {
            ...(latest?.star || {}),
            degree: draft.degree,
            gpa: draft.gpa,
            courses: draft.courses,
        },
    };
};

export const buildCertificationPayload = (draft: CertificationEditDraft) => ({
    name: draft.name.trim() || DEFAULT_CERTIFICATION_NAME,
    issuer: draft.issuer.trim() || undefined,
    issue_date: normalizeDateInput(draft.issueDate),
});

export const resolveSkillCategoryName = (category?: string) => {
    const trimmed = (category || '').trim();
    return trimmed || DEFAULT_SKILL_CATEGORY;
};

export const buildSkillGroups = (skills: UserSkill[]): SkillGroupView[] => {
    const groups: SkillGroupView[] = [];
    const index = new Map<string, SkillGroupView>();
    skills.forEach((skill) => {
        const name = resolveSkillCategoryName(skill.category);
        let group = index.get(name);
        if (!group) {
            group = { name, skills: [] };
            index.set(name, group);
            groups.push(group);
        }
        group.skills.push({ id: skill.id, name: skill.name });
    });
    return groups;
};

export const buildResumeExperienceMap = (detail: ResumeDetail | null) => {
    const map = new Map<string, ResumeExperienceItem>();
    if (!detail?.experiences) {
        return map;
    }
    detail.experiences.forEach((item) => {
        map.set(item.experience.master_experience_id, item);
    });
    return map;
};

export const buildSourceMap = (items: ExperienceListItem[]) => {
    return new Map(items.map((item) => [item.master.id, item]));
};

export const buildResumeExperienceView = (
    item: ExperienceListItem,
    resumeItem?: ResumeExperienceItem
): ResumeExperienceView => {
    const latest = item.latest_version;
    const snapshot = resumeItem?.experience;
    const title = snapshot?.title ?? latest?.title ?? '';
    const company = snapshot?.org ?? latest?.org ?? '';
    const startDate = snapshot?.start_date ?? latest?.start_date;
    const endDate = snapshot?.end_date ?? latest?.end_date;
    const isCurrent = snapshot?.is_current ?? latest?.is_current ?? false;
    const star = buildStarFields(snapshot?.star ?? latest?.star);
    return {
        id: item.master.id,
        title,
        company,
        date: buildExperienceDate(startDate, endDate, isCurrent),
        startDate,
        endDate,
        isCurrent,
        star,
        resumeLinkId: resumeItem?.id,
        experienceVersionId: resumeItem?.experience_version_id ?? latest?.id,
        category: item.master.category as 'work' | 'project',
    };
};

export const buildDraftExperienceView = (
    category: ResumeExperienceView['category'],
    draftId: string
): ResumeExperienceView => ({
    id: draftId,
    title: DEFAULT_EXPERIENCE_TITLE_BY_CATEGORY[category],
    company: DEFAULT_EXPERIENCE_COMPANY_BY_CATEGORY[category],
    date: '',
    startDate: '',
    endDate: '',
    isCurrent: false,
    star: buildStarFields(),
    category,
    isDraft: true,
});

export const buildExperienceEditDraft = (item: ResumeExperienceView): ExperienceEditDraft => ({
    masterId: item.id,
    title: item.title,
    company: item.company,
    startDate: item.startDate ?? '',
    endDate: item.isCurrent ? '至今' : item.endDate ?? '',
    isCurrent: item.isCurrent,
    star: { ...item.star },
    category: item.category,
    isDraft: item.isDraft,
});

export const sortByCategory = (
    items: ResumeExperienceView[],
    compare: (a: ResumeExperienceView, b: ResumeExperienceView) => number
) => {
    return EXPERIENCE_CATEGORY_ORDER.flatMap((category) =>
        [...items].filter((item) => item.category === category).sort(compare)
    );
};

export const compareByDateDesc = (a: ResumeExperienceView, b: ResumeExperienceView) => {
    const valA = parseYearMonthValue(a.startDate) ?? -1;
    const valB = parseYearMonthValue(b.startDate) ?? -1;
    return valB - valA;
};

export const buildProfileFromService = (profile?: Profile | null): ResumeEditorProfile | null => {
    if (!profile) {
        return null;
    }
    return {
        name: profile.full_name || '',
        email: profile.email || '',
        phone: profile.phone || '',
        location: profile.location || '',
        linkedin: resolveLinkedInLink(profile),
        summary: profile.summary || '',
    };
};

const isSameProfileSnapshot = (
    base?: ResumeEditorProfile | null,
    other?: ResumeEditorProfile | null
) => {
    if (!base || !other) {
        return false;
    }
    return base.name === other.name
        && base.email === other.email
        && base.phone === other.phone
        && base.location === other.location
        && base.linkedin === other.linkedin
        && base.summary === other.summary;
};

export const resolveProfileSyncMode = (
    config?: ResumeEditorConfig,
    profile?: Profile | null
): ProfileSyncMode => {
    const mode = config?.profileSyncMode;
    if (mode === PROFILE_SYNC_MODES.global || mode === PROFILE_SYNC_MODES.local) {
        return mode;
    }
    if (!config?.profile) {
        return PROFILE_SYNC_MODES.global;
    }
    const serviceProfile = buildProfileFromService(profile);
    if (serviceProfile && isSameProfileSnapshot(config.profile, serviceProfile)) {
        return PROFILE_SYNC_MODES.global;
    }
    return PROFILE_SYNC_MODES.local;
};

export const resolveProfileSnapshot = (config?: ResumeEditorConfig, profile?: Profile | null) => {
    const syncMode = resolveProfileSyncMode(config, profile);
    const configProfile = config?.profile;
    const serviceProfile = buildProfileFromService(profile);
    if (syncMode === PROFILE_SYNC_MODES.local) {
        if (configProfile) {
            return {
                ...DEFAULT_PROFILE,
                ...configProfile,
            };
        }
        return serviceProfile ?? DEFAULT_PROFILE;
    }
    if (serviceProfile) {
        return serviceProfile;
    }
    if (configProfile) {
        return {
            ...DEFAULT_PROFILE,
            ...configProfile,
        };
    }
    return DEFAULT_PROFILE;
};

export const resolveSelectionSet = (ids?: Array<string | number>) => {
    return new Set((ids || []).map((value) => String(value)).filter(Boolean));
};

export const buildResumeConfigSnapshot = (
    profile: ResumeEditorProfile,
    profileSyncMode: ProfileSyncMode,
    selectedExpIds: Set<string>,
    selectedEduIds: Set<string>,
    selectedCertIds: Set<string>,
    selectedSkillIds: Set<string>,
    sectionOrder: string[],
    density: 'compact' | 'standard' | 'spacious'
): ResumeEditorConfig => ({
    profile: profileSyncMode === PROFILE_SYNC_MODES.local ? { ...profile } : undefined,
    profileSyncMode,
    selection: {
        experienceIds: Array.from(selectedExpIds),
        educationIds: Array.from(selectedEduIds),
        certificationIds: Array.from(selectedCertIds),
        skillIds: Array.from(selectedSkillIds),
    },
    layout: {
        sectionOrder: [...sectionOrder],
        density,
    },
});

export const normalizeSectionOrder = (order?: string[]) => {
    const filtered = (order || []).filter((sectionId) => RESUME_SECTION_IDS.has(sectionId));
    const unique: string[] = [];
    filtered.forEach((sectionId) => {
        if (!unique.includes(sectionId)) {
            unique.push(sectionId);
        }
    });
    DEFAULT_SECTION_ORDER.forEach((sectionId) => {
        if (!unique.includes(sectionId)) {
            unique.push(sectionId);
        }
    });
    return unique.length ? unique : [...DEFAULT_SECTION_ORDER];
};

export const getA4PixelHeight = () => {
    const probe = document.createElement('div');
    probe.style.height = `${A4_HEIGHT_MM}mm`;
    probe.style.position = 'absolute';
    probe.style.visibility = 'hidden';
    document.body.appendChild(probe);
    const height = probe.getBoundingClientRect().height;
    document.body.removeChild(probe);
    return height;
};

export const resolveScaleForHeight = (contentHeight: number, a4Height: number) => {
    if (contentHeight <= a4Height) {
        return 1;
    }
    return Math.max(SMART_PAGE_MIN_SCALE, a4Height / contentHeight);
};

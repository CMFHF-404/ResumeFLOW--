import type { ExperienceListItem } from '../services/experienceService';
import { convertDateToISO } from '../views/experienceUtils';

export const EDUCATION_DEFAULTS = {
    org: '新学校',
    title: '新专业',
};

export const EDU_TOAST_MESSAGES = {
    createLoading: '正在创建教育经历...',
    createSuccess: '教育经历创建成功',
    createError: '创建教育经历失败，请重试',
    saveLoading: '正在保存教育经历...',
    saveSuccess: '教育经历保存成功',
    saveError: '保存失败，请重试',
    deleteLoading: '正在删除教育经历...',
    deleteSuccess: '教育经历删除成功',
    deleteError: '删除失败，请重试',
};

export type EduCardData = {
    school: string;
    major: string;
    degree: string;
    startDate: string;
    endDate: string;
    gpa: string;
    courses: string;
};

export const createEmptyEduCardData = (): EduCardData => ({
    school: '',
    major: '',
    degree: '',
    startDate: '',
    endDate: '',
    gpa: '',
    courses: '',
});

export const cloneEduCardData = (data: EduCardData): EduCardData => ({ ...data });

const normalizeStarText = (value: unknown): string => {
    if (value === null || value === undefined) {
        return '';
    }
    if (Array.isArray(value)) {
        return value
            .map((item) => String(item ?? '').trim())
            .filter(Boolean)
            .join('、');
    }
    return String(value).trim();
};

const buildEduStarPayload = (data: EduCardData): Record<string, any> => {
    const star: Record<string, any> = {};
    const degree = data.degree.trim();
    const gpa = data.gpa.trim();
    const courses = data.courses.trim();

    if (degree) {
        star.degree = degree;
    }
    if (gpa) {
        star.gpa = gpa;
    }
    if (courses) {
        star.courses = courses;
    }
    return star;
};

export const buildEduCardData = (item: ExperienceListItem): EduCardData => {
    const v = item.latest_version;
    const s = v?.star || {};
    return {
        school: v?.org || '',
        major: v?.title || '',
        startDate: v?.start_date || '',
        endDate: v?.end_date || '',
        degree: normalizeStarText((s as any).degree),
        gpa: normalizeStarText((s as any).gpa),
        courses: normalizeStarText((s as any).courses),
    };
};

export const normalizeEduData = (data: EduCardData): EduCardData => ({
    school: data.school.trim(),
    major: data.major.trim(),
    degree: data.degree.trim(),
    startDate: data.startDate.trim(),
    endDate: data.endDate.trim(),
    gpa: data.gpa.trim(),
    courses: data.courses.trim(),
});

export const buildEduVersionPayload = (data: EduCardData) => ({
    title: data.major,
    org: data.school || undefined,
    start_date: convertDateToISO(data.startDate),
    end_date: convertDateToISO(data.endDate),
    star: buildEduStarPayload(data),
});

export const buildEducationDateLabel = (data: EduCardData) => {
    return [data.startDate, data.endDate].filter(Boolean).join(' - ');
};

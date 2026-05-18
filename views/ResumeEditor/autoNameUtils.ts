import type { JDAnalysisResult } from '../../services/aiService';
import { DEFAULT_RESUME_TITLE, UNTITLED_RESUME_TITLE } from '../../constants/resumeConstants';

const RESUME_AUTO_NAME_SEPARATOR = ' - ';
const MAX_AUTO_NAME_PART_LENGTH = 40;
const JD_TITLE_PATTERNS = [
    /(?:职位|岗位|角色|招聘职位|招聘岗位|Position|Title)\s*[:：]\s*([^\n\r]+)/i,
    /(?:需求|开放岗位)\s*[:：]\s*([^\n\r]+)/i,
];
const JD_COMPANY_PATTERNS = [
    /(?:公司|企业|单位|组织|公司名称|公司名|Company|Organization)\s*[:：]\s*([^\n\r]+)/i,
];

export const normalizeResumeTitle = (value: string) => value.trim();

export const isDefaultResumeTitle = (value: string) => {
    const normalized = normalizeResumeTitle(value);
    return normalized === UNTITLED_RESUME_TITLE || normalized === DEFAULT_RESUME_TITLE;
};

export const sanitizeAutoNamePart = (value?: string) => {
    const trimmed = value?.trim() ?? '';
    if (!trimmed) {
        return '';
    }
    return trimmed.length > MAX_AUTO_NAME_PART_LENGTH
        ? trimmed.slice(0, MAX_AUTO_NAME_PART_LENGTH)
        : trimmed;
};

export const extractFirstMatch = (text: string, patterns: RegExp[]) => {
    if (!text.trim()) {
        return '';
    }
    for (const pattern of patterns) {
        const match = pattern.exec(text);
        if (match?.[1]) {
            return sanitizeAutoNamePart(match[1]);
        }
    }
    return '';
};

export const buildAutoResumeName = (jobTitle?: string, company?: string) => {
    const safeTitle = sanitizeAutoNamePart(jobTitle);
    const safeCompany = sanitizeAutoNamePart(company);
    if (safeTitle && safeCompany) {
        return `${safeTitle}${RESUME_AUTO_NAME_SEPARATOR}${safeCompany}`;
    }
    return safeTitle || safeCompany || '';
};

export const resolveAutoResumeName = (analysisResult: JDAnalysisResult | null, jdText: string) => {
    if (!analysisResult) {
        return '';
    }
    const jobTitle = sanitizeAutoNamePart(analysisResult.jobTitle)
        || extractFirstMatch(jdText, JD_TITLE_PATTERNS);
    const company = sanitizeAutoNamePart(analysisResult.company)
        || extractFirstMatch(jdText, JD_COMPANY_PATTERNS);
    return buildAutoResumeName(jobTitle, company);
};

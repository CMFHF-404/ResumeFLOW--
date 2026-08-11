import { DEFAULT_SECTION_ORDER, RESUME_SECTION_IDS } from './constants';

export const normalizeSectionOrder = (order?: string[]) => {
    const filtered = (order || []).filter((sectionId) => RESUME_SECTION_IDS.has(sectionId));
    const unique: string[] = [];
    filtered.forEach((sectionId) => {
        if (!unique.includes(sectionId)) {
            unique.push(sectionId);
        }
    });
    if (!unique.includes('summary')) {
        unique.unshift('summary');
    }
    DEFAULT_SECTION_ORDER.forEach((sectionId) => {
        if (!unique.includes(sectionId)) {
            unique.push(sectionId);
        }
    });
    return unique.length ? unique : [...DEFAULT_SECTION_ORDER];
};

import type {
    ProfileSyncMode,
    ResumeEditorProfile,
    ResumeExperienceView,
} from '../../types/resume';
import { MATCH_BADGE_STYLES } from '../../constants/resumeConstants';

export const DEFAULT_EXPERIENCE_TITLE_BY_CATEGORY = {
    work: '新建工作经历',
    project: '新建项目经历',
} as const;

export const DEFAULT_EXPERIENCE_COMPANY_BY_CATEGORY = {
    work: '未命名公司',
    project: '未命名项目',
} as const;

export const ADD_WORK_EXPERIENCE_LABEL = '添加工作经历';
export const ADD_PROJECT_EXPERIENCE_LABEL = '添加项目经历';
export const ADD_EDUCATION_LABEL = '添加教育经历';
export const ADD_CERTIFICATION_LABEL = '添加证书';
export const ADD_SKILL_TYPE_LABEL = '添加技能类型';
export const ADD_SKILL_TAG_LABEL = '添加技能标签';
export const DELETE_SKILL_CATEGORY_LABEL = '删除技能分类';

export const DEFAULT_EDUCATION_SCHOOL = '未命名学校';
export const DEFAULT_EDUCATION_MAJOR = '未命名专业';
export const DEFAULT_CERTIFICATION_NAME = '未命名证书';
export const DEFAULT_SKILL_NAME = '未命名技能';
export const DEFAULT_SKILL_CATEGORY = '未分类';

export const CONFIRM_DELETE_EXPERIENCE_TEXT = '确定删除该经历吗？删除后将从经历库移除。';
export const CONFIRM_DELETE_EDUCATION_TEXT = '确定删除该教育经历吗？删除后将无法恢复。';
export const CONFIRM_DELETE_CERTIFICATION_TEXT = '确定删除该证书吗？删除后将无法恢复。';
export const CONFIRM_DELETE_SKILL_TEXT = '确定删除该技能吗？删除后将无法恢复。';
export const CONFIRM_DELETE_SKILL_CATEGORY_TEXT = '确定删除该技能分类及其全部技能吗？删除后将无法恢复。';
export const CONFIRM_DELETE_EXPERIENCE_TITLE = '删除经历';
export const CONFIRM_DELETE_EDUCATION_TITLE = '删除教育经历';
export const CONFIRM_DELETE_CERTIFICATION_TITLE = '删除证书';
export const CONFIRM_DELETE_SKILL_TITLE = '删除技能';
export const CONFIRM_DELETE_SKILL_CATEGORY_TITLE = '删除技能分类';

export const AUTO_SAVE_DELAY_MS = 800;
export const CERT_META_PREFIX = '__rf_cert_meta__:';
export const EXPERIENCE_DRAFT_PREFIX = 'draft-exp';
export const EDUCATION_DRAFT_PREFIX = 'draft-edu';
export const CERTIFICATION_DRAFT_PREFIX = 'draft-cert';

export const EXPERIENCE_CATEGORY_ORDER: Array<ResumeExperienceView['category']> = [
    'work',
    'project',
];

export const DEFAULT_SECTION_ORDER = [
    'summary',
    'work',
    'project',
    'education',
    'certifications',
    'skills',
] as const;

export const RESUME_SECTION_IDS = new Set<string>(DEFAULT_SECTION_ORDER);

export const SIDEBAR_WIDTH_CLASS = 'w-[600px]';
export const JD_PANEL_BOTTOM_SPACING_CLASS = 'mb-3';
export const JD_PANEL_STICKY_CLASS = 'sticky top-0 z-20';
export const EDITING_SUGGESTION_NAV_CLASS =
    'border-t border-border-light dark:border-border-dark bg-white dark:bg-surface-dark px-4 py-2';

export const SMART_PAGE_MIN_SCALE = 0.86;
export const SMART_PAGE_HEIGHT_TOLERANCE = 12;
export const SMART_PAGE_TOAST_MESSAGES = {
    success: '已自动调整为一页',
    overflow: '内容过多，无法压缩到一页',
} as const;

export const DEFAULT_MATCH_BADGE_TONE: keyof typeof MATCH_BADGE_STYLES = 'emerald';
export const STALE_EXPERIENCE_TIP = '该经历已更新，建议重新分析';

export const PROFILE_SYNC_MODES: Record<ProfileSyncMode, ProfileSyncMode> = {
    global: 'global',
    local: 'local',
} as const;

export const DEFAULT_PROFILE: ResumeEditorProfile = {
    name: '',
    email: '',
    phone: '',
    location: '',
    linkedin: '',
    summary: '',
};

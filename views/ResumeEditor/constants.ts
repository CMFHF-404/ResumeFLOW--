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
    'education',
    'work',
    'project',
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
export const SMART_PAGE_ADJUSTING_TOAST_DURATION_MS = 800;
export const A4_HEIGHT_MM = 297;
export const PREVIEW_PADDING_MM = 20;
export const SMART_PAGE_BOTTOM_GAP_MM = PREVIEW_PADDING_MM;
export const PRINT_LAYOUT_OVERFLOW_TOLERANCE_PX = 2;
export const LINE_HEIGHT_DEFAULT = 1.6;
export const LINE_HEIGHT_MIN = 1.35;
export const LINE_HEIGHT_STEP = 0.05;

// 字号配置（支持智能一页动态调整）
export const FONT_SIZE_DEFAULT = 16; // px - 默认基线
export const FONT_SIZE_MIN = 13; // px - 智能一页极限
export const FONT_SIZE_STEP = 0.5; // px

// 列表间距（给 CSS 变量使用；单位在构建变量时确定）
export const LIST_SPACING_BY_DENSITY = {
    compact: 0.375,
    standard: 1,
    spacious: 1.5,
} as const;

// 简历预览布局间距（统一管理，避免魔法类名散落各处）

/** 各密度模式下，每个模块（section）底部的外边距 Tailwind 类 */
export const SECTION_SPACING_CLASS_BY_DENSITY = {
    compact: 'mb-4',
    standard: 'mb-6',
    spacious: 'mb-8',
} as const;

export const SMART_PAGE_TOP_PADDING_MIN_PX = 15;
export const SMART_PAGE_TOP_PADDING_STEP_PX = 5;

export const SMART_PAGE_SECTION_SPACING_CLASS_BY_KEY = {
    6: 'mb-6',
    5: 'mb-5',
    4: 'mb-4',
    3: 'mb-3',
    2: 'mb-2',
} as const;

export const SMART_PAGE_SECTION_SPACING_STEPS = [6, 5, 4, 3, 2] as const;
export const SMART_PAGE_ITEM_SPACING_DEFAULT = 1;
export const SMART_PAGE_ITEM_SPACING_MIN = 0.25;
export const SMART_PAGE_ITEM_SPACING_STEP = 0.25;

/**
 * 简历头部姓名区域的顶部额外内边距（相对页边距的补偿留白）。
 * 设为 'pt-0' 表示不额外增加，可改为 'pt-2'/'pt-4' 等拉大与页眉的距离。
 */
export const HEADER_EXTRA_TOP_SPACING_CLASS = 'pt-0';

/** 节标题（h2）与其下方内容之间的下外边距 Tailwind 类 */
export const SECTION_TITLE_BOTTOM_SPACING = 'mb-3';

/** 节标题（h2）自身与分割线之间的下内边距 Tailwind 类 */
export const SECTION_TITLE_BOTTOM_PADDING = 'pb-1';

export const SMART_PAGE_TOAST_MESSAGES = {
    success: '已自动调整为一页',
    overflow: '内容过多，即使调整行间距与字号也无法保留页尾留白，请删减部分内容。',
    adjusting: '正在尝试自动适配一页...',
} as const;
export const DEFAULT_MATCH_SCORE_FILTER = 70;
export const AUTO_ASSEMBLY_MAX_EXPERIENCES = 3;
export const AUTO_ASSEMBLY_MATCH_THRESHOLD = 80;
export const AUTO_ASSEMBLY_TOAST_MESSAGES = {
    loading: '正在一键组装简历...',
    success: '已完成一键组装，并自动适配为一页',
    partialOverflow: '已完成一键组装，但内容仍超出一页，请继续手动删减',
    emptyJd: '请先填写 JD 内容或上传附件，再执行一键组装',
    analyzeFailed: 'JD 分析失败，无法执行一键组装',
    noExperienceMatch: 'JD 分析未匹配到合适经历，请手动勾选后再调整',
    skipped: '当前无法完成一键组装，请稍后重试',
    error: '一键组装失败，请稍后重试',
} as const;
export const JD_ANALYSIS_PROGRESS_NODE_TITLES = {
    prepare_context: "准备分析上下文...",
    request_ai: "AI 正在思考中...",
    merge_result: "整理 AI 输出...",
    apply_score: "计算匹配分...",
    persist_result: "输出最终结果...",
} as const;

export const JD_ANALYSIS_TOAST_MESSAGES = {
    loading: '正在进行 JD 分析...',
    success: 'JD 分析完成',
    noChange: 'JD 分析完成，但未产生可用调整',
    error: 'JD 分析失败，请稍后重试',
    empty: '请先填写 JD 内容或上传附件再分析',
    missingAttachment: '该分析依赖已丢失的 JD 附件，请重新上传后再分析',
} as const;
export const BOSS_GREETING_TOAST_MESSAGES = {
    loading: '正在生成 BOSS 招呼语...',
    success: 'BOSS 招呼语已生成',
    empty: '请先完成 JD 分析后再生成招呼语',
    error: '生成 BOSS 招呼语失败，请稍后重试',
    copySuccess: '招呼语已复制',
    copyError: '复制失败，请手动复制',
} as const;
export const JD_ANALYSIS_TOAST_DURATION_MS = 2500;
export const JD_ANALYSIS_TOAST_ERROR_DURATION_MS = 3000;

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
    avatarDataUrl: '',
};

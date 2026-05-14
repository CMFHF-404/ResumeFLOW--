export type ResumeTemplateId =
  | 'modern-slate'
  | 'minimal-gray'
  | 'accent-emerald'
  | 'open-source-classic'
  | 'timeline-blue'
  | 'avatar-professional'
  | 'avatar-split'
  | 'modern-slate-avatar'
  | 'photo-card'
  | 'photo-sidebar';

export type ResumeThemeColorPresetId =
  | 'slate'
  | 'blue'
  | 'emerald'
  | 'teal'
  | 'violet'
  | 'rose'
  | 'amber';

export type ResumeTemplateLayoutKind =
  | 'classic'
  | 'minimal'
  | 'accent'
  | 'avatar'
  | 'split';

export type ResumeTemplateDefinition = {
  id: ResumeTemplateId;
  name: string;
  description: string;
  hasAvatar: boolean;
  layoutKind: ResumeTemplateLayoutKind;
  defaultThemeColorPresetId: ResumeThemeColorPresetId;
};

export type ResumeThemeColorDefinition = {
  id: ResumeThemeColorPresetId;
  name: string;
  accentColor: string;
  accentSoftBg: string;
  accentBorder: string;
  accentText: string;
};

export const DEFAULT_RESUME_TEMPLATE_ID: ResumeTemplateId = 'modern-slate';
const LEGACY_TEMPLATE_ID_MAP: Record<string, ResumeTemplateId> = {
  'avatar-creative': 'avatar-professional',
};
const LEGACY_TEMPLATE_DEFAULT_THEME_COLOR_MAP: Record<string, ResumeThemeColorPresetId> = {
  'avatar-creative': 'violet',
};

export const RESUME_THEME_COLOR_PRESETS: ResumeThemeColorDefinition[] = [
  {
    id: 'slate',
    name: '岩墨灰',
    accentColor: '#334155',
    accentSoftBg: '#f1f5f9',
    accentBorder: '#cbd5e1',
    accentText: '#1e293b',
  },
  {
    id: 'blue',
    name: '商务蓝',
    accentColor: '#2563eb',
    accentSoftBg: '#eff6ff',
    accentBorder: '#bfdbfe',
    accentText: '#1d4ed8',
  },
  {
    id: 'emerald',
    name: '翡翠绿',
    accentColor: '#059669',
    accentSoftBg: '#ecfdf5',
    accentBorder: '#a7f3d0',
    accentText: '#047857',
  },
  {
    id: 'teal',
    name: '青湖色',
    accentColor: '#0f766e',
    accentSoftBg: '#f0fdfa',
    accentBorder: '#99f6e4',
    accentText: '#115e59',
  },
  {
    id: 'violet',
    name: '经典紫',
    accentColor: '#7c3aed',
    accentSoftBg: '#f5f3ff',
    accentBorder: '#ddd6fe',
    accentText: '#6d28d9',
  },
  {
    id: 'rose',
    name: '玫瑰红',
    accentColor: '#e11d48',
    accentSoftBg: '#fff1f2',
    accentBorder: '#fecdd3',
    accentText: '#be123c',
  },
  {
    id: 'amber',
    name: '琥珀橙',
    accentColor: '#d97706',
    accentSoftBg: '#fffbeb',
    accentBorder: '#fde68a',
    accentText: '#b45309',
  },
] as const;

export const RESUME_TEMPLATE_DEFINITIONS: ResumeTemplateDefinition[] = [
  {
    id: 'modern-slate',
    name: '现代深灰',
    description: 'ATS 友好的成熟单栏模板，结构清晰稳重。',
    hasAvatar: false,
    layoutKind: 'classic',
    defaultThemeColorPresetId: 'slate',
  },
  {
    id: 'minimal-gray',
    name: '极简留白',
    description: '轻装饰、强可读的 clean 模板，适合大多数岗位。',
    hasAvatar: false,
    layoutKind: 'minimal',
    defaultThemeColorPresetId: 'slate',
  },
  {
    id: 'accent-emerald',
    name: '活力青绿',
    description: '现代强调色单栏模板，保留专业感与识别度。',
    hasAvatar: false,
    layoutKind: 'accent',
    defaultThemeColorPresetId: 'emerald',
  },
  {
    id: 'open-source-classic',
    name: '开源经典',
    description: '参考开源简历项目的紧凑单栏结构，偏 ATS 与打印友好。',
    hasAvatar: false,
    layoutKind: 'classic',
    defaultThemeColorPresetId: 'blue',
  },
  {
    id: 'timeline-blue',
    name: '时间线蓝',
    description: '借鉴社区时间线模板的纵向节奏，适合项目和经历较多的简历。',
    hasAvatar: false,
    layoutKind: 'accent',
    defaultThemeColorPresetId: 'blue',
  },
  {
    id: 'avatar-professional',
    name: '商务头像',
    description: '右上头像与左侧信息严格分栏，适合正式商务简历。',
    hasAvatar: true,
    layoutKind: 'avatar',
    defaultThemeColorPresetId: 'blue',
  },
  {
    id: 'avatar-split',
    name: '侧栏头像',
    description: '成熟双栏模板，左侧品牌信息，右侧主内容。',
    hasAvatar: true,
    layoutKind: 'split',
    defaultThemeColorPresetId: 'amber',
  },
  {
    id: 'modern-slate-avatar',
    name: '商务深灰',
    description: '在现代深灰基础上增加头像与区块图标，更具视觉活力。',
    hasAvatar: true,
    layoutKind: 'classic',
    defaultThemeColorPresetId: 'slate',
  },
  {
    id: 'photo-card',
    name: '头像名片',
    description: '顶部名片式头像布局，适合需要更强个人识别度的投递场景。',
    hasAvatar: true,
    layoutKind: 'avatar',
    defaultThemeColorPresetId: 'teal',
  },
  {
    id: 'photo-sidebar',
    name: '深色侧栏',
    description: '成熟双栏头像模板，侧栏承载身份信息，主栏突出成果内容。',
    hasAvatar: true,
    layoutKind: 'split',
    defaultThemeColorPresetId: 'violet',
  },
] as const;

export const normalizeResumeTemplateId = (templateId?: string | null): ResumeTemplateId => {
  if (!templateId) {
    return DEFAULT_RESUME_TEMPLATE_ID;
  }
  const resolvedId = LEGACY_TEMPLATE_ID_MAP[templateId] ?? templateId;
  return RESUME_TEMPLATE_DEFINITIONS.find((item) => item.id === resolvedId)?.id ?? DEFAULT_RESUME_TEMPLATE_ID;
};

export const resolveResumeTemplate = (templateId?: string | null): ResumeTemplateDefinition => (
  RESUME_TEMPLATE_DEFINITIONS.find((item) => item.id === normalizeResumeTemplateId(templateId))
  ?? RESUME_TEMPLATE_DEFINITIONS[0]
);

export const resolveDefaultResumeThemeColorPresetId = (
  templateId?: ResumeTemplateId | string | null
): ResumeThemeColorPresetId => (
  (templateId ? LEGACY_TEMPLATE_DEFAULT_THEME_COLOR_MAP[templateId] : undefined)
  ?? resolveResumeTemplate(templateId).defaultThemeColorPresetId
);

export const resolveResumeThemeColor = (
  templateId?: ResumeTemplateId | string | null,
  themeColorPresetId?: ResumeThemeColorPresetId | string | null
): ResumeThemeColorDefinition => {
  const resolvedPresetId = (themeColorPresetId && RESUME_THEME_COLOR_PRESETS.some((item) => item.id === themeColorPresetId))
    ? themeColorPresetId as ResumeThemeColorPresetId
    : resolveDefaultResumeThemeColorPresetId(templateId);
  return RESUME_THEME_COLOR_PRESETS.find((item) => item.id === resolvedPresetId) ?? RESUME_THEME_COLOR_PRESETS[0];
};

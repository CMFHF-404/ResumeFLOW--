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
  | 'photo-sidebar'
  | 'deephire-standard'
  | 'deephire-blue'
  | 'deephire-steady'
  | 'deephire-simple'
  | 'deephire-deep-blue'
  | 'deephire-lucky-red'
  | 'deephire-champion-blue'
  | 'deephire-collector-red'
  | 'deephire-minimal'
  | 'deephire-blue-header'
  | 'deephire-elegant'
  | 'deephire-concise'
  | 'deephire-table'
  | 'deephire-ink'
  | 'deephire-retro'
  | 'deephire-business'
  | 'deephire-fashion-black'
  | 'deephire-youth-energy'
  | 'deephire-artistic'
  | 'deephire-soft-realm'
  | 'deephire-forest'
  | 'deephire-classic-elegance'
  | 'deephire-magazine-editorial'
  | 'deephire-forest-fresh'
  | 'deephire-cyber-future'
  | 'deephire-renaissance'
  | 'deephire-watercolor'
  | 'deephire-campus-youth';

export type ResumeThemeColorPresetId =
  | 'slate'
  | 'blue'
  | 'emerald'
  | 'teal'
  | 'violet'
  | 'rose'
  | 'amber'
  | 'cyan'
  | 'navy'
  | 'royal'
  | 'crimson'
  | 'magenta'
  | 'gold'
  | 'forest'
  | 'black';

export type ResumeTemplateLayoutKind =
  | 'classic'
  | 'minimal'
  | 'accent'
  | 'avatar'
  | 'split';

export type ResumeTemplateCollection = 'native' | 'deephire';

export type ResumeTemplateRenderVariant =
  | 'native'
  | 'avatar-right'
  | 'watercolor-profile'
  | 'top-banner-avatar'
  | 'split-profile'
  | 'curved-profile'
  | 'editorial-split'
  | 'table-grid'
  | 'art-frame'
  | 'dark-technical';

export type ResumeTemplateSectionVariant =
  | 'native'
  | 'plain-rule'
  | 'watercolor-dot'
  | 'soft-band'
  | 'solid-band'
  | 'left-rail'
  | 'timeline-dot'
  | 'table-cell'
  | 'editorial-tag'
  | 'centered-label'
  | 'heavy-rule';

export type ResumeTemplateVisualTokens = {
  pageBackground?: string;
  pageForeground?: string;
  pageInsets?: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
  headerBackground?: string;
  headerForeground?: string;
  headerPlacement?: 'sidebar' | 'main' | 'page';
  sidebarBackground?: string;
  sidebarForeground?: string;
  sidebarSectionIds?: string[];
  mainBackground?: string;
  borderColor?: string;
  fontFamily?: string;
  sidebarRatio?: number;
};

export type ResumeTemplateDefinition = {
  id: ResumeTemplateId;
  name: string;
  description: string;
  hasAvatar: boolean;
  layoutKind: ResumeTemplateLayoutKind;
  defaultThemeColorPresetId: ResumeThemeColorPresetId;
  collection: ResumeTemplateCollection;
  visualStyle: ResumeTemplateId;
  renderVariant: ResumeTemplateRenderVariant;
  sectionVariant: ResumeTemplateSectionVariant;
  thumbnailSrc?: string;
  visualTokens?: ResumeTemplateVisualTokens;
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
  {
    id: 'cyan',
    name: '湛青色',
    accentColor: '#078a93',
    accentSoftBg: '#e8f7f8',
    accentBorder: '#9bd5d8',
    accentText: '#05646b',
  },
  {
    id: 'navy',
    name: '沉稳海军蓝',
    accentColor: '#293248',
    accentSoftBg: '#eef1f6',
    accentBorder: '#b8c0cf',
    accentText: '#20283a',
  },
  {
    id: 'royal',
    name: '冠军蓝',
    accentColor: '#2857a4',
    accentSoftBg: '#edf3fc',
    accentBorder: '#a9bfe3',
    accentText: '#1e4380',
  },
  {
    id: 'crimson',
    name: '幸运红',
    accentColor: '#b30743',
    accentSoftBg: '#fff0f5',
    accentBorder: '#e4a0b9',
    accentText: '#850331',
  },
  {
    id: 'magenta',
    name: '艺术紫红',
    accentColor: '#a31b72',
    accentSoftBg: '#fbf0f8',
    accentBorder: '#d9a5c8',
    accentText: '#741250',
  },
  {
    id: 'gold',
    name: '典藏金',
    accentColor: '#b88a16',
    accentSoftBg: '#fff8df',
    accentBorder: '#e3cb82',
    accentText: '#805d0e',
  },
  {
    id: 'forest',
    name: '森林绿',
    accentColor: '#2f9f69',
    accentSoftBg: '#edfaf3',
    accentBorder: '#9dd8b9',
    accentText: '#1f7049',
  },
  {
    id: 'black',
    name: '时尚黑',
    accentColor: '#111827',
    accentSoftBg: '#f3f4f6',
    accentBorder: '#9ca3af',
    accentText: '#111827',
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
    collection: 'native',
    visualStyle: 'modern-slate',
    renderVariant: 'native',
    sectionVariant: 'native',
  },
  {
    id: 'minimal-gray',
    name: '极简留白',
    description: '轻装饰、强可读的 clean 模板，适合大多数岗位。',
    hasAvatar: false,
    layoutKind: 'minimal',
    defaultThemeColorPresetId: 'slate',
    collection: 'native',
    visualStyle: 'minimal-gray',
    renderVariant: 'native',
    sectionVariant: 'native',
  },
  {
    id: 'accent-emerald',
    name: '活力青绿',
    description: '现代强调色单栏模板，保留专业感与识别度。',
    hasAvatar: false,
    layoutKind: 'accent',
    defaultThemeColorPresetId: 'emerald',
    collection: 'native',
    visualStyle: 'accent-emerald',
    renderVariant: 'native',
    sectionVariant: 'native',
  },
  {
    id: 'open-source-classic',
    name: '开源经典',
    description: '参考开源简历项目的紧凑单栏结构，偏 ATS 与打印友好。',
    hasAvatar: false,
    layoutKind: 'classic',
    defaultThemeColorPresetId: 'blue',
    collection: 'native',
    visualStyle: 'open-source-classic',
    renderVariant: 'native',
    sectionVariant: 'native',
  },
  {
    id: 'timeline-blue',
    name: '时间线蓝',
    description: '借鉴社区时间线模板的纵向节奏，适合项目和经历较多的简历。',
    hasAvatar: false,
    layoutKind: 'accent',
    defaultThemeColorPresetId: 'blue',
    collection: 'native',
    visualStyle: 'timeline-blue',
    renderVariant: 'native',
    sectionVariant: 'native',
  },
  {
    id: 'avatar-professional',
    name: '商务头像',
    description: '右上头像与左侧信息严格分栏，适合正式商务简历。',
    hasAvatar: true,
    layoutKind: 'avatar',
    defaultThemeColorPresetId: 'blue',
    collection: 'native',
    visualStyle: 'avatar-professional',
    renderVariant: 'native',
    sectionVariant: 'native',
  },
  {
    id: 'avatar-split',
    name: '侧栏头像',
    description: '成熟双栏模板，左侧品牌信息，右侧主内容。',
    hasAvatar: true,
    layoutKind: 'split',
    defaultThemeColorPresetId: 'amber',
    collection: 'native',
    visualStyle: 'avatar-split',
    renderVariant: 'native',
    sectionVariant: 'native',
  },
  {
    id: 'modern-slate-avatar',
    name: '商务深灰',
    description: '在现代深灰基础上增加头像与区块图标，更具视觉活力。',
    hasAvatar: true,
    layoutKind: 'classic',
    defaultThemeColorPresetId: 'slate',
    collection: 'native',
    visualStyle: 'modern-slate-avatar',
    renderVariant: 'native',
    sectionVariant: 'native',
  },
  {
    id: 'photo-card',
    name: '头像名片',
    description: '顶部名片式头像布局，适合需要更强个人识别度的投递场景。',
    hasAvatar: true,
    layoutKind: 'avatar',
    defaultThemeColorPresetId: 'teal',
    collection: 'native',
    visualStyle: 'photo-card',
    renderVariant: 'native',
    sectionVariant: 'native',
  },
  {
    id: 'photo-sidebar',
    name: '深色侧栏',
    description: '成熟双栏头像模板，侧栏承载身份信息，主栏突出成果内容。',
    hasAvatar: true,
    layoutKind: 'split',
    defaultThemeColorPresetId: 'violet',
    collection: 'native',
    visualStyle: 'photo-sidebar',
    renderVariant: 'native',
    sectionVariant: 'native',
  },
  {
    id: 'deephire-standard',
    name: '标准',
    description: '清爽单栏、右上头像与细线标题，适合通用投递。',
    hasAvatar: true,
    layoutKind: 'avatar',
    defaultThemeColorPresetId: 'slate',
    collection: 'deephire',
    visualStyle: 'deephire-standard',
    renderVariant: 'avatar-right',
    sectionVariant: 'plain-rule',
    thumbnailSrc: '/resume-templates/deephire/deephire-standard.webp',
    visualTokens: { pageInsets: { top: 46, right: 40, bottom: 40, left: 40 } },
  },
  {
    id: 'deephire-blue',
    name: '青蓝',
    description: '青蓝标题带与柔和底色强化模块层次。',
    hasAvatar: true,
    layoutKind: 'avatar',
    defaultThemeColorPresetId: 'cyan',
    collection: 'deephire',
    visualStyle: 'deephire-blue',
    renderVariant: 'avatar-right',
    sectionVariant: 'soft-band',
    thumbnailSrc: '/resume-templates/deephire/deephire-blue.webp',
    visualTokens: { pageInsets: { top: 42, right: 40, bottom: 40, left: 40 } },
  },
  {
    id: 'deephire-steady',
    name: '沉稳',
    description: '深海军蓝满宽页眉，稳重且有明确视觉重心。',
    hasAvatar: true,
    layoutKind: 'avatar',
    defaultThemeColorPresetId: 'navy',
    collection: 'deephire',
    visualStyle: 'deephire-steady',
    renderVariant: 'top-banner-avatar',
    sectionVariant: 'plain-rule',
    thumbnailSrc: '/resume-templates/deephire/deephire-steady.webp',
    visualTokens: {
      pageInsets: { top: 0, right: 60, bottom: 44, left: 60 },
      headerBackground: '#343b4e',
      headerForeground: '#ffffff',
    },
  },
  {
    id: 'deephire-simple',
    name: '简约',
    description: '轻量双栏，左侧身份信息与右侧经历严格分区。',
    hasAvatar: true,
    layoutKind: 'split',
    defaultThemeColorPresetId: 'cyan',
    collection: 'deephire',
    visualStyle: 'deephire-simple',
    renderVariant: 'split-profile',
    sectionVariant: 'timeline-dot',
    thumbnailSrc: '/resume-templates/deephire/deephire-simple.webp',
    visualTokens: {
      pageInsets: { top: 0, right: 0, bottom: 0, left: 0 },
      headerPlacement: 'sidebar',
      sidebarBackground: '#ffffff',
      sidebarForeground: '#20262d',
      sidebarRatio: 0.305,
      sidebarSectionIds: ['certifications', 'skills'],
    },
  },
  {
    id: 'deephire-deep-blue',
    name: '湛青',
    description: '湛青弧形头区与居中圆形头像，简洁醒目。',
    hasAvatar: true,
    layoutKind: 'avatar',
    defaultThemeColorPresetId: 'cyan',
    collection: 'deephire',
    visualStyle: 'deephire-deep-blue',
    renderVariant: 'curved-profile',
    sectionVariant: 'plain-rule',
    thumbnailSrc: '/resume-templates/deephire/deephire-deep-blue.webp',
    visualTokens: {
      pageInsets: { top: 0, right: 60, bottom: 44, left: 60 },
      headerBackground: '#078a93',
      headerForeground: '#ffffff',
    },
  },
  {
    id: 'deephire-lucky-red',
    name: '幸运红',
    description: '酒红页眉与圆角内容卡片，强调个人识别度。',
    hasAvatar: true,
    layoutKind: 'avatar',
    defaultThemeColorPresetId: 'crimson',
    collection: 'deephire',
    visualStyle: 'deephire-lucky-red',
    renderVariant: 'top-banner-avatar',
    sectionVariant: 'solid-band',
    thumbnailSrc: '/resume-templates/deephire/deephire-lucky-red.webp',
    visualTokens: {
      pageInsets: { top: 0, right: 0, bottom: 0, left: 0 },
      pageBackground: '#f8cad7',
      headerBackground: '#bd0045',
      headerForeground: '#ffffff',
    },
  },
  {
    id: 'deephire-champion-blue',
    name: '冠军蓝',
    description: '冠军蓝侧栏与大字号问候式页眉，适合创意岗位。',
    hasAvatar: true,
    layoutKind: 'split',
    defaultThemeColorPresetId: 'royal',
    collection: 'deephire',
    visualStyle: 'deephire-champion-blue',
    renderVariant: 'editorial-split',
    sectionVariant: 'solid-band',
    thumbnailSrc: '/resume-templates/deephire/deephire-champion-blue.webp',
    visualTokens: {
      pageInsets: { top: 0, right: 0, bottom: 0, left: 0 },
      headerPlacement: 'main',
      sidebarBackground: '#386bb7',
      sidebarForeground: '#ffffff',
      sidebarRatio: 0.295,
      sidebarSectionIds: ['certifications', 'skills'],
    },
  },
  {
    id: 'deephire-collector-red',
    name: '典藏红',
    description: '红色顶轨与信息侧栏结合，经典而利落。',
    hasAvatar: true,
    layoutKind: 'split',
    defaultThemeColorPresetId: 'crimson',
    collection: 'deephire',
    visualStyle: 'deephire-collector-red',
    renderVariant: 'split-profile',
    sectionVariant: 'timeline-dot',
    thumbnailSrc: '/resume-templates/deephire/deephire-collector-red.webp',
    visualTokens: {
      pageInsets: { top: 0, right: 0, bottom: 0, left: 0 },
      headerPlacement: 'sidebar',
      sidebarBackground: '#ffffff',
      sidebarForeground: '#252525',
      mainBackground: '#f7f7f7',
      sidebarRatio: 0.295,
      sidebarSectionIds: ['certifications', 'skills'],
    },
  },
  {
    id: 'deephire-minimal',
    name: '极简',
    description: '大面积留白、细分隔线与居中信息，阅读轻盈。',
    hasAvatar: true,
    layoutKind: 'avatar',
    defaultThemeColorPresetId: 'slate',
    collection: 'deephire',
    visualStyle: 'deephire-minimal',
    renderVariant: 'avatar-right',
    sectionVariant: 'plain-rule',
    thumbnailSrc: '/resume-templates/deephire/deephire-minimal.webp',
    visualTokens: {
      pageInsets: { top: 96, right: 40, bottom: 48, left: 40 },
      fontFamily: 'Georgia, "Noto Serif SC", "Songti SC", SimSun, serif',
    },
  },
  {
    id: 'deephire-blue-header',
    name: '蓝顶',
    description: '皇家蓝横幅页眉搭配紧凑单栏正文。',
    hasAvatar: true,
    layoutKind: 'avatar',
    defaultThemeColorPresetId: 'royal',
    collection: 'deephire',
    visualStyle: 'deephire-blue-header',
    renderVariant: 'top-banner-avatar',
    sectionVariant: 'plain-rule',
    thumbnailSrc: '/resume-templates/deephire/deephire-blue-header.webp',
    visualTokens: {
      pageInsets: { top: 0, right: 40, bottom: 44, left: 40 },
      headerBackground: '#07539f',
      headerForeground: '#ffffff',
      fontFamily: 'Georgia, "Noto Serif SC", "Songti SC", SimSun, serif',
    },
  },
  {
    id: 'deephire-elegant',
    name: '清雅',
    description: '左侧栏目标题与右侧正文严格对齐，版面清爽雅致。',
    hasAvatar: true,
    layoutKind: 'avatar',
    defaultThemeColorPresetId: 'slate',
    collection: 'deephire',
    visualStyle: 'deephire-elegant',
    renderVariant: 'avatar-right',
    sectionVariant: 'plain-rule',
    thumbnailSrc: '/resume-templates/deephire/deephire-elegant.webp',
    visualTokens: { pageInsets: { top: 96, right: 69, bottom: 48, left: 69 } },
  },
  {
    id: 'deephire-concise',
    name: '简明',
    description: '窄侧栏与红色节点时间线，信息路径一目了然。',
    hasAvatar: true,
    layoutKind: 'split',
    defaultThemeColorPresetId: 'rose',
    collection: 'deephire',
    visualStyle: 'deephire-concise',
    renderVariant: 'split-profile',
    sectionVariant: 'timeline-dot',
    thumbnailSrc: '/resume-templates/deephire/deephire-concise.webp',
    visualTokens: {
      pageInsets: { top: 0, right: 0, bottom: 0, left: 0 },
      headerPlacement: 'sidebar',
      sidebarBackground: '#ffffff',
      sidebarForeground: '#252525',
      sidebarRatio: 0.30,
      sidebarSectionIds: ['certifications', 'skills'],
    },
  },
  {
    id: 'deephire-table',
    name: '表格',
    description: '模块使用严谨表格边框，适合结构化经历展示。',
    hasAvatar: true,
    layoutKind: 'avatar',
    defaultThemeColorPresetId: 'slate',
    collection: 'deephire',
    visualStyle: 'deephire-table',
    renderVariant: 'table-grid',
    sectionVariant: 'table-cell',
    thumbnailSrc: '/resume-templates/deephire/deephire-table.webp',
    visualTokens: { pageInsets: { top: 42, right: 39, bottom: 40, left: 39 } },
  },
  {
    id: 'deephire-ink',
    name: '墨韵',
    description: '衬线文字与暖色细线，呈现书卷式专业气质。',
    hasAvatar: true,
    layoutKind: 'avatar',
    defaultThemeColorPresetId: 'crimson',
    collection: 'deephire',
    visualStyle: 'deephire-ink',
    renderVariant: 'avatar-right',
    sectionVariant: 'editorial-tag',
    thumbnailSrc: '/resume-templates/deephire/deephire-ink.webp',
    visualTokens: {
      pageInsets: { top: 42, right: 40, bottom: 42, left: 40 },
      pageBackground: '#fffdf7',
      fontFamily: 'Georgia, "Noto Serif SC", "Songti SC", SimSun, serif',
      borderColor: '#c36d5e',
    },
  },
  {
    id: 'deephire-retro',
    name: '复古',
    description: '米色资料侧栏与温暖正文，复古但保持清晰。',
    hasAvatar: true,
    layoutKind: 'split',
    defaultThemeColorPresetId: 'amber',
    collection: 'deephire',
    visualStyle: 'deephire-retro',
    renderVariant: 'split-profile',
    sectionVariant: 'plain-rule',
    thumbnailSrc: '/resume-templates/deephire/deephire-retro.webp',
    visualTokens: {
      pageInsets: { top: 0, right: 0, bottom: 0, left: 0 },
      headerPlacement: 'sidebar',
      pageBackground: '#fffdf8',
      sidebarBackground: '#f1ece5',
      sidebarForeground: '#55483a',
      mainBackground: '#ffffff',
      sidebarRatio: 0.374,
      sidebarSectionIds: ['certifications', 'skills'],
      fontFamily: 'Georgia, "Noto Serif SC", "Songti SC", SimSun, serif',
    },
  },
  {
    id: 'deephire-business',
    name: '商务',
    description: '深蓝商务侧栏与金色强调，突出成熟可靠。',
    hasAvatar: true,
    layoutKind: 'split',
    defaultThemeColorPresetId: 'gold',
    collection: 'deephire',
    visualStyle: 'deephire-business',
    renderVariant: 'split-profile',
    sectionVariant: 'plain-rule',
    thumbnailSrc: '/resume-templates/deephire/deephire-business.webp',
    visualTokens: {
      pageInsets: { top: 0, right: 0, bottom: 0, left: 0 },
      headerPlacement: 'sidebar',
      sidebarBackground: '#29418f',
      sidebarForeground: '#ffffff',
      mainBackground: '#ffffff',
      sidebarRatio: 0.375,
      sidebarSectionIds: ['certifications', 'skills'],
    },
  },
  {
    id: 'deephire-fashion-black',
    name: '时尚黑',
    description: '黑色圆角页眉与重线模块，视觉对比鲜明。',
    hasAvatar: true,
    layoutKind: 'avatar',
    defaultThemeColorPresetId: 'black',
    collection: 'deephire',
    visualStyle: 'deephire-fashion-black',
    renderVariant: 'top-banner-avatar',
    sectionVariant: 'heavy-rule',
    thumbnailSrc: '/resume-templates/deephire/deephire-fashion-black.webp',
    visualTokens: {
      pageInsets: { top: 0, right: 23, bottom: 32, left: 23 },
      headerBackground: '#050505',
      headerForeground: '#ffffff',
    },
  },
  {
    id: 'deephire-youth-energy',
    name: '活力青春',
    description: '明亮头像区与紫色内容导线，轻盈富有节奏。',
    hasAvatar: true,
    layoutKind: 'split',
    defaultThemeColorPresetId: 'violet',
    collection: 'deephire',
    visualStyle: 'deephire-youth-energy',
    renderVariant: 'editorial-split',
    sectionVariant: 'left-rail',
    thumbnailSrc: '/resume-templates/deephire/deephire-youth-energy.webp',
    visualTokens: {
      pageInsets: { top: 0, right: 0, bottom: 0, left: 0 },
      headerPlacement: 'page',
      sidebarBackground: '#ffffff',
      sidebarForeground: '#252525',
      mainBackground: '#ffffff',
      sidebarRatio: 0.38,
      sidebarSectionIds: ['certifications', 'skills'],
    },
  },
  {
    id: 'deephire-artistic',
    name: '艺术气息',
    description: '深蓝画框、几何标签与金色强调，具有作品集气质。',
    hasAvatar: true,
    layoutKind: 'avatar',
    defaultThemeColorPresetId: 'royal',
    collection: 'deephire',
    visualStyle: 'deephire-artistic',
    renderVariant: 'art-frame',
    sectionVariant: 'editorial-tag',
    thumbnailSrc: '/resume-templates/deephire/deephire-artistic.webp',
    visualTokens: {
      pageInsets: { top: 34, right: 32, bottom: 34, left: 32 },
      borderColor: '#1d3557',
    },
  },
  {
    id: 'deephire-soft-realm',
    name: '柔境',
    description: '柔和侧栏、圆形头像与紫红强调，亲和细腻。',
    hasAvatar: true,
    layoutKind: 'split',
    defaultThemeColorPresetId: 'magenta',
    collection: 'deephire',
    visualStyle: 'deephire-soft-realm',
    renderVariant: 'split-profile',
    sectionVariant: 'left-rail',
    thumbnailSrc: '/resume-templates/deephire/deephire-soft-realm.webp',
    visualTokens: {
      pageInsets: { top: 0, right: 0, bottom: 0, left: 0 },
      headerPlacement: 'sidebar',
      sidebarBackground: '#f5f0fa',
      sidebarForeground: '#30262d',
      mainBackground: '#ffffff',
      sidebarRatio: 0.27,
      sidebarSectionIds: ['certifications', 'skills'],
    },
  },
  {
    id: 'deephire-forest',
    name: '林原',
    description: '深色林野页眉与青绿节点，适合沉浸式个人品牌。',
    hasAvatar: true,
    layoutKind: 'avatar',
    defaultThemeColorPresetId: 'cyan',
    collection: 'deephire',
    visualStyle: 'deephire-forest',
    renderVariant: 'top-banner-avatar',
    sectionVariant: 'plain-rule',
    thumbnailSrc: '/resume-templates/deephire/deephire-forest.webp',
    visualTokens: {
      pageInsets: { top: 0, right: 48, bottom: 44, left: 48 },
      headerBackground: '#26312f',
      headerForeground: '#ffffff',
    },
  },
  {
    id: 'deephire-classic-elegance',
    name: '典雅',
    description: '淡紫标题、克制间距与优雅细线，适合文职岗位。',
    hasAvatar: true,
    layoutKind: 'avatar',
    defaultThemeColorPresetId: 'violet',
    collection: 'deephire',
    visualStyle: 'deephire-classic-elegance',
    renderVariant: 'avatar-right',
    sectionVariant: 'plain-rule',
    thumbnailSrc: '/resume-templates/deephire/deephire-classic-elegance.webp',
    visualTokens: { pageInsets: { top: 0, right: 48, bottom: 44, left: 48 }, headerBackground: '#f1f0ff' },
  },
  {
    id: 'deephire-magazine-editorial',
    name: '杂志编辑',
    description: '绿色编辑线、栏目式双栏与标签组件，版式感强。',
    hasAvatar: true,
    layoutKind: 'split',
    defaultThemeColorPresetId: 'forest',
    collection: 'deephire',
    visualStyle: 'deephire-magazine-editorial',
    renderVariant: 'editorial-split',
    sectionVariant: 'editorial-tag',
    thumbnailSrc: '/resume-templates/deephire/deephire-magazine-editorial.webp',
    visualTokens: {
      pageInsets: { top: 0, right: 0, bottom: 0, left: 0 },
      headerPlacement: 'sidebar',
      sidebarBackground: '#ffffff',
      sidebarForeground: '#1f3028',
      mainBackground: '#f1faf3',
      sidebarRatio: 0.37,
      sidebarSectionIds: ['certifications', 'skills'],
      borderColor: '#2f9f69',
    },
  },
  {
    id: 'deephire-forest-fresh',
    name: '森系清新',
    description: '浅绿侧栏与清爽内容区，强调自然与成长感。',
    hasAvatar: true,
    layoutKind: 'split',
    defaultThemeColorPresetId: 'forest',
    collection: 'deephire',
    visualStyle: 'deephire-forest-fresh',
    renderVariant: 'editorial-split',
    sectionVariant: 'editorial-tag',
    thumbnailSrc: '/resume-templates/deephire/deephire-forest-fresh.webp',
    visualTokens: {
      pageInsets: { top: 0, right: 0, bottom: 0, left: 0 },
      headerPlacement: 'sidebar',
      sidebarBackground: '#ffffff',
      sidebarForeground: '#1e3929',
      mainBackground: '#effaf3',
      sidebarRatio: 0.37,
      sidebarSectionIds: ['certifications', 'skills'],
      borderColor: '#74d9a7',
    },
  },
  {
    id: 'deephire-cyber-future',
    name: '赛博未来',
    description: '深色整页与霓虹青蓝强调，适合技术与创意方向。',
    hasAvatar: true,
    layoutKind: 'avatar',
    defaultThemeColorPresetId: 'cyan',
    collection: 'deephire',
    visualStyle: 'deephire-cyber-future',
    renderVariant: 'dark-technical',
    sectionVariant: 'editorial-tag',
    thumbnailSrc: '/resume-templates/deephire/deephire-cyber-future.webp',
    visualTokens: {
      pageInsets: { top: 36, right: 36, bottom: 36, left: 36 },
      pageBackground: '#07182c',
      pageForeground: '#e7f7ff',
      headerBackground: '#0b2039',
      headerForeground: '#e7f7ff',
      borderColor: '#17c3d6',
    },
  },
  {
    id: 'deephire-renaissance',
    name: '文艺复兴',
    description: '羊皮纸色纸张、金红标题与居中章节，古典华丽。',
    hasAvatar: true,
    layoutKind: 'avatar',
    defaultThemeColorPresetId: 'gold',
    collection: 'deephire',
    visualStyle: 'deephire-renaissance',
    renderVariant: 'avatar-right',
    sectionVariant: 'centered-label',
    thumbnailSrc: '/resume-templates/deephire/deephire-renaissance.webp',
    visualTokens: {
      pageInsets: { top: 55, right: 40, bottom: 42, left: 40 },
      pageBackground: '#fff7d8',
      pageForeground: '#5b381d',
      borderColor: '#9f2f24',
      fontFamily: 'Georgia, "Noto Serif SC", "Songti SC", SimSun, serif',
    },
  },
  {
    id: 'deephire-watercolor',
    name: '清新水彩',
    description: '柔和水彩头区、蓝紫标题与留白正文，清新轻盈。',
    hasAvatar: true,
    layoutKind: 'avatar',
    defaultThemeColorPresetId: 'blue',
    collection: 'deephire',
    visualStyle: 'deephire-watercolor',
    renderVariant: 'watercolor-profile',
    sectionVariant: 'watercolor-dot',
    thumbnailSrc: '/resume-templates/deephire/deephire-watercolor.webp',
    visualTokens: {
      pageBackground: '#fffefe',
      pageForeground: '#4c5564',
      pageInsets: { top: 60, right: 46, bottom: 54, left: 46 },
      borderColor: '#bdd6ff',
      headerForeground: '#292929',
    },
  },
  {
    id: 'deephire-campus-youth',
    name: '青春校园',
    description: '多彩细线、圆形头像与蓝色小标题，适合校园求职。',
    hasAvatar: true,
    layoutKind: 'avatar',
    defaultThemeColorPresetId: 'royal',
    collection: 'deephire',
    visualStyle: 'deephire-campus-youth',
    renderVariant: 'avatar-right',
    sectionVariant: 'plain-rule',
    thumbnailSrc: '/resume-templates/deephire/deephire-campus-youth.webp',
    visualTokens: { pageInsets: { top: 55, right: 40, bottom: 42, left: 40 } },
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

export const supportsResumeTemplateThemeColorCustomization = (
  templateId?: ResumeTemplateId | string | null
) => resolveResumeTemplate(templateId).collection === 'native';

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
  const resolvedPresetId = (
    supportsResumeTemplateThemeColorCustomization(templateId)
    && themeColorPresetId
    && RESUME_THEME_COLOR_PRESETS.some((item) => item.id === themeColorPresetId)
  )
    ? themeColorPresetId as ResumeThemeColorPresetId
    : resolveDefaultResumeThemeColorPresetId(templateId);
  return RESUME_THEME_COLOR_PRESETS.find((item) => item.id === resolvedPresetId) ?? RESUME_THEME_COLOR_PRESETS[0];
};

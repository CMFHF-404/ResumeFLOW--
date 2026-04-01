export type ResumeTemplateId =
  | 'modern-slate'
  | 'minimal-gray'
  | 'accent-emerald'
  | 'avatar-professional'
  | 'avatar-creative'
  | 'avatar-split';

export type ResumeTemplateDefinition = {
  id: ResumeTemplateId;
  name: string;
  description: string;
  hasAvatar: boolean;
  accentColor: string;
  headerClassName: string;
  cardClassName: string;
};

export const DEFAULT_RESUME_TEMPLATE_ID: ResumeTemplateId = 'modern-slate';

export const RESUME_TEMPLATE_DEFINITIONS: ResumeTemplateDefinition[] = [
  {
    id: 'modern-slate',
    name: '现代深灰',
    description: '稳重商务风，适合绝大多数岗位',
    hasAvatar: false,
    accentColor: '#0f172a',
    headerClassName: 'text-center',
    cardClassName: 'bg-white border-slate-200',
  },
  {
    id: 'minimal-gray',
    name: '极简留白',
    description: '简约清爽，强调内容可读性',
    hasAvatar: false,
    accentColor: '#374151',
    headerClassName: 'text-left',
    cardClassName: 'bg-white border-gray-200',
  },
  {
    id: 'accent-emerald',
    name: '活力青绿',
    description: '有辨识度的现代科技风',
    hasAvatar: false,
    accentColor: '#059669',
    headerClassName: 'text-left',
    cardClassName: 'bg-emerald-50/60 border-emerald-200',
  },
  {
    id: 'avatar-professional',
    name: '商务头像',
    description: '带大头照，适合咨询/销售/客户岗位',
    hasAvatar: true,
    accentColor: '#1d4ed8',
    headerClassName: 'text-left',
    cardClassName: 'bg-blue-50/60 border-blue-200',
  },
  {
    id: 'avatar-creative',
    name: '创意头像',
    description: '带大头照，适合设计/产品岗位',
    hasAvatar: true,
    accentColor: '#7c3aed',
    headerClassName: 'text-left',
    cardClassName: 'bg-violet-50/60 border-violet-200',
  },
  {
    id: 'avatar-split',
    name: '侧栏头像',
    description: '带大头照，强化个人品牌识别',
    hasAvatar: true,
    accentColor: '#ea580c',
    headerClassName: 'text-left',
    cardClassName: 'bg-orange-50/60 border-orange-200',
  },
];

export const resolveResumeTemplate = (templateId?: string | null): ResumeTemplateDefinition => {
  if (!templateId) {
    return RESUME_TEMPLATE_DEFINITIONS[0];
  }
  return RESUME_TEMPLATE_DEFINITIONS.find((item) => item.id === templateId) ?? RESUME_TEMPLATE_DEFINITIONS[0];
};

import {
  resolveDefaultResumeThemeColorPresetId,
  type ResumeTemplateId,
} from '../constants/resumeTemplates';
import type { ResumePdfRenderSnapshot } from '../types/resume';

const TEMPLATE_PREVIEW_AVATAR_SRC = '/resume-template-previews/fixture/lin-che-portrait.webp';

export const buildResumeTemplatePreviewSnapshot = (
  templateId: ResumeTemplateId
): ResumePdfRenderSnapshot => ({
  resumeName: 'AI 产品经理',
  profile: {
    name: '林澈',
    email: 'lin.che@example.com',
    phone: '138 0000 0000',
    location: '杭州',
    linkedin: 'portfolio.example.com/lin-che',
    summary: '3 年 AI 产品经验，擅长需求洞察、原型设计与跨团队交付，持续把复杂流程转化为清晰、可验证的产品方案。',
    avatarDataUrl: TEMPLATE_PREVIEW_AVATAR_SRC,
  },
  lineHeight: 1.38,
  fontSize: 13,
  listSpacingValue: '0.35em',
  bulletSpacingValue: '0.15em',
  topPaddingPx: 42,
  sectionSpacingClass: 'mb-3',
  listSpacingClass: 'space-y-2',
  sectionOrder: ['summary', 'education', 'certifications', 'skills', 'work', 'project'],
  selectedWorkItems: [
    {
      id: 'fixture-work-ai-product-manager',
      title: 'AI 产品经理',
      company: '星河智能科技',
      date: '2024.07 - 至今',
      startDate: '2024.07',
      endDate: '',
      isCurrent: true,
      category: 'work',
      star: {
        s: '负责企业知识协作平台，解决资料分散与检索效率低的问题。',
        t: '在 10 周内完成核心工作流设计并推动首版上线。',
        a: '访谈 18 位一线用户，梳理检索、问答与反馈闭环<br>输出 PRD 和交互原型，协同算法、研发完成两轮验证',
        r: '上线后资料检索耗时降低 32%，试点团队周活跃率达到 76%。',
      },
    },
    {
      id: 'fixture-work-product-intern',
      title: '产品实习生',
      company: '云栖数创实验室',
      date: '2023.07 - 2024.06',
      startDate: '2023.07',
      endDate: '2024.06',
      isCurrent: false,
      category: 'work',
      star: {
        s: '参与企业数据看板迭代，业务指标口径分散且需求响应周期较长。',
        t: '协助完成指标治理、需求排期与版本验收。',
        a: '整理 46 项核心指标并建立口径字典<br>跟进 12 个迭代需求，维护原型、验收清单与周报',
        r: '需求平均确认周期缩短 28%，版本按期交付率提升至 94%。',
      },
    },
  ],
  selectedProjectItems: [
    {
      id: 'fixture-project-knowledge-copilot',
      title: '产品负责人',
      company: '智能知识助手',
      date: '2024.03 - 2024.06',
      startDate: '2024.03',
      endDate: '2024.06',
      category: 'project',
      star: {
        s: '面向校企团队搭建轻量知识助手，统一文档问答与任务沉淀。',
        t: '',
        a: '设计信息架构与 Prompt 评测集<br>组织 3 轮可用性测试并迭代关键路径',
        r: '在 6 周内交付 MVP，问答任务完成率提升至 88%。',
      },
    },
    {
      id: 'fixture-project-job-insight',
      title: '产品策划',
      company: '岗位洞察仪表盘',
      date: '2023.10 - 2024.01',
      startDate: '2023.10',
      endDate: '2024.01',
      category: 'project',
      star: {
        s: '针对校园求职信息零散问题，设计岗位采集、标签筛选与趋势分析工具。',
        t: '完成从需求验证到可交互原型的完整产品方案。',
        a: '分析 320 条岗位样本并搭建分类体系<br>完成高保真原型和 8 人可用性测试',
        r: '关键筛选任务平均完成时间缩短 41%，方案获得校级创新项目立项。',
      },
    },
  ],
  educations: [
    {
      id: 'fixture-education-hailan',
      school: '海岚大学',
      major: '信息管理与信息系统',
      degree: '本科',
      startDate: '2020.09',
      endDate: '2024.06',
      gpa: '3.7 / 4.0',
      courses: '产品设计、数据分析、人机交互',
    },
  ],
  selectedEduIds: ['fixture-education-hailan'],
  sortedCertifications: [
    {
      id: 'fixture-certification-npdp',
      name: 'NPDP 产品经理认证',
      issuer: 'PDMA',
      date: '2025.03',
    },
    {
      id: 'fixture-certification-data-analysis',
      name: '数据分析专业能力证书',
      issuer: 'CDA 数据分析研究院',
      date: '2024.11',
    },
  ],
  selectedCertIds: [
    'fixture-certification-npdp',
    'fixture-certification-data-analysis',
  ],
  selectedSkillGroups: [
    {
      name: '产品能力',
      skills: [
        { id: 'fixture-skill-research', name: '用户研究' },
        { id: 'fixture-skill-prd', name: 'PRD' },
        { id: 'fixture-skill-prototype', name: '原型设计' },
        { id: 'fixture-skill-roadmap', name: '产品规划' },
      ],
    },
    {
      name: '数据与 AI',
      skills: [
        { id: 'fixture-skill-sql', name: 'SQL' },
        { id: 'fixture-skill-ab', name: 'A/B 测试' },
        { id: 'fixture-skill-prompt', name: 'Prompt 设计' },
        { id: 'fixture-skill-evaluation', name: '模型评测' },
      ],
    },
    {
      name: '协作工具',
      skills: [
        { id: 'fixture-skill-figma', name: 'Figma' },
        { id: 'fixture-skill-axure', name: 'Axure' },
        { id: 'fixture-skill-jira', name: 'Jira' },
        { id: 'fixture-skill-notion', name: 'Notion' },
      ],
    },
  ],
  templateId,
  themeColorPresetId: resolveDefaultResumeThemeColorPresetId(templateId),
  experienceListMarkerStyle: 'unordered',
  skillTagSeparator: ' · ',
});

export { TEMPLATE_PREVIEW_AVATAR_SRC };

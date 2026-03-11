export enum ViewState {
  DASHBOARD = 'DASHBOARD',
  EDITOR = 'EDITOR',
  EXPERIENCE_BANK = 'EXPERIENCE_BANK',
}

export interface Resume {
  id: string;
  name: string;
  targetRole: string;
  matchRate: number;
  createdAt: string;
  lastModified: string;
  status: 'draft' | 'final';
  type: 'internship' | 'fulltime' | 'general';
}

export interface ExperienceItem {
  id: string;
  company: string;
  role: string;
  startDate: string;
  endDate: string;
  description?: string;
  star?: {
    s: string;
    t: string;
    a: string;
    r: string;
  };
  type: 'work' | 'education' | 'project';
}

// 教育背景接口 - 与经历库数据结构一致
export interface Education {
  id: string;
  school: string;        // 学校名称
  major: string;         // 专业
  degree: string;        // 学位类型 (本科/硕士/博士等)
  startDate: string;     // 开始时间 YYYY.MM
  endDate: string;       // 结束时间 YYYY.MM
  gpa?: string;          // GPA (可选)
  courses?: string;      // 课程描述 (可选)
}

// 证书/资质认证接口
export interface Certification {
  id: string;
  name: string;          // 证书名称
  issuer: string;        // 颁发机构
  date: string;          // 获得时间 YYYY.MM
  matchRate?: number;    // 匹配度百分比 (用于JD分析，可选)
}

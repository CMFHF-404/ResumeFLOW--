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

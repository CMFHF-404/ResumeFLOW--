import apiClient from './apiClient';
import type { ExperienceCategory } from './experienceService';

export interface DuplicateMatch {
  is_duplicate: boolean;
  match_type?: 'exact' | 'similar';
  match_score?: number;
}

export interface ParsedExperienceVersion {
  title: string;
  org?: string;
  location?: string;
  start_date?: string;
  end_date?: string;
  is_current?: boolean;
  summary?: string;
  highlights?: string[];
  tags?: string[];
  star?: Record<string, any>;
}

export interface ParsedExperienceItem {
  id: string;
  category: ExperienceCategory;
  version: ParsedExperienceVersion;
  duplicate: DuplicateMatch;
}

export interface ParsedPersonalInfo {
  full_name?: string;
  email?: string;
  phone?: string;
  location?: string;
  links?: string[];
}

export type ParsedPersonalInfoSelection = {
  full_name: boolean;
  email: boolean;
  phone: boolean;
  location: boolean;
};

export interface ParsedCertification {
  name: string;
  issuer?: string;
  issue_date?: string;
  expiry_date?: string;
  credential_id?: string;
  credential_url?: string;
  description?: string;
}

export interface ParsedSkillGroup {
  category: string;
  tags: string[];
}

export interface ResumeParseResponse {
  items: ParsedExperienceItem[];
  personal_info?: ParsedPersonalInfo;
  certifications?: ParsedCertification[];
  skills?: ParsedSkillGroup[];
}

export const parserService = {
  async parseResume(file: File) {
    const formData = new FormData();
    formData.append('file', file);
    const response = await apiClient.post<ResumeParseResponse>('/parser/parse', formData, {
      headers: {
        'Content-Type': null,
      },
    });
    return response.data;
  },
};

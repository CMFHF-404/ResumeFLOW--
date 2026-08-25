export type ExperienceCategory = 'work' | 'project' | 'education';

export interface ExperienceVersion {
  id: string;
  title: string;
  org?: string;
  location?: string;
  start_date?: string;
  end_date?: string;
  is_current?: boolean;
  summary?: string;
  highlights?: string[];
  star?: Record<string, any>;
}

export interface ExperienceListItem {
  master: {
    id: string;
    category: ExperienceCategory;
    is_archived: boolean;
  };
  latest_version?: ExperienceVersion;
}

export interface ExperienceDetail {
  master: {
    id: string;
    category: ExperienceCategory;
    is_archived: boolean;
  };
  latest_version?: ExperienceVersion;
  versions: ExperienceVersion[];
}

export interface ExperienceCreatePayload {
  category: ExperienceCategory;
  version: {
    title: string;
    org?: string;
    location?: string;
    start_date?: string;
    end_date?: string;
    is_current?: boolean;
    summary?: string;
    highlights?: string[];
    star?: Record<string, any>;
  };
}

export interface ExperienceUpdatePayload {
  category?: ExperienceCategory;
  is_archived?: boolean;
  version?: {
    title: string;
    org?: string;
    location?: string;
    start_date?: string;
    end_date?: string;
    is_current?: boolean;
    summary?: string;
    highlights?: string[];
    star?: Record<string, any>;
  };
}

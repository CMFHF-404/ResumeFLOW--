export interface Profile {
  user_id: string;
  full_name?: string;
  title?: string;
  summary?: string;
  location?: string;
  phone?: string;
  email?: string;
  social_links?: Record<string, any>;
  links?: ProfileLink[];
  extra_json?: Record<string, any>;
  updated_at: string;
}

export interface ProfileLink {
  label: string;
  url: string;
  position?: number;
}

export interface ProfileUpdate {
  full_name?: string;
  title?: string;
  summary?: string;
  location?: string;
  phone?: string;
  email?: string;
  social_links?: Record<string, any>;
  extra_json?: Record<string, any>;
  links?: ProfileLink[];
  expected_updated_at?: string;
}

export interface UserSkill {
  id: string;
  user_id: string;
  skill_id: string;
  name: string;
  category?: string;
  proficiency?: number;
}

export interface SkillCreatePayload {
  name: string;
  category?: string;
  proficiency?: number;
}

export interface SkillUpdatePayload {
  name?: string;
  category?: string;
  proficiency?: number;
}

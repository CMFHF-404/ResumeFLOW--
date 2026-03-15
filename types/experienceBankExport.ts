import type { Certification } from '../services/certificationsService';
import type { ExperienceListItem } from '../services/experienceService';
import type { Profile } from '../services/profileService';
import type { UserSkill } from '../services/skillsService';

export type ExperienceBankPdfRenderSnapshot = {
  profile: Profile | null;
  workItems: ExperienceListItem[];
  projectItems: ExperienceListItem[];
  educationItems: ExperienceListItem[];
  certifications: Certification[];
  skills: UserSkill[];
  exportDateLabel?: string | null;
};

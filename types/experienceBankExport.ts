import type { Certification } from './certification';
import type { ExperienceListItem } from './experience';
import type { Profile } from './profile';
import type { UserSkill } from './skill';

export type ExperienceBankPdfRenderSnapshot = {
  profile: Profile | null;
  workItems: ExperienceListItem[];
  projectItems: ExperienceListItem[];
  educationItems: ExperienceListItem[];
  certifications: Certification[];
  skills: UserSkill[];
  exportDateLabel?: string | null;
};

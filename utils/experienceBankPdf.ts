import type { Certification } from '../services/certificationsService';
import type {
  ExperienceListItem,
  ExperienceVersion,
} from '../services/experienceService';
import type { Profile, ProfileLink } from '../services/profileService';
import type { UserSkill } from '../services/skillsService';
import type { ExperienceBankPdfRenderSnapshot } from '../types/experienceBankExport';

type ExperienceBankPdfSnapshotInput = ExperienceBankPdfRenderSnapshot;

const cloneJsonRecord = <T extends Record<string, unknown> | undefined | null>(
  value: T
): T => {
  if (!value) {
    return value;
  }
  return JSON.parse(JSON.stringify(value)) as T;
};

const cloneProfileLinks = (links?: ProfileLink[]) =>
  (links ?? []).map((link) => ({ ...link }));

const cloneProfile = (profile: Profile | null): Profile | null => {
  if (!profile) {
    return null;
  }

  return {
    ...profile,
    social_links: cloneJsonRecord(profile.social_links),
    links: cloneProfileLinks(profile.links),
    extra_json: cloneJsonRecord(profile.extra_json),
  };
};

const cloneExperienceVersion = (
  version?: ExperienceVersion
): ExperienceVersion | undefined => {
  if (!version) {
    return undefined;
  }

  return {
    ...version,
    highlights: version.highlights ? [...version.highlights] : undefined,
    tags: version.tags ? [...version.tags] : undefined,
    star: cloneJsonRecord(version.star),
  };
};

const cloneExperienceItem = (item: ExperienceListItem): ExperienceListItem => ({
  master: { ...item.master },
  latest_version: cloneExperienceVersion(item.latest_version),
});

const cloneCertification = (certification: Certification): Certification => ({
  ...certification,
});

const cloneSkill = (skill: UserSkill): UserSkill => ({
  ...skill,
});

export const buildExperienceBankPdfRenderSnapshot = ({
  profile,
  workItems,
  projectItems,
  educationItems,
  certifications,
  skills,
  exportDateLabel,
}: ExperienceBankPdfSnapshotInput): ExperienceBankPdfRenderSnapshot => ({
  profile: cloneProfile(profile),
  workItems: workItems.map(cloneExperienceItem),
  projectItems: projectItems.map(cloneExperienceItem),
  educationItems: educationItems.map(cloneExperienceItem),
  certifications: certifications.map(cloneCertification),
  skills: skills.map(cloneSkill),
  exportDateLabel: exportDateLabel ?? null,
});

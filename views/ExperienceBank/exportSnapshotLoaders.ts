import { certificationsService } from '../../services/certificationsService';
import { experienceService } from '../../services/experienceService';
import { profileService } from '../../services/profileService';
import { skillsService } from '../../services/skillsService';
import type { ExperienceBankPdfRenderSnapshot } from '../../types/experienceBankExport';

export const loadExperienceBankExportSnapshot = async (): Promise<ExperienceBankPdfRenderSnapshot> => {
  const [
    profile,
    workItems,
    projectItems,
    educationItems,
    certifications,
    skills,
  ] = await Promise.all([
    profileService.getProfile({ force: true }),
    experienceService.list('work', { force: true }),
    experienceService.list('project', { force: true }),
    experienceService.list('education', { force: true }),
    certificationsService.list({ force: true }),
    skillsService.list({ force: true }),
  ]);

  return {
    profile,
    workItems,
    projectItems,
    educationItems,
    certifications,
    skills,
  };
};

export const loadExperienceBankValidationSnapshot = async (): Promise<ExperienceBankPdfRenderSnapshot | null> => {
  const [
    profile,
    workItems,
    projectItems,
    educationItems,
    certifications,
    skills,
  ] = await Promise.all([
    profileService.peekProfileForCurrentUser(),
    experienceService.peekListForCurrentUser('work', { allowStale: true }),
    experienceService.peekListForCurrentUser('project', { allowStale: true }),
    experienceService.peekListForCurrentUser('education', { allowStale: true }),
    certificationsService.peekListForCurrentUser({ allowStale: true }),
    skillsService.peekListForCurrentUser({ allowStale: true }),
  ]);

  if (!profile || !workItems || !projectItems || !educationItems || !certifications || !skills) {
    return null;
  }

  return {
    profile,
    workItems,
    projectItems,
    educationItems,
    certifications,
    skills,
  };
};

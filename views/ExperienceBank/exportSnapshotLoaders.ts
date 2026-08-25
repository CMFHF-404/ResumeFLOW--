import { certificationsService } from '../../services/certificationsService';
import { experienceService } from '../../services/experienceService';
import { profileService } from '../../services/profileService';
import { skillsService } from '../../services/skillsService';
import { assertAuthCacheKey } from '../../services/apiClient';
import type { ExperienceBankPdfRenderSnapshot } from '../../types/experienceBankExport';

export const loadExperienceBankExportSnapshot = async (
  expectedAuthCacheKey: string,
): Promise<ExperienceBankPdfRenderSnapshot> => {
  await assertAuthCacheKey(expectedAuthCacheKey);
  const [
    profile,
    workItems,
    projectItems,
    educationItems,
    certifications,
    skills,
  ] = await Promise.all([
    profileService.getProfile({ force: true, expectedAuthCacheKey }),
    experienceService.list('work', { force: true, expectedAuthCacheKey }),
    experienceService.list('project', { force: true, expectedAuthCacheKey }),
    experienceService.list('education', { force: true, expectedAuthCacheKey }),
    certificationsService.list({ force: true, expectedAuthCacheKey }),
    skillsService.list({ force: true, expectedAuthCacheKey }),
  ]);
  await assertAuthCacheKey(expectedAuthCacheKey);

  return {
    profile,
    workItems,
    projectItems,
    educationItems,
    certifications,
    skills,
  };
};

export const loadExperienceBankValidationSnapshot = async (
  expectedAuthCacheKey: string,
): Promise<ExperienceBankPdfRenderSnapshot | null> => {
  await assertAuthCacheKey(expectedAuthCacheKey);
  const [
    profile,
    workItems,
    projectItems,
    educationItems,
    certifications,
    skills,
  ] = await Promise.all([
    profileService.peekProfileForCurrentUser({ expectedAuthCacheKey }),
    experienceService.peekListForCurrentUser('work', { allowStale: true, expectedAuthCacheKey }),
    experienceService.peekListForCurrentUser('project', { allowStale: true, expectedAuthCacheKey }),
    experienceService.peekListForCurrentUser('education', { allowStale: true, expectedAuthCacheKey }),
    certificationsService.peekListForCurrentUser({ allowStale: true, expectedAuthCacheKey }),
    skillsService.peekListForCurrentUser({ allowStale: true, expectedAuthCacheKey }),
  ]);
  await assertAuthCacheKey(expectedAuthCacheKey);

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

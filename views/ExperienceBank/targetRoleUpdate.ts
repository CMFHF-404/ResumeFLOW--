import type { Resume } from '../../services/resumeService';

type ResumeTargetRoleUpdateDependencies = {
  update: (resumeId: string, data: { target_role: string }) => Promise<Resume>;
  get: (resumeId: string) => Promise<unknown>;
  waitForMutations: (resumeId: string) => Promise<void>;
  isConflict: (error: unknown) => boolean;
};

export const updateResumeTargetRoleWithConflictRetry = async (
  resumeId: string,
  targetRole: string,
  dependencies: ResumeTargetRoleUpdateDependencies,
) => {
  const update = () => dependencies.update(resumeId, { target_role: targetRole });
  try {
    return await update();
  } catch (error) {
    if (!dependencies.isConflict(error)) {
      throw error;
    }
    await dependencies.waitForMutations(resumeId);
    await dependencies.get(resumeId);
    return update();
  }
};

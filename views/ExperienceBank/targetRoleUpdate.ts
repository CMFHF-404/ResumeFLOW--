import type { Resume } from '../../services/resumeService';
import type { AuthOwnerOptions } from '../../services/apiClient';

type ResumeTargetRoleUpdateDependencies = {
  update: (
    resumeId: string,
    data: { target_role: string },
    options?: AuthOwnerOptions,
  ) => Promise<Resume>;
  get: (resumeId: string, options?: AuthOwnerOptions) => Promise<unknown>;
  waitForMutations: (resumeId: string) => Promise<void>;
  isConflict: (error: unknown) => boolean;
};

export const updateResumeTargetRoleWithConflictRetry = async (
  resumeId: string,
  targetRole: string,
  dependencies: ResumeTargetRoleUpdateDependencies,
  options?: AuthOwnerOptions,
) => {
  const update = () => dependencies.update(
    resumeId,
    { target_role: targetRole },
    options,
  );
  try {
    return await update();
  } catch (error) {
    if (!dependencies.isConflict(error)) {
      throw error;
    }
    await dependencies.waitForMutations(resumeId);
    await dependencies.get(resumeId, options);
    return update();
  }
};

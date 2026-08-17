export type ResumeConfigSaveOptions = {
  forceVersionCheck?: boolean;
};

type ResumeConfigSaveCoordinatorOptions<TConfig, TResult> = {
  getResumeId: () => string | null;
  getExpectedUpdatedAt: () => string | undefined;
  getLastSavedSignature: () => string | null;
  isHydrated: () => boolean;
  assertCanPersist?: () => void;
  persist: (
    resumeId: string,
    config: TConfig,
    expectedUpdatedAt: string | undefined
  ) => Promise<TResult>;
  onSaveStart: (resumeId: string) => void;
  onSaveSuccess: (
    resumeId: string,
    result: TResult,
    configSignature: string
  ) => void;
  serialize?: (config: TConfig) => string;
};

export const createResumeConfigSaveCoordinator = <TConfig, TResult>({
  getResumeId,
  getExpectedUpdatedAt,
  getLastSavedSignature,
  isHydrated,
  assertCanPersist = () => undefined,
  persist,
  onSaveStart,
  onSaveSuccess,
  serialize = JSON.stringify,
}: ResumeConfigSaveCoordinatorOptions<TConfig, TResult>) => {
  let queue: Promise<void> = Promise.resolve();
  const pendingKeys = new Map<string, number>();

  const save = (
    config: TConfig,
    { forceVersionCheck = false }: ResumeConfigSaveOptions = {}
  ): Promise<void> => {
    const requestedResumeId = getResumeId();
    if (!requestedResumeId || !isHydrated()) {
      return Promise.resolve();
    }
    const configSignature = serialize(config);
    const pendingKey = `${requestedResumeId}\u0000${configSignature}`;
    const pendingForSameSnapshot = pendingKeys.get(pendingKey) ?? 0;
    pendingKeys.set(pendingKey, pendingForSameSnapshot + 1);

    const execute = async () => {
      if (getResumeId() !== requestedResumeId || !isHydrated()) {
        return;
      }
      assertCanPersist();
      const alreadySaved = configSignature === getLastSavedSignature();
      if (alreadySaved && (!forceVersionCheck || pendingForSameSnapshot > 0)) {
        return;
      }
      onSaveStart(requestedResumeId);
      const result = await persist(
        requestedResumeId,
        config,
        getExpectedUpdatedAt()
      );
      if (getResumeId() === requestedResumeId && isHydrated()) {
        onSaveSuccess(requestedResumeId, result, configSignature);
      }
    };

    const scheduled = queue.catch(() => undefined).then(execute);
    queue = scheduled.then(() => undefined, () => undefined);
    return scheduled.finally(() => {
      const remaining = (pendingKeys.get(pendingKey) ?? 1) - 1;
      if (remaining > 0) {
        pendingKeys.set(pendingKey, remaining);
      } else {
        pendingKeys.delete(pendingKey);
      }
    });
  };

  const drain = () => queue;

  return { save, drain };
};

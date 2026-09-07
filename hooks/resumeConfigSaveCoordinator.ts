export type ResumeConfigSaveOptions = {
  forceVersionCheck?: boolean;
};

type ResumeConfigSaveReceipt = {
  resumeId: string;
  configSignature: string;
};

type ResumeConfigSaveCoordinatorOptions<TConfig, TResult> = {
  getResumeId: () => string | null;
  getExpectedUpdatedAt: () => string | undefined;
  getLastSavedSignature: () => string | null;
  isHydrated: () => boolean;
  assertCanPersist?: () => void;
  prepareConfig?: (resumeId: string, config: TConfig) => TConfig;
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
  prepareConfig = (_resumeId, config) => config,
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
  ): Promise<ResumeConfigSaveReceipt | undefined> => {
    const requestedResumeId = getResumeId();
    if (!requestedResumeId || !isHydrated()) {
      return Promise.resolve(undefined);
    }
    const queuedConfigSignature = serialize(config);
    const pendingKey = `${requestedResumeId}\u0000${queuedConfigSignature}`;
    const pendingForSameSnapshot = pendingKeys.get(pendingKey) ?? 0;
    pendingKeys.set(pendingKey, pendingForSameSnapshot + 1);

    const execute = async () => {
      if (getResumeId() !== requestedResumeId || !isHydrated()) {
        return;
      }
      assertCanPersist();
      const preparedConfig = prepareConfig(requestedResumeId, config);
      const configSignature = serialize(preparedConfig);
      const receipt = { resumeId: requestedResumeId, configSignature };
      const alreadySaved = configSignature === getLastSavedSignature();
      if (alreadySaved && (!forceVersionCheck || pendingForSameSnapshot > 0)) {
        return receipt;
      }
      onSaveStart(requestedResumeId);
      const result = await persist(
        requestedResumeId,
        preparedConfig,
        getExpectedUpdatedAt()
      );
      if (getResumeId() === requestedResumeId && isHydrated()) {
        onSaveSuccess(requestedResumeId, result, configSignature);
        return receipt;
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

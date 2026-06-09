const PENDING_RESUME_UPLOAD_KEY = 'yuanzijianli.pendingResumeUpload';
const PENDING_ASSISTANT_LAUNCH_KEY = 'yuanzijianli.pendingExperienceBankAssistantLaunch';

type PendingActionStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const getSessionStorage = (): PendingActionStorage | undefined => {
  if (typeof window === 'undefined') {
    return undefined;
  }
  try {
    return window.sessionStorage;
  } catch (error) {
    return undefined;
  }
};

const readPendingFlag = (
  key: string,
  storage: PendingActionStorage | undefined = getSessionStorage()
) => {
  if (!storage) {
    return false;
  }
  try {
    return storage.getItem(key) === '1';
  } catch (error) {
    return false;
  }
};

const writePendingFlag = (
  key: string,
  shouldPersist: boolean,
  storage: PendingActionStorage | undefined = getSessionStorage()
) => {
  if (!storage) {
    return;
  }
  try {
    if (shouldPersist) {
      storage.setItem(key, '1');
      return;
    }
    storage.removeItem(key);
  } catch (error) {
    // Ignore storage errors from private mode or blocked sessionStorage.
  }
};

export const readPendingResumeUpload = (storage?: PendingActionStorage) => (
  readPendingFlag(PENDING_RESUME_UPLOAD_KEY, storage)
);

export const writePendingResumeUpload = (
  shouldPersist: boolean,
  storage?: PendingActionStorage
) => {
  writePendingFlag(PENDING_RESUME_UPLOAD_KEY, shouldPersist, storage);
};

export const readPendingAssistantLaunch = (storage?: PendingActionStorage) => (
  readPendingFlag(PENDING_ASSISTANT_LAUNCH_KEY, storage)
);

export const writePendingAssistantLaunch = (
  shouldPersist: boolean,
  storage?: PendingActionStorage
) => {
  writePendingFlag(PENDING_ASSISTANT_LAUNCH_KEY, shouldPersist, storage);
};

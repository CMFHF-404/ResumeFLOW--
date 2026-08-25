const RESUME_STORAGE_KEY = 'yuanzijianli.activeResumeId';

const isAuthenticatedOwnerKey = (
  ownerKey: string | null | undefined,
): ownerKey is string => (
  typeof ownerKey === 'string'
  && ownerKey.trim().length > 0
  && ownerKey !== 'anonymous'
);

export const buildActiveResumeStorageKey = (ownerKey: string) => (
  `${RESUME_STORAGE_KEY}:${encodeURIComponent(ownerKey)}`
);

export const clearLegacyActiveResumeId = () => {
  if (typeof localStorage === 'undefined') {
    return;
  }
  localStorage.removeItem(RESUME_STORAGE_KEY);
};

export const getActiveResumeId = (ownerKey: string | null | undefined) => {
  if (typeof localStorage === 'undefined') {
    return null;
  }
  clearLegacyActiveResumeId();
  if (!isAuthenticatedOwnerKey(ownerKey)) {
    return null;
  }
  return localStorage.getItem(buildActiveResumeStorageKey(ownerKey));
};

export const setActiveResumeId = (
  ownerKey: string | null | undefined,
  id: string,
) => {
  if (typeof localStorage === 'undefined') {
    return;
  }
  clearLegacyActiveResumeId();
  if (!isAuthenticatedOwnerKey(ownerKey) || !id) {
    return;
  }
  localStorage.setItem(buildActiveResumeStorageKey(ownerKey), id);
};

export const clearActiveResumeId = (ownerKey: string | null | undefined) => {
  if (typeof localStorage === 'undefined') {
    return;
  }
  clearLegacyActiveResumeId();
  if (!isAuthenticatedOwnerKey(ownerKey)) {
    return;
  }
  localStorage.removeItem(buildActiveResumeStorageKey(ownerKey));
};

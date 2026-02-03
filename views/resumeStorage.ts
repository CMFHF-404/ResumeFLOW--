const RESUME_STORAGE_KEY = 'resumeFlow.activeResumeId';

export const getActiveResumeId = () => {
  return localStorage.getItem(RESUME_STORAGE_KEY);
};

export const setActiveResumeId = (id: string) => {
  localStorage.setItem(RESUME_STORAGE_KEY, id);
};

export const clearActiveResumeId = () => {
  localStorage.removeItem(RESUME_STORAGE_KEY);
};

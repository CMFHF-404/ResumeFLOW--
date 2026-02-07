const DEFAULT_AVATAR_PLACEHOLDER = '?';

const normalizeDisplayName = (fullName?: string | null): string => {
  if (typeof fullName !== 'string') {
    return '';
  }
  return fullName.trim();
};

export const resolveDisplayName = (
  fullName?: string | null,
  fallback = ''
): string => {
  const normalized = normalizeDisplayName(fullName);
  return normalized || fallback;
};

export const resolveAvatarInitial = (
  fullName?: string | null,
  placeholder = DEFAULT_AVATAR_PLACEHOLDER
): string => {
  const normalized = normalizeDisplayName(fullName);
  if (!normalized) {
    return placeholder;
  }
  const [firstChar] = Array.from(normalized);
  return firstChar ? firstChar.toLocaleUpperCase() : placeholder;
};

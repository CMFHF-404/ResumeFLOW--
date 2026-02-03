const TAG_SUGGESTION_LIMIT = 8;
const TAG_SPLIT_PATTERN = /[,，\n]/;

const normalizeTagText = (value: string) => value.trim();

export const normalizeTagKey = (value: string) => normalizeTagText(value).toLowerCase();

export const buildTagsFromInput = (input: string): string[] => {
  if (!input.trim()) {
    return [];
  }
  return input
    .split(TAG_SPLIT_PATTERN)
    .map((item) => item.trim())
    .filter(Boolean);
};

export const mergeTags = (base: string[], additions: string[]): string[] => {
  const merged: string[] = [];
  const seen = new Set<string>();
  const append = (tag: string) => {
    const cleaned = normalizeTagText(tag);
    if (!cleaned) {
      return;
    }
    const key = normalizeTagKey(cleaned);
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    merged.push(cleaned);
  };
  base.forEach(append);
  additions.forEach(append);
  return merged;
};

export const buildTagSuggestions = (
  current: string[],
  suggestions: readonly string[],
  query: string
): string[] => {
  const existing = new Set(current.map(normalizeTagKey));
  const keyword = normalizeTagKey(query);
  return suggestions
    .filter((item) => {
      const key = normalizeTagKey(item);
      if (existing.has(key)) {
        return false;
      }
      if (!keyword) {
        return false;
      }
      return key.includes(keyword);
    })
    .slice(0, TAG_SUGGESTION_LIMIT);
};

export const sanitizeTagList = (payload: unknown): string[] => {
  if (!Array.isArray(payload)) {
    return [];
  }
  return payload
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
};

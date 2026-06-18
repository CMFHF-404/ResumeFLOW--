import { stripRichTextToText } from '../../utils/richText';
import type { StarFieldKey } from '../ExperienceCard';

export type SimpleModeParseResult = {
  ok: boolean;
  star: Record<StarFieldKey, string>;
};

const STAR_KEYS: StarFieldKey[] = ['s', 't', 'a', 'r'];
const LABEL_WORDS: Record<StarFieldKey, Set<string>> = {
  s: new Set(['情境', '背景', 'situation']),
  t: new Set(['任务', '目标', '职责', 'task']),
  a: new Set(['行动', '动作', '举措', 'action']),
  r: new Set(['结果', '成果', '影响', 'result']),
};

const LETTER_HEADING_PATTERNS: Record<StarFieldKey, RegExp> = {
  s: /^\s*(?:#{1,6}\s*)?(?:situation\b\s*(?:[-:：.、)]\s*)?(.*)|s\s*(?:[-:：.、)]\s*)(?:情境|背景|situation)?\s*(?:[-:：.、)]\s*)?(.*)|s\s+(?:情境|背景|situation)\s*(?:[-:：.、)]\s*)?(.*)|s\s*)$/i,
  t: /^\s*(?:#{1,6}\s*)?(?:task\b\s*(?:[-:：.、)]\s*)?(.*)|t\s*(?:[-:：.、)]\s*)(?:任务|目标|职责|task)?\s*(?:[-:：.、)]\s*)?(.*)|t\s+(?:任务|目标|职责|task)\s*(?:[-:：.、)]\s*)?(.*)|t\s*)$/i,
  a: /^\s*(?:#{1,6}\s*)?(?:action\b\s*(?:[-:：.、)]\s*)?(.*)|a\s*(?:[-:：.、)]\s*)(?:行动|动作|举措|action)?\s*(?:[-:：.、)]\s*)?(.*)|a\s+(?:行动|动作|举措|action)\s*(?:[-:：.、)]\s*)?(.*)|a\s*)$/i,
  r: /^\s*(?:#{1,6}\s*)?(?:result\b\s*(?:[-:：.、)]\s*)?(.*)|r\s*(?:[-:：.、)]\s*)(?:结果|成果|影响|result)?\s*(?:[-:：.、)]\s*)?(.*)|r\s+(?:结果|成果|影响|result)\s*(?:[-:：.、)]\s*)?(.*)|r\s*)$/i,
};

const WORD_HEADING_PATTERNS: Record<StarFieldKey, RegExp> = {
  s: /^\s*(?:#{1,6}\s*)?(?:情境|背景)\s*(?:(?:[-:：.、)]\s*)(.*)|$)/i,
  t: /^\s*(?:#{1,6}\s*)?(?:任务|目标|职责)\s*(?:(?:[-:：.、)]\s*)(.*)|$)/i,
  a: /^\s*(?:#{1,6}\s*)?(?:行动|动作|举措)\s*(?:(?:[-:：.、)]\s*)(.*)|$)/i,
  r: /^\s*(?:#{1,6}\s*)?(?:结果|成果|影响)\s*(?:(?:[-:：.、)]\s*)(.*)|$)/i,
};

const HTML_BLOCK_BREAK_PATTERN = /(?:<br\s*\/?>|<\/(?:div|p|li)>|<li[^>]*>)/gi;
const HTML_BLOCK_TAG_PATTERN = /<\/?(?:div|p|ul|ol)[^>]*>/gi;
const HTML_TAG_PATTERN = /<[^>]*>/g;
const SEPARATOR_PATTERN = /^\s*---+\s*$/;

const createEmptyStar = (): Record<StarFieldKey, string> => ({
  s: '',
  t: '',
  a: '',
  r: '',
});

const normalizeLineBreaks = (value: string) =>
  value
    .replace(/\r\n?/g, '\n')
    .replace(HTML_BLOCK_BREAK_PATTERN, '\n')
    .replace(HTML_BLOCK_TAG_PATTERN, '');

const splitLines = (value: string) => normalizeLineBreaks(value).split('\n');

const stripInlineHtml = (value: string) => stripRichTextToText(value.replace(HTML_TAG_PATTERN, '')).trim();

const trimRichLine = (value: string) => value.replace(/^[\s\u00a0]+|[\s\u00a0]+$/g, '');

const normalizeComparableLine = (value: string) => stripInlineHtml(value).replace(/\s+/g, '');
const normalizeComparableSentence = (value: string) => normalizeComparableLine(value).replace(/[。！？!?]+$/g, '');
const SENTENCE_CHUNK_PATTERN = /[^。！？!?]+[。！？!?]?/g;
const MIN_DUPLICATE_SENTENCE_CHARS = 8;

const dedupeAdjacentDuplicateSentences = (line: string) => {
  const chunks = line.match(SENTENCE_CHUNK_PATTERN);
  if (!chunks || chunks.length <= 1) {
    return line;
  }
  const result: string[] = [];
  let previousComparable = '';
  chunks.forEach((chunk) => {
    const comparable = normalizeComparableSentence(chunk);
    if (
      comparable
      && comparable === previousComparable
      && comparable.length >= MIN_DUPLICATE_SENTENCE_CHARS
    ) {
      return;
    }
    result.push(chunk);
    previousComparable = comparable;
  });
  return result.join('').replace(/[ \t]+$/g, '');
};

const dedupeAdjacentDuplicateLines = (lines: string[]) => {
  const result: string[] = [];
  let previousComparable = '';
  lines.forEach((line) => {
    const comparable = normalizeComparableLine(line);
    if (comparable && comparable === previousComparable) {
      return;
    }
    result.push(line);
    previousComparable = comparable;
  });
  return result;
};

const trimRichBlock = (value: string) => {
  const lines = splitLines(value).map(trimRichLine);
  while (lines.length && !stripInlineHtml(lines[0])) {
    lines.shift();
  }
  while (lines.length && !stripInlineHtml(lines[lines.length - 1])) {
    lines.pop();
  }
  return lines.join('\n').trim();
};

export const dedupeAdjacentRepeatedContent = (value: string) => {
  const lines = splitLines(trimRichBlock(value));
  return dedupeAdjacentDuplicateLines(lines.map(dedupeAdjacentDuplicateSentences)).join('\n').trim();
};

const isLabelOnlyContent = (key: StarFieldKey, value: string) =>
  LABEL_WORDS[key].has(stripInlineHtml(value).toLowerCase());

const stripRawHeadingPrefix = (line: string, key: StarFieldKey): string | null => {
  const letter = key.toUpperCase();
  const word = {
    s: 'situation',
    t: 'task',
    a: 'action',
    r: 'result',
  }[key];
  const letterPattern = new RegExp(`^\\s*(?:#{1,6}\\s*)?(?:${word}\\b|${letter})\\s*(?:[-:：.、)]\\s*)([\\s\\S]*)$`, 'i');
  const letterMatch = line.match(letterPattern);
  if (letterMatch) {
    return trimRichLine(letterMatch[1] || '');
  }
  const wordPattern = {
    s: /^\s*(?:#{1,6}\s*)?(?:情境|背景)\s*(?:[-:：.、)]\s*)([\s\S]*)$/i,
    t: /^\s*(?:#{1,6}\s*)?(?:任务|目标|职责)\s*(?:[-:：.、)]\s*)([\s\S]*)$/i,
    a: /^\s*(?:#{1,6}\s*)?(?:行动|动作|举措)\s*(?:[-:：.、)]\s*)([\s\S]*)$/i,
    r: /^\s*(?:#{1,6}\s*)?(?:结果|成果|影响)\s*(?:[-:：.、)]\s*)([\s\S]*)$/i,
  }[key];
  const wordMatch = line.match(wordPattern);
  return wordMatch ? trimRichLine(wordMatch[1] || '') : null;
};

const resolveHeading = (line: string): { key: StarFieldKey; content: string } | null => {
  const plain = stripInlineHtml(line);
  if (!plain) {
    return null;
  }
  for (const key of STAR_KEYS) {
    const letterMatch = plain.match(LETTER_HEADING_PATTERNS[key]);
    if (letterMatch) {
      const rawContent = stripRawHeadingPrefix(line, key);
      if (rawContent !== null) {
        return { key, content: isLabelOnlyContent(key, rawContent) ? '' : rawContent };
      }
      return { key, content: '' };
    }
    const wordMatch = plain.match(WORD_HEADING_PATTERNS[key]);
    if (wordMatch && (wordMatch[0].trim() === plain || /[-:：.、)]/.test(wordMatch[0]))) {
      const rawContent = stripRawHeadingPrefix(line, key);
      return { key, content: rawContent ?? '' };
    }
  }
  return null;
};

const parseByHeadings = (value: string): SimpleModeParseResult | null => {
  const star = createEmptyStar();
  const labelFallbacks = createEmptyStar();
  const seen = new Set<StarFieldKey>();
  let currentKey: StarFieldKey | null = null;
  const preHeadingLines: string[] = [];

  splitLines(value).forEach((line) => {
    const heading = resolveHeading(line);
    if (heading) {
      currentKey = heading.key;
      seen.add(heading.key);
      const rawContent = stripRawHeadingPrefix(line, heading.key);
      if (!heading.content && rawContent && isLabelOnlyContent(heading.key, rawContent)) {
        labelFallbacks[heading.key] = rawContent;
      }
      if (heading.content) {
        star[heading.key] = star[heading.key]
          ? `${star[heading.key]}\n${heading.content}`
          : heading.content;
      }
      return;
    }
    if (!currentKey) {
      if (stripInlineHtml(line)) {
        preHeadingLines.push(line);
      }
      return;
    }
    star[currentKey] = star[currentKey] ? `${star[currentKey]}\n${line}` : line;
  });

  if (seen.size < 4) {
    return null;
  }

  const preHeadingContent = dedupeAdjacentRepeatedContent(preHeadingLines.join('\n'));
  if (preHeadingContent) {
    star.a = star.a ? `${preHeadingContent}\n${star.a}` : preHeadingContent;
  }

  const normalized = {
    s: dedupeAdjacentRepeatedContent(star.s) || dedupeAdjacentRepeatedContent(labelFallbacks.s),
    t: dedupeAdjacentRepeatedContent(star.t) || dedupeAdjacentRepeatedContent(labelFallbacks.t),
    a: dedupeAdjacentRepeatedContent(star.a) || dedupeAdjacentRepeatedContent(labelFallbacks.a),
    r: dedupeAdjacentRepeatedContent(star.r) || dedupeAdjacentRepeatedContent(labelFallbacks.r),
  };
  const hasAnyContent = STAR_KEYS.some((key) => stripInlineHtml(normalized[key]));
  return hasAnyContent ? { ok: true, star: normalized } : null;
};

const parseBySeparators = (value: string): SimpleModeParseResult | null => {
  const parts: string[] = [''];
  splitLines(value).forEach((line) => {
    if (SEPARATOR_PATTERN.test(stripInlineHtml(line))) {
      parts.push('');
      return;
    }
    const index = parts.length - 1;
    parts[index] = parts[index] ? `${parts[index]}\n${line}` : line;
  });

  if (parts.length !== 4) {
    return null;
  }

  const star = {
    s: dedupeAdjacentRepeatedContent(parts[0]),
    t: dedupeAdjacentRepeatedContent(parts[1]),
    a: dedupeAdjacentRepeatedContent(parts[2]),
    r: dedupeAdjacentRepeatedContent(parts[3]),
  };
  const hasAnyContent = STAR_KEYS.some((key) => stripInlineHtml(star[key]));
  return hasAnyContent ? { ok: true, star } : null;
};

const normalizeCoverageText = (value: string) =>
  stripRichTextToText(value)
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[\s`*_~[\]()（）【】.,，。:：;；'"“”‘’!?！？\-—_/\\|<>]+/g, '')
    .toLowerCase();

const extractUrls = (value: string) =>
  (value.match(/https?:\/\/[^\s"'<>]+/g) || []).sort();

const buildCharacterCounts = (value: string) => {
  const counts = new Map<string, number>();
  for (const char of value) {
    counts.set(char, (counts.get(char) || 0) + 1);
  }
  return counts;
};

export const validateSplitCoverage = (
  source: string,
  star: Record<StarFieldKey, string>
) => {
  const sourceText = normalizeCoverageText(source);
  if (!sourceText) {
    return true;
  }
  const splitText = normalizeCoverageText(STAR_KEYS.map((key) => star[key] || '').join(''));
  if (!splitText) {
    return false;
  }
  const sourceUrls = extractUrls(source);
  const splitUrls = extractUrls(STAR_KEYS.map((key) => star[key] || '').join('\n'));
  if (sourceUrls.length !== splitUrls.length || sourceUrls.some((url, index) => url !== splitUrls[index])) {
    return false;
  }
  const splitCounts = buildCharacterCounts(splitText);
  let covered = 0;
  for (const char of sourceText) {
    const remaining = splitCounts.get(char) || 0;
    if (remaining <= 0) {
      continue;
    }
    covered += 1;
    splitCounts.set(char, remaining - 1);
  }
  const sourceCounts = buildCharacterCounts(sourceText);
  let supported = 0;
  for (const char of splitText) {
    const remaining = sourceCounts.get(char) || 0;
    if (remaining <= 0) {
      continue;
    }
    supported += 1;
    sourceCounts.set(char, remaining - 1);
  }
  return covered / sourceText.length >= 0.85 && supported === splitText.length;
};

export const parseSimpleExperienceText = (value: string): SimpleModeParseResult => {
  const source = value || '';
  const parsed = parseByHeadings(source) ?? parseBySeparators(source);
  if (parsed) {
    return parsed;
  }
  return {
    ok: false,
    star: {
      s: '',
      t: '',
      a: source,
      r: '',
    },
  };
};

export const joinStarFieldsForSimpleMode = (star: Record<StarFieldKey, string>) =>
  STAR_KEYS
    .map((key) => trimRichBlock(star[key] || ''))
    .join('\n---\n');

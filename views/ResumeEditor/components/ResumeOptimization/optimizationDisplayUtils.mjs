import { normalizeEvaluationDimension } from '../ResumeEvaluationReport/evaluationReportUtils.mjs';
import { decodeNamedCharacterReference } from 'decode-named-character-reference';
import { decodeRichTextEntities, stripRichTextToText } from '../../../../utils/richText.ts';

const TERMINAL_ANSWER_STATES = new Set([
  'no_data',
  'unknown',
  'not_my_work',
  'skipped',
]);

const TERMINAL_LABEL_STATES = new Map([
  ['没有数据', 'no_data'],
  ['记不清', 'unknown'],
  ['不属于我的工作', 'not_my_work'],
  ['跳过', 'skipped'],
]);

const HIDDEN_OPEN_ENDED_CHOICE_LABEL = /^(?:其他|其它).*(?:请补充|请填写)/u;
const RICH_HTML_SIGNATURE_TAGS = new Set(['a', 'b', 'strong', 'i', 'em', 'u', 'br', 'ul', 'ol', 'li']);
const RICH_HTML_VALIDATION_TAGS = new Set([...RICH_HTML_SIGNATURE_TAGS, 'p', 'div']);
const RICH_HTML_STRUCTURAL_TAGS = new Set(['br', 'ul', 'ol', 'li']);
const RICH_HTML_LIST_CONTAINER_TAGS = new Set(['ul', 'ol']);
const RICH_HTML_LIST_TREE_TAGS = new Set(['ul', 'ol', 'li']);
const RICH_HTML_PROTECTED_WRAPPER_TAGS = new Set(['a', 'b', 'strong', 'i', 'em', 'u', 'li']);
const RICH_HTML_PROTECTED_BINDING_TAGS = new Set(['a', 'b', 'strong', 'i', 'em', 'u']);
const RICH_HTML_VOID_TAGS = new Set(['br']);
const NON_VISIBLE_HTML_CONTAINER_TAGS = new Set([
  'iframe',
  'noembed',
  'noframes',
  'noscript',
  'script',
  'style',
  'template',
  'textarea',
  'title',
  'xmp',
]);
const HTML_PLAINTEXT_TAGS = new Set(['plaintext']);
const INVISIBLE_HTML_NAMED_ENTITY = /&(?:nbsp|ZeroWidthSpace|NegativeMediumSpace|NegativeThickSpace|NegativeThinSpace|NegativeVeryThinSpace|zwnj|zwj|lrm|rlm|NoBreak|shy);/giu;
const HTML_NUMERIC_ENTITY = /&#(?:x([\da-f]+)|(\d+));/giu;
const HTML5_C1_NUMERIC_REMAP = new Map([
  [0x80, 0x20AC], [0x82, 0x201A], [0x83, 0x0192], [0x84, 0x201E],
  [0x85, 0x2026], [0x86, 0x2020], [0x87, 0x2021], [0x88, 0x02C6],
  [0x89, 0x2030], [0x8A, 0x0160], [0x8B, 0x2039], [0x8C, 0x0152],
  [0x8E, 0x017D], [0x91, 0x2018], [0x92, 0x2019], [0x93, 0x201C],
  [0x94, 0x201D], [0x95, 0x2022], [0x96, 0x2013], [0x97, 0x2014],
  [0x98, 0x02DC], [0x99, 0x2122], [0x9A, 0x0161], [0x9B, 0x203A],
  [0x9C, 0x0153], [0x9E, 0x017E], [0x9F, 0x0178],
]);
const HTML_TAG_NAME_CHARACTER = /[^\s/>]/u;
const HTML_TAG_NAME_START_CHARACTER = /[a-z!?]/iu;
const HTML_ATTRIBUTE_NAME_CHARACTER = /[^\s"'<>\/=]/u;
const INVISIBLE_UNICODE_CONTENT = /[\s\p{Default_Ignorable_Code_Point}]+/gu;
const MARKDOWN_BOLD = /(?:\*\*|＊＊)[^*＊\r\n]+(?:\*\*|＊＊)/gu;
const MARKDOWN_UNDERLINE = /__[^_\r\n]+__/gu;
const MARKDOWN_ITALIC = /(?<!\*)\*(?![\s*])[^*\r\n]*?\S\*(?!\*)/gu;
const MARKDOWN_PROTECTED_BINDING_PATTERNS = [
  ['markdown:bold', /(?:\*\*|＊＊)([^*＊\r\n]+)(?:\*\*|＊＊)/gu],
  ['markdown:underline', /__([^_\r\n]+)__/gu],
  ['markdown:italic', /(?<!\*)\*(?![\s*])([^*\r\n]*?\S)\*(?!\*)/gu],
];
const ACTION_BOUNDARY_TAGS = new Set(['li', 'div', 'p', 'ul', 'ol', 'br']);
const ACTION_TRAILING_CLOSE_TAGS = /\s*(?:<\/[^>]+>\s*)+$/iu;
const ACTION_TRAILING_WHITESPACE = /\s+$/u;
const ACTION_TRAILING_QUOTE_CLOSERS = /[”’"'」』]+$/u;
const ACTION_TRAILING_CLOSER_ENTITY = /(?:&(?:CloseCurlyDoubleQuote|CloseCurlyQuote|rdquo|rdquor|rsquo|rsquor|quot|QUOT|apos|#0*(?:8221|8217|34|39)|#(?:x|X)0*(?:201d|2019|22|27));)+$/u;
const ACTION_TRAILING_ENTITY = /&(?:#\d+|#x[\da-f]+|[a-z][\da-z]*);$/iu;
const ACTION_TRAILING_PUNCTUATION = /[。！？!?；;，,、：:.…]+$/u;
const ACTION_PUNCTUATION_ONLY = /^[。！？!?；;，,、：:.…]+$/u;
const ACTION_MARKDOWN_EMPHASIS_DELIMITERS = ['***', '**', '＊＊', '__', '*'];
const ACTION_MARKDOWN_HTML_SPLIT = /<[^>]+>/gu;
const ACTION_MARKDOWN_RENDER_BOLD = /(?:\*\*|＊＊)([^*\r\n＊]+)(?:\*\*|＊＊)/gu;
const ACTION_MARKDOWN_RENDER_UNDERLINE = /__([^_\r\n]+)__/gu;
const ACTION_MARKDOWN_RENDER_ITALIC = /(^|[^*])\*([^\s*](?:[^*\r\n]*?[^\s*])?)\*(?!\*)/gu;
const ACTION_TRAILING_CLOSING_TAG = /<\/[^>]+>$/iu;
const ACTION_TRAILING_DEFAULT_IGNORABLE = /\p{Default_Ignorable_Code_Point}+$/u;
const DEFAULT_IGNORABLE_ACTION_ENTITY_NAMES = new Set([
  'ApplyFunction',
  'af',
  'InvisibleTimes',
  'it',
  'InvisibleComma',
  'ic',
  'NegativeMediumSpace',
  'NegativeThickSpace',
  'NegativeThinSpace',
  'NegativeVeryThinSpace',
  'NoBreak',
  'ZeroWidthSpace',
  'lrm',
  'rlm',
  'shy',
  'zwnj',
  'zwj',
]);
const ACTION_WHITESPACE_ENTITY_NAMES = new Set([
  'nbsp', 'Tab', 'MediumSpace', 'NonBreakingSpace', 'ThickSpace', 'ThinSpace',
  'VeryThinSpace', 'emsp13', 'emsp14', 'emsp', 'ensp', 'hairsp', 'numsp',
  'puncsp', 'thinsp',
]);
const ACTION_NAMED_PUNCTUATION_ENTITIES = new Map([
  ['&colon;', ':'],
  ['&comma;', ','],
  ['&excl;', '!'],
  ['&hellip;', '…'],
  ['&mldr;', '…'],
  ['&period;', '.'],
  ['&quest;', '?'],
  ['&semi;', ';'],
]);
const DANGEROUS_RICH_TEXT_URL_SCHEMES = new Set(['data', 'file', 'javascript', 'vbscript']);

const MODULE_LABELS = new Map([
  ['experience_star', '经历 STAR'],
  ['personal_summary', '个人总结'],
  ['skills_order', '技能顺序'],
  ['section_order', '模块顺序'],
  ['bank_suggestion', '经历库机会'],
]);

const SOURCE_LABELS = new Map([
  ['当前简历', '当前简历'],
  ['已选经历原始版本', '从总经历补回'],
  ['本轮补充信息', '来自补充信息'],
  ['已验证来源', '已验证来源'],
]);

const SPECIAL_DIMENSION_LABELS = new Map([
  ['内容完整性', '内容完整'],
  ['教育背景', '教育背景'],
  ['证书完整性', '证书完整性'],
]);

const SECTION_LABELS = new Map([
  ['summary', '个人评价'],
  ['education', '教育背景'],
  ['work', '工作经历'],
  ['project', '项目经历'],
  ['certifications', '证书资质'],
  ['skills', '技能清单'],
]);

const EXPERIENCE_CATEGORIES = new Set(['work', 'project', 'education']);
const STAR_FIELD_ORDER = new Map([
  ['s', 0],
  ['t', 1],
  ['a', 2],
  ['r', 3],
]);
const COMPARISON_VISIBLE_UI_STATES = new Set([
  'preview',
  'applying',
  'rescoring',
  'completed',
]);
const STAR_FIELD_LABELS = new Map([
  ['star.s', '情境 S'],
  ['star.t', '任务 T'],
  ['star.a', '行动 A'],
  ['star.r', '结果 R'],
]);

const list = (value) => Array.isArray(value) ? value : [];
const text = (value) => typeof value === 'string' ? value.trim() : '';
const INTERNAL_COPY_MARKER = /(?:\/?(?:currentResume|current_resume|selectedSourceExperiences|selected_source_experiences|userAnswers|user_answers)(?:\/|\.|\b)|\b(?:moduleId|module_id|fieldPath|field_path|sourceRefs?|source_refs?|sourceSnapshotHash|source_snapshot_hash|affectsChangeIds|affects_change_ids|changeId|change_id|questionId|question_id|issueId|issue_id|evidenceId|evidence_id|masterExperienceId|master_experience_id|suggestionId|suggestion_id|runId|run_id|requestId|request_id)\b)/iu;

const looksLikeSerializedStructuredData = (value) => {
  if (!value.startsWith('{') && !value.startsWith('[')) return false;
  try {
    const parsed = JSON.parse(value);
    return parsed !== null && typeof parsed === 'object';
  } catch {
    return false;
  }
};

const parseRichHtmlAttributes = (attributes) => {
  let cursor = 0;
  let href;
  let hasHref = false;
  const seenAttributeNames = new Set();
  while (cursor < attributes.length) {
    while (/\s/u.test(attributes[cursor] ?? '')) cursor += 1;
    if (cursor >= attributes.length) break;
    if (attributes[cursor] === '/' && !attributes.slice(cursor + 1).trim()) break;

    const nameStart = cursor;
    while (HTML_ATTRIBUTE_NAME_CHARACTER.test(attributes[cursor] ?? '')) cursor += 1;
    if (cursor === nameStart) return null;
    const name = attributes.slice(nameStart, cursor).toLowerCase();
    if (seenAttributeNames.has(name)) return null;
    seenAttributeNames.add(name);
    while (/\s/u.test(attributes[cursor] ?? '')) cursor += 1;

    let attributeValue = null;
    if (attributes[cursor] === '=') {
      cursor += 1;
      while (/\s/u.test(attributes[cursor] ?? '')) cursor += 1;
      if (cursor >= attributes.length) return null;
      const quote = attributes[cursor];
      if (quote === '"' || quote === "'") {
        cursor += 1;
        const valueStart = cursor;
        while (cursor < attributes.length && attributes[cursor] !== quote) cursor += 1;
        if (cursor >= attributes.length) return null;
        attributeValue = attributes.slice(valueStart, cursor);
        if (attributeValue.includes('<')) return null;
        cursor += 1;
      } else {
        const valueStart = cursor;
        while (cursor < attributes.length && !/\s/u.test(attributes[cursor])) cursor += 1;
        attributeValue = attributes.slice(valueStart, cursor);
        if (!attributeValue || /["'<=`]/u.test(attributeValue)) return null;
      }
    }
    if (name === 'href') {
      if (hasHref || attributeValue === null) return null;
      hasHref = true;
      href = attributeValue.trim();
    }
  }
  return { href };
};

const findHtmlTagEnd = (value, start) => {
  let quote = null;
  for (let index = start; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (character === quote) quote = null;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '>') {
      return index;
    }
  }
  return -1;
};

const findNonVisibleHtmlContainerEnd = (value, tag, contentStart) => {
  if (HTML_PLAINTEXT_TAGS.has(tag)) return value.length;
  const lowerValue = value.toLowerCase();
  const closingPrefix = `</${tag}`;
  let searchFrom = contentStart;
  while (searchFrom < value.length) {
    const closingStart = lowerValue.indexOf(closingPrefix, searchFrom);
    if (closingStart < 0) return value.length;
    const boundary = value[closingStart + closingPrefix.length] ?? '';
    if (!boundary || /[\s/>]/u.test(boundary)) {
      const closingEnd = findHtmlTagEnd(value, closingStart + closingPrefix.length);
      return closingEnd < 0 ? value.length : closingEnd + 1;
    }
    searchFrom = closingStart + closingPrefix.length;
  }
  return value.length;
};

const scanHtmlLexicalItems = (value) => {
  const items = [];
  let cursor = 0;
  while (cursor < value.length) {
    const start = value.indexOf('<', cursor);
    if (start < 0) break;

    if (value.startsWith('<!--', start)) {
      const commentEnd = value.indexOf('-->', start + 4);
      if (commentEnd < 0 || value[start + 4] === '>') {
        items.push({ kind: 'invalid', start, end: value.length });
        break;
      }
      const end = commentEnd < 0 ? value.length : commentEnd + 3;
      items.push({ kind: 'hidden', start, end });
      cursor = end;
      continue;
    }

    let position = start + 1;
    let malformedSpacing = false;
    if (/\s/u.test(value[position] ?? '')) {
      malformedSpacing = true;
      while (/\s/u.test(value[position] ?? '')) position += 1;
    }
    let closing = false;
    if (value[position] === '/') {
      closing = true;
      position += 1;
      if (/\s/u.test(value[position] ?? '')) {
        malformedSpacing = true;
        while (/\s/u.test(value[position] ?? '')) position += 1;
      }
    }
    if (!HTML_TAG_NAME_START_CHARACTER.test(value[position] ?? '')) {
      cursor = start + 1;
      continue;
    }

    const nameStart = position;
    while (HTML_TAG_NAME_CHARACTER.test(value[position] ?? '')) position += 1;
    const tag = value.slice(nameStart, position).toLowerCase();
    const tagEnd = findHtmlTagEnd(value, position);
    if (tagEnd < 0) {
      items.push({
        kind: 'tag',
        tag,
        closing,
        malformedSpacing,
        unterminated: true,
        nameEnd: position,
        start,
        end: value.length,
      });
      break;
    }

    const openingEnd = tagEnd + 1;
    if (!closing && (
      NON_VISIBLE_HTML_CONTAINER_TAGS.has(tag)
      || HTML_PLAINTEXT_TAGS.has(tag)
    )) {
      const end = findNonVisibleHtmlContainerEnd(value, tag, openingEnd);
      items.push({ kind: 'raw', start, end });
      cursor = end;
      continue;
    }

    items.push({
      kind: 'tag',
      tag,
      closing,
      malformedSpacing,
      unterminated: false,
      nameEnd: position,
      start,
      end: openingEnd,
    });
    cursor = openingEnd;
  }
  return items;
};

const extractRichHtmlTextSource = (value) => {
  let visibleSource = '';
  let cursor = 0;
  for (const item of scanHtmlLexicalItems(value)) {
    visibleSource += value.slice(cursor, item.start);
    cursor = item.end;
  }
  return visibleSource + value.slice(cursor);
};

// Keep source offsets stable for protected Markdown bindings. The backend masks
// HTML rather than deleting it before collecting spans, because those offsets
// are later used to compare the text outside a binding in the original value.
const renderedTextScanValue = (value) => {
  const masked = value.split('');
  for (const item of scanHtmlLexicalItems(value)) {
    masked.fill(' ', item.start, item.end);
  }
  return masked.join('');
};

const hasMalformedProtectedHtmlTagPrefix = (tag) => (
  [...RICH_HTML_VALIDATION_TAGS].some((protectedTag) => (
    ['.', '_', '@', '-'].some((separator) => tag.startsWith(`${protectedTag}${separator}`))
  ))
);

const scanRichHtmlTokens = (value) => {
  const tokens = [];
  for (const item of scanHtmlLexicalItems(value)) {
    if (item.kind === 'invalid' || item.kind === 'raw') return null;
    if (item.kind !== 'tag') continue;
    const {
      tag,
      closing,
      malformedSpacing,
      unterminated,
      nameEnd,
      start,
      end,
    } = item;
    if (unterminated) return null;
    if (!RICH_HTML_VALIDATION_TAGS.has(tag)) {
      if (hasMalformedProtectedHtmlTagPrefix(tag)) return null;
      continue;
    }
    if (malformedSpacing) return null;
    const attributes = value.slice(nameEnd, end - 1);
    if (closing && attributes.trim()) return null;
    const parsedAttributes = closing ? { href: undefined } : parseRichHtmlAttributes(attributes);
    if (!parsedAttributes) return null;
    tokens.push({
      tag,
      closing,
      href: parsedAttributes.href,
      start,
      end,
    });
  }
  return tokens;
};

const validateRichHtmlTokens = (tokens) => {
  const openTags = [];
  for (const token of tokens) {
    if (RICH_HTML_VOID_TAGS.has(token.tag)) {
      if (token.closing) return false;
      continue;
    }
    if (!token.closing) {
      if (token.tag === 'a' && openTags.some((item) => item.tag === 'a')) return false;
      openTags.push(token);
      continue;
    }
    if (openTags.pop()?.tag !== token.tag) return false;
  }
  return openTags.length === 0;
};

const decodeNumericHtmlEntities = (value) => value.replace(
  HTML_NUMERIC_ENTITY,
  (entity, hexValue, decimalValue) => {
    const parsedCodePoint = Number.parseInt(hexValue ?? decimalValue, hexValue ? 16 : 10);
    const codePoint = HTML5_C1_NUMERIC_REMAP.get(parsedCodePoint) ?? parsedCodePoint;
    if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return entity;
    try {
      return String.fromCodePoint(codePoint);
    } catch {
      return entity;
    }
  },
);

// Decode in one pass: a decoded ampersand must not start another reference.
// The complete HTML5 name table also covers URL punctuation such as sol/equals.
const decodeRichTextLinkEntities = (value) => value.replace(
  /&(#(?:[xX][\da-fA-F]+|\d+)|[a-zA-Z][a-zA-Z\d]*);/gu,
  (entity, name) => name.startsWith('#')
    ? decodeNumericHtmlEntities(entity)
    : (decodeNamedCharacterReference(name) || entity),
);

const isSafeRichTextLinkTarget = (value) => {
  const compact = decodeRichTextLinkEntities(value)
    .trim()
    .replace(/[\u0000-\u0020\u007F-\u009F]/gu, '');
  const scheme = /^([a-z][a-z\d+.-]*):/iu.exec(compact)?.[1]?.toLowerCase();
  return !scheme || !DANGEROUS_RICH_TEXT_URL_SCHEMES.has(scheme);
};

const hasNonEmptyRichTextVisibleContent = (value, tokens = scanRichHtmlTokens(value)) => {
  if (!tokens) return false;
  return decodeNumericHtmlEntities(stripRichTextToText(extractRichHtmlTextSource(value)))
    .replace(INVISIBLE_HTML_NAMED_ENTITY, '')
    .replace(INVISIBLE_UNICODE_CONTENT, '').length > 0;
};

const isIgnorableListContainerGap = (value) => (
  !scanHtmlLexicalItems(value).some((item) => item.kind === 'tag')
  && !hasNonEmptyRichTextVisibleContent(value)
);

const hasValidRichHtmlListContentModel = (value, tokens) => {
  const openTags = [];
  let cursor = 0;
  for (const token of tokens) {
    const parentTag = openTags.at(-1);
    if (
      RICH_HTML_LIST_CONTAINER_TAGS.has(parentTag)
      && !isIgnorableListContainerGap(value.slice(cursor, token.start))
    ) return false;

    if (RICH_HTML_VOID_TAGS.has(token.tag)) {
      if (RICH_HTML_LIST_CONTAINER_TAGS.has(parentTag)) return false;
      cursor = token.end;
      continue;
    }
    if (!token.closing) {
      if (RICH_HTML_LIST_CONTAINER_TAGS.has(parentTag) && token.tag !== 'li') return false;
      if (token.tag === 'li' && !RICH_HTML_LIST_CONTAINER_TAGS.has(parentTag)) return false;
      openTags.push(token.tag);
    } else {
      openTags.pop();
    }
    cursor = token.end;
  }
  return true;
};

const buildRichHtmlListTreeSignature = (tokens) => {
  const roots = [];
  const openListNodes = [];
  for (const token of tokens) {
    if (!RICH_HTML_LIST_TREE_TAGS.has(token.tag)) continue;
    if (token.closing) {
      openListNodes.pop();
      continue;
    }
    const node = [token.tag, []];
    if (openListNodes.length) {
      openListNodes.at(-1)[1].push(node);
    } else {
      roots.push(node);
    }
    openListNodes.push(node);
  }
  return JSON.stringify(roots);
};

const buildNonEmptyPairedRichTextTagCounts = (value, tokens) => {
  const counts = new Map();
  const openTags = [];
  for (const token of tokens) {
    if (RICH_HTML_VOID_TAGS.has(token.tag)) continue;
    if (!token.closing) {
      openTags.push(token);
      continue;
    }
    const opening = openTags.pop();
    if (
      !opening
      || !RICH_HTML_PROTECTED_WRAPPER_TAGS.has(token.tag)
      || !hasNonEmptyRichTextVisibleContent(value.slice(opening.end, token.start))
    ) continue;
    const key = token.tag === 'a'
      ? `a\u0000${decodeRichTextLinkEntities(opening.href ?? '')}`
      : token.tag;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
};

const isEscaped = (value, index) => {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === '\\'; cursor -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
};

const findMatchingMarkdownDelimiter = (value, start, opening, closing) => {
  let depth = 1;
  let quote = null;
  for (let index = start + 1; index < value.length; index += 1) {
    const character = value[index];
    if (character === '\r' || character === '\n') return -1;
    if (character === '\\') {
      index += 1;
      continue;
    }
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (
      opening === '('
      && (character === '"' || character === "'")
      && (index === start + 1 || /\s/u.test(value[index - 1]))
    ) {
      quote = character;
      continue;
    }
    if (character === opening) depth += 1;
    if (character === closing) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
};

const findMarkdownLinkAt = (value, labelStart) => {
  if (isEscaped(value, labelStart)) return null;
  const labelEnd = findMatchingMarkdownDelimiter(value, labelStart, '[', ']');
  if (
    labelEnd < 0
    || labelEnd === labelStart + 1
    || labelEnd + 1 >= value.length
    || value[labelEnd + 1] !== '('
  ) return null;
  const urlEnd = findMatchingMarkdownDelimiter(value, labelEnd + 1, '(', ')');
  if (urlEnd < 0) return null;
  const target = parseMarkdownLinkTarget(value.slice(labelEnd + 2, urlEnd));
  return target === null ? null : { labelEnd, urlEnd, target };
};

const extractMarkdownLinkUrls = (value) => {
  const urls = [];
  let cursor = 0;
  while (cursor < value.length) {
    const labelStart = value.indexOf('[', cursor);
    if (labelStart < 0) break;
    const link = findMarkdownLinkAt(value, labelStart);
    if (!link) {
      cursor = labelStart + 1;
      continue;
    }
    urls.push(link.target);
    cursor = link.urlEnd + 1;
  }
  return urls;
};

const parseMarkdownLinkTarget = (destination) => {
  let quote = null;
  let titleStart = -1;
  let titleEnd = -1;
  for (let index = 0; index < destination.length; index += 1) {
    const character = destination[index];
    if (character === '\\') {
      index += 1;
      continue;
    }
    if (quote) {
      if (character === quote) {
        quote = null;
        titleEnd = index;
      }
      continue;
    }
    if (
      (character === '"' || character === "'")
      && (index === 0 || /\s/u.test(destination[index - 1]))
    ) {
      quote = character;
      titleStart = index;
    }
  }
  if (quote || (titleStart >= 0 && destination.slice(titleEnd + 1).trim())) return null;
  const target = (titleStart >= 0 ? destination.slice(0, titleStart) : destination).trim();
  return target && !/\s/u.test(target) ? target : null;
};

const splitTrailingMarkdownLink = (value) => {
  let cursor = 0;
  while (cursor < value.length) {
    const labelStart = value.indexOf('[', cursor);
    if (labelStart < 0) return null;
    if (isEscaped(value, labelStart)) {
      cursor = labelStart + 1;
      continue;
    }
    const labelEnd = findMatchingMarkdownDelimiter(value, labelStart, '[', ']');
    if (
      labelEnd < 0
      || labelEnd === labelStart + 1
      || labelEnd + 1 >= value.length
      || value[labelEnd + 1] !== '('
    ) {
      cursor = labelStart + 1;
      continue;
    }
    const urlEnd = findMatchingMarkdownDelimiter(value, labelEnd + 1, '(', ')');
    if (urlEnd < 0) {
      cursor = labelStart + 1;
      continue;
    }
    if (parseMarkdownLinkTarget(value.slice(labelEnd + 2, urlEnd)) === null) {
      cursor = labelStart + 1;
      continue;
    }
    if (urlEnd === value.length - 1) {
      return [
        value.slice(0, labelStart + 1),
        value.slice(labelStart + 1, labelEnd),
        value.slice(labelEnd),
      ];
    }
    cursor = urlEnd + 1;
  }
  return null;
};

const buildRichTextSignature = (value, tokens) => {
  const tagSequence = [];
  const structuralTagSequence = [];
  const htmlLinks = [];
  for (const token of tokens) {
    if (!RICH_HTML_SIGNATURE_TAGS.has(token.tag)) continue;
    if (RICH_HTML_STRUCTURAL_TAGS.has(token.tag)) {
      structuralTagSequence.push(token.closing ? `/${token.tag}` : token.tag);
      continue;
    }
    tagSequence.push(token.closing ? `/${token.tag}` : token.tag);
    if (token.tag === 'a' && !token.closing) {
      htmlLinks.push(decodeRichTextLinkEntities(token.href ?? ''));
    }
  }
  const visibleSource = extractRichHtmlTextSource(value);
  return {
    tagSequence,
    structuralTagSequence,
    nonEmptyPairedTagCounts: buildNonEmptyPairedRichTextTagCounts(value, tokens),
    htmlLinks,
    markdownLinks: extractMarkdownLinkUrls(visibleSource),
    boldCount: [...visibleSource.matchAll(MARKDOWN_BOLD)].length,
    underlineCount: [...visibleSource.matchAll(MARKDOWN_UNDERLINE)].length,
    italicCount: [...visibleSource.matchAll(MARKDOWN_ITALIC)].length,
    listTreeSignature: buildRichHtmlListTreeSignature(tokens),
  };
};

const markdownLinksToPlainText = (value) => {
  let output = '';
  let sourceCursor = 0;
  let searchCursor = 0;
  while (searchCursor < value.length) {
    const labelStart = value.indexOf('[', searchCursor);
    if (labelStart < 0) break;
    const link = findMarkdownLinkAt(value, labelStart);
    if (!link) {
      searchCursor = labelStart + 1;
      continue;
    }
    output += value.slice(sourceCursor, labelStart);
    output += value.slice(labelStart + 1, link.labelEnd);
    sourceCursor = link.urlEnd + 1;
    searchCursor = sourceCursor;
  }
  return output + value.slice(sourceCursor);
};

const bindingVisibleText = (value) => {
  let rendered = markdownLinksToPlainText(extractRichHtmlTextSource(value));
  for (const [, pattern] of MARKDOWN_PROTECTED_BINDING_PATTERNS) {
    rendered = rendered.replace(pattern, '$1');
  }
  return decodeRichTextEntities(rendered)
    .replace(/\u00a0/gu, ' ')
    .replace(INVISIBLE_UNICODE_CONTENT, '')
    .normalize('NFKC')
    .replace(/−/gu, '-')
    .toLowerCase()
    .replace(/\s+/gu, ' ')
    .trim();
};

const bindingStructuralSlot = (value) => {
  let rendered = markdownLinksToPlainText(extractRichHtmlTextSource(value));
  for (const [, pattern] of MARKDOWN_PROTECTED_BINDING_PATTERNS) {
    rendered = rendered.replace(pattern, '$1');
  }
  const normalized = decodeRichTextEntities(rendered)
    .replace(/\p{Default_Ignorable_Code_Point}/gu, '')
    .normalize('NFKC')
    .trim();
  return normalized ? normalized.split(/[\s，。；！？,;!?：:]+/u).filter(Boolean).length : 0;
};

const buildHtmlProtectedBindings = (value, tokens) => {
  const bindings = [];
  const stack = [];
  for (const token of tokens) {
    if (!RICH_HTML_PROTECTED_BINDING_TAGS.has(token.tag)) continue;
    if (!token.closing) {
      stack.push({
        tag: token.tag,
        key: token.tag === 'a'
          ? `html:a:${decodeRichTextLinkEntities(token.href ?? '')}`
          : `html:${token.tag}`,
        start: token.start,
        contentStart: token.end,
      });
      continue;
    }
    const opening = stack.at(-1);
    if (!opening || opening.tag !== token.tag) continue;
    stack.pop();
    bindings.push({
      key: opening.key,
      start: opening.start,
      end: token.end,
      content: value.slice(opening.contentStart, token.start),
    });
  }
  return bindings;
};

const buildMarkdownProtectedBindings = (value) => {
  const bindings = [];
  let cursor = 0;
  while (cursor < value.length) {
    const labelStart = value.indexOf('[', cursor);
    if (labelStart < 0) break;
    const link = findMarkdownLinkAt(value, labelStart);
    if (!link) {
      cursor = labelStart + 1;
      continue;
    }
    bindings.push({
      key: `markdown:a:${link.target}`,
      start: labelStart,
      end: link.urlEnd + 1,
      content: value.slice(labelStart + 1, link.labelEnd),
    });
    cursor = link.urlEnd + 1;
  }
  for (const [key, pattern] of MARKDOWN_PROTECTED_BINDING_PATTERNS) {
    for (const match of value.matchAll(pattern)) {
      bindings.push({
        key,
        start: match.index,
        end: match.index + match[0].length,
        content: match[1],
      });
    }
  }
  return bindings;
};

const buildProtectedBindings = (value, tokens) => [
  ...buildHtmlProtectedBindings(value, tokens),
  ...buildMarkdownProtectedBindings(renderedTextScanValue(value)),
].sort((left, right) => (
  left.start - right.start
  || left.end - right.end
  || left.key.localeCompare(right.key)
));

const preservesProtectedBindings = (before, targeted, beforeTokens, targetedTokens) => {
  const requiredBindings = buildProtectedBindings(before, beforeTokens);
  if (!requiredBindings.length) return true;
  const candidateBindings = buildProtectedBindings(targeted, targetedTokens);
  let candidateCursor = 0;
  for (const required of requiredBindings) {
    const matchedIndex = candidateBindings.findIndex(
      (available, index) => index >= candidateCursor && available.key === required.key,
    );
    if (matchedIndex < 0) return false;
    const available = candidateBindings[matchedIndex];
    candidateCursor = matchedIndex + 1;
    const beforeContent = bindingVisibleText(required.content);
    const candidateContent = bindingVisibleText(available.content);
    const occurrenceCount = (haystack, needle) => {
      if (!needle) return 0;
      let count = 0;
      let cursor = 0;
      while ((cursor = haystack.indexOf(needle, cursor)) >= 0) {
        count += 1;
        cursor += 1;
      }
      return count;
    };
    const beforePrefix = bindingVisibleText(before.slice(0, required.start));
    const candidatePrefix = bindingVisibleText(targeted.slice(0, available.start));
    const beforeOutside = bindingVisibleText(
      before.slice(0, required.start) + before.slice(required.end),
    );
    if (
      beforeContent
      && beforeOutside.includes(beforeContent)
      && bindingStructuralSlot(before.slice(0, required.start))
        !== bindingStructuralSlot(targeted.slice(0, available.start))
    ) return false;
    if (beforeContent === candidateContent) {
      const beforeOrdinal = occurrenceCount(
        beforePrefix,
        beforeContent,
      );
      const candidateOrdinal = occurrenceCount(
        candidatePrefix,
        candidateContent,
      );
      if (beforeOrdinal !== candidateOrdinal) return false;
      continue;
    }
    const candidateOutside = bindingVisibleText(
      targeted.slice(0, available.start) + targeted.slice(available.end),
    );
    const oldContentMovedOut = Boolean(beforeContent)
      && !beforeOutside.includes(beforeContent)
      && candidateOutside.includes(beforeContent);
    const adjacentContentMovedIn = Boolean(candidateContent)
      && !candidateOutside.includes(candidateContent)
      && beforeOutside.includes(candidateContent);
    if (oldContentMovedOut || adjacentContentMovedIn) return false;
  }
  return true;
};

const isOrderedSubset = (required, available) => {
  let cursor = 0;
  for (const item of available) {
    if (item === required[cursor]) cursor += 1;
    if (cursor === required.length) return true;
  }
  return required.length === 0;
};

const isDefaultIgnorableActionEntity = (entity) => {
  const numeric = /^&#(?:x([\da-f]+)|(\d+));$/iu.exec(entity);
  if (numeric) {
    const parsedCodePoint = Number.parseInt(numeric[1] ?? numeric[2], numeric[1] ? 16 : 10);
    const codePoint = HTML5_C1_NUMERIC_REMAP.get(parsedCodePoint) ?? parsedCodePoint;
    if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10FFFF) return false;
    return /^\p{Default_Ignorable_Code_Point}$/u.test(String.fromCodePoint(codePoint));
  }
  return DEFAULT_IGNORABLE_ACTION_ENTITY_NAMES.has(entity.slice(1, -1));
};

const isActionQuoteCloserEntity = (entity) => {
  const decoded = decodeNumericHtmlEntities(entity);
  return /^[”’"'」』]+$/u.test(decoded)
    || ACTION_TRAILING_CLOSER_ENTITY.test(entity);
};

const isActionWhitespaceEntity = (entity) => {
  const numeric = /^&#(?:x([\da-f]+)|(\d+));$/iu.exec(entity);
  if (numeric) {
    const parsedCodePoint = Number.parseInt(numeric[1] ?? numeric[2], numeric[1] ? 16 : 10);
    const codePoint = HTML5_C1_NUMERIC_REMAP.get(parsedCodePoint) ?? parsedCodePoint;
    return Number.isFinite(codePoint) && /^\s$/u.test(String.fromCodePoint(codePoint));
  }
  return ACTION_WHITESPACE_ENTITY_NAMES.has(entity.slice(1, -1));
};

const hasVisibleActionContent = (segment) => {
  const visibleSource = decodeNumericHtmlEntities(extractRichHtmlTextSource(segment))
    .replace(/&(?:ApplyFunction|af|InvisibleTimes|it|InvisibleComma|ic|NegativeMediumSpace|NegativeThickSpace|NegativeThinSpace|NegativeVeryThinSpace|NoBreak|ZeroWidthSpace|lrm|rlm|shy|zwnj|zwj|nbsp|Tab|MediumSpace|NonBreakingSpace|ThickSpace|ThinSpace|VeryThinSpace|emsp13|emsp14|emsp|ensp|hairsp|numsp|puncsp|thinsp);/gu, '')
    .replace(/\p{Default_Ignorable_Code_Point}/gu, '');
  if (!visibleSource.trim()) return false;
  return true;
};

const splitTrailingActionSuffix = (value) => {
  let body = value;
  let suffix = '';
  while (body) {
    if (body.endsWith('-->')) {
      const commentStart = body.lastIndexOf('<!--');
      if (commentStart >= 0) {
        const trailingComment = body.slice(commentStart);
        body = body.slice(0, commentStart);
        suffix = `${trailingComment}${suffix}`;
        continue;
      }
    }
    const trailingEntity = body.match(ACTION_TRAILING_ENTITY);
    if (trailingEntity && (
      isActionQuoteCloserEntity(trailingEntity[0])
      || isDefaultIgnorableActionEntity(trailingEntity[0])
      || (isActionWhitespaceEntity(trailingEntity[0]) && body.includes('</'))
    )) {
      body = body.slice(0, -trailingEntity[0].length);
      suffix = `${trailingEntity[0]}${suffix}`;
      continue;
    }
    const trailingInvisible = body.match(ACTION_TRAILING_DEFAULT_IGNORABLE);
    if (trailingInvisible) {
      body = body.slice(0, -trailingInvisible[0].length);
      suffix = `${trailingInvisible[0]}${suffix}`;
      continue;
    }
    const trailingWhitespace = body.match(ACTION_TRAILING_WHITESPACE);
    if (trailingWhitespace) {
      body = body.slice(0, -trailingWhitespace[0].length);
      suffix = `${trailingWhitespace[0]}${suffix}`;
      continue;
    }
    const trailingClosers = body.match(ACTION_TRAILING_QUOTE_CLOSERS);
    if (trailingClosers) {
      body = body.slice(0, -trailingClosers[0].length);
      suffix = `${trailingClosers[0]}${suffix}`;
      continue;
    }
    const closingTag = body.match(ACTION_TRAILING_CLOSING_TAG);
    if (closingTag) {
      body = body.slice(0, -closingTag[0].length);
      suffix = `${closingTag[0]}${suffix}`;
      continue;
    }
    break;
  }
  return [body, suffix];
};

const splitTrailingActionClosers = (value) => {
  const match = value.match(ACTION_TRAILING_QUOTE_CLOSERS);
  if (!match) return [value, ''];
  const closers = match[0];
  const body = value.slice(0, -closers.length);
  return [body, closers];
};

const stripTrailingActionPunctuation = (value) => {
  let normalized = value;
  while (ACTION_TRAILING_PUNCTUATION.test(normalized)) {
    if (ACTION_TRAILING_ENTITY.test(normalized)) return normalized;
    normalized = normalized.slice(0, -1);
  }
  return normalized;
};

const isActionPunctuationEntity = (entity) => {
  const numeric = /^&#(?:x([\da-f]+)|(\d+));$/iu.exec(entity);
  let decoded = '';
  if (numeric) {
    const parsedCodePoint = Number.parseInt(numeric[1] ?? numeric[2], numeric[1] ? 16 : 10);
    const codePoint = HTML5_C1_NUMERIC_REMAP.get(parsedCodePoint) ?? parsedCodePoint;
    if (Number.isFinite(codePoint) && codePoint <= 0x10FFFF) {
      decoded = String.fromCodePoint(codePoint);
    }
  } else {
    // Mirrors Python html.unescape for every named entity that can resolve to
    // the punctuation family normalized by the apply path.
    decoded = ACTION_NAMED_PUNCTUATION_ENTITIES.get(entity) ?? '';
  }
  return ACTION_PUNCTUATION_ONLY.test(decoded);
};

const applyActionMarkdownRenderPass = (
  tokens,
  pattern,
  { contentGroup, italic = false },
) => {
  pattern.lastIndex = 0;
  const rendered = tokens.map(({ character }) => character).join('');
  const matches = [...rendered.matchAll(pattern)];
  const consumed = new Set();
  for (let matchIndex = matches.length - 1; matchIndex >= 0; matchIndex -= 1) {
    const match = matches[matchIndex];
    const openingStart = italic
      ? match.index + (match[1]?.length ?? 0)
      : match.index;
    const contentStart = italic ? openingStart + 1 : openingStart + 2;
    const contentEnd = contentStart + match[contentGroup].length;
    const closingEnd = italic ? contentEnd + 1 : contentEnd + 2;
    for (const token of [
      ...tokens.slice(openingStart, contentStart),
      ...tokens.slice(contentEnd, closingEnd),
    ]) {
      if (token.sourceIndex !== null) consumed.add(token.sourceIndex);
    }
    tokens.splice(
      openingStart,
      closingEnd - openingStart,
      { character: '\uE000', sourceIndex: null },
      ...tokens.slice(contentStart, contentEnd),
      { character: '\uE001', sourceIndex: null },
    );
  }
  return consumed;
};

const renderedActionMarkdownMarkerIndices = (value) => {
  ACTION_MARKDOWN_HTML_SPLIT.lastIndex = 0;
  if (ACTION_MARKDOWN_HTML_SPLIT.test(value)) return null;
  const tokens = value.split('').map((character, sourceIndex) => ({
    character: '*＊_'.includes(character) && isEscaped(value, sourceIndex)
      ? '\uE002'
      : character,
    sourceIndex,
  }));
  const consumed = new Set([
    ...applyActionMarkdownRenderPass(
      tokens,
      ACTION_MARKDOWN_RENDER_BOLD,
      { contentGroup: 1 },
    ),
    ...applyActionMarkdownRenderPass(
      tokens,
      ACTION_MARKDOWN_RENDER_UNDERLINE,
      { contentGroup: 1 },
    ),
    ...applyActionMarkdownRenderPass(
      tokens,
      ACTION_MARKDOWN_RENDER_ITALIC,
      { contentGroup: 2, italic: true },
    ),
  ]);
  for (let index = 0; index < value.length; index += 1) {
    if (
      '*＊_'.includes(value[index])
      && !isEscaped(value, index)
      && !consumed.has(index)
    ) return null;
  }
  return consumed;
};

const hasTerminalActionPlainPunctuation = (value) => {
  let [body] = splitTrailingActionSuffix(value);
  [body] = splitTrailingActionClosers(body);
  const closerEntity = body.match(ACTION_TRAILING_CLOSER_ENTITY);
  if (closerEntity) body = body.slice(0, -closerEntity[0].length);
  const entity = body.match(ACTION_TRAILING_ENTITY)?.[0] ?? '';
  return entity
    ? isActionPunctuationEntity(entity)
    : ACTION_TRAILING_PUNCTUATION.test(body);
};

const normalizeActionPlainTail = (value) => {
  let [body, suffix] = splitTrailingActionSuffix(value);
  let closers;
  [body, closers] = splitTrailingActionClosers(body);
  const closerEntity = body.match(ACTION_TRAILING_CLOSER_ENTITY);
  if (closerEntity) {
    body = body.slice(0, -closerEntity[0].length);
    closers = `${closerEntity[0]}${closers}`;
  }
  body = stripTrailingActionPunctuation(body);
  let entity = body.match(ACTION_TRAILING_ENTITY)?.[0] ?? '';
  if (entity) body = body.slice(0, -entity.length);
  if (isActionPunctuationEntity(entity)) entity = '';
  body = stripTrailingActionPunctuation(body);
  return `${body}${entity}。${closers}${suffix}`;
};

const normalizeRenderedActionMarkdown = (value) => {
  const consumed = renderedActionMarkdownMarkerIndices(value);
  if (!consumed) return null;
  let closingStart = value.length;
  while (closingStart > 0 && consumed.has(closingStart - 1)) closingStart -= 1;
  return `${normalizeActionPlainTail(value.slice(0, closingStart))}${value.slice(closingStart)}`;
};

const normalizeRenderedActionMarkdownLabel = (value) => {
  const consumed = renderedActionMarkdownMarkerIndices(value);
  if (!consumed) return null;
  let closingStart = value.length;
  while (closingStart > 0 && consumed.has(closingStart - 1)) closingStart -= 1;
  const body = value.slice(0, closingStart);
  if (!hasTerminalActionPlainPunctuation(body)) return null;
  return `${normalizeActionPlainTail(body)}${value.slice(closingStart)}`;
};

const splitTrailingMarkdownEmphasis = (value) => {
  if (value.includes('<') && /(?:\*|＊|_)+$/u.test(value)) return null;
  for (const delimiter of ACTION_MARKDOWN_EMPHASIS_DELIMITERS) {
    if (!value.endsWith(delimiter)) continue;
    const closingStart = value.length - delimiter.length;
    const openingStart = value.lastIndexOf(delimiter, closingStart - 1);
    if (
      openingStart < 0
      || openingStart + delimiter.length >= closingStart
      || isEscaped(value, openingStart)
      || isEscaped(value, closingStart)
    ) continue;
    return [value.slice(0, closingStart), delimiter];
  }
  return null;
};

const stripTrailingActionMarkup = (value) => {
  let body = value;
  while (body) {
    const closeTags = body.match(ACTION_TRAILING_CLOSE_TAGS);
    if (closeTags) {
      body = body.slice(0, -closeTags[0].length);
      continue;
    }
    const emphasis = splitTrailingMarkdownEmphasis(body);
    if (emphasis) {
      [body] = emphasis;
      continue;
    }
    break;
  }
  return body;
};

const hasTerminalActionPunctuation = (value) => {
  let [body] = splitTrailingActionClosers(value);
  const closerEntity = body.match(ACTION_TRAILING_CLOSER_ENTITY);
  if (closerEntity) body = body.slice(0, -closerEntity[0].length);
  body = stripTrailingActionMarkup(body);
  const entity = body.match(ACTION_TRAILING_ENTITY)?.[0] ?? '';
  return entity
    ? isActionPunctuationEntity(entity)
    : ACTION_TRAILING_PUNCTUATION.test(body);
};

const reflowCompletePlainSentences = (value, tokens) => {
  // Match the server's exception for complete prose separated only by <br>.
  // Keep links, emphasis, block/list markup and incomplete fragments strict.
  if (scanHtmlLexicalItems(value).some((item) => item.kind === 'tag' && item.tag !== 'br')
    || buildProtectedBindings(value, tokens).length) return null;
  const parts = value.split(/<br\b[^>]*>/giu);
  if (parts.slice(0, -1).some((part) => (
    !/[。！？!?\.；;]$/u.test(stripRichTextToText(part).trimEnd())
  ))) return null;
  return parts.join(' ');
};

export const hasPreservedResumeOptimizationRichText = (beforeValue, targetedValue) => {
  if (typeof beforeValue !== 'string' || typeof targetedValue !== 'string') return true;
  let beforeTokens = scanRichHtmlTokens(beforeValue);
  let targetedTokens = scanRichHtmlTokens(targetedValue);
  if (
    !beforeTokens
    || !targetedTokens
    || !validateRichHtmlTokens(beforeTokens)
    || !validateRichHtmlTokens(targetedTokens)
    || !hasValidRichHtmlListContentModel(beforeValue, beforeTokens)
    || !hasValidRichHtmlListContentModel(targetedValue, targetedTokens)
    || !hasNonEmptyRichTextVisibleContent(targetedValue, targetedTokens)
  ) return false;
  const reflowedBefore = reflowCompletePlainSentences(beforeValue, beforeTokens);
  const reflowedTargeted = reflowCompletePlainSentences(targetedValue, targetedTokens);
  if (reflowedBefore !== null && reflowedTargeted !== null) {
    beforeValue = reflowedBefore;
    targetedValue = reflowedTargeted;
    beforeTokens = scanRichHtmlTokens(beforeValue);
    targetedTokens = scanRichHtmlTokens(targetedValue);
    if (!beforeTokens || !targetedTokens) return false;
  }
  const before = buildRichTextSignature(beforeValue, beforeTokens);
  const targeted = buildRichTextSignature(targetedValue, targetedTokens);
  return isOrderedSubset(before.tagSequence, targeted.tagSequence)
    && isOrderedSubset(before.structuralTagSequence, targeted.structuralTagSequence)
    && [...before.nonEmptyPairedTagCounts].every(([tag, count]) => (
      (targeted.nonEmptyPairedTagCounts.get(tag) ?? 0) >= count
    ))
    && before.htmlLinks.length === targeted.htmlLinks.length
    && before.htmlLinks.every((target, index) => target === targeted.htmlLinks[index])
    && before.markdownLinks.length === targeted.markdownLinks.length
    && before.markdownLinks.every((target, index) => target === targeted.markdownLinks[index])
    && [...before.htmlLinks, ...before.markdownLinks, ...targeted.htmlLinks, ...targeted.markdownLinks]
      .every(isSafeRichTextLinkTarget)
    && preservesProtectedBindings(beforeValue, targetedValue, beforeTokens, targetedTokens)
    && targeted.boldCount >= before.boldCount
    && targeted.underlineCount >= before.underlineCount
    && targeted.italicCount >= before.italicCount
    && (
      !beforeTokens.some((token) => RICH_HTML_LIST_CONTAINER_TAGS.has(token.tag))
      || targeted.listTreeSignature === before.listTreeSignature
    );
};

export const isResumeOptimizationChangeReviewable = (change) => (
  change?.safetyStatus === 'allowed'
  && (change?.actionKind === 'rewrite_now' || change?.actionKind === 'ask_user')
  && change?.targetedValue !== null
  && change?.targetedValue !== undefined
  && (
    (change?.moduleType === 'personal_summary' && change.targetedValue === '')
    || hasPreservedResumeOptimizationRichText(change?.beforeValue, change?.targetedValue)
  )
);

const normalizeActionParagraphSegment = (segment) => {
  if (!hasVisibleActionContent(segment)) return segment;
  let [body, suffix] = splitTrailingActionSuffix(segment);
  ACTION_MARKDOWN_HTML_SPLIT.lastIndex = 0;
  const htmlMatches = [...body.matchAll(ACTION_MARKDOWN_HTML_SPLIT)];
  const textStart = htmlMatches.at(-1)?.index === undefined
    ? 0
    : htmlMatches.at(-1).index + htmlMatches.at(-1)[0].length;
  const textPrefix = body.slice(0, textStart);
  const textTail = body.slice(textStart);
  const markdownLink = splitTrailingMarkdownLink(textTail);
  if (markdownLink) {
    const [prefix, label, linkSuffix] = markdownLink;
    const normalizedLabel = normalizeRenderedActionMarkdownLabel(label);
    if (normalizedLabel !== null) {
      return `${textPrefix}${prefix}${normalizedLabel}${linkSuffix}${suffix}`;
    }
    return `${textPrefix}${normalizeActionPlainTail(textTail)}${suffix}`;
  }

  // Legacy Markdown conversion is scoped to each HTML/comment-delimited text
  // segment. A bracket pair that spans such a boundary remains literal.
  if (htmlMatches.length > 0 && splitTrailingMarkdownLink(body)) {
    return `${normalizeActionPlainTail(body)}${suffix}`;
  }

  if ([...textTail].some((character) => '*＊_'.includes(character))) {
    const normalizedMarkdown = normalizeRenderedActionMarkdown(textTail)
      ?? normalizeActionPlainTail(textTail);
    return `${textPrefix}${normalizedMarkdown}${suffix}`;
  }

  return `${normalizeActionPlainTail(body)}${suffix}`;
};

export const normalizeResumeOptimizationActionParagraphEndings = (value) => {
  if (typeof value !== 'string' || !value) return value;
  const parts = [];
  let segmentStart = 0;
  for (let cursor = 0; cursor < value.length;) {
    const entity = /^(?:&NewLine;|&#0*(?:10|13);|&#[xX]0*(?:[aAdD]);)/u.exec(value.slice(cursor));
    if (entity) {
      parts.push(normalizeActionParagraphSegment(value.slice(segmentStart, cursor)), entity[0]);
      cursor += entity[0].length;
      segmentStart = cursor;
      continue;
    }
    if (value[cursor] === '\r' || value[cursor] === '\n') {
      const end = value.startsWith('\r\n', cursor) ? cursor + 2 : cursor + 1;
      parts.push(normalizeActionParagraphSegment(value.slice(segmentStart, cursor)), value.slice(cursor, end));
      cursor = end;
      segmentStart = cursor;
      continue;
    }
    if (value.startsWith('<!--', cursor)) {
      const commentEnd = value.indexOf('-->', cursor + 4);
      cursor = commentEnd < 0 ? value.length : commentEnd + 3;
      continue;
    }
    if (value[cursor] === '<') {
      const end = findHtmlTagEnd(value, cursor + 1);
      const tag = end < 0 ? '' : value.slice(cursor, end + 1);
      if (/^<(?:li|div|p|ul|ol|br)(?=[\s/>])(?:[^"'<>]|"[^"]*"|'[^']*')*>$|^<\/(?:li|div|p|ul|ol)\s*>$/iu.test(tag)) {
        parts.push(normalizeActionParagraphSegment(value.slice(segmentStart, cursor)), tag);
        cursor = end + 1;
        segmentStart = cursor;
        continue;
      }
      cursor = end < 0 ? cursor + 1 : end + 1;
      continue;
    }
    cursor += 1;
  }
  parts.push(normalizeActionParagraphSegment(value.slice(segmentStart)));
  return parts.join('');
};

export const formatResumeOptimizationUserCopy = (value, fallback = '') => {
  const normalized = text(value);
  const safeFallback = text(fallback);
  if (!normalized) return safeFallback;
  const inspectionCopy = normalized
    .normalize('NFKC')
    .replace(/%2f/giu, '/')
    .replace(/~1/gu, '/');
  return INTERNAL_COPY_MARKER.test(inspectionCopy)
    || looksLikeSerializedStructuredData(inspectionCopy)
    ? safeFallback
    : normalized;
};

const RESUME_OPTIMIZATION_SAFETY_FINDING_FALLBACK = '该项未通过自动安全规则，已保留原文。';

export const buildResumeOptimizationSafetyFindingCopy = (findings) => {
  const copies = [];
  const seen = new Set();
  for (const finding of list(findings)) {
    const copy = formatResumeOptimizationUserCopy(finding);
    if (!copy || seen.has(copy)) continue;
    seen.add(copy);
    copies.push(copy);
  }
  return copies.length > 0 ? copies : [RESUME_OPTIMIZATION_SAFETY_FINDING_FALLBACK];
};

export const RESUME_OPTIMIZATION_TERMINAL_ANSWER_OPTIONS = Object.freeze([
  Object.freeze({ state: 'skipped', label: '无法回答' }),
]);

export const isResumeOptimizationTerminalAnswerState = (state) => (
  TERMINAL_ANSWER_STATES.has(state)
);

export const buildResumeOptimizationOverviewMetrics = (plan) => {
  const changes = list(plan?.changes);
  return {
    directChanges: changes.filter((item) => (
      item?.actionKind === 'rewrite_now' && isResumeOptimizationChangeReviewable(item)
    )).length,
    questions: list(plan?.questions).length,
    blockedChanges: changes.filter((item) => item?.safetyStatus === 'blocked').length,
    bankOpportunities: list(plan?.bankSuggestions).length,
  };
};

const resolveResumeOptimizationModuleOrderKey = (change) => {
  if (change?.moduleType === 'personal_summary') return 'summary';
  if (change?.moduleType === 'skills_order') return 'skills';
  if (change?.moduleType === 'section_order') return 'sections';
  return text(change?.moduleId);
};

const resolveResumeOptimizationFieldOrder = (change) => {
  const fieldMatch = /^star\.([star])$/u.exec(change?.fieldPath ?? '');
  return fieldMatch
    ? STAR_FIELD_ORDER.get(fieldMatch[1]) ?? Number.MAX_SAFE_INTEGER
    : 0;
};

export const sortResumeOptimizationChangesByResumeOrder = (changes, moduleOrder = []) => {
  const moduleRank = new Map(
    list(moduleOrder)
      .map((moduleId) => text(moduleId))
      .filter(Boolean)
      .map((moduleId, index) => [moduleId, index]),
  );
  return list(changes)
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const leftRank = moduleRank.get(resolveResumeOptimizationModuleOrderKey(left.item))
        ?? Number.MAX_SAFE_INTEGER;
      const rightRank = moduleRank.get(resolveResumeOptimizationModuleOrderKey(right.item))
        ?? Number.MAX_SAFE_INTEGER;
      return leftRank - rightRank
        || resolveResumeOptimizationFieldOrder(left.item) - resolveResumeOptimizationFieldOrder(right.item)
        || left.index - right.index;
    })
    .map(({ item }) => item);
};

export const shouldRenderResumeOptimizationComparison = (uiState) => (
  COMPARISON_VISIBLE_UI_STATES.has(uiState)
);

export const buildResumeOptimizationExperienceComparisonMap = (
  changes,
  acceptedChangeIds = [],
  readOnly = false,
) => {
  const acceptedChangeIdList = list(acceptedChangeIds);
  const acceptedIds = new Set(acceptedChangeIdList);
  const candidatesByTarget = new Map();
  const comparisons = new Map();

  for (const change of list(changes)) {
    if (
      change?.moduleType !== 'experience_star'
      || !isResumeOptimizationChangeReviewable(change)
      || typeof change?.moduleId !== 'string'
      || !change.moduleId.trim()
      || typeof change?.beforeValue !== 'string'
      || typeof change?.targetedValue !== 'string'
      || !change.targetedValue.trim()
      || change.beforeValue.trim() === change.targetedValue.trim()
    ) {
      continue;
    }
    const fieldMatch = /^star\.([star])$/u.exec(change.fieldPath ?? '');
    if (!fieldMatch) continue;

    const field = fieldMatch[1];
    const moduleId = change.moduleId.trim();
    const targetKey = `${moduleId}\u0000${field}`;
    const candidates = candidatesByTarget.get(targetKey) ?? [];
    candidates.push({ change, field, moduleId });
    candidatesByTarget.set(targetKey, candidates);
  }

  for (const candidates of candidatesByTarget.values()) {
    // Old persisted plans can contain duplicate targets. The flow retains the
    // most recently selected ID for a target, so use that same selection order
    // here and never show a different candidate in the document preview.
    const selectedCandidate = [...acceptedChangeIdList]
      .reverse()
      .map((changeId) => candidates.find(({ change }) => change.changeId === changeId))
      .find(Boolean);
    if (readOnly && !selectedCandidate) continue;
    const { change, field, moduleId } = selectedCandidate ?? candidates[0];

    const current = comparisons.get(moduleId) ?? [];
    current.push({
      changeId: change.changeId,
      field,
      beforeValue: change.beforeValue,
      afterValue: field === 'a'
        ? normalizeResumeOptimizationActionParagraphEndings(change.targetedValue)
        : change.targetedValue,
      selected: acceptedIds.has(change.changeId),
      readOnly: Boolean(readOnly),
    });
    current.sort((left, right) => (
      (STAR_FIELD_ORDER.get(left.field) ?? Number.MAX_SAFE_INTEGER)
      - (STAR_FIELD_ORDER.get(right.field) ?? Number.MAX_SAFE_INTEGER)
    ));
    comparisons.set(moduleId, current);
  }

  return comparisons;
};

export const buildResumeOptimizationPersonalSummaryComparison = (
  changes,
  acceptedChangeIds = [],
  readOnly = false,
) => {
  const acceptedChangeIdList = list(acceptedChangeIds);
  const acceptedIds = new Set(acceptedChangeIdList);
  const candidates = [];
  for (const change of list(changes)) {
    if (
      change?.moduleType !== 'personal_summary'
      || !['current_resume', 'personal_summary', 'resume'].includes(change?.moduleId)
      || !['personal_summary', 'personalSummary'].includes(change?.fieldPath)
      || !isResumeOptimizationChangeReviewable(change)
      || typeof change?.beforeValue !== 'string'
      || typeof change?.targetedValue !== 'string'
      || (!change.targetedValue.trim() && change.targetedValue !== '')
      || change.beforeValue.trim() === change.targetedValue.trim()
    ) continue;
    candidates.push(change);
  }
  if (candidates.length === 0) return null;
  // Summary aliases share one persisted field. Mirror the flow's last-wins
  // collapse for legacy plans so preview and the submitted selection agree.
  const selectedCandidate = [...acceptedChangeIdList]
    .reverse()
    .map((changeId) => candidates.find((change) => change.changeId === changeId))
    .find(Boolean);
  if (readOnly && !selectedCandidate) return null;
  const change = selectedCandidate ?? candidates[0];
  return {
    changeId: change.changeId,
    beforeValue: change.beforeValue,
    afterValue: change.targetedValue,
    selected: acceptedIds.has(change.changeId),
    readOnly: Boolean(readOnly),
  };
};

export const formatResumeOptimizationModuleLabel = (moduleType, fieldPath = '') => {
  if (fieldPath === 'unsupported') return '当前简历';
  if (moduleType === 'experience_star' && STAR_FIELD_LABELS.has(fieldPath)) {
    return `经历 STAR · ${STAR_FIELD_LABELS.get(fieldPath)}`;
  }
  return MODULE_LABELS.get(moduleType) ?? '简历内容';
};

export const formatResumeOptimizationDimensionLabel = (value) => {
  const normalized = text(value).replace(/\s+/g, '');
  if (!normalized) return '综合优化';
  return normalizeEvaluationDimension(normalized)
    || SPECIAL_DIMENSION_LABELS.get(normalized)
    || '综合优化';
};

export const formatResumeOptimizationSourceLabel = (value) => (
  SOURCE_LABELS.get(value) ?? '已验证来源'
);

export const isResumeOptimizationAnswerComplete = (draft) => {
  if (!draft || typeof draft !== 'object' || typeof draft.value !== 'string') return false;
  if (draft.state === 'answered') return Boolean(draft.value.trim());
  return TERMINAL_ANSWER_STATES.has(draft.state);
};

export const areResumeOptimizationAnswersComplete = (questions, drafts) => {
  if (!Array.isArray(questions) || questions.length === 0 || questions.length > 5) return false;
  if (!drafts || typeof drafts !== 'object' || Array.isArray(drafts)) return false;
  const questionIds = questions.map((question) => text(question?.questionId));
  if (questionIds.some((questionId) => !questionId)) return false;
  if (new Set(questionIds).size !== questionIds.length) return false;
  return questionIds.every((questionId) => isResumeOptimizationAnswerComplete(drafts[questionId]));
};

export const resolveResumeOptimizationChoiceDraft = (choice) => {
  if (!choice || typeof choice !== 'object') return null;
  const value = text(choice.value);
  const label = formatResumeOptimizationUserCopy(choice.label);
  if (!value || !label) return null;
  const terminalState = TERMINAL_ANSWER_STATES.has(value)
    ? value
    : TERMINAL_LABEL_STATES.get(label);
  return terminalState
    ? { state: terminalState, value: '' }
    : { state: 'answered', value: label };
};

export const buildResumeOptimizationQuestionChoices = (choices) => {
  const seenLabels = new Set();
  const resolved = [];
  for (const choice of list(choices)) {
    const draft = resolveResumeOptimizationChoiceDraft(choice);
    const label = formatResumeOptimizationUserCopy(choice?.label);
    if (
      !draft
      || draft.state !== 'answered'
      || seenLabels.has(label)
      || HIDDEN_OPEN_ENDED_CHOICE_LABEL.test(label)
    ) continue;
    seenLabels.add(label);
    resolved.push({ label, draft });
  }
  return resolved;
};

const fallbackPreviewLines = (value) => (
  value === null || value === undefined ? ['无内容'] : ['内容暂不可预览']
);

const formatRichTextPreviewLines = (value) => {
  if (typeof value !== 'string') return fallbackPreviewLines(value);
  const lines = stripRichTextToText(value)
    .split(/\r?\n/u)
    .map((item) => formatResumeOptimizationUserCopy(item))
    .filter(Boolean);
  return lines.length > 0 ? lines : ['无内容'];
};

const formatSkillOrderPreviewLines = (value, skillNameById) => {
  if (!Array.isArray(value)) return fallbackPreviewLines(value);
  return value.map((skillId) => {
    if (typeof skillId !== 'string') return '未知技能';
    const name = Object.prototype.hasOwnProperty.call(skillNameById, skillId)
      ? skillNameById[skillId]
      : undefined;
    return formatResumeOptimizationUserCopy(name, '未知技能');
  });
};

const formatSectionOrderPreviewLines = (value) => {
  if (!Array.isArray(value)) return fallbackPreviewLines(value);
  return value.map((sectionId) => (
    typeof sectionId === 'string' ? SECTION_LABELS.get(sectionId) ?? '其他模块' : '其他模块'
  ));
};

const formatChangePreviewLines = (moduleType, fieldPath, value, skillNameById) => {
  if (moduleType === 'skills_order') {
    return formatSkillOrderPreviewLines(value, skillNameById);
  }
  if (moduleType === 'section_order') {
    return formatSectionOrderPreviewLines(value);
  }
  if (moduleType === 'experience_star' && fieldPath === 'star.a') {
    return formatRichTextPreviewLines(normalizeResumeOptimizationActionParagraphEndings(value));
  }
  return formatRichTextPreviewLines(value);
};

export const buildResumeOptimizationChangePreview = (change, skillNameById = {}) => ({
  before: formatChangePreviewLines(change?.moduleType, undefined, change?.beforeValue, skillNameById),
  after: change?.targetedValue === null
    ? ['保留原文']
    : formatChangePreviewLines(
      change?.moduleType,
      change?.fieldPath,
      change?.targetedValue,
      skillNameById,
    ),
});

export const resolveResumeOptimizationExperienceCategory = (value) => (
  EXPERIENCE_CATEGORIES.has(value) ? value : undefined
);

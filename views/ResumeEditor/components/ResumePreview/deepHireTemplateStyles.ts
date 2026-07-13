import type React from 'react';
import type {
    ResumeTemplateDefinition,
    ResumeTemplateSectionVariant,
} from '../../../../constants/resumeTemplates';
import { PREVIEW_PADDING_MM } from '../../constants';

type DeepHirePreviewCssProperties = React.CSSProperties & {
    '--rf-template-top-padding'?: string;
    '--rf-template-inset-top'?: string;
    '--rf-template-inset-right'?: string;
    '--rf-template-inset-bottom'?: string;
    '--rf-template-inset-left'?: string;
    '--rf-template-page-bg'?: string;
    '--rf-template-page-fg'?: string;
    '--rf-template-header-bg'?: string;
    '--rf-template-header-fg'?: string;
    '--rf-template-sidebar-bg'?: string;
    '--rf-template-sidebar-fg'?: string;
    '--rf-template-main-bg'?: string;
    '--rf-template-border'?: string;
};

const DEFAULT_PAGE_BACKGROUND = '#ffffff';
const DEFAULT_PAGE_FOREGROUND = '#111827';
const DEFAULT_SIDEBAR_RATIO = 0.32;
const MIN_SIDEBAR_RATIO = 0.22;
const MAX_SIDEBAR_RATIO = 0.42;
const CSS_PX_PER_MM = 96 / 25.4;
const DEFAULT_EDITOR_TOP_PADDING_PX = Number((PREVIEW_PADDING_MM * CSS_PX_PER_MM).toFixed(2));

const isDeepHireTemplate = (activeTemplate: ResumeTemplateDefinition) => (
    activeTemplate.collection === 'deephire'
);

const normalizeTopPaddingPx = (topPaddingPx: number) => (
    Number.isFinite(topPaddingPx)
        ? Math.max(0, topPaddingPx)
        : DEFAULT_EDITOR_TOP_PADDING_PX
);

const clampSidebarRatio = (ratio?: number) => {
    if (!Number.isFinite(ratio)) {
        return DEFAULT_SIDEBAR_RATIO;
    }
    return Math.min(MAX_SIDEBAR_RATIO, Math.max(MIN_SIDEBAR_RATIO, ratio as number));
};

const escapeCssAttributeValue = (value: string) => value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, '\\a ');

const parseHexColor = (value?: string) => {
    if (!value) {
        return null;
    }
    const normalized = value.trim();
    const shortMatch = /^#([\da-f])([\da-f])([\da-f])$/i.exec(normalized);
    if (shortMatch) {
        return shortMatch.slice(1).map((part) => Number.parseInt(`${part}${part}`, 16));
    }
    const fullMatch = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(normalized);
    return fullMatch
        ? fullMatch.slice(1).map((part) => Number.parseInt(part, 16))
        : null;
};

const resolveRelativeLuminance = (value?: string) => {
    const rgb = parseHexColor(value);
    if (!rgb) {
        return null;
    }
    const channels = rgb.map((channel) => {
        const normalized = channel / 255;
        return normalized <= 0.03928
            ? normalized / 12.92
            : ((normalized + 0.055) / 1.055) ** 2.4;
    });
    return (0.2126 * channels[0]) + (0.7152 * channels[1]) + (0.0722 * channels[2]);
};

const buildSectionVariantCss = (
    rootSelector: string,
    sectionVariant: ResumeTemplateSectionVariant
) => {
    const headingSelector = `${rootSelector} .rf-template-section-heading`;

    switch (sectionVariant) {
        case 'plain-rule':
            return `
${headingSelector} {
  width: 100%;
  border: 0 !important;
  border-bottom: 1px solid var(--rf-template-border) !important;
  border-radius: 0 !important;
  background-color: transparent !important;
  color: var(--rf-accent-text) !important;
  padding: 0 0 5px !important;
  margin-bottom: 10px;
}`;
        case 'watercolor-dot':
            return `
${headingSelector} {
  width: 100%;
  gap: 10px;
  border: 0 !important;
  border-radius: 0 !important;
  background-color: transparent !important;
  color: #263653 !important;
  padding: 0 !important;
  margin-bottom: 28px;
  font-size: 20px !important;
  font-weight: 700 !important;
  letter-spacing: 0.02em !important;
  line-height: 1.35 !important;
  text-transform: none !important;
}`;
        case 'soft-band':
            return `
${headingSelector} {
  width: 100%;
  border: 0 !important;
  border-left: 3px solid var(--rf-accent-color) !important;
  border-radius: 2px !important;
  background-color: var(--rf-accent-soft-bg) !important;
  color: var(--rf-accent-text) !important;
  padding: 5px 8px !important;
  margin-bottom: 10px;
}`;
        case 'solid-band':
            return `
${headingSelector} {
  width: 100%;
  border: 0 !important;
  border-radius: 3px !important;
  background-color: var(--rf-accent-color) !important;
  color: #ffffff !important;
  padding: 5px 9px !important;
  margin-bottom: 10px;
}`;
        case 'left-rail':
            return `
${headingSelector} {
  width: 100%;
  border: 0 !important;
  border-left: 4px solid var(--rf-accent-color) !important;
  border-radius: 0 !important;
  background-color: transparent !important;
  color: var(--rf-accent-text) !important;
  padding: 2px 0 2px 9px !important;
  margin-bottom: 10px;
}`;
        case 'timeline-dot':
            return `
${headingSelector} {
  width: 100%;
  border: 0 !important;
  border-left: 4px solid var(--rf-accent-color) !important;
  border-bottom: 1px solid var(--rf-template-border) !important;
  border-radius: 0 !important;
  background-color: transparent !important;
  color: var(--rf-accent-text) !important;
  padding: 2px 0 5px 9px !important;
  margin-bottom: 10px;
}`;
        case 'table-cell':
            return `
${headingSelector} {
  width: 100%;
  border: 1px solid var(--rf-template-border) !important;
  border-radius: 0 !important;
  background-color: var(--rf-accent-soft-bg) !important;
  color: var(--rf-accent-text) !important;
  padding: 5px 7px !important;
  margin-bottom: 0;
}
${rootSelector} [data-rf-section-surface] {
  border: 1px solid var(--rf-template-border) !important;
  border-radius: 0 !important;
  padding: 8px !important;
}`;
        case 'editorial-tag':
            return `
${headingSelector} {
  width: fit-content;
  border: 0 !important;
  border-radius: 4px !important;
  background-color: var(--rf-accent-color) !important;
  color: #ffffff !important;
  padding: 5px 10px !important;
  margin-bottom: 10px;
}`;
        case 'centered-label':
            return `
${headingSelector} {
  width: 56%;
  justify-content: center;
  border: 0 !important;
  border-bottom: 1px solid var(--rf-template-border) !important;
  border-radius: 0 !important;
  background-color: transparent !important;
  color: var(--rf-accent-text) !important;
  padding: 0 0 7px !important;
  margin: 0 auto 12px;
  text-align: center;
}`;
        case 'heavy-rule':
            return `
${headingSelector} {
  width: 100%;
  border: 0 !important;
  border-top: 2px solid #111111 !important;
  border-bottom: 2px solid #111111 !important;
  border-radius: 0 !important;
  background-color: transparent !important;
  color: #111111 !important;
  padding: 5px 0 !important;
  margin-bottom: 10px;
}`;
        case 'native':
        default:
            return '';
    }
};

const buildTemplateSpecificCss = (
    activeTemplate: ResumeTemplateDefinition,
    rootSelector: string
) => {
    const fullBleedSplitCss = `
${rootSelector} .rf-template-split-background,
${rootSelector} .rf-template-content-layout {
  min-height: 100% !important;
  border-radius: 0 !important;
}
${rootSelector} .rf-template-split-background {
  height: 100% !important;
}
${rootSelector} .rf-template-sidebar,
${rootSelector} .rf-template-main {
  min-height: 100% !important;
}`;
    const trailingRuleCss = `
${rootSelector} .rf-template-section-heading {
  display: flex !important;
  align-items: center !important;
  gap: 14px !important;
  border: 0 !important;
  background: transparent !important;
  color: #141414 !important;
  font-size: 17px !important;
  font-weight: 800 !important;
  letter-spacing: 0 !important;
  padding: 0 !important;
  margin-bottom: 12px;
}
${rootSelector} .rf-template-section-heading::after {
  content: "";
  height: 1px;
  min-width: 32px;
  flex: 1;
  background: #d9dde3;
}`;

    switch (activeTemplate.id) {
        case 'deephire-standard':
            return `
${rootSelector} .rf-deephire-header {
  border: 0 !important;
  padding: 0 0 24px !important;
  margin-bottom: 24px;
}
${rootSelector} .rf-deephire-name { font-size: 34px !important; letter-spacing: 0.04em !important; }
${rootSelector} .rf-deephire-avatar { width: 106px !important; height: 106px !important; border-radius: 9px !important; }
${rootSelector} .rf-deephire-contact-list { max-width: 560px; row-gap: 7px !important; }
${trailingRuleCss}`;
        case 'deephire-blue':
            return `
${rootSelector} .rf-deephire-header {
  border: 0 !important;
  padding: 0 0 22px !important;
  margin-bottom: 20px;
}
${rootSelector} .rf-deephire-avatar { width: 88px !important; height: 88px !important; border-radius: 7px !important; }
${rootSelector} .rf-template-section-heading {
  min-height: 29px;
  border: 0 !important;
  border-left: 4px solid #098e98 !important;
  border-radius: 0 !important;
  background: #e5f7f8 !important;
  color: #087982 !important;
  font-size: 17px !important;
  letter-spacing: 0 !important;
  padding: 4px 10px !important;
  margin-bottom: 11px;
}`;
        case 'deephire-steady':
            return `
${rootSelector} .rf-deephire-header--banner {
  min-height: 223px;
  margin: 0 calc(var(--rf-template-inset-right) * -1) 30px calc(var(--rf-template-inset-left) * -1);
  padding-right: 68px !important;
  padding-bottom: 38px !important;
  padding-left: 68px !important;
}
${rootSelector} .rf-deephire-avatar { width: 110px !important; height: 110px !important; border-radius: 9px !important; }
${rootSelector} .rf-deephire-name { font-size: 35px !important; }
${trailingRuleCss}`;
        case 'deephire-simple':
            return `
${fullBleedSplitCss}
${rootSelector} .rf-template-sidebar { padding: 40px 28px 36px 38px !important; }
${rootSelector} .rf-template-main {
  position: relative;
  border-left: 1px solid #70d8d1 !important;
  padding: 46px 42px 36px 44px !important;
}
${rootSelector} .rf-deephire-header { margin-bottom: 28px; }
${rootSelector} .rf-deephire-avatar { width: 122px !important; height: 122px !important; border-radius: 4px !important; }
${rootSelector} .rf-deephire-name { font-size: 28px !important; }
${rootSelector} .rf-template-section-heading {
  position: relative;
  border: 0 !important;
  border-bottom: 1px solid #dfe5e5 !important;
  background: transparent !important;
  color: #111827 !important;
  font-size: 16px !important;
  letter-spacing: 0 !important;
  padding: 0 0 7px !important;
  margin-bottom: 12px;
}
${rootSelector} .rf-template-main .rf-heading-marker {
  position: absolute;
  left: -51px;
  color: #41cfc5;
  width: 10px;
  height: 10px;
}
${rootSelector} .rf-template-sidebar .rf-heading-marker { display: none; }`;
        case 'deephire-deep-blue':
            return `
${rootSelector} .rf-deephire-header--curved {
  margin: 0 calc(var(--rf-template-inset-right) * -1) 46px calc(var(--rf-template-inset-left) * -1);
}
${rootSelector} .rf-deephire-curved-band {
  height: 126px !important;
  margin: 0 !important;
  border-radius: 0 !important;
  background: url("/resume-templates/deephire/deephire-deep-blue-band.png") center top / 100% 126px no-repeat !important;
}
${rootSelector} .rf-deephire-header-inner { margin-top: -62px !important; }
${rootSelector} .rf-deephire-avatar { width: 110px !important; height: 110px !important; }
${rootSelector} .rf-deephire-name { font-size: 32px !important; margin-top: 18px !important; }
${trailingRuleCss}`;
        case 'deephire-lucky-red':
            return `
${rootSelector} .rf-template-content-layout {
  display: flex;
  min-height: 100%;
  flex-direction: column;
  padding: 0 16px 16px;
}
${rootSelector} .rf-template-content-layout::before {
  content: "";
  position: absolute;
  z-index: 0;
  inset: 216px 16px 16px;
  border-radius: 16px;
  background: #ffffff;
}
${rootSelector} .rf-deephire-header--banner {
  z-index: 1;
  min-height: 200px;
  margin: 0 -16px 16px;
  padding-right: 40px !important;
  padding-bottom: 22px !important;
  padding-left: 40px !important;
  background-image: url("/resume-templates/deephire/deephire-lucky-dots.png") !important;
  background-position: right top !important;
  background-repeat: no-repeat !important;
}
${rootSelector} .rf-deephire-header-inner { flex-direction: row-reverse; justify-content: flex-end !important; gap: 34px !important; }
${rootSelector} .rf-deephire-avatar { width: 164px !important; height: 164px !important; border-radius: 9px !important; }
${rootSelector} .rf-deephire-profile-copy { padding-top: 26px; }
${rootSelector} .rf-deephire-name { font-size: 38px !important; }
${rootSelector} [data-rf-section-id]:not([data-rf-section-id="basic-info"]) {
  z-index: 1;
  margin-right: 30px !important;
  margin-left: 30px !important;
}
${rootSelector} [data-rf-section-id="work"] { margin-top: 14px !important; }
${rootSelector} [data-rf-section-surface] { border: 0 !important; border-radius: 0 !important; background: transparent !important; padding: 0 !important; }
${rootSelector} .rf-template-section-heading {
  width: 100%;
  border: 0 !important;
  border-radius: 999px 0 0 999px !important;
  background: #941348 !important;
  color: #ffffff !important;
  font-size: 17px !important;
  letter-spacing: 0 !important;
  padding: 7px 18px !important;
  margin-bottom: 16px;
}`;
        case 'deephire-champion-blue':
            return `
${fullBleedSplitCss}
${rootSelector} .rf-template-sidebar {
  padding: 56px 38px 36px !important;
  background-image: url("/resume-templates/deephire/deephire-champion-honeycomb.png") !important;
  background-position: left bottom !important;
  background-repeat: no-repeat !important;
  background-size: 100% auto !important;
}
${rootSelector} .rf-template-main { padding: 40px 42px 36px !important; }
${rootSelector} .rf-deephire-header--champion { margin-bottom: 38px; }
${rootSelector} .rf-deephire-kicker { font-size: 67px !important; }
${rootSelector} .rf-deephire-name { font-size: 27px !important; }
${rootSelector} .rf-deephire-avatar { width: 146px !important; height: 146px !important; border-radius: 10px !important; }
${rootSelector} .rf-deephire-header--champion .rf-deephire-contact-list { display: none; }
${rootSelector} .rf-template-section-heading {
  border: 0 !important;
  border-bottom: 1px solid #e3e6eb !important;
  background: transparent !important;
  color: #111111 !important;
  font-size: 17px !important;
  letter-spacing: 0 !important;
  padding: 0 0 9px !important;
  margin-bottom: 13px;
}
${rootSelector} .rf-template-sidebar .rf-template-section-heading { color: #ffffff !important; border-bottom-color: rgba(255,255,255,.2) !important; }
${rootSelector} .rf-template-sidebar .rf-heading-diamond-trail { display: none; }
${rootSelector} .rf-heading-diamond-trail { color: #4f80c9; }`;
        case 'deephire-collector-red':
            return `
${fullBleedSplitCss}
${rootSelector} { border-top: 41px solid #a7093e !important; }
${rootSelector} .rf-template-split-background,
${rootSelector} .rf-template-content-layout { min-height: calc(100% - 41px) !important; }
${rootSelector} .rf-template-sidebar { padding: 28px 34px 36px !important; }
${rootSelector} .rf-template-main { padding: 30px 42px 36px !important; }
${rootSelector} .rf-deephire-avatar { width: 86px !important; height: 86px !important; border-radius: 5px !important; }
${rootSelector} .rf-deephire-name { font-size: 26px !important; }
${rootSelector} .rf-template-section-heading {
  border: 0 !important;
  background: transparent !important;
  color: #161616 !important;
  font-size: 16px !important;
  letter-spacing: 0 !important;
  padding: 0 0 8px !important;
  margin-bottom: 12px;
}
${rootSelector} .rf-heading-diamond-trail { margin-left: auto !important; color: #a7093e; }
${rootSelector} .rf-template-sidebar .rf-heading-diamond-trail { display: none; }`;
        case 'deephire-minimal':
            return `
${rootSelector} .rf-deephire-header { position: relative; border: 0 !important; padding: 0 0 50px !important; margin-bottom: 50px; }
${rootSelector} .rf-deephire-header-inner { justify-content: center !important; text-align: center; }
${rootSelector} .rf-deephire-profile-copy { max-width: 590px; }
${rootSelector} .rf-deephire-name { font-size: 31px !important; letter-spacing: .08em !important; }
${rootSelector} .rf-deephire-contact-list { justify-content: center; }
${rootSelector} .rf-deephire-avatar { position: absolute; right: 0; top: -6px; width: 86px !important; height: 86px !important; border-radius: 3px !important; }
${rootSelector} .rf-template-section-heading { color: #252525 !important; font-family: inherit; font-weight: 500 !important; font-size: 16px !important; letter-spacing: .12em !important; margin-bottom: 20px; }`;
        case 'deephire-blue-header':
            return `
${rootSelector} .rf-deephire-header--banner {
  min-height: 170px;
  margin: 0 calc(var(--rf-template-inset-right) * -1) 30px calc(var(--rf-template-inset-left) * -1);
  padding-right: 40px !important;
  padding-bottom: 30px !important;
  padding-left: 40px !important;
}
${rootSelector} .rf-deephire-avatar { width: 88px !important; height: 88px !important; border-radius: 2px !important; }
${rootSelector} .rf-deephire-name { font-size: 31px !important; }
${rootSelector} .rf-template-section-heading { border: 0 !important; color: #222 !important; font-size: 16px !important; font-weight: 700 !important; letter-spacing: .04em !important; padding: 0 !important; margin-bottom: 13px; }
${rootSelector} [data-rf-section-id]:not([data-rf-section-id="basic-info"]) { border-bottom: 1px solid #dedede; padding-bottom: 18px; }`;
        case 'deephire-elegant':
            return `
${rootSelector} .rf-deephire-header { border: 0 !important; border-bottom: 1px solid #ededed !important; padding: 0 0 36px !important; margin-bottom: 24px; }
${rootSelector} .rf-deephire-header-inner { flex-direction: row-reverse; justify-content: flex-end !important; gap: 28px !important; }
${rootSelector} .rf-deephire-avatar { width: 126px !important; height: 126px !important; border-radius: 8px !important; }
${rootSelector} .rf-deephire-name { font-size: 38px !important; }
${rootSelector} [data-rf-section-surface] {
  display: grid;
  grid-template-columns: 142px minmax(0, 1fr);
  column-gap: 22px;
  border-radius: 0 !important;
  padding: 0 0 18px !important;
  border-bottom: 1px solid #ededed;
}
${rootSelector} .rf-template-section-heading { align-self: start; border: 0 !important; background: transparent !important; color: #202020 !important; font-size: 15px !important; letter-spacing: 0 !important; padding: 0 !important; margin: 0; }`;
        case 'deephire-concise':
            return `
${fullBleedSplitCss}
${rootSelector} .rf-template-sidebar { padding: 38px 28px 34px 36px !important; }
${rootSelector} .rf-template-main { position: relative; border-left: 2px solid #ef8f8d !important; padding: 42px 38px 34px 45px !important; }
${rootSelector} .rf-deephire-avatar { width: 122px !important; height: 122px !important; border-radius: 3px !important; }
${rootSelector} .rf-template-section-heading { position: relative; border: 0 !important; background: transparent !important; color: #191919 !important; font-size: 16px !important; letter-spacing: 0 !important; padding: 0 0 8px !important; margin-bottom: 12px; }
${rootSelector} .rf-template-main .rf-heading-marker { position: absolute; left: -51px; width: 11px; height: 11px; color: #ed7774; }
${rootSelector} .rf-template-sidebar .rf-heading-marker { display: none; }`;
        case 'deephire-table':
            return `
${rootSelector} .rf-deephire-header { border: 0 !important; padding: 0 0 28px !important; margin-bottom: 18px; text-align: center; }
${rootSelector} .rf-deephire-header-inner { justify-content: center !important; position: relative; }
${rootSelector} .rf-deephire-profile-copy { max-width: 570px; }
${rootSelector} .rf-deephire-contact-list { justify-content: center; }
${rootSelector} .rf-deephire-avatar { position: absolute; right: 0; width: 70px !important; height: 70px !important; border-radius: 50% !important; }
${rootSelector} [data-rf-section-surface] { border: 1px solid #cfd3d8 !important; border-radius: 0 !important; padding: 0 !important; }
${rootSelector} .rf-template-section-heading { border: 0 !important; border-bottom: 1px solid #cfd3d8 !important; background: #ffffff !important; color: #111111 !important; font-size: 15px !important; letter-spacing: 0 !important; padding: 7px 10px !important; margin: 0; }
${rootSelector} [data-rf-item-container],
${rootSelector} [data-rf-section-surface="summary"] > div:last-child { padding: 10px !important; }
${rootSelector} [data-rf-item-surface] { border: 0 !important; padding: 0 !important; }`;
        case 'deephire-ink':
            return `
${rootSelector} .rf-deephire-header { border: 0 !important; border-bottom: 1px solid #c36d5e !important; padding: 0 0 16px !important; margin-bottom: 24px; }
${rootSelector} .rf-deephire-name { color: #162c55 !important; font-size: 34px !important; }
${rootSelector} .rf-deephire-avatar { width: 74px !important; height: 74px !important; border: 2px solid #c36d5e !important; border-radius: 2px !important; }
${rootSelector} .rf-template-section-heading {
  display: flex !important;
  gap: 9px !important;
  border: 0 !important;
  border-bottom: 1px dashed #d8b3aa !important;
  border-radius: 0 !important;
  background-color: transparent !important;
  color: #162c55 !important;
  font-size: 17px !important;
  letter-spacing: .08em !important;
  padding: 0 0 7px !important;
  margin-bottom: 12px;
}
${rootSelector} .rf-heading-marker { color: #c36d5e; }`;
        case 'deephire-retro':
            return `
${fullBleedSplitCss}
${rootSelector} .rf-template-sidebar { padding: 34px 30px 36px !important; }
${rootSelector} .rf-template-main { padding: 42px 38px 36px !important; }
${rootSelector} .rf-deephire-avatar { width: 72px !important; height: 72px !important; border-radius: 5px !important; }
${rootSelector} .rf-template-section-heading { width: fit-content; border: 0 !important; border-bottom: 2px solid #be9a72 !important; background: transparent !important; color: #6b5038 !important; font-size: 15px !important; letter-spacing: .05em !important; padding: 0 0 5px !important; margin-bottom: 12px; }`;
        case 'deephire-business':
            return `
${fullBleedSplitCss}
${rootSelector} .rf-template-sidebar { padding: 38px 32px 36px !important; border-right: 3px solid #f0c42b !important; }
${rootSelector} .rf-template-main { padding: 42px 38px 36px !important; }
${rootSelector} .rf-deephire-avatar { width: 80px !important; height: 80px !important; border: 4px solid #f0c42b !important; border-radius: 50% !important; }
${rootSelector} .rf-template-sidebar .rf-template-section-heading { color: #f6d250 !important; border-bottom-color: rgba(255,255,255,.2) !important; }
${rootSelector} .rf-template-main .rf-template-section-heading { border: 0 !important; border-left: 4px solid #f0c42b !important; background: transparent !important; color: #29418f !important; font-size: 16px !important; letter-spacing: .03em !important; padding: 1px 0 1px 10px !important; margin-bottom: 12px; }`;
        case 'deephire-fashion-black':
            return `
${rootSelector} { border-left: 3px solid #050505 !important; border-right: 3px solid #050505 !important; }
${rootSelector} .rf-deephire-header--banner {
  min-height: 176px;
  margin: 0 calc(var(--rf-template-inset-right) * -1) 18px calc(var(--rf-template-inset-left) * -1);
  padding-right: 34px !important;
  padding-bottom: 28px !important;
  padding-left: 34px !important;
  background-image: url("/resume-templates/deephire/deephire-fashion-rings.png") !important;
  background-position: right top !important;
  background-repeat: no-repeat !important;
}
${rootSelector} .rf-deephire-avatar { width: 72px !important; height: 72px !important; border-radius: 0 !important; margin-right: 18px; }
${rootSelector} .rf-deephire-name { font-size: 38px !important; }
${rootSelector} .rf-template-section-heading { border: 0 !important; border-bottom: 2px solid #111 !important; background: transparent !important; color: #111 !important; font-size: 18px !important; letter-spacing: .08em !important; padding: 0 0 7px !important; margin-bottom: 12px; }
${rootSelector} [data-rf-section-id="certifications"] [data-rf-item-surface] { display: inline-block; width: auto; background: #050505 !important; color: #fff !important; padding: 7px 10px !important; border-radius: 0 !important; }
${rootSelector} [data-rf-section-id="certifications"] [data-rf-item-surface] * { color: #fff !important; }`;
        case 'deephire-youth-energy':
            return `
${fullBleedSplitCss}
${rootSelector} .rf-template-split-page-header { padding: 34px 48px 28px; }
${rootSelector} .rf-deephire-header--youth { margin: 0; }
${rootSelector} .rf-deephire-header-inner { flex-direction: row-reverse; justify-content: flex-end !important; gap: 54px !important; }
${rootSelector} .rf-deephire-avatar { width: 190px !important; height: 190px !important; border-radius: 48% !important; }
${rootSelector} .rf-deephire-profile-copy { padding-top: 14px; }
${rootSelector} .rf-deephire-quote { margin-left: -30px; margin-bottom: -10px; }
${rootSelector} .rf-youth-accent { z-index: 0; right: -38px; bottom: -10px; width: 70px; height: 112px; object-fit: contain; }
${rootSelector} .rf-template-sidebar { padding: 26px 38px 36px 48px !important; border-right: 1px solid #ece7df !important; }
${rootSelector} .rf-template-main { padding: 26px 42px 36px !important; }
${rootSelector} .rf-template-section-heading { border: 0 !important; border-bottom: 1px solid #ece7df !important; background: transparent !important; color: #171717 !important; font-size: 16px !important; letter-spacing: 0 !important; padding: 0 0 8px !important; margin-bottom: 12px; }
${rootSelector} .rf-heading-marker { color: #f3c326; }`;
        case 'deephire-artistic':
            return `
${rootSelector} .rf-deephire-header {
  border: 0 !important;
  padding: 0 0 28px !important;
  margin-bottom: 18px;
}
${rootSelector} .rf-deephire-name { color: #213558 !important; font-size: 38px !important; }
${rootSelector} .rf-deephire-profile-copy::after {
  content: "";
  display: block;
  width: 70px;
  height: 5px;
  margin-top: 16px;
  background: #f0bd27;
}
${rootSelector} .rf-deephire-avatar {
  width: 78px !important;
  height: 78px !important;
  border: 3px solid #213558 !important;
  border-radius: 0 !important;
  box-shadow: 8px 8px 0 #f0bd27 !important;
}
${rootSelector} .rf-template-section-heading {
  display: inline-flex !important;
  align-items: center !important;
  width: fit-content !important;
  min-height: 36px;
  border: 0 !important;
  border-radius: 5px !important;
  background-color: #213558 !important;
  color: #ffffff !important;
  transform: skewX(-10deg);
  transform-origin: center;
  font-size: 18px !important;
  font-style: italic;
  font-weight: 800 !important;
  letter-spacing: .06em !important;
  line-height: 1.35 !important;
  padding: 6px 18px !important;
  margin-bottom: 12px;
}
${rootSelector} .rf-template-section-heading > span { transform: skewX(10deg); }
${rootSelector} [data-rf-section-id="certifications"] [data-rf-item-surface] { display: inline-block; width: auto; background: #f0bd27 !important; border-radius: 0 !important; padding: 6px 10px !important; }`;
        case 'deephire-soft-realm':
            return `
${fullBleedSplitCss}
${rootSelector} .rf-template-sidebar { padding: 0 28px 36px 20px !important; }
${rootSelector} .rf-template-main { padding: 38px 40px 36px !important; }
${rootSelector} .rf-deephire-header { min-height: 480px; margin: 0 -28px 26px -20px; padding: 40px 24px 18px 48px !important; background: url("/resume-templates/deephire/deephire-soft-realm-arc.png") left top / 220px 245px no-repeat; }
${rootSelector} .rf-deephire-avatar { width: 164px !important; height: 200px !important; border-radius: 0 0 50% 50% !important; }
${rootSelector} .rf-deephire-name { margin-top: 24px; font-size: 30px !important; }
${rootSelector} .rf-template-sidebar .rf-template-section-heading { border: 0 !important; border-bottom: 2px solid #f45bd4 !important; background: transparent !important; color: #171717 !important; font-size: 15px !important; letter-spacing: 0 !important; padding: 0 0 7px !important; margin-bottom: 14px; }
${rootSelector} .rf-template-main .rf-template-section-heading { border: 0 !important; border-left: 4px solid #f45bd4 !important; background: transparent !important; color: #171717 !important; font-size: 16px !important; letter-spacing: 0 !important; padding: 0 0 0 10px !important; margin-bottom: 12px; }
${rootSelector} .rf-heading-marker { display: none; }`;
        case 'deephire-forest':
            return `
${rootSelector} .rf-deephire-header--banner {
  min-height: 164px;
  margin: 0 calc(var(--rf-template-inset-right) * -1) 34px calc(var(--rf-template-inset-left) * -1);
  padding-right: 48px !important;
  padding-bottom: 28px !important;
  padding-left: 48px !important;
  background-image: url("/resume-templates/deephire/deephire-forest-band.png") !important;
  background-position: center !important;
  background-size: cover !important;
}
${rootSelector} .rf-deephire-header-inner { flex-direction: row-reverse; justify-content: flex-end !important; gap: 74px !important; }
${rootSelector} .rf-deephire-avatar { width: 108px !important; height: 108px !important; border-radius: 12px !important; }
${rootSelector} .rf-deephire-name { font-size: 30px !important; }
${rootSelector} [data-rf-section-surface] { display: grid; grid-template-columns: 142px minmax(0,1fr); column-gap: 22px; border-radius: 0 !important; padding: 0 0 16px !important; }
${rootSelector} .rf-template-section-heading { border: 0 !important; background: transparent !important; color: #1a1a1a !important; font-size: 16px !important; letter-spacing: 0 !important; padding: 0 !important; margin: 0; align-self: start; }`;
        case 'deephire-classic-elegance':
            return `
${rootSelector} .rf-deephire-header {
  min-height: 126px;
  margin: 0 calc(var(--rf-template-inset-right) * -1) 30px calc(var(--rf-template-inset-left) * -1);
  padding: 32px 48px 24px !important;
  border: 0 !important;
  background: #f1f0ff;
}
${rootSelector} .rf-deephire-avatar { width: 72px !important; height: 72px !important; border-radius: 50% !important; }
${rootSelector} .rf-template-content-layout { border-left: 1px solid #d7ccff; padding-left: 18px; }
${rootSelector} .rf-template-section-heading { position: relative; border: 0 !important; background: transparent !important; color: #271d3f !important; font-size: 16px !important; letter-spacing: 0 !important; padding: 0 0 7px !important; margin-bottom: 12px; }
${rootSelector} .rf-heading-marker { position: absolute; left: -24px; width: 9px; height: 9px; color: #8b6ce7; }`;
        case 'deephire-magazine-editorial':
            return `
${fullBleedSplitCss}
${rootSelector} { border-top: 4px solid #42c67c !important; border-bottom: 4px solid #42c67c !important; }
${rootSelector} .rf-template-sidebar { padding: 28px 30px 34px !important; border-right: 2px solid #42c67c !important; }
${rootSelector} .rf-template-main { padding: 34px 38px 34px !important; }
${rootSelector} .rf-deephire-avatar { width: 82px !important; height: 82px !important; border-radius: 50% !important; }
${rootSelector} .rf-template-section-heading {
  border: 0 !important;
  border-radius: 0 !important;
  background-color: transparent !important;
  color: #22965d !important;
  font-size: 16px !important;
  letter-spacing: 0 !important;
  padding: 0 0 8px !important;
  margin-bottom: 12px;
}
${rootSelector} .rf-heading-marker { color: #42c67c; }
${rootSelector} .rf-template-sidebar .rf-template-section-heading {
  display: inline-flex !important;
  align-items: center !important;
  width: fit-content !important;
  min-height: 32px;
  clip-path: polygon(0 0, 100% 0, calc(100% - 5px) 100%, 0 100%);
  background-color: #3eb97f !important;
  color: #ffffff !important;
  font-size: 18px !important;
  font-weight: 800 !important;
  line-height: 1.2 !important;
  padding: 5px 13px 5px 12px !important;
  margin-bottom: 14px;
}
${rootSelector} .rf-template-sidebar .rf-heading-marker { display: none; }
${rootSelector} .rf-template-date { border-radius: 999px; background: #42c67c; color: #fff !important; padding: 3px 10px; }
${rootSelector} .rf-template-sidebar .rf-template-date { background: transparent; color: inherit !important; padding: 0; }`;
        case 'deephire-forest-fresh':
            return `
${fullBleedSplitCss}
${rootSelector} .rf-template-sidebar { padding: 28px 30px 34px !important; border-right: 1px dashed #9cd9b7 !important; }
${rootSelector} .rf-template-main { padding: 34px 38px 34px !important; }
${rootSelector} .rf-deephire-avatar { width: 82px !important; height: 82px !important; border-radius: 50% !important; }
${rootSelector} .rf-template-section-heading { border: 0 !important; border-left: 4px solid #55b87c !important; border-radius: 0 !important; background: transparent !important; color: #2b6c47 !important; font-size: 16px !important; letter-spacing: 0 !important; padding: 0 0 0 9px !important; margin-bottom: 12px; }
${rootSelector} .rf-template-sidebar .rf-template-section-heading { border-left: 0 !important; padding-left: 0 !important; }
${rootSelector} .rf-heading-marker { color: #55b87c; }
${rootSelector} .rf-template-date { border-radius: 999px; background: #c8efd7; color: #276b45 !important; padding: 3px 10px; }`;
        case 'deephire-cyber-future':
            return `
${rootSelector},
${rootSelector} .text-gray-950,
${rootSelector} .text-gray-900,
${rootSelector} .text-gray-800,
${rootSelector} .text-gray-700,
${rootSelector} .text-gray-600,
${rootSelector} .text-gray-500 {
  color: var(--rf-template-page-fg) !important;
}
${rootSelector} .rf-deephire-header {
  min-height: 120px;
  border: 1px solid var(--rf-template-border);
  background-color: var(--rf-template-header-bg);
  padding: 26px !important;
  margin-bottom: 24px;
}
${rootSelector} .rf-deephire-avatar { width: 80px !important; height: 80px !important; border: 2px solid #17c3d6 !important; border-radius: 0 !important; }
${rootSelector} .rf-template-avatar-placeholder { background-color: #0b2039 !important; color: #e7f7ff !important; }
${rootSelector} .rf-cyber-avatar-square { width: 58px; height: 58px; color: #17c3d6; }
${rootSelector} .rf-cyber-avatar-square--back { right: -18px; top: -16px; opacity: .42; }
${rootSelector} .rf-cyber-avatar-square--front { right: -10px; top: -8px; opacity: .72; }
${rootSelector} .rf-template-section-heading {
  width: 100%;
  border: 0 !important;
  border-radius: 0 !important;
  background-color: transparent !important;
  color: var(--rf-template-border) !important;
  font-size: 16px !important;
  letter-spacing: .08em !important;
  padding: 2px 0 !important;
  margin-bottom: 12px;
}
${rootSelector} .rf-heading-marker { color: #17c3d6; }
${rootSelector} [data-rf-section-id="education"] [data-rf-item-surface],
${rootSelector} [data-rf-section-id="work"] [data-rf-item-surface],
${rootSelector} [data-rf-section-id="project"] [data-rf-item-surface] {
  border: 1px solid var(--rf-template-border);
  border-radius: 3px !important;
  background-color: transparent !important;
  padding: 10px !important;
}`;
        case 'deephire-renaissance':
            return `
${rootSelector},
${rootSelector} .text-gray-950,
${rootSelector} .text-gray-900,
${rootSelector} .text-gray-800,
${rootSelector} .text-gray-700,
${rootSelector} .text-gray-600,
${rootSelector} .text-gray-500 {
  color: var(--rf-template-page-fg) !important;
}
${rootSelector} .rf-deephire-header {
  border: 0 !important;
  border-bottom: 1px solid #d3a423 !important;
  padding: 6px 0 44px !important;
  margin-bottom: 68px;
}
${rootSelector} { background-image: url("/resume-templates/deephire/deephire-renaissance-band.png") !important; background-position: center top !important; background-size: 100% 14px !important; background-repeat: no-repeat !important; }
${rootSelector} .rf-deephire-name { font-size: 44px !important; color: #17243a !important; }
${rootSelector} .rf-deephire-avatar { width: 78px !important; height: 78px !important; border: 3px solid #a2201d !important; border-radius: 0 !important; box-shadow: 0 0 0 2px #d3a423 !important; }
${rootSelector} .rf-renaissance-avatar-diamond { z-index: 0; right: -28px; top: -22px; width: 66px; height: 66px; color: #d3a423; }
${rootSelector} .rf-template-section-heading { width: 58% !important; justify-content: center !important; gap: 18px !important; border: 0 !important; border-bottom: 1px solid #e0c66d !important; background: transparent !important; color: #9b1117 !important; font-size: 20px !important; letter-spacing: .08em !important; padding: 0 0 10px !important; margin: 0 auto 28px; }
${rootSelector} .rf-heading-marker { color: #c99d19; }
${rootSelector} [data-rf-section-id="certifications"] [data-rf-item-surface] { display: inline-block; width: auto; border: 1px solid #a2201d !important; background: #d7af24 !important; border-radius: 0 !important; padding: 7px 12px !important; }
${rootSelector} .rf-template-date { color: #7f1d1d !important; font-style: italic; font-weight: 700 !important; }`;
        case 'deephire-watercolor':
            return `
${rootSelector},
${rootSelector} .text-gray-950,
${rootSelector} .text-gray-900,
${rootSelector} .text-gray-800,
${rootSelector} .text-gray-700,
${rootSelector} .text-gray-600,
${rootSelector} .text-gray-500 {
  color: var(--rf-template-page-fg) !important;
}
${rootSelector} .rf-deephire-header {
  border: 0 !important;
  background-color: transparent !important;
  padding: 0 !important;
  margin-bottom: 70px;
}
${rootSelector} .rf-watercolor-name {
  color: #292929 !important;
  letter-spacing: 0 !important;
}
${rootSelector} .rf-watercolor-title,
${rootSelector} .rf-watercolor-contact-row {
  color: #33445f !important;
}
${rootSelector} .rf-deephire-header--watercolor > .flex > .min-w-0 {
  padding-top: 14px !important;
}
${rootSelector} .rf-watercolor-contact-row {
  font-size: 14px !important;
  line-height: 1.35 !important;
}
${rootSelector} .rf-watercolor-contact-item > svg {
  color: #78aefc !important;
  stroke-width: 1.8;
}
${rootSelector} .rf-deephire-avatar--watercolor {
  border: 3px solid #72a8ff !important;
  padding: 4px !important;
  box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.96), 0 0 0 5px rgba(122, 172, 255, 0.34) !important;
}
${rootSelector} .rf-watercolor-divider {
  display: block;
  width: calc(100% + 28px) !important;
  max-width: none;
  margin-top: 56px !important;
  margin-left: -14px;
  margin-right: -14px;
}
${rootSelector} .rf-watercolor-heading-dot {
  color: #ffb8dd !important;
  fill: currentColor;
  filter: drop-shadow(0 0 4px rgba(255, 174, 216, 0.9));
}
${rootSelector} [data-rf-section-surface],
${rootSelector} [data-rf-item-surface] {
  background-color: transparent !important;
}
${rootSelector} [data-rf-item-container="certifications"] {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 10px 12px !important;
}
${rootSelector} [data-rf-item-container="certifications"] > [data-rf-item-id] {
  flex: 0 0 auto;
}
${rootSelector} [data-rf-item-container="certifications"] [data-rf-item-surface] {
  border: 2px solid #72a8ff !important;
  border-radius: 10px !important;
  background-color: rgba(255, 255, 255, 0.46) !important;
  min-height: 34px;
  padding: 7px 12px !important;
}
${rootSelector} [data-rf-section-id="education"] [data-rf-item-id] {
  border-bottom: 1px solid rgba(181, 225, 201, 0.58);
  padding-bottom: 24px;
  margin-bottom: 24px;
}
${rootSelector} [data-rf-section-id="education"] [data-rf-item-id]:last-child {
  margin-bottom: 0;
}
${rootSelector} [data-rf-section-id="education"] [data-rf-item-surface] span:last-child {
  font-style: italic;
  font-weight: 700;
}`;
        case 'deephire-campus-youth':
            return `
${rootSelector} { background-image: url("/resume-templates/deephire/deephire-campus-divider.png") !important; background-position: center top !important; background-size: 100% 4px !important; background-repeat: no-repeat !important; }
${rootSelector} .rf-deephire-header {
  border: 0 !important;
  padding: 0 0 75px !important;
  margin-bottom: 42px;
  background: url("/resume-templates/deephire/deephire-campus-divider.png") center bottom / 100% 5px no-repeat;
}
${rootSelector} .rf-deephire-name { font-size: 38px !important; }
${rootSelector} .rf-deephire-avatar { width: 80px !important; height: 80px !important; border: 3px solid #5e8cff !important; border-radius: 12px !important; }
${rootSelector} .rf-campus-avatar-dot { z-index: 2; right: -16px; top: -14px; width: 16px; height: 16px; color: #85e7bb; }
${rootSelector} .rf-template-section-heading { width: fit-content !important; gap: 9px !important; border: 0 !important; border-radius: 0 !important; background: rgba(111,145,255,.14) !important; color: #27364e !important; font-size: 18px !important; letter-spacing: 0 !important; padding: 2px 12px 2px 0 !important; margin-bottom: 22px; }
${rootSelector} .rf-heading-marker { color: #6590ff; }
${rootSelector} [data-rf-section-id="certifications"] [data-rf-item-surface] { display: inline-block; width: auto; border: 2px solid #6590ff !important; border-radius: 12px !important; padding: 7px 12px !important; }
${rootSelector} [data-rf-section-id="education"] [data-rf-item-id] { border-bottom: 1px solid #eceff5; padding-bottom: 22px; margin-bottom: 22px; }
${rootSelector} [data-rf-section-id="education"] .rf-template-date { color: #5d86ff !important; font-weight: 700 !important; }`;
        default:
            return '';
    }
};

export const buildDeepHirePreviewStyleOverrides = (
    activeTemplate: ResumeTemplateDefinition,
    topPaddingPx: number
): React.CSSProperties => {
    if (!isDeepHireTemplate(activeTemplate)) {
        return {};
    }

    const tokens = activeTemplate.visualTokens;
    const defaultInsetPx = DEFAULT_EDITOR_TOP_PADDING_PX;
    const configuredInsets = tokens?.pageInsets;
    const adjustedTopInsetPx = Math.max(
        0,
        (configuredInsets?.top ?? defaultInsetPx)
        + normalizeTopPaddingPx(topPaddingPx)
        - DEFAULT_EDITOR_TOP_PADDING_PX
    );
    const insets = {
        top: Number(adjustedTopInsetPx.toFixed(2)),
        right: configuredInsets?.right ?? defaultInsetPx,
        bottom: configuredInsets?.bottom ?? defaultInsetPx,
        left: configuredInsets?.left ?? defaultInsetPx,
    };
    const pageBackground = tokens?.pageBackground ?? DEFAULT_PAGE_BACKGROUND;
    const pageForeground = tokens?.pageForeground ?? DEFAULT_PAGE_FOREGROUND;
    const borderColor = tokens?.borderColor ?? 'var(--rf-accent-border)';
    const style: DeepHirePreviewCssProperties = {
        background: activeTemplate.id === 'deephire-watercolor'
            ? `${pageBackground} url("/resume-templates/deephire/deephire-watercolor-wash.webp") center top / 100% 100% no-repeat`
            : pageBackground,
        color: pageForeground,
        fontFamily: tokens?.fontFamily,
        paddingTop: `${insets.top}px`,
        paddingRight: `${insets.right}px`,
        paddingBottom: `${insets.bottom}px`,
        paddingLeft: `${insets.left}px`,
        '--rf-template-top-padding': `${insets.top}px`,
        '--rf-template-inset-top': `${insets.top}px`,
        '--rf-template-inset-right': `${insets.right}px`,
        '--rf-template-inset-bottom': `${insets.bottom}px`,
        '--rf-template-inset-left': `${insets.left}px`,
        '--rf-template-page-bg': pageBackground,
        '--rf-template-page-fg': pageForeground,
        '--rf-template-header-bg': tokens?.headerBackground ?? 'var(--rf-accent-color)',
        '--rf-template-header-fg': tokens?.headerForeground ?? '#ffffff',
        '--rf-template-sidebar-bg': tokens?.sidebarBackground ?? 'var(--rf-accent-soft-bg)',
        '--rf-template-sidebar-fg': tokens?.sidebarForeground ?? pageForeground,
        '--rf-template-main-bg': tokens?.mainBackground ?? pageBackground,
        '--rf-template-border': borderColor,
    };

    if (activeTemplate.renderVariant === 'art-frame') {
        style.border = `8px solid ${tokens?.borderColor ?? '#1d3557'}`;
    } else if (activeTemplate.renderVariant === 'dark-technical') {
        style.border = `1px solid ${tokens?.borderColor ?? '#17c3d6'}`;
    }

    return style;
};

export const buildDeepHireTemplateCss = (
    activeTemplate: ResumeTemplateDefinition,
    previewScope: string
) => {
    if (!isDeepHireTemplate(activeTemplate)) {
        return '';
    }

    const escapedScope = escapeCssAttributeValue(previewScope);
    const escapedStyle = escapeCssAttributeValue(activeTemplate.visualStyle);
    const rootSelector = `.a4-preview[data-rf-preview-scope="${escapedScope}"][data-rf-template-style="${escapedStyle}"]`;
    const baseCss = `
${rootSelector} {
  background-color: var(--rf-template-page-bg);
  color: var(--rf-template-page-fg);
}
${rootSelector} .rf-template-section-heading {
  display: flex;
  align-items: center;
  min-width: 0;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.12em;
  line-height: 1.35;
  text-transform: none;
}
${rootSelector} .rf-template-sidebar {
  background-color: var(--rf-template-sidebar-bg);
  color: var(--rf-template-sidebar-fg);
}
${rootSelector} .rf-template-main {
  background-color: var(--rf-template-main-bg);
  color: var(--rf-template-page-fg);
}`;

    return [
        baseCss,
        buildSectionVariantCss(rootSelector, activeTemplate.sectionVariant),
        buildTemplateSpecificCss(activeTemplate, rootSelector),
    ].filter(Boolean).join('\n');
};

export const resolveDeepHireSplitGridTemplateColumns = (
    activeTemplate: ResumeTemplateDefinition
): string | undefined => {
    if (!isDeepHireTemplate(activeTemplate) || activeTemplate.layoutKind !== 'split') {
        return undefined;
    }
    const sidebarRatio = clampSidebarRatio(activeTemplate.visualTokens?.sidebarRatio);
    const mainRatio = 1 - sidebarRatio;
    return `minmax(0, ${sidebarRatio.toFixed(3)}fr) minmax(0, ${mainRatio.toFixed(3)}fr)`;
};

export const buildDeepHireSplitSidebarStyle = (
    activeTemplate: ResumeTemplateDefinition
): React.CSSProperties => {
    if (!isDeepHireTemplate(activeTemplate) || activeTemplate.layoutKind !== 'split') {
        return {};
    }
    const tokens = activeTemplate.visualTokens;
    return {
        backgroundColor: tokens?.sidebarBackground ?? 'var(--rf-accent-soft-bg)',
        color: tokens?.sidebarForeground ?? 'var(--rf-accent-text)',
        borderRight: 'none',
    };
};

export const buildDeepHireSplitMainStyle = (
    activeTemplate: ResumeTemplateDefinition
): React.CSSProperties => {
    if (!isDeepHireTemplate(activeTemplate) || activeTemplate.layoutKind !== 'split') {
        return {};
    }
    const tokens = activeTemplate.visualTokens;
    return {
        backgroundColor: tokens?.mainBackground ?? tokens?.pageBackground ?? DEFAULT_PAGE_BACKGROUND,
        color: tokens?.pageForeground ?? DEFAULT_PAGE_FOREGROUND,
    };
};

export const usesLightDeepHireSidebar = (activeTemplate: ResumeTemplateDefinition) => {
    if (!isDeepHireTemplate(activeTemplate) || activeTemplate.layoutKind !== 'split') {
        return false;
    }
    const foregroundLuminance = resolveRelativeLuminance(activeTemplate.visualTokens?.sidebarForeground);
    const backgroundLuminance = resolveRelativeLuminance(activeTemplate.visualTokens?.sidebarBackground);
    return foregroundLuminance !== null
        && foregroundLuminance >= 0.72
        && (backgroundLuminance === null || backgroundLuminance <= 0.45);
};

import React from 'react';
import {
    RESUME_THEME_COLOR_PRESETS,
    type ResumeThemeColorPresetId,
} from '../../../constants/resumeTemplates';
import {
    FONT_SIZE_OPTIONS,
    ITEM_SPACING_SELECT_OPTIONS,
    LINE_HEIGHT_OPTIONS,
    MAX_ITEM_SPACING_EM,
    SECTION_SPACING_OPTIONS,
    TOP_PADDING_MIN_PX,
    TOP_PADDING_SELECT_OPTIONS,
    TOP_PADDING_SLIDER_MAX,
} from '../layoutUtils';
import {
    FONT_SIZE_MAX,
    FONT_SIZE_MIN,
    FONT_SIZE_STEP,
    LINE_HEIGHT_MAX,
    LINE_HEIGHT_MIN,
    LINE_HEIGHT_STEP,
    SMART_PAGE_ITEM_SPACING_MIN,
    SMART_PAGE_ITEM_SPACING_STEP,
    SMART_PAGE_TOP_PADDING_STEP_PX,
} from '../constants';
import LayoutAdjustToolbar from './LayoutAdjustToolbar';

export type ResumeEditorLayoutAdjustPanelProps = {
    isOpen: boolean;
    lineHeight: number;
    fontSize: number;
    topPaddingPx: number;
    sectionSpacingKey: number;
    itemSpacingEm: number;
    themeColorPresetId: ResumeThemeColorPresetId;
    onLineHeightChange: (value: number) => void;
    onFontSizeChange: (value: number) => void;
    onTopPaddingChange: (value: number) => void;
    onSectionSpacingChange: (value: number) => void;
    onItemSpacingChange: (value: number) => void;
    onThemeColorChange: (value: ResumeThemeColorPresetId) => void;
};

const ResumeEditorLayoutAdjustPanel: React.FC<ResumeEditorLayoutAdjustPanelProps> = ({
    isOpen,
    lineHeight,
    fontSize,
    topPaddingPx,
    sectionSpacingKey,
    itemSpacingEm,
    themeColorPresetId,
    onLineHeightChange,
    onFontSizeChange,
    onTopPaddingChange,
    onSectionSpacingChange,
    onItemSpacingChange,
    onThemeColorChange,
}) => {
    if (!isOpen) {
        return null;
    }

    return (
        <LayoutAdjustToolbar
            lineHeight={lineHeight}
            fontSize={fontSize}
            topPaddingPx={topPaddingPx}
            sectionSpacingKey={sectionSpacingKey}
            itemSpacingEm={itemSpacingEm}
            lineHeightOptions={LINE_HEIGHT_OPTIONS}
            fontSizeOptions={FONT_SIZE_OPTIONS}
            topPaddingOptions={TOP_PADDING_SELECT_OPTIONS}
            sectionSpacingOptions={SECTION_SPACING_OPTIONS}
            itemSpacingOptions={ITEM_SPACING_SELECT_OPTIONS}
            lineHeightSlider={{
                min: LINE_HEIGHT_MIN,
                max: LINE_HEIGHT_MAX,
                step: LINE_HEIGHT_STEP,
            }}
            fontSizeSlider={{
                min: FONT_SIZE_MIN,
                max: FONT_SIZE_MAX,
                step: FONT_SIZE_STEP,
            }}
            topPaddingSlider={{
                min: TOP_PADDING_MIN_PX,
                max: TOP_PADDING_SLIDER_MAX,
                step: SMART_PAGE_TOP_PADDING_STEP_PX,
            }}
            sectionSpacingSlider={{
                min: 2,
                max: 12,
                step: 1,
            }}
            itemSpacingSlider={{
                min: SMART_PAGE_ITEM_SPACING_MIN,
                max: MAX_ITEM_SPACING_EM,
                step: SMART_PAGE_ITEM_SPACING_STEP,
            }}
            themeColorPresetId={themeColorPresetId}
            themeColorOptions={RESUME_THEME_COLOR_PRESETS}
            onLineHeightChange={onLineHeightChange}
            onFontSizeChange={onFontSizeChange}
            onTopPaddingChange={onTopPaddingChange}
            onSectionSpacingChange={onSectionSpacingChange}
            onItemSpacingChange={onItemSpacingChange}
            onThemeColorChange={onThemeColorChange}
        />
    );
};

export default ResumeEditorLayoutAdjustPanel;

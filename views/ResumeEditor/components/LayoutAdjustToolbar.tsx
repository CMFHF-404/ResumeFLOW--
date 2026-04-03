import React, { useMemo, useState } from 'react';
import { Check, Palette } from 'lucide-react';
import type { ResumeThemeColorDefinition, ResumeThemeColorPresetId } from '../../../constants/resumeTemplates';

type NumericOption = {
    label: string;
    value: number;
};

type SliderConfig = {
    min: number;
    max: number;
    step: number;
};

type LayoutAdjustToolbarProps = {
    lineHeight: number;
    fontSize: number;
    topPaddingPx: number;
    sectionSpacingKey: number;
    itemSpacingEm: number;
    themeColorPresetId: ResumeThemeColorPresetId;
    themeColorOptions: readonly ResumeThemeColorDefinition[];
    lineHeightOptions: NumericOption[];
    fontSizeOptions: NumericOption[];
    topPaddingOptions: NumericOption[];
    sectionSpacingOptions: NumericOption[];
    itemSpacingOptions: NumericOption[];
    lineHeightSlider: SliderConfig;
    fontSizeSlider: SliderConfig;
    topPaddingSlider: SliderConfig;
    sectionSpacingSlider: SliderConfig;
    itemSpacingSlider: SliderConfig;
    onLineHeightChange: (value: number) => void;
    onFontSizeChange: (value: number) => void;
    onTopPaddingChange: (value: number) => void;
    onSectionSpacingChange: (value: number) => void;
    onItemSpacingChange: (value: number) => void;
    onThemeColorChange: (value: ResumeThemeColorPresetId) => void;
};

type ControlDescriptor = {
    key: string;
    label: string;
    unit: string;
    value: number;
    options: NumericOption[];
    slider: SliderConfig;
    onChange: (value: number) => void;
};

const clampValue = (value: number, config: SliderConfig) => {
    return Math.min(config.max, Math.max(config.min, value));
};

const resolveFallbackValue = (config: SliderConfig, options: NumericOption[]) => (
    options[0]?.value
    ?? (Number.isFinite(config.min) ? config.min : 0)
);

const normalizeControlValue = (
    value: number | undefined,
    config: SliderConfig,
    options: NumericOption[]
) => {
    if (!Number.isFinite(value)) {
        return resolveFallbackValue(config, options);
    }
    return clampValue(value, config);
};

const formatInputValue = (value: number | undefined, step: number) => {
    if (!Number.isFinite(value)) {
        return '';
    }
    if (Number.isInteger(value)) {
        return String(value);
    }
    if (Math.abs(value - Number(value.toFixed(1))) < 0.001 && step >= 0.1) {
        return value.toFixed(1);
    }
    if (Math.abs(value - Number(value.toFixed(2))) < 0.001) {
        return value.toFixed(2);
    }
    return value.toFixed(3);
};

const resolveNearestOptionValue = (value: number, options: NumericOption[]) => (
    options.reduce((nearest, option) => {
        const nearestDistance = Math.abs(nearest - value);
        const candidateDistance = Math.abs(option.value - value);
        if (candidateDistance < nearestDistance) {
            return option.value;
        }
        return nearest;
    }, options[0]?.value ?? value)
);

const resolveSelectedOptionIndex = (value: number, options: NumericOption[]) => {
    const exactIndex = options.findIndex((option) => option.value === value);
    if (exactIndex >= 0) {
        return exactIndex;
    }
    const nearestValue = resolveNearestOptionValue(value, options);
    return options.findIndex((option) => option.value === nearestValue);
};

const DesktopSelectField: React.FC<{ control: ControlDescriptor }> = ({ control }) => (
    <label className="flex min-w-0 flex-col gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">
            {control.label}
        </span>
        <select
            value={String(control.value)}
            onChange={(event) => control.onChange(Number(event.target.value))}
            className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
        >
            {control.options.map((option) => (
                <option key={`${control.key}-${option.value}`} value={option.value}>
                    {option.label}
                </option>
            ))}
        </select>
    </label>
);

const MobileSliderField: React.FC<{ control: ControlDescriptor }> = ({ control }) => {
    const sliderOptions = [...control.options].sort((left, right) => left.value - right.value);
    const normalizedValue = normalizeControlValue(control.value, control.slider, sliderOptions);

    return (
        <div className="rounded-2xl border border-gray-200 bg-white/92 p-3 shadow-sm dark:border-gray-800 dark:bg-gray-900/85">
            <div className="flex items-center gap-3">
                <input
                    type="range"
                    min={0}
                    max={Math.max(sliderOptions.length - 1, 0)}
                    step={1}
                    value={Math.max(resolveSelectedOptionIndex(normalizedValue, sliderOptions), 0)}
                    onChange={(event) => {
                        const nextOption = sliderOptions[Number(event.target.value)];
                        if (!nextOption) {
                            return;
                        }
                        control.onChange(nextOption.value);
                    }}
                    className="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-gray-200 accent-primary dark:bg-gray-700"
                />
                <input
                    type="number"
                    min={control.slider.min}
                    max={control.slider.max}
                    step={control.slider.step}
                    value={formatInputValue(normalizedValue, control.slider.step)}
                    onChange={(event) => {
                        const next = Number(event.target.value);
                        if (Number.isNaN(next)) {
                            return;
                        }
                        control.onChange(resolveNearestOptionValue(clampValue(next, control.slider), control.options));
                    }}
                    className="w-20 shrink-0 rounded-xl border border-gray-200 bg-white px-2.5 py-2 text-right text-sm font-medium text-gray-700 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                />
            </div>
        </div>
    );
};

const ThemeSwatch: React.FC<{
    color: ResumeThemeColorDefinition;
    isSelected: boolean;
    onClick: () => void;
}> = ({ color, isSelected, onClick }) => (
    <button
        type="button"
        onClick={onClick}
        className={[
            'flex items-center gap-2 rounded-xl border px-3 py-2 text-left transition-all',
            isSelected
                ? 'border-gray-900 bg-gray-900 text-white shadow-sm dark:border-white dark:bg-white dark:text-gray-900'
                : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200',
        ].join(' ')}
    >
        <span
            className="inline-flex h-4 w-4 shrink-0 rounded-full border border-black/10"
            style={{ backgroundColor: color.accentColor }}
        />
        <span className="text-xs font-semibold">{color.name}</span>
        {isSelected ? <Check className="ml-auto h-3.5 w-3.5" /> : null}
    </button>
);

const ThemeColorDesktopField: React.FC<{
    value: ResumeThemeColorPresetId;
    options: readonly ResumeThemeColorDefinition[];
    onChange: (value: ResumeThemeColorPresetId) => void;
}> = ({ value, options, onChange }) => {
    const [isOpen, setIsOpen] = useState(false);
    const activeColor = options.find((item) => item.id === value) ?? options[0];

    return (
        <div className="relative">
            <label className="flex min-w-0 flex-col gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">
                    主题颜色
                </span>
                <button
                    type="button"
                    onClick={() => setIsOpen((open) => !open)}
                    className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 outline-none transition hover:border-gray-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                >
                    <Palette className="h-4 w-4 text-gray-500" />
                    <span
                        className="inline-flex h-4 w-4 rounded-full border border-black/10"
                        style={{ backgroundColor: activeColor?.accentColor }}
                    />
                    <span>{activeColor?.name ?? '主题色'}</span>
                </button>
            </label>
            {isOpen ? (
                <div className="absolute left-0 top-[calc(100%+10px)] z-20 w-[280px] rounded-2xl border border-gray-200 bg-white p-3 shadow-xl dark:border-gray-700 dark:bg-gray-900">
                    <div className="mb-2 text-xs font-semibold text-gray-500 dark:text-gray-400">选择主题色</div>
                    <div className="grid grid-cols-2 gap-2">
                        {options.map((color) => (
                            <ThemeSwatch
                                key={color.id}
                                color={color}
                                isSelected={color.id === value}
                                onClick={() => {
                                    onChange(color.id);
                                    setIsOpen(false);
                                }}
                            />
                        ))}
                    </div>
                </div>
            ) : null}
        </div>
    );
};

const ThemeColorMobileField: React.FC<{
    value: ResumeThemeColorPresetId;
    options: readonly ResumeThemeColorDefinition[];
    onChange: (value: ResumeThemeColorPresetId) => void;
}> = ({ value, options, onChange }) => (
    <div className="rounded-2xl border border-gray-200 bg-white/92 p-3 shadow-sm dark:border-gray-800 dark:bg-gray-900/85">
        <div className="mb-3 flex items-center gap-2">
            <Palette className="h-4 w-4 text-gray-500" />
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-500 dark:text-gray-400">
                主题颜色
            </span>
        </div>
        <div className="grid grid-cols-2 gap-2">
            {options.map((color) => (
                <ThemeSwatch
                    key={color.id}
                    color={color}
                    isSelected={color.id === value}
                    onClick={() => onChange(color.id)}
                />
            ))}
        </div>
    </div>
);

const LayoutAdjustToolbar: React.FC<LayoutAdjustToolbarProps> = ({
    lineHeight,
    fontSize,
    topPaddingPx,
    sectionSpacingKey,
    itemSpacingEm,
    themeColorPresetId,
    themeColorOptions,
    lineHeightOptions,
    fontSizeOptions,
    topPaddingOptions,
    sectionSpacingOptions,
    itemSpacingOptions,
    lineHeightSlider,
    fontSizeSlider,
    topPaddingSlider,
    sectionSpacingSlider,
    itemSpacingSlider,
    onLineHeightChange,
    onFontSizeChange,
    onTopPaddingChange,
    onSectionSpacingChange,
    onItemSpacingChange,
    onThemeColorChange,
}) => {
    const controls: ControlDescriptor[] = [
        {
            key: 'line-height',
            label: '行间高',
            unit: '',
            value: lineHeight,
            options: lineHeightOptions,
            slider: lineHeightSlider,
            onChange: onLineHeightChange,
        },
        {
            key: 'font-size',
            label: '字体大小',
            unit: 'px',
            value: fontSize,
            options: fontSizeOptions,
            slider: fontSizeSlider,
            onChange: onFontSizeChange,
        },
        {
            key: 'page-padding',
            label: '页边距',
            unit: 'px',
            value: topPaddingPx,
            options: topPaddingOptions,
            slider: topPaddingSlider,
            onChange: onTopPaddingChange,
        },
        {
            key: 'section-spacing',
            label: '模块间距',
            unit: '',
            value: sectionSpacingKey,
            options: sectionSpacingOptions,
            slider: sectionSpacingSlider,
            onChange: onSectionSpacingChange,
        },
        {
            key: 'item-spacing',
            label: '条目间距',
            unit: '',
            value: itemSpacingEm,
            options: itemSpacingOptions,
            slider: itemSpacingSlider,
            onChange: onItemSpacingChange,
        },
    ].map((control) => ({
        ...control,
        value: normalizeControlValue(control.value, control.slider, control.options),
    }));
    const [activeMobileControlKey, setActiveMobileControlKey] = useState<'theme-color' | string>('theme-color');
    const activeMobileControl = useMemo(
        () => controls.find((control) => control.key === activeMobileControlKey) ?? controls[0],
        [activeMobileControlKey, controls]
    );
    const activeThemeColor = themeColorOptions.find((item) => item.id === themeColorPresetId) ?? themeColorOptions[0];

    return (
        <section className="relative border-b border-border-light bg-white/92 backdrop-blur dark:border-border-dark dark:bg-surface-dark/92 md:z-30">
            <div className="hidden px-6 py-4 md:block">
                <div className="mb-3 flex items-center justify-between gap-4">
                    <div>
                        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">手动调节工具栏</h3>
                        <p className="text-xs text-gray-500 dark:text-gray-400">调整后会立即同步到右侧简历预览</p>
                    </div>
                </div>
                <div className="grid grid-cols-6 gap-3">
                    <ThemeColorDesktopField
                        value={themeColorPresetId}
                        options={themeColorOptions}
                        onChange={onThemeColorChange}
                    />
                    {controls.map((control) => (
                        <DesktopSelectField key={control.key} control={control} />
                    ))}
                </div>
            </div>
            <div className="space-y-3 px-4 py-4 md:hidden">
                <div>
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-white">手动调节工具栏</h3>
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">点击参数按钮后展开对应滑条，预览会实时刷新</p>
                </div>
                <div className="-mx-1 overflow-x-auto pb-1">
                    <div className="flex min-w-max gap-2 px-1">
                        <button
                            type="button"
                            onClick={() => setActiveMobileControlKey('theme-color')}
                            className={[
                                'inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold transition-colors',
                                activeMobileControlKey === 'theme-color'
                                    ? 'border-primary bg-primary text-white shadow-sm'
                                    : 'border-gray-200 bg-white text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300',
                            ].join(' ')}
                            aria-pressed={activeMobileControlKey === 'theme-color'}
                        >
                            <Palette className="h-3.5 w-3.5" />
                            <span>主题颜色</span>
                            <span
                                className={[
                                    'inline-flex h-4 w-4 rounded-full border border-white/30',
                                    activeMobileControlKey === 'theme-color' ? '' : 'border-black/10',
                                ].join(' ')}
                                style={{ backgroundColor: activeThemeColor?.accentColor }}
                            />
                        </button>
                        {controls.map((control) => {
                            const isActive = control.key === activeMobileControl?.key;
                            return (
                                <button
                                    key={control.key}
                                    type="button"
                                    onClick={() => setActiveMobileControlKey(control.key)}
                                    className={[
                                        'inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold transition-colors',
                                        isActive
                                            ? 'border-primary bg-primary text-white shadow-sm'
                                            : 'border-gray-200 bg-white text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300',
                                    ].join(' ')}
                                    aria-pressed={isActive}
                                >
                                    <span>{control.label}</span>
                                    <span className={[
                                        'rounded-full px-2 py-0.5 text-[10px] font-bold',
                                        isActive
                                            ? 'bg-white/20 text-white'
                                            : 'bg-primary/10 text-primary',
                                    ].join(' ')}>
                                        {formatInputValue(control.value, control.slider.step)}
                                        {control.unit}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </div>
                {activeMobileControlKey === 'theme-color' ? (
                    <ThemeColorMobileField
                        value={themeColorPresetId}
                        options={themeColorOptions}
                        onChange={onThemeColorChange}
                    />
                ) : activeMobileControl ? (
                    <MobileSliderField control={activeMobileControl} />
                ) : null}
            </div>
        </section>
    );
};

export default LayoutAdjustToolbar;

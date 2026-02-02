import React, { forwardRef } from 'react';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import { ChevronDown, Calendar, X } from 'lucide-react';
import { zhCN } from 'date-fns/locale';
import { format } from 'date-fns';

interface MonthPickerProps {
  value: string; // Format: YYYY.MM or "至今" or empty
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  allowPresent?: boolean; // Whether to show "至今" option/toggle logic
  isPresent?: boolean;    // External control for "Present" state if needed
  className?: string;
  minDate?: string;       // Format: YYYY.MM
  maxDate?: string;       // Format: YYYY.MM
}

const MonthPicker = forwardRef<HTMLDivElement, MonthPickerProps>(({
  value,
  onChange,
  placeholder = "选择月份",
  disabled = false,
  allowPresent = false,
  isPresent = false,
  className = "",
  minDate,
  maxDate
}, ref) => {

  const parseMonthValue = (rawValue?: string) => {
    if (!rawValue) return null;
    const trimmed = rawValue.trim();
    if (!trimmed || trimmed === '至今' || trimmed === 'Present') return null;

    if (/^\d{4}$/.test(trimmed)) {
      return new Date(Number(trimmed), 0, 1);
    }

    const normalized = trimmed.replace('.', '-');
    const parts = normalized.split('-');
    if (parts.length < 2) return null;

    const year = Number(parts[0]);
    const month = Number(parts[1]);
    if (!Number.isFinite(year) || !Number.isFinite(month)) return null;
    if (month < 1 || month > 12) return null;

    return new Date(year, month - 1, 1);
  };

  // Parse string value (YYYY.MM / YYYY-MM / YYYY-MM-DD) to Date object
  const selectedDate = React.useMemo(() => parseMonthValue(value), [value]);

  const minDateObj = React.useMemo(() => parseMonthValue(minDate) ?? undefined, [minDate]);
  const maxDateObj = React.useMemo(() => parseMonthValue(maxDate) ?? undefined, [maxDate]);

  const handleChange = (date: Date | null) => {
    if (date) {
      const formatted = format(date, 'yyyy.MM');
      onChange(formatted);
    } else {
      onChange(''); // Clearing returns empty string
    }
  };

  const handlePresentClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange('至今');
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange('');
  };

  const CustomInput = forwardRef<HTMLDivElement, any>(({ value: displayValue, onClick }, inputRef) => {
    const isPresentValue = value === '至今' || value === 'Present';
    const showValue = isPresentValue ? '至今' : (selectedDate ? format(selectedDate, 'yyyy.MM') : '');

    return (
      <div
        className={`relative group cursor-pointer h-full ${className}`}
        onClick={disabled ? undefined : onClick}
        ref={inputRef}
      >
        <div className={`
          fluid-input flex items-center justify-between w-full h-full
          ${disabled ? 'opacity-60 cursor-not-allowed' : ''}
        `}>
          <div className="flex items-center gap-2 overflow-hidden flex-1 shrink-0">
            <Calendar className={`w-4 h-4 shrink-0 ${showValue ? 'text-gray-700 dark:text-gray-300' : 'text-gray-400'}`} />
            <span className={`block truncate ${showValue ? 'text-gray-900 dark:text-white font-medium' : 'text-gray-400'}`}>
              {showValue || placeholder}
            </span>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {/* "Present" Button for End Date */}
            {allowPresent && !showValue && !disabled && (
              <button
                type="button"
                onClick={handlePresentClick}
                className="text-xs font-medium text-primary hover:text-primary-dark px-2 py-1 rounded hover:bg-primary/5 transition-colors mr-1 shrink-0"
              >
                设为至今
              </button>
            )}

            {/* Clear Button */}
            {(showValue) && !disabled && (
              <button
                type="button"
                onClick={handleClear}
                className="p-1 rounded-full text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors opacity-0 group-hover:opacity-100 shrink-0"
              >
                <X className="w-3 h-3" />
              </button>
            )}

            <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />
          </div>
        </div>
      </div>
    );
  });

  return (
    <div className="w-full relative" ref={ref}>
      <DatePicker
        selected={selectedDate}
        onChange={handleChange}
        dateFormat="yyyy.MM"
        showMonthYearPicker
        customInput={<CustomInput />}
        disabled={disabled}
        locale={zhCN}
        preventOpenOnFocus // Prevent auto open when tabbing
        minDate={minDateObj}
        maxDate={maxDateObj}
        calendarClassName="!font-sans shadow-xl border border-gray-100 dark:border-gray-700 rounded-xl overflow-hidden"
        showPopperArrow={false}
        popperPlacement="bottom-end"
      />
      {/* Global styles override for react-datepicker to match theme */}
      <style>{`
        .react-datepicker {
          border: none;
          font-family: inherit;
        }
        .react-datepicker__header {
          background-color: transparent;
          border-bottom: 1px solid #f3f4f6;
          padding-top: 1rem;
        }
        .dark .react-datepicker__header {
          border-bottom-color: #374151;
          background-color: #1f2937;
        }
        .react-datepicker__triangle {
          display: none;
        }
        .react-datepicker__month-wrapper {
          display: flex;
          justify-content: space-around;
          padding: 0.5rem;
        }
        .react-datepicker__month-text {
          padding: 0.5rem;
          border-radius: 0.5rem;
          width: 3.5rem;
          font-size: 0.875rem;
        }
        .react-datepicker__month-text:hover {
          background-color: #f3f4f6;
        }
        .dark .react-datepicker__month-text:hover {
          background-color: #374151;
        }
        .react-datepicker__month-text--keyboard-selected {
          background-color: var(--color-primary, #2563eb);
          color: white;
        }
        .react-datepicker__month-text--selected {
          background-color: var(--color-primary, #2563eb);
          color: white;
        }
        .dark .react-datepicker {
          background-color: #1f2937;
          color: white;
        }
        .dark .react-datepicker__current-month {
          color: white;
        }
        .dark .react-datepicker__month-text {
          color: #d1d5db;
        }
        .dark .react-datepicker__month-text--selected {
          color: white;
        }
      `}</style>
    </div>
  );
});

export default MonthPicker;

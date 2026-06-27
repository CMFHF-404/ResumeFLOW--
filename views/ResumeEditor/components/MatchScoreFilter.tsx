import React, { useEffect, useRef, useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';

interface MatchScoreFilterProps {
    value: number;
    onChange: (value: number) => void;
    disabled?: boolean;
}

const MatchScoreFilter: React.FC<MatchScoreFilterProps> = ({ value, onChange, disabled = false }) => {
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isOpen]);

    useEffect(() => {
        if (disabled) {
            setIsOpen(false);
        }
    }, [disabled]);

    return (
        <div className="relative inline-block" ref={containerRef}>
            <button
                type="button"
                onClick={() => {
                    if (disabled) {
                        return;
                    }
                    setIsOpen(!isOpen);
                }}
                disabled={disabled}
                className={`inline-flex whitespace-nowrap items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-semibold transition-colors border ${
                    disabled
                        ? 'cursor-not-allowed border-gray-200 bg-gray-100 text-gray-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-500'
                        : isOpen || value > 0
                        ? 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100 dark:bg-blue-900/40 dark:text-blue-400 dark:border-blue-800/60'
                        : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700'
                }`}
                title={disabled ? '请先确认或撤销当前润色结果' : '调整匹配度筛选'}
            >
                <SlidersHorizontal className="w-3.5 h-3.5" />
                <span>{value > 0 ? `≥ ${value}%` : '筛选'}</span>
            </button>

            {isOpen && !disabled && (
                <div className="absolute right-0 top-full mt-2 w-64 rounded-lg border border-gray-200 bg-white p-3 shadow-lg z-50 dark:border-gray-700 dark:bg-gray-800 animate-in fade-in slide-in-from-top-2 duration-200">
                    <div className="flex items-center justify-between mb-3">
                        <span className="text-xs font-semibold text-gray-700 dark:text-gray-200">隐藏匹配度小于</span>
                        <span className="text-xs font-mono font-bold text-blue-600 dark:text-blue-400">{value}%</span>
                    </div>
                    <div className="px-1">
                        <input
                            type="range"
                            min="0"
                            max="100"
                            step="1"
                            value={value}
                            onChange={(e) => onChange(Number(e.target.value))}
                            className="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700 accent-blue-600"
                        />
                    </div>
                    <div className="flex justify-between mt-2 text-[10px] text-gray-400 font-medium">
                        <span>0%</span>
                        <span>50%</span>
                        <span>100%</span>
                    </div>
                </div>
            )}
        </div>
    );
};

export default MatchScoreFilter;

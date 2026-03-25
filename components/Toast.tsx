import React, { useEffect } from 'react';
import { CheckCircle, XCircle, Info, X, Loader } from 'lucide-react';

/**
 * Toast 类型
 */
export type ToastType = 'success' | 'error' | 'info' | 'loading' | 'ai_thinking';

/**
 * Toast 配置接口
 */
export interface ToastConfig {
    /** 消息内容 */
    message: string;
    /** 消息类型 */
    type: ToastType;
    /** 显示时长（毫秒），默认 3000ms。传 0 或负数表示不自动关闭 */
    duration?: number;
    /** 唯一标识符 */
    id: string;
}

/**
 * Toast 组件 Props
 */
interface ToastProps extends ToastConfig {
    /** 关闭回调 */
    onClose: (id: string) => void;
}

/**
 * 获取 Toast 样式配置
 */
const getToastStyles = (type: ToastType) => {
    const styles = {
        success: {
            bg: 'bg-emerald-50 dark:bg-emerald-900/20',
            border: 'border-emerald-200 dark:border-emerald-800',
            text: 'text-emerald-800 dark:text-emerald-200',
            icon: CheckCircle,
            iconColor: 'text-emerald-600 dark:text-emerald-400',
            spin: false
        },
        error: {
            bg: 'bg-red-50 dark:bg-red-900/20',
            border: 'border-red-200 dark:border-red-800',
            text: 'text-red-800 dark:text-red-200',
            icon: XCircle,
            iconColor: 'text-red-600 dark:text-red-400',
            spin: false
        },
        info: {
            bg: 'bg-blue-50 dark:bg-blue-900/20',
            border: 'border-blue-200 dark:border-blue-800',
            text: 'text-blue-800 dark:text-blue-200',
            icon: Info,
            iconColor: 'text-blue-600 dark:text-blue-400',
            spin: false
        },
        loading: {
            bg: 'bg-gray-50 dark:bg-gray-800',
            border: 'border-gray-200 dark:border-gray-700',
            text: 'text-gray-800 dark:text-gray-200',
            icon: Loader,
            iconColor: 'text-primary',
            spin: true
        },
        ai_thinking: {
            bg: 'bg-indigo-50 dark:bg-indigo-900/20',
            border: 'border-indigo-200 dark:border-indigo-800',
            text: 'text-indigo-800 dark:text-indigo-200',
            icon: Loader,
            iconColor: 'text-indigo-600 dark:text-indigo-400',
            spin: true
        }
    };
    return styles[type];
};

/**
 * Toast 单个消息组件
 */
export const Toast: React.FC<ToastProps> = ({ message, type, duration = 3000, id, onClose }) => {
    const style = getToastStyles(type);
    const Icon = style.icon;

    useEffect(() => {
        if (duration > 0) {
            const timer = setTimeout(() => {
                onClose(id);
            }, duration);
            return () => clearTimeout(timer);
        }
    }, [id, duration, onClose]);

    return (
        <div
            className={`
        ${style.bg} ${style.border} ${style.text}
        flex items-center gap-3 px-4 py-3 rounded-lg border shadow-lg
        animate-slideIn min-w-[300px] max-w-md transition-all duration-300
      `}
        >
            <Icon className={`w-5 h-5 shrink-0 ${style.iconColor} ${style.spin ? 'animate-spin' : ''}`} />
            {type === 'ai_thinking' ? (
                <span
                    className="flex-1 text-sm font-bold bg-gradient-to-r from-blue-500 via-purple-500 to-blue-500 bg-[length:200%_auto] bg-clip-text text-transparent"
                    style={{ animation: 'toast-ai-gradient 3s linear infinite' }}
                >
                    思考中：{message}
                </span>
            ) : (
                <span className="flex-1 text-sm font-medium">{message}</span>
            )}
            <button
                onClick={() => onClose(id)}
                className="shrink-0 hover:opacity-70 transition-opacity"
                aria-label="关闭"
            >
                <X className="w-4 h-4" />
            </button>
            <style>{`
                @keyframes toast-ai-gradient {
                    0% { background-position: 0% center; }
                    100% { background-position: -200% center; }
                }
            `}</style>
        </div>
    );
};

/**
 * Toast 容器组件
 */
interface ToastContainerProps {
    toasts: ToastConfig[];
    onClose: (id: string) => void;
}

export const ToastContainer: React.FC<ToastContainerProps> = ({ toasts, onClose }) => {
    return (
        <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none">
            <div className="flex flex-col gap-2 pointer-events-auto">
                {toasts.map((toast) => (
                    <Toast key={toast.id} {...toast} onClose={onClose} />
                ))}
            </div>
        </div>
    );
};

/**
 * Toast Hook - 用于管理 Toast 状态
 */
export const useToast = () => {
    const [toasts, setToasts] = React.useState<ToastConfig[]>([]);

    const showToast = React.useCallback((message: string, type: ToastType = 'info', duration = 3000) => {
        const id = `toast-${Date.now()}-${Math.random()}`;
        const newToast = { message, type, duration, id };
        setToasts((prev) => [...prev, newToast]);
        return id;
    }, []);

    const updateToast = React.useCallback((id: string, updates: Partial<Omit<ToastConfig, 'id'>>) => {
        setToasts((prev) => prev.map((toast) =>
            toast.id === id ? { ...toast, ...updates } : toast
        ));

        // 如果更新后的 duration > 0，这里其实不会自动重启定时器，因为 Toast 组件内部的 useEffect 依赖了 duration。
        // 但是 React 的 diff 机制会重新渲染 Toast。
        // 更好的做法是在 update 时如果不想要自动关闭，就在 updates 里把 duration 设为 0。
        // 如果想要在 update 后自动关闭，需要在 Toast 组件里处理 prop 变化。
        // 当前 Toast 组件实现已经依赖 [id, duration, onClose]，所以 duration 变化会重置定时器，这是符合预期的。
    }, []);

    const closeToast = React.useCallback((id: string) => {
        setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, []);

    return {
        toasts,
        showToast,
        updateToast,
        closeToast,
        success: (message: string, duration?: number) => showToast(message, 'success', duration),
        error: (message: string, duration?: number) => showToast(message, 'error', duration),
        info: (message: string, duration?: number) => showToast(message, 'info', duration),
        loading: (message: string) => showToast(message, 'loading', 0), // 0 表示不自动关闭
        ai_thinking: (message: string) => showToast(message, 'ai_thinking', 0),
    };
};

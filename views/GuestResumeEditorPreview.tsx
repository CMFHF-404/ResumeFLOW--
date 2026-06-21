import React from 'react';
import {
    Bot,
    Download,
    FileText,
    LayoutTemplate,
    Lock,
    LogIn,
    Plus,
    SlidersHorizontal,
    Sparkles,
} from 'lucide-react';
import UnAuthPrompt from '../components/UnAuthPrompt';

type GuestResumeEditorPreviewProps = {
    onRequireAuth: () => void | Promise<void>;
};

const GuestResumeEditorPreview: React.FC<GuestResumeEditorPreviewProps> = ({ onRequireAuth }) => {
    const handleRequireAuth = () => {
        void onRequireAuth();
    };

    return (
        <div className="flex h-full flex-1 flex-col overflow-hidden bg-gray-50 dark:bg-gray-900/50">
            <header className="shrink-0 border-b border-border-light bg-surface-light px-4 py-3 dark:border-border-dark dark:bg-surface-dark md:px-6">
                <div className="flex flex-col gap-3 md:h-10 md:flex-row md:items-center md:justify-between">
                    <div className="flex min-w-0 flex-wrap items-center gap-3 md:gap-4">
                        <div className="flex items-center gap-2 text-primary">
                            <img
                                src="/logo-mark-128.png"
                                alt="原子简历 favicon"
                                className="h-8 w-8 object-contain"
                            />
                            <span className="text-lg font-bold tracking-tight text-gray-900 dark:text-white md:text-xl">原子简历</span>
                        </div>
                        <div className="hidden h-6 w-px bg-border-light dark:bg-border-dark md:block" />
                        <span className="text-sm font-medium text-gray-500">简历工厂</span>
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700 ring-1 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/20">
                            <Lock className="h-3.5 w-3.5" />
                            只读预览
                        </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 md:justify-end md:gap-3">
                        <UnAuthPrompt />
                        <button
                            type="button"
                            onClick={handleRequireAuth}
                            className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-primary-dark"
                        >
                            <LogIn className="h-4 w-4 -scale-x-100" />
                            登录后编辑
                        </button>
                    </div>
                </div>
            </header>
            <main className="min-h-0 flex-1 overflow-y-auto">
                <div className="grid min-h-full grid-cols-1 lg:grid-cols-[minmax(280px,420px)_minmax(0,1fr)]">
                    <aside className="border-b border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-surface-dark lg:border-b-0 lg:border-r">
                        <div className="space-y-4">
                            <section className="rounded-xl border border-gray-200 p-4 dark:border-gray-700">
                                <h2 className="flex items-center gap-2 text-sm font-bold text-gray-900 dark:text-white">
                                    <FileText className="h-4 w-4 text-primary" />
                                    简历内容
                                </h2>
                                <p className="mt-2 text-sm leading-6 text-gray-500 dark:text-gray-400">
                                    访客模式可预览编辑器布局。创建、保存、导入和 AI 写作需要登录后使用。
                                </p>
                                <button
                                    type="button"
                                    onClick={handleRequireAuth}
                                    className="mt-4 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-dark"
                                >
                                    <Plus className="h-4 w-4" />
                                    登录后创建简历
                                </button>
                            </section>
                            <section className="rounded-xl border border-gray-200 p-4 dark:border-gray-700">
                                <h2 className="flex items-center gap-2 text-sm font-bold text-gray-900 dark:text-white">
                                    <Sparkles className="h-4 w-4 text-indigo-500" />
                                    智能工具
                                </h2>
                                <div className="mt-3 grid grid-cols-2 gap-2">
                                    {[
                                        [Bot, 'AI 助理'],
                                        [LayoutTemplate, '模板'],
                                        [SlidersHorizontal, '智能一页'],
                                        [Download, '导出 PDF'],
                                    ].map(([Icon, label]) => {
                                        const ToolIcon = Icon as typeof Bot;
                                        return (
                                            <button
                                                key={label as string}
                                                type="button"
                                                onClick={handleRequireAuth}
                                                className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-600 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                                            >
                                                <ToolIcon className="h-4 w-4" />
                                                {label as string}
                                            </button>
                                        );
                                    })}
                                </div>
                            </section>
                        </div>
                    </aside>
                    <section className="flex min-h-[640px] items-center justify-center bg-gray-100 p-4 dark:bg-gray-950/40 md:p-8">
                        <div className="aspect-[210/297] w-full max-w-[520px] bg-white p-10 text-gray-900 shadow-2xl shadow-gray-900/10 dark:bg-gray-100 dark:text-gray-900">
                            <div className="flex items-start justify-between border-b border-gray-200 pb-5">
                                <div>
                                    <div className="h-7 w-36 rounded bg-gray-900/90" />
                                    <div className="mt-3 h-3 w-48 rounded bg-gray-200" />
                                </div>
                                <div className="h-16 w-16 rounded-full bg-primary/15" />
                            </div>
                            <div className="mt-8 space-y-7">
                                {['个人评价', '工作经历', '项目经历', '教育背景', '技能证书'].map((title, index) => (
                                    <div key={title}>
                                        <div className="mb-3 flex items-center gap-3">
                                            <div className="h-4 w-1 rounded bg-primary" />
                                            <div className="h-4 w-20 rounded bg-gray-800" />
                                            <span className="text-xs font-semibold text-gray-400">{title}</span>
                                        </div>
                                        <div className="space-y-2">
                                            <div className="h-2.5 w-full rounded bg-gray-200" />
                                            <div className={`h-2.5 rounded bg-gray-200 ${index % 2 === 0 ? 'w-5/6' : 'w-3/4'}`} />
                                            <div className="h-2.5 w-2/3 rounded bg-gray-100" />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </section>
                </div>
            </main>
        </div>
    );
};

export default GuestResumeEditorPreview;

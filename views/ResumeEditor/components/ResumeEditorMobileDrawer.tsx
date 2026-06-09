import React from 'react';
import { Database } from 'lucide-react';
import EditorSidebar, { type EditorSidebarProps } from './EditorSidebar';

type ResumeEditorMobileDrawerProps = {
    isOpen: boolean;
    isVisible: boolean;
    onOpen: () => void;
    onClose: () => void;
    sidebarProps: Omit<EditorSidebarProps, 'layoutMode' | 'showJDPanel'>;
};

const ResumeEditorMobileDrawer: React.FC<ResumeEditorMobileDrawerProps> = ({
    isOpen,
    isVisible,
    onOpen,
    onClose,
    sidebarProps,
}) => (
    <>
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-20 md:hidden">
            <div className="pointer-events-auto rounded-t-[28px] border border-b-0 border-border-light bg-surface-light/96 px-4 pb-[calc(env(safe-area-inset-bottom)+10px)] pt-2 shadow-[0_-18px_40px_rgba(15,23,42,0.14)] backdrop-blur dark:border-border-dark dark:bg-surface-dark/96">
                <button
                    type="button"
                    onClick={onOpen}
                    className="mx-auto flex w-full max-w-[240px] flex-col items-center rounded-t-[20px] px-6 pb-1 pt-0.5 text-center"
                >
                    <span className="mb-2 h-1.5 w-14 rounded-full bg-gray-300 dark:bg-gray-700" />
                    <span className="inline-flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
                        <Database className="h-4 w-4 text-primary" />
                        经历库
                    </span>
                </button>
            </div>
        </div>
        {isOpen ? (
            <div className={`fixed inset-0 z-[70] transition-opacity duration-[320ms] ease-[cubic-bezier(0.22,1,0.36,1)] md:hidden ${isVisible ? 'bg-black/35 opacity-100 backdrop-blur-[1px]' : 'bg-black/0 opacity-0'}`}>
                <button
                    type="button"
                    aria-label="关闭经历库抽屉遮罩"
                    className="absolute inset-0 h-full w-full cursor-default"
                    onClick={onClose}
                />
                <div className={`absolute inset-x-0 bottom-0 h-[82vh] rounded-t-[28px] border border-border-light bg-surface-light shadow-[0_-24px_60px_rgba(15,23,42,0.22)] will-change-transform transition-transform duration-[320ms] ease-[cubic-bezier(0.22,1,0.36,1)] dark:border-border-dark dark:bg-surface-dark ${isVisible ? 'translate-y-0' : 'translate-y-full'}`}>
                    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-t-[28px]">
                        <div className="shrink-0 px-4 pb-2 pt-2">
                            <div className="mx-auto h-1.5 w-14 rounded-full bg-gray-300 dark:bg-gray-700" />
                        </div>
                        <EditorSidebar
                            {...sidebarProps}
                            layoutMode="drawer"
                            showJDPanel={false}
                        />
                    </div>
                </div>
            </div>
        ) : null}
    </>
);

export default ResumeEditorMobileDrawer;

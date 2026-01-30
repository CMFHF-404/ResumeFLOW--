import React from 'react';
import { Briefcase, Plus, Sparkles, ChevronUp, ChevronDown, Trash2 } from 'lucide-react';
import { ExperienceListItem } from './services/experienceService';

/**
 * 工作经历卡片组件的Props接口
 * 负责管理工作经历的多卡片展示和编辑
 */
interface WorkExperienceCardsProps {
    /** 工作经历列表数据 */
    workExperiences: ExperienceListItem[];
    /** 是否正在加载工作经历 */
    isLoadingWork: boolean;
    /** 展开的卡片ID集合 */
    expandedCards: Set<string>;
    /** 已修改的卡片ID集合 */
    modifiedCards: Set<string>;
    /** 卡片数据Map */
    cardData: Map<string, any>;
    /** 正在删除的卡片ID */
    deletingCardId: string | null;
    /** 是否正在进行AI润色 */
    isPolishing: boolean;
    /** 切换卡片展开/折叠状态 */
    toggleCard: (cardId: string) => void;
    /** 更新卡片字段值 */
    updateCardField: (cardId: string, field: string, value: any) => void;
    /** 保存卡片 */
    handleSaveCard: (cardId: string) => void;
    /** 取消修改 */
    handleCancelCard: (cardId: string) => void;
    /** 删除卡片 */
    handleDeleteCard: (cardId: string) => void;
    /** 新增工作经历 */
    handleAddNewWork: () => void;
    /** AI润色卡片 */
    handlePolishCard: (cardId: string) => void;
    /** 设置正在删除的卡片ID */
    setDeletingCardId: (cardId: string | null) => void;
}

/**
 * 工作经历多卡片UI组件
 * 提供工作经历的展示、编辑、删除和AI润色功能
 */
const WorkExperienceCards: React.FC<WorkExperienceCardsProps> = ({
    workExperiences,
    isLoadingWork,
    expandedCards,
    modifiedCards,
    cardData,
    deletingCardId,
    isPolishing,
    toggleCard,
    updateCardField,
    handleSaveCard,
    handleCancelCard,
    handleDeleteCard,
    handleAddNewWork,
    handlePolishCard,
    setDeletingCardId,
}) => {
    return (
        <>
            {/* ============= 新的工作经历UI(多卡片) ============= */}
            {/* Work Experience Section */}
            <section className="space-y-6 pt-6 border-t border-gray-200 dark:border-gray-800">
                <div className="flex items-center justify-between">
                    <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                        <Briefcase className="w-5 h-5 text-primary" />
                        工作经历
                        <span className="text-sm font-normal text-gray-400 ml-2">Work Experience</span>
                    </h2>
                    <span className="text-xs font-mono text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded">
                        {isLoadingWork ? 'Loading...' : `${workExperiences.length} items`}
                    </span>
                </div>

                <button
                    onClick={handleAddNewWork}
                    className="w-full group border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-xl p-4 flex items-center justify-center gap-2 text-gray-500 hover:text-primary hover:border-primary hover:bg-primary/5 transition-all duration-300"
                >
                    <div className="p-1 rounded-full bg-gray-200 dark:bg-gray-800 group-hover:bg-white group-hover:text-primary transition-colors">
                        <Plus className="w-5 h-5" />
                    </div>
                    <span className="font-medium">新增工作经历</span>
                </button>

                {/* 工作经历卡片列表 */}
                {workExperiences.map((item) => {
                    const cardId = item.master.id;
                    const isExpanded = expandedCards.has(cardId);
                    const isModified = modifiedCards.has(cardId);
                    const data = cardData.get(cardId) || {
                        org: item.latest_version?.org || "",
                        title: item.latest_version?.title || "",
                        start_date: item.latest_version?.start_date || "",
                        end_date: item.latest_version?.end_date || "",
                        star: item.latest_version?.star || { s: "", t: "", a: "", r: "" }
                    };

                    return (
                        <div key={cardId} className="bg-white dark:bg-surface-dark rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm hover:shadow-md transition-all duration-300 overflow-hidden">
                            {!isExpanded ? (
                                // 折叠态
                                <div className="p-5 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors" onClick={() => toggleCard(cardId)}>
                                    <div className="flex items-start justify-between gap-4">
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-3 mb-1">
                                                <h3 className="font-bold text-gray-900 dark:text-white truncate">{data.org}</h3>
                                                <span className="text-gray-300 dark:text-gray-600">|</span>
                                                <span className="text-gray-700 dark:text-gray-300 font-medium">{data.title}</span>
                                            </div>
                                            <p className="text-sm text-gray-500 dark:text-gray-400 truncate">
                                                {data.star?.s ? data.star.s.substring(0, 60) + '...' : '点击展开编辑工作经历...'}
                                            </p>
                                        </div>
                                        <div className="text-right shrink-0 flex items-center gap-2">
                                            <span className="block text-sm font-mono text-gray-500">{data.start_date} - {data.end_date || '至今'}</span>
                                            {/* 删除按钮 - 折叠态可见 */}
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setDeletingCardId(cardId);
                                                }}
                                                className="text-gray-400 hover:text-red-500 transition-colors p-1 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
                                                title="删除"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                            <ChevronDown className="w-5 h-5 text-gray-400" />
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                // 展开态
                                <>
                                    <div className="p-6 pb-2 border-b border-gray-50 dark:border-gray-800/50">
                                        <div className="flex flex-col lg:flex-row gap-6 mb-4">
                                            <div className="flex-1">
                                                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1 block">公司名称</label>
                                                <input
                                                    className="fluid-input text-xl font-bold text-gray-900 dark:text-white placeholder-gray-300"
                                                    placeholder="输入公司名称"
                                                    type="text"
                                                    value={data.org}
                                                    onChange={(e) => updateCardField(cardId, 'org', e.target.value)}
                                                />
                                            </div>
                                            <div className="flex-1">
                                                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1 block">担任职位</label>
                                                <input
                                                    className="fluid-input text-xl font-bold text-gray-900 dark:text-white placeholder-gray-300"
                                                    placeholder="输入职位名称"
                                                    type="text"
                                                    value={data.title}
                                                    onChange={(e) => updateCardField(cardId, 'title', e.target.value)}
                                                />
                                            </div>
                                            <div className="w-full lg:w-auto shrink-0">
                                                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1 block">时间段</label>
                                                <div className="flex items-center gap-2">
                                                    <input
                                                        className="fluid-input w-24 text-center text-base text-gray-600 dark:text-gray-300"
                                                        placeholder="YYYY.MM"
                                                        type="text"
                                                        value={data.start_date}
                                                        onChange={(e) => updateCardField(cardId, 'start_date', e.target.value)}
                                                    />
                                                    <span className="text-gray-400">-</span>
                                                    <input
                                                        className="fluid-input w-24 text-center text-base text-gray-600 dark:text-gray-300"
                                                        placeholder="至今"
                                                        type="text"
                                                        value={data.end_date}
                                                        onChange={(e) => updateCardField(cardId, 'end_date', e.target.value)}
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="p-6 pt-4 space-y-4">
                                        {/* STAR Sections */}
                                        {[
                                            { id: 's', label: 'S - 情境 (Situation)', color: 'blue', ph: 'Describe the context...' },
                                            { id: 't', label: 'T - 任务 (Task)', color: 'orange', ph: 'What were your goals?' },
                                            { id: 'a', label: 'A - 行动 (Action)', color: 'amber', ph: 'What specifically did you do?' },
                                            { id: 'r', label: 'R - 结果 (Result)', color: 'emerald', ph: 'Quantifiable outcomes...' },
                                        ].map((section, idx) => (
                                            <div key={section.id} className="flex gap-4 relative group">
                                                {idx !== 3 && <div className="absolute left-[19px] top-10 bottom-0 w-[2px] bg-gray-100 dark:bg-gray-800"></div>}
                                                <div className={`shrink-0 w-10 h-10 rounded-full bg-${section.color}-50 dark:bg-${section.color}-900/20 text-${section.color}-600 dark:text-${section.color}-400 flex items-center justify-center ring-4 ring-white dark:ring-surface-dark z-10 font-bold`}>
                                                    {section.id.toUpperCase()}
                                                </div>
                                                <div className="flex-1 pt-1 pb-4">
                                                    <div className="flex items-center justify-between mb-2">
                                                        <span className={`text-xs font-bold text-${section.color}-600 dark:text-${section.color}-400 uppercase tracking-widest`}>{section.label}</span>
                                                    </div>
                                                    <textarea
                                                        className="w-full bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-lg p-3 text-sm text-gray-700 dark:text-gray-300 focus:ring-2 focus:ring-primary/20 focus:border-primary resize-none leading-relaxed transition-all hover:bg-white dark:hover:bg-gray-800 shadow-sm"
                                                        rows={section.id === 'a' ? 4 : 2}
                                                        value={data.star?.[section.id] || ""}
                                                        placeholder={section.ph}
                                                        onChange={(e) => updateCardField(cardId, `star.${section.id}`, e.target.value)}
                                                    />
                                                </div>
                                            </div>
                                        ))}
                                    </div>

                                    <div className="bg-gray-50 dark:bg-gray-800/50 px-6 py-3 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between">
                                        <button
                                            onClick={() => handlePolishCard(cardId)}
                                            disabled={isPolishing}
                                            className="flex items-center gap-2 text-sm font-medium text-emerald-600 bg-emerald-50 hover:bg-emerald-100 dark:text-emerald-400 dark:bg-emerald-900/20 dark:hover:bg-emerald-900/30 px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
                                        >
                                            <Sparkles className="w-4 h-4" />
                                            {isPolishing ? 'AI 润色中...' : 'AI 润色'}
                                        </button>
                                        <div className="flex items-center gap-2">
                                            {/* 删除按钮 - 展开态可见 */}
                                            <button
                                                onClick={() => setDeletingCardId(cardId)}
                                                className="text-gray-400 hover:text-red-500 transition-colors p-2 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg mr-2"
                                                title="删除"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>

                                            {isModified ? (
                                                <>
                                                    <button
                                                        onClick={() => handleCancelCard(cardId)}
                                                        className="text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white transition-colors text-sm font-medium px-4 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
                                                    >
                                                        取消
                                                    </button>
                                                    <button
                                                        onClick={() => handleSaveCard(cardId)}
                                                        className="flex items-center gap-2 text-sm font-medium text-white bg-primary hover:bg-primary-dark px-6 py-2 rounded-lg transition-colors shadow-sm shadow-primary/20"
                                                    >
                                                        保存
                                                    </button>
                                                </>
                                            ) : (
                                                <button
                                                    onClick={() => toggleCard(cardId)}
                                                    className="flex items-center gap-2 text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white px-4 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                                                >
                                                    折叠
                                                    <ChevronUp className="w-4 h-4" />
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>
                    );
                })}

                {/* 删除确认对话框 */}
                {
                    deletingCardId && (
                        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                            <div className="bg-white dark:bg-surface-dark rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl">
                                <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">确认删除</h3>
                                <p className="text-gray-600 dark:text-gray-400 mb-6">
                                    确定要删除这条工作经历吗？此操作无法撤销。
                                </p>
                                <div className="flex items-center justify-end gap-3">
                                    <button
                                        onClick={() => setDeletingCardId(null)}
                                        className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                                    >
                                        取消
                                    </button>
                                    <button
                                        onClick={() => handleDeleteCard(deletingCardId)}
                                        className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
                                    >
                                        删除
                                    </button>
                                </div>
                            </div>
                        </div>
                    )
                }
            </section>
            {/* ============= 新的工作经历UI(多卡片) 结束 ============= */}
        </>
    );
};

export default WorkExperienceCards;

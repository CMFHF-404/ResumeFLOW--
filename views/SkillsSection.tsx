import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Wrench, ChevronDown } from 'lucide-react';
import { skillsService, UserSkill } from '../services/skillsService';
import ConfirmDialog from '../components/ConfirmDialog';
import { runDedupedRefresh } from './experienceUtils';
import SkillCategoryCard, { SkillCategoryCardData } from './SkillCategoryCard';
import { normalizeTagKey } from './tagUtils';

const DEFAULT_SKILL_CATEGORY = "未分类";

const SKILL_TOAST_MESSAGES = {
    saveLoading: "正在保存技能...",
    saveSuccess: "技能保存成功",
    saveError: "保存失败，请重试",
    deleteLoading: "正在删除分类...",
    deleteSuccess: "分类删除成功",
    deleteError: "删除失败，请重试",
};

const SKILL_CATEGORY_VALIDATION_MESSAGES = {
    emptyName: "分类名称不能为空",
    nameExists: "该分类已存在",
};

const normalizeCategoryName = (name: string) => name.trim();
const normalizeCategoryKey = (name: string) => normalizeCategoryName(name);
const resolveSkillCategoryName = (category?: string) => (category || "").trim() || DEFAULT_SKILL_CATEGORY;

const buildGroupedSkills = (items: UserSkill[]) => {
    return items.reduce((acc, skill) => {
        const category = resolveSkillCategoryName(skill.category);
        if (!acc[category]) acc[category] = [];
        acc[category].push(skill);
        return acc;
    }, {} as Record<string, UserSkill[]>);
};

const buildSkillCategoryOrder = (items: UserSkill[], extraCategories: string[]) => {
    const order: string[] = [];
    const seen = new Set<string>();
    const append = (name: string) => {
        const key = normalizeCategoryKey(name);
        if (seen.has(key)) return;
        seen.add(key);
        order.push(name);
    };
    items.forEach((skill) => append(resolveSkillCategoryName(skill.category)));
    extraCategories.forEach((name) => append(normalizeCategoryName(name)));
    return order;
};

interface SkillsSectionProps {
    refreshSignal?: number;
    toast: {
        success: (message: string, duration?: number) => string;
        error: (message: string, duration?: number) => string;
        loading: (message: string) => string;
        updateToast: (id: string, updates: { message?: string; type?: 'success' | 'error' | 'loading' | 'ai_thinking'; duration?: number }) => void;
    };
    isAuthenticated?: boolean;
    onRequireAuth?: () => void | Promise<void>;
}

const SkillsSection: React.FC<SkillsSectionProps> = ({
    refreshSignal,
    toast,
    isAuthenticated = true,
    onRequireAuth = () => undefined,
}) => {
    const { error, loading, updateToast } = toast;

    // Data State
    const [skills, setSkills] = useState<UserSkill[]>([]);
    const [extraCategories, setExtraCategories] = useState<string[]>([]); // New empty categories
    const [isLoading, setIsLoading] = useState(isAuthenticated);
    const hasLoadedRef = useRef(false);
    const refreshInFlightRef = useRef<Promise<UserSkill[]> | null>(null);

    // Card State (Key = Category Name)
    const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
    const [collapsingCategories, setCollapsingCategories] = useState<Set<string>>(new Set());
    const [categoryData, setCategoryData] = useState<Map<string, SkillCategoryCardData>>(new Map());
    const [originalCategoryData, setOriginalCategoryData] = useState<Map<string, SkillCategoryCardData>>(new Map());
    const [modifiedCategories, setModifiedCategories] = useState<Set<string>>(new Set());
    const [savingCategories, setSavingCategories] = useState<Set<string>>(new Set());

    // Deletion
    const [deletingCategory, setDeletingCategory] = useState<string | null>(null);

    // Scroll Refs
    const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());

    // Derived
    const groupedSkills = useMemo(() => buildGroupedSkills(skills), [skills]);
    const categoryOrder = useMemo(() => buildSkillCategoryOrder(skills, extraCategories), [skills, extraCategories]);

    const refreshSkills = useCallback(async () => {
        if (!isAuthenticated) {
            setSkills([]);
            setExtraCategories([]);
            setIsLoading(false);
            return [];
        }
        return runDedupedRefresh(refreshInFlightRef, async () => {
            const data = await skillsService.list({ force: true });
            setSkills(data);
            return data;
        });
    }, [isAuthenticated]);

    useEffect(() => {
        if (!isAuthenticated) {
            hasLoadedRef.current = false;
            setSkills([]);
            setExtraCategories([]);
            setIsLoading(false);
            return;
        }
        const loadSkills = async () => {
            if (hasLoadedRef.current) return;
            try {
                setIsLoading(true);
                hasLoadedRef.current = true;
                const data = await skillsService.list();
                setSkills(data);
            } catch (err) {
                console.error('Failed to load skills:', err);
                hasLoadedRef.current = false;
            } finally {
                setIsLoading(false);
            }
        };
        loadSkills();
    }, [isAuthenticated]);

    useEffect(() => {
        if (refreshSignal && isAuthenticated) {
            refreshSkills().catch(err => console.error('Refresh failed', err));
        }
    }, [isAuthenticated, refreshSignal, refreshSkills]);


    // Helpers
    const ensureCardState = (category: string) => {
        if (categoryData.has(category)) return;
        const currentSkills = groupedSkills[category] || [];
        const data: SkillCategoryCardData = {
            name: category,
            skills: currentSkills.map(s => s.name),
        };
        setCategoryData(prev => new Map(prev).set(category, data));
        setOriginalCategoryData(prev => new Map(prev).set(category, JSON.parse(JSON.stringify(data))));
    };

    const toggleCard = (category: string) => {
        setExpandedCategories(prev => {
            const next = new Set(prev);
            if (next.has(category)) {
                // Collapse
                setCollapsingCategories(c => new Set(c).add(category));
                next.delete(category);
                setTimeout(() => {
                    setCollapsingCategories(c => {
                        const updated = new Set(c);
                        updated.delete(category);
                        return updated;
                    });
                    setTimeout(() => {
                        cardRefs.current.get(category)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }, 50);
                }, 300);
            } else {
                // Expand
                next.add(category);
                ensureCardState(category);
                setTimeout(() => {
                    cardRefs.current.get(category)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }, 100);
            }
            return next;
        });
    };

    const updateCardData = (category: string, updates: Partial<SkillCategoryCardData>) => {
        if (!isAuthenticated) {
            void onRequireAuth();
            return;
        }
        setCategoryData(prev => {
            const next = new Map(prev);
            const current = next.get(category) || { name: category, skills: [] };
            next.set(category, { ...current, ...updates });
            return next;
        });

        // Check modification
        // Note: We need to compare against original DATA, but since category key stays same in map until delete,
        // we track modifications by key. 
        // However, if we rename the category, the key in the UI list is the ORIGINAL category name until saved.

        // Defer complex modification check, simply mark modified
        setModifiedCategories(prev => new Set(prev).add(category));
    };

    const isCategoryNameTaken = (name: string, excludeCategory: string) => {
        const key = normalizeCategoryKey(name);
        const excludeKey = normalizeCategoryKey(excludeCategory);
        const candidates = [...Object.keys(groupedSkills), ...extraCategories];
        return candidates.some((candidate) => {
            const candidateKey = normalizeCategoryKey(candidate);
            return candidateKey === key && candidateKey !== excludeKey;
        });
    };

    const requireAuth = useCallback(() => {
        if (!isAuthenticated) {
            void onRequireAuth();
            return true;
        }
        return false;
    }, [isAuthenticated, onRequireAuth]);

    const handleCreateCategory = () => {
        if (requireAuth()) return;
        const newName = "新分类"; // simple duplicate check needed?
        let uniqueName = newName;
        let count = 1;
        while (categoryOrder.includes(uniqueName)) {
            uniqueName = `${newName} ${count++}`;
        }

        setExtraCategories(prev => [uniqueName, ...prev]);
        // Initialize data
        const data = { name: uniqueName, skills: [] };
        setCategoryData(prev => new Map(prev).set(uniqueName, data));
        setOriginalCategoryData(prev => new Map(prev).set(uniqueName, data));
        toggleCard(uniqueName);
    };

    const handleSave = async (originalCategoryName: string) => {
        if (requireAuth()) return;
        const data = categoryData.get(originalCategoryName);
        if (!data) return;
        const newName = data.name.trim();
        if (!newName) {
            error(SKILL_CATEGORY_VALIDATION_MESSAGES.emptyName);
            return;
        }

        const renameNeeded = normalizeCategoryName(originalCategoryName) !== normalizeCategoryName(newName);
        if (renameNeeded && isCategoryNameTaken(newName, originalCategoryName)) {
            error(SKILL_CATEGORY_VALIDATION_MESSAGES.nameExists);
            return;
        }

        setSavingCategories(prev => new Set(prev).add(originalCategoryName));
        const toastId = loading(SKILL_TOAST_MESSAGES.saveLoading);

        try {
            const originalSkills = groupedSkills[originalCategoryName] || [];

            const nextSkills = data.skills.map(s => s.trim()).filter(Boolean);

            // 1. Identify removed skills -> delete
            const toDelete = originalSkills.filter(s => !nextSkills.some(ns => normalizeTagKey(ns) === normalizeTagKey(s.name)));

            // 2. Identify new skills -> create
            const toCreate = nextSkills.filter(ns => !originalSkills.some(os => normalizeTagKey(os.name) === normalizeTagKey(ns)));

            // 3. Identify category rename -> update all remaining skills
            const remainingSkills = originalSkills.filter(s => nextSkills.some(ns => normalizeTagKey(ns) === normalizeTagKey(s.name)));

            const promises: Promise<any>[] = [];

            toDelete.forEach(s => promises.push(skillsService.delete(s.id)));

            const categoryPayload = normalizeCategoryKey(newName) === normalizeCategoryKey(DEFAULT_SKILL_CATEGORY) ? undefined : newName;

            toCreate.forEach(name => promises.push(skillsService.create({ name, category: categoryPayload })));

            if (renameNeeded) {
                remainingSkills.forEach(s => promises.push(skillsService.update(s.id, { category: newName })));
            }

            await Promise.all(promises);

            // Cleanup local state
            if (extraCategories.includes(originalCategoryName) && renameNeeded) {
                setExtraCategories(prev => prev.filter(c => c !== originalCategoryName).concat(newName));
            } else if (extraCategories.includes(originalCategoryName) && !renameNeeded) {
                // Keep as is
            }

            await refreshSkills();

            // Keep "取消" behavior consistent by updating the baseline snapshot after a successful save.
            const savedSnapshot: SkillCategoryCardData = { name: newName, skills: nextSkills };
            setCategoryData(prev => new Map(prev).set(originalCategoryName, savedSnapshot));
            setOriginalCategoryData(prev => new Map(prev).set(originalCategoryName, JSON.parse(JSON.stringify(savedSnapshot))));

            updateToast(toastId, { message: SKILL_TOAST_MESSAGES.saveSuccess, type: 'success', duration: 2000 });
            setModifiedCategories(prev => {
                const next = new Set(prev);
                next.delete(originalCategoryName);
                return next;
            });
            toggleCard(originalCategoryName); // If renamed, this logic might be tricky as the key changes in next render.
            // But actually, after refresh, the list re-renders with NEW keys.

        } catch (err) {
            console.error(err);
            updateToast(toastId, { message: SKILL_TOAST_MESSAGES.saveError, type: 'error', duration: 3000 });
        } finally {
            setSavingCategories(prev => {
                const next = new Set(prev);
                next.delete(originalCategoryName);
                return next;
            });
        }
    };

    const handleCancel = (category: string) => {
        // Reset data
        const original = originalCategoryData.get(category);
        if (original) {
            setCategoryData(prev => new Map(prev).set(category, JSON.parse(JSON.stringify(original))));
        }
        setModifiedCategories(prev => {
            const next = new Set(prev);
            next.delete(category);
            return next;
        });
    };

    const handleDeleteCategory = async () => {
        if (requireAuth()) return;
        if (!deletingCategory) return;
        const category = deletingCategory;
        setDeletingCategory(null);

        const toastId = loading(SKILL_TOAST_MESSAGES.deleteLoading);
        try {
            const skillsToDelete = groupedSkills[category] || [];
            await Promise.all(skillsToDelete.map(s => skillsService.delete(s.id)));

            if (extraCategories.includes(category)) {
                setExtraCategories(prev => prev.filter(c => c !== category));
            }

            await refreshSkills();
            updateToast(toastId, { message: SKILL_TOAST_MESSAGES.deleteSuccess, type: 'success', duration: 2000 });

        } catch (err) {
            console.error(err);
            updateToast(toastId, { message: SKILL_TOAST_MESSAGES.deleteError, type: 'error', duration: 3000 });
        }
    };

    // Collapse State
    const [isCollapsed, setIsCollapsed] = useState(false);

    return (
        <section className="space-y-6 pt-6 border-t border-gray-200 dark:border-gray-800">
            <div className="flex items-center justify-between">
                <h2
                    className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2 cursor-pointer select-none"
                    onClick={() => setIsCollapsed(!isCollapsed)}
                >
                    <div className={`p-1 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors`}>
                        <ChevronDown
                            className={`w-5 h-5 text-gray-400 transition-transform duration-200 ${isCollapsed ? '-rotate-90' : 'rotate-0'}`}
                        />
                    </div>
                    <Wrench className="w-5 h-5 text-rose-500" />
                    专业技能
                    <span className="text-sm font-normal text-gray-400 ml-2">Skills</span>
                </h2>
                <span className="text-xs font-mono text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded">
                    {isLoading ? '加载中...' : `${categoryOrder.length} categories`}
                </span>
            </div>

            {!isCollapsed && (
                <>
                    <button
                        onClick={handleCreateCategory}
                        disabled={isLoading}
                        className="w-full group border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-xl p-4 flex items-center justify-center gap-2 text-gray-500 hover:text-rose-600 hover:border-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/10 transition-all duration-300 disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                        <div className="p-1 rounded-full bg-gray-200 dark:bg-gray-800 group-hover:bg-white group-hover:text-rose-600 transition-colors">
                            <Plus className="w-5 h-5" />
                        </div>
                        <span className="font-medium">新增技能分类</span>
                    </button>

                    <div className="space-y-4">
                        {categoryOrder.map(category => {
                            return (
                                <div key={category} ref={el => { if (el) cardRefs.current.set(category, el); else cardRefs.current.delete(category); }}>
                                    <SkillCategoryCard
                                        data={categoryData.get(category) || { name: category, skills: groupedSkills[category]?.map(s => s.name) || [] }}
                                        isExpanded={expandedCategories.has(category)}
                                        isCollapsing={collapsingCategories.has(category)}
                                        isModified={modifiedCategories.has(category)}
                                        isSaving={savingCategories.has(category)}
                                        onToggle={() => toggleCard(category)}
                                        onDelete={() => {
                                            if (requireAuth()) return;
                                            setDeletingCategory(category);
                                        }}
                                        onSave={() => handleSave(category)}
                                        onCancel={() => handleCancel(category)}
                                        onNameChange={(val) => updateCardData(category, { name: val })}
                                        onSkillsChange={(val) => updateCardData(category, { skills: val })}
                                    />
                                </div>
                            );
                        })}
                    </div>
                </>
            )}

            <ConfirmDialog
                isOpen={!!deletingCategory}
                title="确认删除"
                description={<>确定要删除该分类及其所有技能吗？<br />此操作无法撤销。</>}
                onConfirm={handleDeleteCategory}
                onCancel={() => setDeletingCategory(null)}
            />
        </section>
    );
};

export default SkillsSection;

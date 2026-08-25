import React, { useCallback, useEffect, useLayoutEffect, useRef, useState, useMemo } from 'react';
import { Award, Plus, ChevronDown } from 'lucide-react';
import { certificationsService, Certification as CertificationRecord } from '../services/certificationsService';
import {
    assertAuthCacheKey,
    AuthContextChangedError,
    isAuthContextChangedError,
} from '../services/apiClient';
import ConfirmDialog from '../components/ConfirmDialog';
import { convertDateToISO, getTodayLocalISODate, parseYearMonthValue, runDedupedRefresh } from './experienceUtils';
import CertificationCard, { CertificationCardData } from './CertificationCard';

const CERT_DEFAULT_NAME = "新证书";
const CERT_DEFAULT_ISSUER = "颁发机构";
// Used to store matchRate in description to avoid breaking backend structure
const CERT_META_PREFIX = "__rf_cert_meta__:";

const CERT_TOAST_MESSAGES = {
    createLoading: "正在创建证书...",
    createSuccess: "证书创建成功",
    createError: "创建证书失败，请重试",
    saveLoading: "正在保存证书...",
    saveSuccess: "证书保存成功",
    saveError: "保存失败，请重试",
    deleteLoading: "正在删除证书...",
    deleteSuccess: "证书删除成功",
    deleteError: "删除失败，请重试",
};

const buildCertificationMetaDescription = (matchRate: number) => {
    return `${CERT_META_PREFIX}${JSON.stringify({ matchRate })}`;
};

const buildCertificationCardData = (cert: CertificationRecord): CertificationCardData => ({
    name: cert.name || "",
    issuer: cert.issuer || "",
    date: cert.issue_date || "",
});

const cloneCertificationCardData = (data: CertificationCardData) => JSON.parse(JSON.stringify(data));

type ToastApi = {
    success: (message: string, duration?: number) => string;
    error: (message: string, duration?: number) => string;
    loading: (message: string) => string;
    updateToast: (id: string, updates: { message?: string; type?: 'success' | 'error' | 'loading' | 'ai_thinking'; duration?: number }) => void;
    closeToast?: (id: string) => void;
};

interface CertificationSectionProps {
    refreshSignal?: number;
    toast: ToastApi;
    authUserKey?: string | null;
    isAuthenticated?: boolean;
    onRequireAuth?: () => void | Promise<void>;
}

type CertificationOwnerOperation = {
    expectedAuthCacheKey: string;
    generation: number;
};

const CertificationSection: React.FC<CertificationSectionProps> = ({
    refreshSignal,
    toast,
    authUserKey = null,
    isAuthenticated = true,
    onRequireAuth = () => undefined,
}) => {
    const { success, error, loading, updateToast, closeToast } = toast;
    const normalizedAuthUserKey = authUserKey?.trim() || null;
    const isOwnerResolved = (
        isAuthenticated
        && !!normalizedAuthUserKey
        && normalizedAuthUserKey !== 'anonymous'
    );
    const currentOwnerKey = isOwnerResolved ? normalizedAuthUserKey : null;

    // State
    const [certifications, setCertifications] = useState<CertificationRecord[]>([]);
    const [isLoading, setIsLoading] = useState(isOwnerResolved);
    const [listOwnerKey, setListOwnerKey] = useState<string | null>(currentOwnerKey);
    const refreshInFlightRef = useRef<Promise<CertificationRecord[]> | null>(null);
    const ownerGenerationRef = useRef(0);
    const committedOwnerKeyRef = useRef<string | null>(currentOwnerKey);
    const activeLoadingToastIdsRef = useRef<Set<string>>(new Set());

    useLayoutEffect(() => {
        if (committedOwnerKeyRef.current === currentOwnerKey) {
            return;
        }
        activeLoadingToastIdsRef.current.forEach((toastId) => {
            if (closeToast) {
                closeToast(toastId);
            } else {
                updateToast(toastId, { duration: 1 });
            }
        });
        activeLoadingToastIdsRef.current.clear();
        committedOwnerKeyRef.current = currentOwnerKey;
        ownerGenerationRef.current += 1;
        refreshInFlightRef.current = null;
    }, [closeToast, currentOwnerKey, updateToast]);

    const visibleCertifications = listOwnerKey === currentOwnerKey ? certifications : [];
    const visibleIsLoading = isOwnerResolved && listOwnerKey !== currentOwnerKey
        ? true
        : isLoading;

    // Card State
    const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());
    const [collapsingCards, setCollapsingCards] = useState<Set<string>>(new Set());
    const [cardData, setCardData] = useState<Map<string, CertificationCardData>>(new Map());
    const [originalCardData, setOriginalCardData] = useState<Map<string, CertificationCardData>>(new Map());
    const [modifiedCards, setModifiedCards] = useState<Set<string>>(new Set());
    const [savingCards, setSavingCards] = useState<Set<string>>(new Set());

    // Creation/Deletion
    const [isCreating, setIsCreating] = useState(false);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const deletingOwnerKeyRef = useRef<string | null>(null);

    // Refs for scrolling
    const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());

    const beginOwnerOperation = useCallback((): CertificationOwnerOperation | null => {
        if (!currentOwnerKey) {
            return null;
        }
        return {
            expectedAuthCacheKey: currentOwnerKey,
            generation: ownerGenerationRef.current,
        };
    }, [currentOwnerKey]);

    const isOwnerOperationCurrent = useCallback((operation: CertificationOwnerOperation) => (
        operation.generation === ownerGenerationRef.current
        && operation.expectedAuthCacheKey === committedOwnerKeyRef.current
    ), []);

    const assertOwnerOperationCurrent = useCallback(async (
        operation: CertificationOwnerOperation,
    ) => {
        if (!isOwnerOperationCurrent(operation)) {
            throw new AuthContextChangedError();
        }
        await assertAuthCacheKey(operation.expectedAuthCacheKey);
        if (!isOwnerOperationCurrent(operation)) {
            throw new AuthContextChangedError();
        }
    }, [isOwnerOperationCurrent]);

    const shouldIgnoreOwnerError = useCallback((
        operation: CertificationOwnerOperation,
        caughtError: unknown,
    ) => (
        isAuthContextChangedError(caughtError)
        || !isOwnerOperationCurrent(operation)
    ), [isOwnerOperationCurrent]);

    const dismissStaleLoadingToast = useCallback((toastId: string | null) => {
        if (!toastId) return;
        if (!activeLoadingToastIdsRef.current.delete(toastId)) return;
        if (closeToast) {
            closeToast(toastId);
            return;
        }
        // Compatibility fallback for legacy callers; the owner-aware caller passes closeToast.
        updateToast(toastId, { duration: 1 });
    }, [closeToast, updateToast]);

    const refreshCertifications = useCallback(async () => {
        const operation = beginOwnerOperation();
        if (!operation) {
            setCertifications([]);
            setListOwnerKey(null);
            setIsLoading(false);
            return [];
        }
        return runDedupedRefresh(refreshInFlightRef, async () => {
            await assertOwnerOperationCurrent(operation);
            const data = await certificationsService.list({
                force: true,
                expectedAuthCacheKey: operation.expectedAuthCacheKey,
            });
            await assertOwnerOperationCurrent(operation);
            setCertifications(data);
            setListOwnerKey(operation.expectedAuthCacheKey);
            return data;
        });
    }, [assertOwnerOperationCurrent, beginOwnerOperation]);

    // Initial Load
    useEffect(() => {
        const operation = beginOwnerOperation();
        setCertifications([]);
        setListOwnerKey(operation?.expectedAuthCacheKey ?? null);
        setExpandedCards(new Set());
        setCollapsingCards(new Set());
        setCardData(new Map());
        setOriginalCardData(new Map());
        setModifiedCards(new Set());
        setSavingCards(new Set());
        setIsCreating(false);
        setDeletingId(null);
        deletingOwnerKeyRef.current = null;
        cardRefs.current.clear();

        if (!operation) {
            setIsLoading(false);
            return undefined;
        }

        let cancelled = false;
        const loadCertifications = async () => {
            let shouldFinalizeLoading = false;
            try {
                await assertOwnerOperationCurrent(operation);
                if (cancelled) return;
                setIsLoading(true);
                const data = await certificationsService.list({
                    expectedAuthCacheKey: operation.expectedAuthCacheKey,
                });
                await assertOwnerOperationCurrent(operation);
                if (cancelled) return;
                setCertifications(data);
                setListOwnerKey(operation.expectedAuthCacheKey);
                shouldFinalizeLoading = true;
            } catch (caughtError) {
                if (!cancelled && !shouldIgnoreOwnerError(operation, caughtError)) {
                    try {
                        await assertOwnerOperationCurrent(operation);
                        shouldFinalizeLoading = true;
                    } catch (ownerError) {
                        if (!shouldIgnoreOwnerError(operation, ownerError)) {
                            console.error('Failed to verify certification owner:', ownerError);
                        }
                        return;
                    }
                    console.error('Failed to load certifications:', caughtError);
                }
            } finally {
                if (
                    shouldFinalizeLoading
                    && !cancelled
                    && isOwnerOperationCurrent(operation)
                ) {
                    setIsLoading(false);
                }
            }
        };
        void loadCertifications();
        return () => {
            cancelled = true;
        };
    }, [
        assertOwnerOperationCurrent,
        beginOwnerOperation,
        isOwnerOperationCurrent,
        shouldIgnoreOwnerError,
    ]);

    // External Refresh
    useEffect(() => {
        if (refreshSignal && isOwnerResolved) {
            refreshCertifications().catch((caughtError) => {
                if (!isAuthContextChangedError(caughtError)) {
                    console.error('Refresh failed', caughtError);
                }
            });
        }
    }, [isOwnerResolved, refreshSignal, refreshCertifications]);

    const sortedCertifications = useMemo(() => {
        return [...visibleCertifications].sort((a, b) => {
            const dateA = a.issue_date;
            const dateB = b.issue_date;
            const valA = parseYearMonthValue(dateA) ?? -1;
            const valB = parseYearMonthValue(dateB) ?? -1;
            return valB - valA;
        });
    }, [visibleCertifications]);

    // Card Helpers
    const ensureCardState = (id: string, seedData?: CertificationCardData) => {
        if (cardData.has(id)) return;
        const item = seedData ? null : visibleCertifications.find(c => c.id === id);
        const data = seedData || (item ? buildCertificationCardData(item) : { name: '', issuer: '', date: '' });
        setCardData(prev => new Map(prev).set(id, data));
        setOriginalCardData(prev => new Map(prev).set(id, cloneCertificationCardData(data)));
    };

    const toggleCard = (id: string, seedData?: CertificationCardData) => {
        const generation = ownerGenerationRef.current;
        const ownerKey = committedOwnerKeyRef.current;
        const isToggleCurrent = () => (
            generation === ownerGenerationRef.current
            && ownerKey === committedOwnerKeyRef.current
        );
        setExpandedCards(prev => {
            const next = new Set(prev);
            if (next.has(id)) {
                // Collapse
                setCollapsingCards(c => new Set(c).add(id));
                next.delete(id);
                setTimeout(() => {
                    if (!isToggleCurrent()) return;
                    setCollapsingCards(c => {
                        const updated = new Set(c);
                        updated.delete(id);
                        return updated;
                    });
                    // Scroll center
                    setTimeout(() => {
                        if (!isToggleCurrent()) return;
                        cardRefs.current.get(id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }, 50);
                }, 300);
            } else {
                // Expand
                next.add(id);
                ensureCardState(id, seedData);
                setTimeout(() => {
                    if (!isToggleCurrent()) return;
                    cardRefs.current.get(id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }, 100);
            }
            return next;
        });
    };

    const updateCardField = (id: string, field: keyof CertificationCardData, value: string) => {
        if (!isAuthenticated) {
            void onRequireAuth();
            return;
        }
        let nextData: CertificationCardData | null = null;
        setCardData(prev => {
            const next = new Map(prev);
            const current = next.get(id) || { name: '', issuer: '', date: '' };
            nextData = { ...current, [field]: value };
            next.set(id, nextData);
            return next;
        });

        const original = originalCardData.get(id);
        const isModified = original
            ? JSON.stringify(nextData || { name: '', issuer: '', date: '' }) !== JSON.stringify(original)
            : true;

        setModifiedCards(prev => {
            const next = new Set(prev);
            if (isModified) next.add(id);
            else next.delete(id);
            return next;
        });
    };

    const handleCancelEdit = (id: string) => {
        const original = originalCardData.get(id);
        if (original) {
            setCardData(prev => new Map(prev).set(id, cloneCertificationCardData(original)));
        }
        setModifiedCards(prev => {
            const next = new Set(prev);
            next.delete(id);
            return next;
        });
    };

    const requireAuth = useCallback(() => {
        if (!isAuthenticated) {
            void onRequireAuth();
            return true;
        }
        return !isOwnerResolved;
    }, [isAuthenticated, isOwnerResolved, onRequireAuth]);

    // Actions
    const handleAdd = async () => {
        if (requireAuth()) return;
        if (isCreating) return;
        const operation = beginOwnerOperation();
        if (!operation) return;
        let toastId: string | null = null;
        let didStartCreating = false;
        try {
            await assertOwnerOperationCurrent(operation);
            setIsCreating(true);
            didStartCreating = true;
            toastId = loading(CERT_TOAST_MESSAGES.createLoading);
            if (toastId) activeLoadingToastIdsRef.current.add(toastId);

            const newCert = await certificationsService.create({
                name: CERT_DEFAULT_NAME,
                issuer: CERT_DEFAULT_ISSUER,
                issue_date: getTodayLocalISODate(),
                description: buildCertificationMetaDescription(0),
            }, {
                expectedAuthCacheKey: operation.expectedAuthCacheKey,
            });
            await assertOwnerOperationCurrent(operation);

            const initialData = buildCertificationCardData(newCert);
            setCertifications(prev => [newCert, ...prev]);
            setListOwnerKey(operation.expectedAuthCacheKey);

            // Initialize card state
            setCardData(prev => new Map(prev).set(newCert.id, initialData));
            setOriginalCardData(prev => new Map(prev).set(newCert.id, cloneCertificationCardData(initialData)));
            setModifiedCards(prev => {
                const next = new Set(prev);
                next.delete(newCert.id);
                return next;
            });

            toggleCard(newCert.id, initialData);

            if (toastId) {
                activeLoadingToastIdsRef.current.delete(toastId);
                updateToast(toastId, { message: CERT_TOAST_MESSAGES.createSuccess, type: 'success', duration: 3000 });
            }
            else success(CERT_TOAST_MESSAGES.createSuccess);

        } catch (caughtError) {
            if (shouldIgnoreOwnerError(operation, caughtError)) {
                dismissStaleLoadingToast(toastId);
                return;
            }
            console.error('Failed to create cert:', caughtError);
            if (toastId) {
                activeLoadingToastIdsRef.current.delete(toastId);
                updateToast(toastId, { message: CERT_TOAST_MESSAGES.createError, type: 'error', duration: 3000 });
            }
            else error(CERT_TOAST_MESSAGES.createError);
        } finally {
            if (didStartCreating && isOwnerOperationCurrent(operation)) {
                setIsCreating(false);
            }
        }
    };

    const handleSave = async (id: string) => {
        if (requireAuth()) return;
        const operation = beginOwnerOperation();
        if (!operation) return;
        try {
            await assertOwnerOperationCurrent(operation);
        } catch (caughtError) {
            if (shouldIgnoreOwnerError(operation, caughtError)) return;
            console.error('Failed to verify certification owner:', caughtError);
            error(CERT_TOAST_MESSAGES.saveError);
            return;
        }
        const data = cardData.get(id);
        if (!data) return;

        if (!data.name.trim() || !data.issuer.trim()) {
            error('证书名称和颁发机构不能为空');
            return;
        }

        const issueDate = data.date.trim() ? convertDateToISO(data.date) : null;
        if (data.date.trim() && !issueDate) {
            error('获得时间格式不正确');
            return;
        }

        let toastId: string | null = null;
        try {
            setSavingCards(prev => new Set(prev).add(id));
            toastId = loading(CERT_TOAST_MESSAGES.saveLoading);
            if (toastId) activeLoadingToastIdsRef.current.add(toastId);

            // Preserve existing description/matchRate
            const existing = certifications.find(c => c.id === id);
            const description = existing?.description; // Keep as is

            await certificationsService.update(id, {
                name: data.name,
                issuer: data.issuer,
                issue_date: issueDate,
                description,
            }, {
                expectedAuthCacheKey: operation.expectedAuthCacheKey,
            });
            await assertOwnerOperationCurrent(operation);

            // Update local list
            setCertifications(prev => prev.map(c => {
                if (c.id !== id) return c;
                return {
                    ...c,
                    name: data.name,
                    issuer: data.issuer,
                    issue_date: issueDate,
                };
            }));

            // Update Local State
            setOriginalCardData(prev => new Map(prev).set(id, cloneCertificationCardData(data)));
            setModifiedCards(prev => {
                const next = new Set(prev);
                next.delete(id);
                return next;
            });

            if (toastId) {
                activeLoadingToastIdsRef.current.delete(toastId);
                updateToast(toastId, { message: CERT_TOAST_MESSAGES.saveSuccess, type: 'success', duration: 2000 });
            }
            else success(CERT_TOAST_MESSAGES.saveSuccess);

            toggleCard(id); // Collapse on save

        } catch (caughtError) {
            if (shouldIgnoreOwnerError(operation, caughtError)) {
                dismissStaleLoadingToast(toastId);
                return;
            }
            console.error('Failed to save cert:', caughtError);
            if (toastId) {
                activeLoadingToastIdsRef.current.delete(toastId);
                updateToast(toastId, { message: CERT_TOAST_MESSAGES.saveError, type: 'error', duration: 3000 });
            }
            else error(CERT_TOAST_MESSAGES.saveError);
        } finally {
            if (isOwnerOperationCurrent(operation)) {
                setSavingCards(prev => {
                    const next = new Set(prev);
                    next.delete(id);
                    return next;
                });
            }
        }
    };

    const handleRequestDelete = async (id: string) => {
        if (requireAuth()) return;
        const operation = beginOwnerOperation();
        if (!operation) return;
        try {
            await assertOwnerOperationCurrent(operation);
            deletingOwnerKeyRef.current = operation.expectedAuthCacheKey;
            setDeletingId(id);
        } catch (caughtError) {
            if (!shouldIgnoreOwnerError(operation, caughtError)) {
                console.error('Failed to verify certification owner:', caughtError);
            }
        }
    };

    const handleDelete = async () => {
        if (requireAuth()) return;
        const operation = beginOwnerOperation();
        if (
            !operation
            || !deletingId
            || deletingOwnerKeyRef.current !== operation.expectedAuthCacheKey
        ) return;
        const id = deletingId;
        let toastId: string | null = null;
        try {
            await assertOwnerOperationCurrent(operation);
            setDeletingId(null);
            deletingOwnerKeyRef.current = null;

            toastId = loading(CERT_TOAST_MESSAGES.deleteLoading);
            if (toastId) activeLoadingToastIdsRef.current.add(toastId);
            await certificationsService.delete(id, {
                expectedAuthCacheKey: operation.expectedAuthCacheKey,
            });
            await assertOwnerOperationCurrent(operation);

            setCertifications(prev => prev.filter(c => c.id !== id));

            if (toastId) {
                activeLoadingToastIdsRef.current.delete(toastId);
                updateToast(toastId, { message: CERT_TOAST_MESSAGES.deleteSuccess, type: 'success', duration: 2000 });
            }
            else success(CERT_TOAST_MESSAGES.deleteSuccess);

        } catch (caughtError) {
            if (shouldIgnoreOwnerError(operation, caughtError)) {
                dismissStaleLoadingToast(toastId);
                return;
            }
            console.error('Failed to delete cert:', caughtError);
            if (toastId) {
                activeLoadingToastIdsRef.current.delete(toastId);
                updateToast(toastId, { message: CERT_TOAST_MESSAGES.deleteError, type: 'error', duration: 3000 });
            }
            else error(CERT_TOAST_MESSAGES.deleteError);
        }
    };

    const visibleDeletingId = deletingOwnerKeyRef.current === currentOwnerKey
        ? deletingId
        : null;

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
                    <Award className="w-5 h-5 text-amber-500" />
                    证书资质
                    <span className="text-sm font-normal text-gray-400 ml-2">Certifications</span>
                </h2>
                <span className="text-xs font-mono text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded">
                    {visibleIsLoading ? '加载中...' : `${visibleCertifications.length} items`}
                </span>
            </div>

            {!isCollapsed && (
                <>
                    <button
                        onClick={handleAdd}
                        disabled={visibleIsLoading || isCreating || (isAuthenticated && !isOwnerResolved)}
                        className="w-full group border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-xl p-4 flex items-center justify-center gap-2 text-gray-500 hover:text-amber-600 hover:border-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/10 transition-all duration-300 disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                        <div className="p-1 rounded-full bg-gray-200 dark:bg-gray-800 group-hover:bg-white group-hover:text-amber-600 transition-colors">
                            <Plus className="w-5 h-5" />
                        </div>
                        <span className="font-medium">新增证书资质</span>
                    </button>

                    <div className="space-y-4">
                        {sortedCertifications.map(cert => {
                            const id = cert.id;
                            return (
                                <div key={id} ref={el => { if (el) cardRefs.current.set(id, el); else cardRefs.current.delete(id); }}>
                                    <CertificationCard
                                        data={cardData.get(id) || buildCertificationCardData(cert)}
                                        isExpanded={expandedCards.has(id)}
                                        isCollapsing={collapsingCards.has(id)}
                                        isModified={modifiedCards.has(id)}
                                        isSaving={savingCards.has(id)}
                                        onToggle={() => toggleCard(id)}
                                        onDelete={() => { void handleRequestDelete(id); }}
                                        onSave={() => handleSave(id)}
                                        onCancel={() => handleCancelEdit(id)}
                                        onFieldChange={(field, value) => updateCardField(id, field, value)}
                                    />
                                </div>
                            );
                        })}
                    </div>
                </>
            )}

            <ConfirmDialog
                isOpen={!!visibleDeletingId}
                title="确认删除"
                description="确定要删除这条证书资质吗？此操作无法撤销。"
                onConfirm={handleDelete}
                onCancel={() => {
                    deletingOwnerKeyRef.current = null;
                    setDeletingId(null);
                }}
            />
        </section>
    );
};

export default CertificationSection;

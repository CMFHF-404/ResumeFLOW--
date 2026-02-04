import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { Award, Plus } from 'lucide-react';
import { certificationsService, Certification as CertificationRecord } from '../services/certificationsService';
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
    updateToast: (id: string, updates: { message?: string; type?: 'success' | 'error' | 'loading'; duration?: number }) => void;
};

interface CertificationSectionProps {
    refreshSignal?: number;
    toast: ToastApi;
}

const CertificationSection: React.FC<CertificationSectionProps> = ({ refreshSignal, toast }) => {
    const { success, error, loading, updateToast } = toast;

    // State
    const [certifications, setCertifications] = useState<CertificationRecord[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const hasLoadedRef = useRef(false);
    const refreshInFlightRef = useRef<Promise<CertificationRecord[]> | null>(null);

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

    // Refs for scrolling
    const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());

    const refreshCertifications = useCallback(async () => {
        return runDedupedRefresh(refreshInFlightRef, async () => {
            const data = await certificationsService.list({ force: true });
            setCertifications(data);
            return data;
        });
    }, []);

    // Initial Load
    useEffect(() => {
        const loadCertifications = async () => {
            if (hasLoadedRef.current) return;
            try {
                setIsLoading(true);
                hasLoadedRef.current = true;
                const data = await certificationsService.list();
                setCertifications(data);
            } catch (err) {
                console.error('Failed to load certifications:', err);
                hasLoadedRef.current = false;
            } finally {
                setIsLoading(false);
            }
        };
        loadCertifications();
    }, []);

    // External Refresh
    useEffect(() => {
        if (refreshSignal) {
            refreshCertifications().catch(err => console.error('Refresh failed', err));
        }
    }, [refreshSignal, refreshCertifications]);

    const sortedCertifications = useMemo(() => {
        return [...certifications].sort((a, b) => {
            const dateA = a.issue_date;
            const dateB = b.issue_date;
            const valA = parseYearMonthValue(dateA) ?? -1;
            const valB = parseYearMonthValue(dateB) ?? -1;
            return valB - valA;
        });
    }, [certifications]);

    // Card Helpers
    const ensureCardState = (id: string, seedData?: CertificationCardData) => {
        if (cardData.has(id)) return;
        const item = seedData ? null : certifications.find(c => c.id === id);
        const data = seedData || (item ? buildCertificationCardData(item) : { name: '', issuer: '', date: '' });
        setCardData(prev => new Map(prev).set(id, data));
        setOriginalCardData(prev => new Map(prev).set(id, cloneCertificationCardData(data)));
    };

    const toggleCard = (id: string, seedData?: CertificationCardData) => {
        setExpandedCards(prev => {
            const next = new Set(prev);
            if (next.has(id)) {
                // Collapse
                setCollapsingCards(c => new Set(c).add(id));
                next.delete(id);
                setTimeout(() => {
                    setCollapsingCards(c => {
                        const updated = new Set(c);
                        updated.delete(id);
                        return updated;
                    });
                    // Scroll center
                    setTimeout(() => {
                        cardRefs.current.get(id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }, 50);
                }, 300);
            } else {
                // Expand
                next.add(id);
                ensureCardState(id, seedData);
                setTimeout(() => {
                    cardRefs.current.get(id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }, 100);
            }
            return next;
        });
    };

    const updateCardField = (id: string, field: keyof CertificationCardData, value: string) => {
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

    // Actions
    const handleAdd = async () => {
        if (isCreating) return;
        let toastId: string | null = null;
        try {
            setIsCreating(true);
            toastId = loading(CERT_TOAST_MESSAGES.createLoading);

            const newCert = await certificationsService.create({
                name: CERT_DEFAULT_NAME,
                issuer: CERT_DEFAULT_ISSUER,
                issue_date: getTodayLocalISODate(),
                description: buildCertificationMetaDescription(0),
            });

            const initialData = buildCertificationCardData(newCert);
            setCertifications(prev => [newCert, ...prev]);

            // Initialize card state
            setCardData(prev => new Map(prev).set(newCert.id, initialData));
            setOriginalCardData(prev => new Map(prev).set(newCert.id, cloneCertificationCardData(initialData)));
            setModifiedCards(prev => {
                const next = new Set(prev);
                next.delete(newCert.id);
                return next;
            });

            toggleCard(newCert.id, initialData);

            if (toastId) updateToast(toastId, { message: CERT_TOAST_MESSAGES.createSuccess, type: 'success', duration: 3000 });
            else success(CERT_TOAST_MESSAGES.createSuccess);

        } catch (err) {
            console.error('Failed to create cert:', err);
            if (toastId) updateToast(toastId, { message: CERT_TOAST_MESSAGES.createError, type: 'error', duration: 3000 });
            else error(CERT_TOAST_MESSAGES.createError);
        } finally {
            setIsCreating(false);
        }
    };

    const handleSave = async (id: string) => {
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

            // Preserve existing description/matchRate
            const existing = certifications.find(c => c.id === id);
            const description = existing?.description; // Keep as is

            await certificationsService.update(id, {
                name: data.name,
                issuer: data.issuer,
                issue_date: issueDate,
                description,
            });

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

            if (toastId) updateToast(toastId, { message: CERT_TOAST_MESSAGES.saveSuccess, type: 'success', duration: 2000 });
            else success(CERT_TOAST_MESSAGES.saveSuccess);

            toggleCard(id); // Collapse on save

        } catch (err) {
            console.error('Failed to save cert:', err);
            if (toastId) updateToast(toastId, { message: CERT_TOAST_MESSAGES.saveError, type: 'error', duration: 3000 });
            else error(CERT_TOAST_MESSAGES.saveError);
        } finally {
            setSavingCards(prev => {
                const next = new Set(prev);
                next.delete(id);
                return next;
            });
        }
    };

    const handleDelete = async () => {
        if (!deletingId) return;
        const id = deletingId;
        let toastId: string | null = null;
        try {
            setDeletingId(null);

            // Optimistic update
            setCertifications(prev => prev.filter(c => c.id !== id));

            toastId = loading(CERT_TOAST_MESSAGES.deleteLoading);
            await certificationsService.delete(id);

            if (toastId) updateToast(toastId, { message: CERT_TOAST_MESSAGES.deleteSuccess, type: 'success', duration: 2000 });
            else success(CERT_TOAST_MESSAGES.deleteSuccess);

        } catch (err) {
            console.error('Failed to delete cert:', err);
            if (toastId) updateToast(toastId, { message: CERT_TOAST_MESSAGES.deleteError, type: 'error', duration: 3000 });
            else error(CERT_TOAST_MESSAGES.deleteError);
            try {
                await refreshCertifications(); // Revert
            } catch (refreshErr) {
                console.error('Failed to refresh certifications after delete failure:', refreshErr);
            }
        }
    };

    return (
        <section className="space-y-6 pt-6 border-t border-gray-200 dark:border-gray-800">
            <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                    <Award className="w-5 h-5 text-amber-500" />
                    证书资质
                    <span className="text-sm font-normal text-gray-400 ml-2">Certifications</span>
                </h2>
                <span className="text-xs font-mono text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded">
                    {isLoading ? '加载中...' : `${certifications.length} items`}
                </span>
            </div>

            <button
                onClick={handleAdd}
                disabled={isLoading || isCreating}
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
                                onDelete={() => setDeletingId(id)}
                                onSave={() => handleSave(id)}
                                onCancel={() => handleCancelEdit(id)}
                                onFieldChange={(field, value) => updateCardField(id, field, value)}
                            />
                        </div>
                    );
                })}
            </div>

            <ConfirmDialog
                isOpen={!!deletingId}
                title="确认删除"
                description="确定要删除这条证书资质吗？此操作无法撤销。"
                onConfirm={handleDelete}
                onCancel={() => setDeletingId(null)}
            />
        </section>
    );
};

export default CertificationSection;

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  UploadCloud,
  X,
} from 'lucide-react';

import { experienceService } from '../services/experienceService';
import {
  ParsedExperienceItem,
  ParsedExperienceVersion,
  parserService,
} from '../services/parserService';

const SUPPORTED_EXTENSIONS = ['pdf', 'docx'];
const STAGE_TRANSITION_DELAY_MS = 180;

const CATEGORY_LABELS: Record<string, string> = {
  work: '工作经历',
  education: '教育经历',
  project: '项目经历',
};

const STAGE_LABELS = {
  uploading: '上传中',
  parsing: '解析中',
  analyzing: '查重中',
  ready: '完成',
  error: '失败',
  idle: '待上传',
};

type ParseStage = 'idle' | 'uploading' | 'parsing' | 'analyzing' | 'ready' | 'error';

const STAGE_PROGRESS: Record<ParseStage, number> = {
  idle: 0,
  uploading: 20,
  parsing: 60,
  analyzing: 85,
  ready: 100,
  error: 0,
};
const PARSE_TIMEOUT_MS = 30_000;
const TIMEOUT_ERROR_NAME = 'ResumeParseTimeout';

type ToastHandlers = {
  success: (message: string, duration?: number) => void;
  error: (message: string, duration?: number) => void;
  loading: (message: string) => string;
  updateToast: (id: string, updates: { message?: string; type?: 'success' | 'error'; duration?: number }) => void;
};

interface ResumeUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImported: () => Promise<void> | void;
  toast: ToastHandlers;
}

const buildEmptySet = () => new Set<string>();

const sleep = (duration: number) => new Promise((resolve) => setTimeout(resolve, duration));

const formatDateRange = (start?: string, end?: string, isCurrent?: boolean) => {
  const startLabel = start || '未知时间';
  if (isCurrent && !end) {
    return `${startLabel} - 至今`;
  }
  return `${startLabel} - ${end || '至今'}`;
};

const normalizeImportVersion = (version: ParsedExperienceVersion) => ({
  title: version.title,
  org: version.org || undefined,
  location: version.location || undefined,
  start_date: version.start_date || undefined,
  end_date: version.end_date || undefined,
  is_current: Boolean(version.is_current),
  summary: version.summary || undefined,
  highlights: version.highlights || [],
  tags: version.tags || [],
  star: version.star || {},
});

const isSupportedFile = (file: File) => {
  const extension = file.name.split('.').pop()?.toLowerCase();
  return extension ? SUPPORTED_EXTENSIONS.includes(extension) : false;
};

const buildDefaultSelection = (items: ParsedExperienceItem[]) => {
  return new Set(items.filter((item) => !item.duplicate?.is_duplicate).map((item) => item.id));
};

const createTimeoutError = () => {
  const error = new Error('解析超时');
  error.name = TIMEOUT_ERROR_NAME;
  return error;
};

const withTimeout = async <T,>(task: Promise<T>, timeoutMs: number): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => reject(createTimeoutError()), timeoutMs);
  });

  try {
    return await Promise.race([task, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
};

const resolveParseErrorMessage = (error: unknown) => {
  if (error instanceof Error && error.name === TIMEOUT_ERROR_NAME) {
    return '解析超时，请稍后重试。';
  }
  return '解析失败，请检查文件内容或稍后重试。';
};

const ProgressSteps: React.FC<{ stage: ParseStage }> = ({ stage }) => {
  const steps = [
    { key: 'uploading', label: STAGE_LABELS.uploading },
    { key: 'parsing', label: STAGE_LABELS.parsing },
    { key: 'analyzing', label: STAGE_LABELS.analyzing },
  ] as const;
  const activeIndex = steps.findIndex((step) => step.key === stage);
  const resolvedIndex = stage === 'ready' ? steps.length - 1 : activeIndex;

  return (
    <div className="flex items-center gap-3">
      {steps.map((step, index) => {
        const isActive = resolvedIndex >= index && stage !== 'error';
        return (
          <div key={step.key} className="flex items-center gap-2">
            <span
              className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold ${
                isActive
                  ? 'bg-emerald-500 text-white shadow-emerald-500/30 shadow'
                  : 'bg-gray-200 dark:bg-gray-700 text-gray-500'
              }`}
            >
              {isActive ? <CheckCircle2 className="w-4 h-4" /> : index + 1}
            </span>
            <span className={`text-xs ${isActive ? 'text-emerald-600' : 'text-gray-400'}`}>
              {step.label}
            </span>
            {index < steps.length - 1 && (
              <span className="w-8 h-px bg-gray-200 dark:bg-gray-700" />
            )}
          </div>
        );
      })}
    </div>
  );
};

const ResumeItemCard: React.FC<{
  item: ParsedExperienceItem;
  checked: boolean;
  onToggle: () => void;
}> = ({ item, checked, onToggle }) => {
  const { version, duplicate } = item;
  const headline = `${version.org || '未知机构'} · ${version.title}`;
  const isDuplicate = duplicate?.is_duplicate;

  return (
    <label
      className={`group flex items-start gap-4 rounded-xl border px-4 py-4 transition-all ${
        checked
          ? 'border-emerald-400 bg-emerald-50/50 dark:bg-emerald-900/10'
          : 'border-gray-200 dark:border-gray-700 bg-white/60 dark:bg-surface-dark'
      }`}
    >
      <input
        type="checkbox"
        className="mt-1 h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
        checked={checked}
        onChange={onToggle}
      />
      <div className="flex-1 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs px-2 py-1 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300">
            {CATEGORY_LABELS[item.category] || item.category}
          </span>
          {isDuplicate && (
            <span className="text-xs px-2 py-1 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
              可能重复 {duplicate.match_score ? `(${duplicate.match_score})` : ''}
            </span>
          )}
          <span className="text-sm font-semibold text-gray-900 dark:text-white">
            {headline}
          </span>
        </div>
        <div className="text-xs text-gray-500 dark:text-gray-400">
          {formatDateRange(version.start_date, version.end_date, version.is_current)}
        </div>
        {(version.star?.s || version.summary) && (
          <p className="text-sm text-gray-600 dark:text-gray-300 line-clamp-2">
            {version.star?.s || version.summary}
          </p>
        )}
        {version.highlights && version.highlights.length > 0 && (
          <div className="flex flex-wrap gap-2 text-xs text-gray-500">
            {version.highlights.slice(0, 3).map((itemText, index) => (
              <span
                key={`${item.id}-highlight-${index}`}
                className="px-2 py-1 rounded-full bg-gray-100 dark:bg-gray-800"
              >
                {itemText}
              </span>
            ))}
          </div>
        )}
      </div>
    </label>
  );
};

const ModalHeader: React.FC<{ onClose: () => void }> = ({ onClose }) => (
  <div className="flex items-start justify-between gap-4">
    <div>
      <p className="text-xs uppercase tracking-[0.3em] text-emerald-500">Resume Intake</p>
      <h3 className="text-2xl font-bold text-gray-900 dark:text-white">导入简历经验池</h3>
      <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
        上传 PDF/DOCX，自动拆解 STAR 并智能查重。
      </p>
    </div>
    <button
      type="button"
      onClick={onClose}
      className="rounded-full p-2 text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white transition"
    >
      <X className="w-5 h-5" />
    </button>
  </div>
);

const UploadDropzone: React.FC<{
  isDragging: boolean;
  inputRef: React.RefObject<HTMLInputElement>;
  onFileChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onDrop: (event: React.DragEvent<HTMLDivElement>) => void;
  onDragState: (next: boolean) => void;
}> = ({ isDragging, inputRef, onFileChange, onDrop, onDragState }) => (
  <div
    className={`relative rounded-2xl border-2 border-dashed px-6 py-8 text-center transition-all ${
      isDragging
        ? 'border-emerald-400 bg-emerald-50/70 dark:bg-emerald-900/20'
        : 'border-gray-200 dark:border-gray-700 bg-white/70 dark:bg-gray-900/40'
    }`}
    onDragOver={(event) => {
      event.preventDefault();
      onDragState(true);
    }}
    onDragLeave={() => onDragState(false)}
    onDrop={onDrop}
  >
    <UploadCloud className="w-10 h-10 text-emerald-500 mx-auto" />
    <p className="mt-3 text-sm font-medium text-gray-700 dark:text-gray-200">
      拖拽简历到这里，或点击选择文件
    </p>
    <p className="mt-1 text-xs text-gray-400">支持 PDF / DOCX</p>
    <input
      type="file"
      accept=".pdf,.docx"
      className="absolute inset-0 opacity-0 cursor-pointer"
      onChange={onFileChange}
      ref={inputRef}
    />
  </div>
);

const FileStatusCard: React.FC<{
  file: File | null;
  stage: ParseStage;
  progress: number;
  errorMessage: string | null;
}> = ({ file, stage, progress, errorMessage }) => (
  <div className="rounded-2xl border border-gray-100 dark:border-gray-800 bg-white/80 dark:bg-gray-900/60 p-4 space-y-3">
    <div className="flex items-center gap-3">
      <FileText className="w-5 h-5 text-gray-400" />
      <div className="flex-1">
        <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">
          {file ? file.name : '尚未选择文件'}
        </p>
        <p className="text-xs text-gray-400">状态：{STAGE_LABELS[stage]}</p>
      </div>
    </div>
    <ProgressSteps stage={stage} />
    <div className="h-2 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
      <div
        className="h-full bg-emerald-500 transition-all duration-500"
        style={{ width: `${progress}%` }}
      />
    </div>
    {errorMessage && (
      <div className="flex items-start gap-2 rounded-lg bg-red-50 dark:bg-red-900/20 p-3 text-xs text-red-600 dark:text-red-300">
        <AlertTriangle className="w-4 h-4 mt-0.5" />
        <span>{errorMessage}</span>
      </div>
    )}
  </div>
);

const UploadPanel: React.FC<{
  file: File | null;
  stage: ParseStage;
  progress: number;
  errorMessage: string | null;
  isDragging: boolean;
  inputRef: React.RefObject<HTMLInputElement>;
  onFileChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onDrop: (event: React.DragEvent<HTMLDivElement>) => void;
  onDragState: (next: boolean) => void;
  onReupload: () => void;
}> = ({
  file,
  stage,
  progress,
  errorMessage,
  isDragging,
  inputRef,
  onFileChange,
  onDrop,
  onDragState,
  onReupload,
}) => (
  <div className="space-y-4">
    <UploadDropzone
      isDragging={isDragging}
      inputRef={inputRef}
      onFileChange={onFileChange}
      onDrop={onDrop}
      onDragState={onDragState}
    />
    <FileStatusCard file={file} stage={stage} progress={progress} errorMessage={errorMessage} />
    <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
      <span>默认已勾选非重复条目</span>
      <button type="button" onClick={onReupload} className="hover:text-emerald-600 transition">
        重新上传
      </button>
    </div>
  </div>
);

const PreviewPanel: React.FC<{
  items: ParsedExperienceItem[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
}> = ({ items, selectedIds, onToggle, onToggleAll }) => (
  <div className="space-y-4">
    <div className="flex items-center justify-between">
      <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-200">
        解析结果预览
      </h4>
      <button
        type="button"
        onClick={onToggleAll}
        disabled={!items.length}
        className="text-xs text-emerald-600 hover:text-emerald-500 disabled:opacity-50"
      >
        {selectedIds.size === items.length ? '取消全选' : '全选'}
      </button>
    </div>
    <div className="space-y-3 max-h-[420px] overflow-y-auto pr-2">
      {!items.length ? (
        <div className="rounded-2xl border border-gray-100 dark:border-gray-800 bg-white/70 dark:bg-gray-900/40 p-8 text-center text-sm text-gray-400">
          解析完成后将在这里显示可导入的经历
        </div>
      ) : (
        items.map((item) => (
          <ResumeItemCard
            key={item.id}
            item={item}
            checked={selectedIds.has(item.id)}
            onToggle={() => onToggle(item.id)}
          />
        ))
      )}
    </div>
  </div>
);

const ModalFooter: React.FC<{
  selectedCount: number;
  onClose: () => void;
  onImport: () => void;
  isImporting: boolean;
}> = ({ selectedCount, onClose, onImport, isImporting }) => (
  <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
    <div className="text-sm text-gray-500 dark:text-gray-400">
      已选择 <span className="text-gray-900 dark:text-white font-semibold">{selectedCount}</span> 条
    </div>
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={onClose}
        className="px-4 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
      >
        取消
      </button>
      <button
        type="button"
        onClick={onImport}
        disabled={!selectedCount || isImporting}
        className="px-6 py-2 text-sm rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 transition disabled:opacity-50"
      >
        {isImporting ? '导入中...' : '导入所选'}
      </button>
    </div>
  </div>
);

const useResumeItems = () => {
  const [items, setItems] = useState<ParsedExperienceItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(buildEmptySet);

  const selectedItems = useMemo(
    () => items.filter((item) => selectedIds.has(item.id)),
    [items, selectedIds]
  );

  const applyParsedItems = useCallback((nextItems: ParsedExperienceItem[]) => {
    setItems(nextItems);
    setSelectedIds(buildDefaultSelection(nextItems));
  }, []);

  const resetSelection = useCallback(() => {
    setItems([]);
    setSelectedIds(buildEmptySet());
  }, []);

  const toggleSelection = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelectedIds((prev) => {
      if (prev.size === items.length) {
        return buildEmptySet();
      }
      return new Set(items.map((item) => item.id));
    });
  }, [items]);

  return {
    items,
    selectedIds,
    selectedItems,
    applyParsedItems,
    resetSelection,
    toggleSelection,
    toggleSelectAll,
  };
};

const useResumeParsing = (applyParsedItems: (items: ParsedExperienceItem[]) => void, toast: ToastHandlers) => {
  const [file, setFile] = useState<File | null>(null);
  const [stage, setStage] = useState<ParseStage>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const resetParsing = useCallback(() => {
    setFile(null);
    setStage('idle');
    setErrorMessage(null);
    setIsDragging(false);
  }, []);

  const handleFileParse = useCallback(
    async (nextFile: File) => {
      applyParsedItems([]);
      if (!isSupportedFile(nextFile)) {
        setErrorMessage('仅支持 PDF 或 DOCX 格式的简历。');
        setStage('error');
        return;
      }
      setErrorMessage(null);
      setStage('uploading');
      setFile(nextFile);

      try {
        await sleep(STAGE_TRANSITION_DELAY_MS);
        setStage('parsing');
        const response = await withTimeout(parserService.parseResume(nextFile), PARSE_TIMEOUT_MS);
        await sleep(STAGE_TRANSITION_DELAY_MS);
        setStage('analyzing');
        await sleep(STAGE_TRANSITION_DELAY_MS);
        applyParsedItems(response.items || []);
        setStage('ready');
        toast.success('简历解析完成');
      } catch (error) {
        console.error('[ResumeUploadModal] Failed to parse resume:', error);
        const message = resolveParseErrorMessage(error);
        setErrorMessage(message);
        setStage('error');
        toast.error(message);
      }
    },
    [applyParsedItems, toast]
  );

  const handleFileChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const nextFile = event.target.files?.[0];
      if (nextFile) {
        handleFileParse(nextFile);
      }
    },
    [handleFileParse]
  );

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const nextFile = event.dataTransfer.files?.[0];
      setIsDragging(false);
      if (nextFile) {
        handleFileParse(nextFile);
      }
    },
    [handleFileParse]
  );

  return {
    file,
    stage,
    errorMessage,
    isDragging,
    setIsDragging,
    handleFileChange,
    handleDrop,
    resetParsing,
  };
};

const useResumeImport = (
  selectedItems: ParsedExperienceItem[],
  toast: ToastHandlers,
  onImported: () => Promise<void> | void,
  onClose: () => void
) => {
  const [isImporting, setIsImporting] = useState(false);

  const handleImport = useCallback(async () => {
    if (!selectedItems.length) {
      toast.error('请选择要导入的经历');
      return;
    }

    let toastId: string | null = null;
    try {
      setIsImporting(true);
      toastId = toast.loading('正在导入选择的经历...');
      let successCount = 0;
      for (const item of selectedItems) {
        await experienceService.create({
          category: item.category,
          version: normalizeImportVersion(item.version),
        });
        successCount += 1;
      }
      if (toastId) {
        toast.updateToast(toastId, {
          message: `已导入 ${successCount} 条经历`,
          type: 'success',
          duration: 2500,
        });
      } else {
        toast.success(`已导入 ${successCount} 条经历`);
      }
      await onImported();
      onClose();
    } catch (error) {
      console.error('[ResumeUploadModal] Import failed:', error);
      if (toastId) {
        toast.updateToast(toastId, {
          message: '导入失败，请稍后重试',
          type: 'error',
          duration: 3000,
        });
      } else {
        toast.error('导入失败，请稍后重试');
      }
    } finally {
      setIsImporting(false);
    }
  }, [onClose, onImported, selectedItems, toast]);

  return { isImporting, handleImport };
};

const ResumeUploadModal: React.FC<ResumeUploadModalProps> = ({ isOpen, onClose, onImported, toast }) => {
  const { items, selectedIds, selectedItems, applyParsedItems, resetSelection, toggleSelection, toggleSelectAll } = useResumeItems();
  const {
    file,
    stage,
    errorMessage,
    isDragging,
    setIsDragging,
    handleFileChange,
    handleDrop,
    resetParsing,
  } = useResumeParsing(applyParsedItems, toast);
  const { isImporting, handleImport } = useResumeImport(selectedItems, toast, onImported, onClose);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const progress = STAGE_PROGRESS[stage];
  const resetAll = useCallback(() => {
    resetParsing();
    resetSelection();
  }, [resetParsing, resetSelection]);
  const handleReupload = useCallback(() => {
    resetAll();
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  }, [resetAll]);
  const handleFileChangeWithReset = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const nextFile = event.target.files?.[0];
      if (nextFile) {
        resetAll();
      }
      handleFileChange(event);
    },
    [handleFileChange, resetAll]
  );
  const handleDropWithReset = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      const nextFile = event.dataTransfer.files?.[0];
      if (nextFile) {
        resetAll();
      }
      handleDrop(event);
    },
    [handleDrop, resetAll]
  );
  useEffect(() => {
    if (!isOpen) {
      resetAll();
    }
  }, [isOpen, resetAll]);
  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/50 backdrop-blur-md px-4">
      <div className="relative w-full max-w-5xl rounded-3xl border border-white/20 bg-gradient-to-br from-white/95 via-white/85 to-emerald-50/80 dark:from-gray-900 dark:via-gray-900/95 dark:to-emerald-900/20 shadow-2xl">
        <div className="absolute inset-x-0 -top-20 h-40 rounded-full bg-emerald-400/20 blur-3xl" />
        <div className="relative p-6">
          <ModalHeader onClose={onClose} />
          <div className="mt-6 grid grid-cols-1 lg:grid-cols-[1.1fr_1.9fr] gap-6">
            <UploadPanel
              file={file}
              stage={stage}
              progress={progress}
              errorMessage={errorMessage}
              isDragging={isDragging}
              inputRef={fileInputRef}
              onFileChange={handleFileChangeWithReset}
              onDrop={handleDropWithReset}
              onDragState={setIsDragging}
              onReupload={handleReupload}
            />
            <PreviewPanel
              items={items}
              selectedIds={selectedIds}
              onToggle={toggleSelection}
              onToggleAll={toggleSelectAll}
            />
          </div>
          <ModalFooter
            selectedCount={selectedItems.length}
            onClose={onClose}
            onImport={handleImport}
            isImporting={isImporting}
          />
        </div>
      </div>
    </div>
  );
};

export default ResumeUploadModal;

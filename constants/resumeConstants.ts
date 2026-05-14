export const DEFAULT_RESUME_TITLE = "未命名简历";
export const UNTITLED_RESUME_TITLE = "未命名简历";

/** 用于预览/页眉等：占位标题不展示 */
export const resolveResumeDisplayTitle = (value?: string | null): string | undefined => {
    const trimmed = (value ?? "").trim();
    if (!trimmed || trimmed === DEFAULT_RESUME_TITLE) {
        return undefined;
    }
    return trimmed;
};

export const MATCH_BADGE_STYLES = {
  emerald: {
    soft: "bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400",
    solid: "bg-emerald-500/20 text-emerald-700 dark:text-emerald-200",
  },
  amber: {
    soft: "bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400",
    solid: "bg-amber-500/20 text-amber-700 dark:text-amber-200",
  },
  rose: {
    soft: "bg-rose-50 text-rose-600 dark:bg-rose-900/20 dark:text-rose-400",
    solid: "bg-rose-500/20 text-rose-700 dark:text-rose-200",
  },
} as const;

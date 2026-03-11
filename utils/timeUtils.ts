const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;
const MONTH_MS = 30 * DAY_MS;

export const formatRelativeTime = (dateStr: string): string => {
    const date = new Date(dateStr);
    if (!Number.isFinite(date.getTime())) {
        return dateStr;
    }
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / MINUTE_MS);
    const diffHours = Math.floor(diffMs / HOUR_MS);
    const diffDays = Math.floor(diffMs / DAY_MS);

    if (diffMins < 60) {
        return `${diffMins}分钟前`;
    }
    if (diffHours < 24) {
        return `${diffHours}小时前`;
    }
    if (diffDays < 7) {
        return `${diffDays}天前`;
    }
    if (diffDays < 30) {
        return `${Math.floor(diffDays / 7)}周前`;
    }
    return `${Math.floor(diffDays / 30)}个月前`;
};

export const formatDateLabel = (dateStr: string): string => {
    const date = new Date(dateStr);
    if (!Number.isFinite(date.getTime())) {
        return dateStr;
    }
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}.${month}.${day}`;
};

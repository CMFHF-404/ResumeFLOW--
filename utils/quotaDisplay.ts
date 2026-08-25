export const formatTokenAmount = (value?: number | null): string => {
  const safeValue = Math.max(Number(value || 0), 0);
  if (safeValue >= 1_000_000) {
    return `${(safeValue / 1_000_000).toFixed(safeValue % 1_000_000 === 0 ? 0 : 1)}M`;
  }
  if (safeValue >= 1_000) {
    return `${(safeValue / 1_000).toFixed(safeValue % 1_000 === 0 ? 0 : 1)}k`;
  }
  return safeValue.toLocaleString();
};

export const formatDateTime = (value?: string | null): string => {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
};

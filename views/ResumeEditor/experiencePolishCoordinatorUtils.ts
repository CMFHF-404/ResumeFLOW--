export type BatchPolishOpenState = {
    isFloatingExperiencePolishRunning: boolean;
    hasFloatingPolishSession: boolean;
    activeFloatingPolishExperienceId: string | null;
};

export const resolveBatchPolishOpenBlockMessage = ({
    isFloatingExperiencePolishRunning,
    hasFloatingPolishSession,
    activeFloatingPolishExperienceId,
}: BatchPolishOpenState) => {
    if (isFloatingExperiencePolishRunning) {
        return '请等待当前润色完成后再继续操作';
    }
    if (hasFloatingPolishSession) {
        return '请先确认或撤销当前润色结果';
    }
    if (activeFloatingPolishExperienceId) {
        return '请先关闭当前润色工具栏';
    }
    return null;
};

export const shouldResetFloatingPolishModeForBatch = (mode: string) => mode === 'smart_complete';

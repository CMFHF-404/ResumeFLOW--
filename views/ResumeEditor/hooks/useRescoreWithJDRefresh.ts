import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { JDAnalyzeOutcome } from '../../../hooks/useJDAnalysisExecution';
import type { ResumeEvaluationOutcome } from '../../../hooks/useResumeEvaluation';

type Options = {
    inputKey: string;
    needsJDRefresh: boolean;
    jdResultIdentity: string;
    refreshJD: (isCurrent: () => boolean) => Promise<JDAnalyzeOutcome>;
    resultIdentity: (result: Extract<JDAnalyzeOutcome, { status: 'success' }>['result']) => string;
    evaluate: (isCurrent: () => boolean) => Promise<ResumeEvaluationOutcome | undefined>;
    stopJD: () => void;
    stopEvaluation: () => void;
    onRefreshFailure: () => void;
};

export const useRescoreWithJDRefresh = (options: Options) => {
    const latest = useRef(options);
    const active = useRef<{ finish: (value: ResumeEvaluationOutcome | undefined) => void } | null>(null);
    const [isRunning, setIsRunning] = useState(false);
    const [pending, setPending] = useState<{ request: NonNullable<typeof active.current>; identity: string } | null>(null);
    useLayoutEffect(() => { latest.current = options; });

    const stop = useCallback(() => {
        if (active.current) {
            latest.current.stopJD();
            active.current.finish({ status: 'aborted' });
        }
        latest.current.stopEvaluation();
    }, []);
    useLayoutEffect(() => stop, [options.inputKey, stop]);

    // Continue only after React has committed the refreshed JD into the scoring
    // hook. Calling evaluate immediately after refreshJD would read its old refs.
    useEffect(() => {
        if (!pending || active.current !== pending.request) return;
        setPending(null);
        if (options.needsJDRefresh || options.jdResultIdentity !== pending.identity) {
            pending.request.finish({ status: 'aborted' });
            return;
        }
        void options.evaluate(() => active.current === pending.request).then(
            pending.request.finish, () => pending.request.finish({ status: 'error' }),
        );
    }, [pending, options.needsJDRefresh, options.jdResultIdentity, options.evaluate]);

    const run = useCallback((): Promise<ResumeEvaluationOutcome | undefined> => {
        if (active.current) return Promise.resolve({ status: 'aborted' });
        const start = latest.current;
        return new Promise((resolve) => {
            const request = {
                finish: (outcome: ResumeEvaluationOutcome | undefined) => {
                    if (active.current === request) {
                        active.current = null;
                        setIsRunning(false);
                        setPending(null);
                    }
                    resolve(outcome);
                },
            };
            active.current = request;
            setIsRunning(true);
            void (async () => {
                if (!start.needsJDRefresh) {
                    request.finish(await start.evaluate(() => active.current === request));
                    return;
                }
                const outcome = await start.refreshJD(() => (
                    active.current === request && latest.current.inputKey === start.inputKey
                ));
                if (active.current !== request) return;
                if (latest.current.inputKey !== start.inputKey) {
                    request.finish({ status: 'aborted' });
                } else if (outcome.status === 'success' || outcome.status === 'no_change') {
                    setPending({ request, identity: outcome.status === 'success'
                        ? start.resultIdentity(outcome.result) : start.jdResultIdentity });
                } else {
                    if (outcome.status !== 'aborted') latest.current.onRefreshFailure();
                    request.finish({ status: outcome.status === 'aborted' ? 'aborted' : 'error' });
                }
            })().catch(() => {
                if (active.current === request) latest.current.onRefreshFailure();
                request.finish({ status: 'error' });
            });
        });
    }, []);
    return { run, stop, isRunning };
};

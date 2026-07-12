export type JDAnalyzeWorkflowCoordinator<Result, AutoNameContext> = {
    run: (
        workflow: (isCurrent: () => boolean) => Promise<Result>,
        options: {
            requestAutoName: boolean;
            autoNameContext: AutoNameContext;
            applyAutoName: (result: Result, context: AutoNameContext) => Promise<void>;
        }
    ) => Promise<Result>;
    invalidate: () => void;
};

export const createJDAnalyzeWorkflowCoordinator = <Result, AutoNameContext>(): JDAnalyzeWorkflowCoordinator<
    Result,
    AutoNameContext
> => {
    let inFlight: Promise<Result> | null = null;
    let shouldAutoName = false;
    let generation = 0;

    return {
        run(workflow, options) {
            if (options.requestAutoName) {
                shouldAutoName = true;
            }
            if (inFlight) {
                return inFlight;
            }

            shouldAutoName = options.requestAutoName;
            const requestGeneration = generation;
            const isCurrent = () => generation === requestGeneration;
            const request = (async () => {
                const result = await workflow(isCurrent);
                if (isCurrent() && shouldAutoName) {
                    await options.applyAutoName(result, options.autoNameContext);
                }
                return result;
            })();
            inFlight = request;
            const clearRequest = () => {
                if (inFlight === request) {
                    inFlight = null;
                    shouldAutoName = false;
                }
            };
            void request.then(clearRequest, clearRequest);
            return request;
        },
        invalidate() {
            generation += 1;
            inFlight = null;
            shouldAutoName = false;
        },
    };
};

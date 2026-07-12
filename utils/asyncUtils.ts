export type PromiseRef<T> = {
  current: Promise<T> | null;
};

export const runDedupedRefresh = async <T,>(
  inFlightRef: PromiseRef<T>,
  task: () => Promise<T>
): Promise<T> => {
  if (inFlightRef.current) {
    return inFlightRef.current;
  }
  let request: Promise<T>;
  request = task().finally(() => {
    if (inFlightRef.current === request) {
      inFlightRef.current = null;
    }
  });
  inFlightRef.current = request;
  return request;
};

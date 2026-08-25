export type OwnerScopedValue<T> = Readonly<{
  ownerKey: string;
  value: T;
}>;

const isResolvedOwnerKey = (ownerKey: string | null | undefined): ownerKey is string => (
  typeof ownerKey === 'string'
  && ownerKey.trim().length > 0
  && ownerKey !== 'anonymous'
);

export const bindOwnerScopedValue = <T,>(
  activeOwnerKey: string | null | undefined,
  expectedOwnerKey: string | null | undefined,
  valueOwnerKey: string | null | undefined,
  value: T,
): OwnerScopedValue<T> | null => {
  if (
    !isResolvedOwnerKey(activeOwnerKey)
    || activeOwnerKey !== expectedOwnerKey
    || activeOwnerKey !== valueOwnerKey
  ) {
    return null;
  }
  return { ownerKey: activeOwnerKey, value };
};

export const readOwnerScopedValue = <T,>(
  activeOwnerKey: string | null | undefined,
  scopedValue: OwnerScopedValue<T> | null,
): T | null => (
  isResolvedOwnerKey(activeOwnerKey) && scopedValue?.ownerKey === activeOwnerKey
    ? scopedValue.value
    : null
);

export const isOwnerOperationCurrent = (
  cancelled: boolean,
  activeOwnerKey: string | null | undefined,
  expectedOwnerKey: string,
) => !cancelled && isResolvedOwnerKey(activeOwnerKey) && activeOwnerKey === expectedOwnerKey;

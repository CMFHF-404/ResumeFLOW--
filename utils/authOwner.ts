/**
 * Matches the established owner-scoped storage contract: only a non-empty
 * string other than the anonymous sentinel may address owner data.
 */
export const isAuthenticatedOwnerKey = (
  ownerKey: string | null | undefined,
): ownerKey is string => (
  typeof ownerKey === 'string'
  && ownerKey.trim().length > 0
  && ownerKey !== 'anonymous'
);

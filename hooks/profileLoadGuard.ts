export type ProfileLoadRequest = Readonly<{
  ownerKey: string;
  generation: number;
}>;

export type ProfileLoadGuard = {
  transitionOwner: (ownerKey: string | null) => void;
  invalidate: () => void;
  beginRequest: (ownerKey: string) => ProfileLoadRequest | null;
  isCurrent: (request: ProfileLoadRequest) => boolean;
};

export const createProfileLoadGuard = (): ProfileLoadGuard => {
  let activeOwnerKey: string | null = null;
  let generation = 0;

  return {
    transitionOwner(ownerKey) {
      activeOwnerKey = ownerKey;
      generation += 1;
    },
    invalidate() {
      generation += 1;
    },
    beginRequest(ownerKey) {
      if (!ownerKey || ownerKey !== activeOwnerKey) {
        return null;
      }
      generation += 1;
      return { ownerKey, generation };
    },
    isCurrent(request) {
      return (
        activeOwnerKey === request.ownerKey
        && generation === request.generation
      );
    },
  };
};

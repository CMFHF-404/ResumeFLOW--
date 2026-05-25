import type { Dispatch, SetStateAction } from 'react';

export const createDraftId = (prefix: string) => {
    const random = Math.random().toString(16).slice(2, 6);
    return `${prefix}-${Date.now()}-${random}`;
};

export const isDraftId = (id: string, prefix: string) => id.startsWith(prefix);

export const addToSet = (prev: Set<string>, id: string) => {
    const next = new Set(prev);
    next.add(id);
    return next;
};

export const removeFromSet = (prev: Set<string>, id: string) => {
    const next = new Set(prev);
    next.delete(id);
    return next;
};

export const toggleInSet = (prev: Set<string>, id: string) => {
    const next = new Set(prev);
    if (next.has(id)) {
        next.delete(id);
    } else {
        next.add(id);
    }
    return next;
};

export const setMapEntry = <K, V>(prev: Map<K, V>, key: K, value: V) => {
    const next = new Map(prev);
    next.set(key, value);
    return next;
};

export const deleteMapEntry = <K, V>(prev: Map<K, V>, key: K) => {
    const next = new Map(prev);
    next.delete(key);
    return next;
};

export const runWithFlag = async <T>(
    id: string,
    flagSet: Set<string>,
    setFlagSet: Dispatch<SetStateAction<Set<string>>>,
    task: () => Promise<T>
) => {
    if (flagSet.has(id)) {
        return null;
    }
    setFlagSet((prev) => addToSet(prev, id));
    try {
        return await task();
    } finally {
        setFlagSet((prev) => removeFromSet(prev, id));
    }
};

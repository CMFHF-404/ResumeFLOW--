export type DragItemType = 'experience' | 'education' | 'certification' | 'skillGroup';

export type ParsedDragItemKey = {
    type: DragItemType;
    id: string;
};

const DRAG_ITEM_TYPES = new Set<DragItemType>([
    'experience',
    'education',
    'certification',
    'skillGroup',
]);

export const buildDragItemKey = (type: DragItemType, id: string) => `${type}:${id}`;

export const parseDragItemKey = (key: string | null | undefined): ParsedDragItemKey | null => {
    if (!key) {
        return null;
    }
    const separatorIndex = key.indexOf(':');
    if (separatorIndex <= 0) {
        return null;
    }
    const type = key.slice(0, separatorIndex) as DragItemType;
    if (!DRAG_ITEM_TYPES.has(type)) {
        return null;
    }
    return { type, id: key.slice(separatorIndex + 1) };
};


import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  buildDropdownAnchor,
  resolveDropdownPosition,
  type DropdownAnchor,
  type DropdownPosition,
} from './dashboardUtils';

const DROPDOWN_WIDTH = 192;
const DROPDOWN_ESTIMATED_HEIGHT = 200;

export const useDashboardDropdown = () => {
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const [dropdownAnchor, setDropdownAnchor] = useState<DropdownAnchor | null>(null);
  const [dropdownPos, setDropdownPos] = useState<DropdownPosition | null>(null);

  const closeDropdown = useCallback(() => {
    setOpenDropdownId(null);
    setDropdownPos(null);
    setDropdownAnchor(null);
  }, []);

  const syncDropdownPosition = useCallback((anchor: DropdownAnchor) => {
    if (!dropdownRef.current) {
      return;
    }
    const rect = dropdownRef.current.getBoundingClientRect();
    const nextPos = resolveDropdownPosition(anchor, { width: rect.width, height: rect.height });
    setDropdownPos((prev) => {
      if (prev && prev.top === nextPos.top && prev.left === nextPos.left) {
        return prev;
      }
      return nextPos;
    });
  }, []);

  const openDropdown = useCallback((id: string, trigger: Pick<DOMRect, 'top' | 'right' | 'bottom' | 'left'>) => {
    const anchor = buildDropdownAnchor(trigger);
    setOpenDropdownId(id);
    setDropdownAnchor(anchor);
    setDropdownPos(resolveDropdownPosition(anchor, { width: DROPDOWN_WIDTH, height: DROPDOWN_ESTIMATED_HEIGHT }));
  }, []);

  useLayoutEffect(() => {
    if (!openDropdownId || !dropdownAnchor) {
      return;
    }
    syncDropdownPosition(dropdownAnchor);
  }, [dropdownAnchor, openDropdownId, syncDropdownPosition]);

  useEffect(() => {
    if (!openDropdownId || !dropdownAnchor) {
      return;
    }
    const handleResize = () => syncDropdownPosition(dropdownAnchor);
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [dropdownAnchor, openDropdownId, syncDropdownPosition]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Element;
      if (!target.closest('.dropdown-menu') && !target.closest('.dropdown-trigger')) {
        closeDropdown();
      }
    };
    const handleScroll = () => closeDropdown();
    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [closeDropdown]);

  return {
    closeDropdown,
    dropdownPos,
    dropdownRef,
    openDropdown,
    openDropdownId,
  };
};

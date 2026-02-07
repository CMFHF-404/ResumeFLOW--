import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

const PRINT_ROOT_ID = 'rf-print-root';

const ensurePrintRoot = () => {
  let root = document.getElementById(PRINT_ROOT_ID);
  if (!root) {
    root = document.createElement('div');
    root.id = PRINT_ROOT_ID;
    document.body.appendChild(root);
  }
  return root;
};

type PrintPortalProps = {
  isActive: boolean;
  children: React.ReactNode;
};

const PrintPortal: React.FC<PrintPortalProps> = ({ isActive, children }) => {
  const [root, setRoot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!isActive) {
      setRoot(null);
      return;
    }
    setRoot(ensurePrintRoot());
  }, [isActive]);

  if (!isActive || !root) {
    return null;
  }

  return createPortal(
    <div className="rf-print-surface">
      {children}
    </div>,
    root
  );
};

export default PrintPortal;

import React, { useLayoutEffect } from 'react';

/** Own the document scroll boundary only while the editor shell is mounted. */
const AppViewport: React.FC<React.PropsWithChildren<{ isEditor: boolean }>> = ({ isEditor, children }) => {
  useLayoutEffect(() => {
    if (!isEditor) return;
    const root = document.documentElement;
    const previous = root.getAttribute('data-rf-editor-viewport');
    root.setAttribute('data-rf-editor-viewport', 'true');
    return () => {
      if (previous === null) root.removeAttribute('data-rf-editor-viewport');
      else root.setAttribute('data-rf-editor-viewport', previous);
    };
  }, [isEditor]);

  return (
    <div data-editor-viewport={isEditor} className="rf-app-viewport flex h-[100dvh] min-h-[100dvh] w-full flex-col md:h-screen md:min-h-screen md:flex-row">
      {children}
    </div>
  );
};

export default AppViewport;

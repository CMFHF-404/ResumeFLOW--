import React, { useLayoutEffect } from 'react';

/** Own the document scroll boundary while the signed-in app shell is mounted. */
const AppViewport: React.FC<React.PropsWithChildren<{ isEditor: boolean }>> = ({ isEditor, children }) => {
  useLayoutEffect(() => {
    const root = document.documentElement;
    const previous = root.getAttribute('data-rf-app-viewport');
    root.setAttribute('data-rf-app-viewport', 'true');
    return () => {
      if (previous === null) root.removeAttribute('data-rf-app-viewport');
      else root.setAttribute('data-rf-app-viewport', previous);
    };
  }, []);

  return (
    <div data-editor-viewport={isEditor} className="rf-app-viewport flex h-[100dvh] min-h-[100dvh] w-full flex-col md:h-screen md:min-h-screen md:flex-row">
      {children}
    </div>
  );
};

export default AppViewport;

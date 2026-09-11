import type React from 'react';

/** Add keyboard activation only to the focused click target, never its children. */
export const activateOnEnterOrSpace = (event: React.KeyboardEvent<HTMLElement>) => {
  if (event.target !== event.currentTarget || event.defaultPrevented || event.repeat) return;
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  event.currentTarget.click();
};

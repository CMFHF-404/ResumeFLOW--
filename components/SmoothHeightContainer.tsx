import React, { useState, useLayoutEffect, useRef } from 'react';

interface SmoothHeightContainerProps {
  children: React.ReactNode;
  className?: string;
}

export const SmoothHeightContainer: React.FC<SmoothHeightContainerProps> = ({ children, className = '' }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | 'auto'>('auto');

  useLayoutEffect(() => {
    if (containerRef.current) {
      const currentHeight = containerRef.current.scrollHeight;
      setHeight(currentHeight);
    }
  }, [children]);

  return (
    <div
      style={{
        height: height === 'auto' ? 'auto' : `${height}px`,
        transition: 'height 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
      }}
      className={`overflow-hidden ${className}`}
    >
      <div ref={containerRef}>
        {children}
      </div>
    </div>
  );
};

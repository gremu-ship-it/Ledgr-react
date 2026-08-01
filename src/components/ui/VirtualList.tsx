import { useRef, useState, useMemo, useEffect, type ReactNode } from 'react';

interface VirtualListProps<T> {
  items: T[];
  itemHeight: number; // px
  containerHeight: number; // px
  renderItem: (item: T, index: number) => ReactNode;
  overscan?: number;
  keyExtractor?: (item: T, index: number) => string;
  className?: string;
}

export function VirtualList<T>({
  items,
  itemHeight,
  containerHeight,
  renderItem,
  overscan = 5,
  keyExtractor,
  className,
}: VirtualListProps<T>) {
  const [scrollTop, setScrollTop] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const totalHeight = items.length * itemHeight;

  const visibleRange = useMemo(() => {
    const start = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
    const end = Math.min(items.length, Math.ceil((scrollTop + containerHeight) / itemHeight) + overscan);
    return { start, end };
  }, [scrollTop, itemHeight, containerHeight, items.length, overscan]);

  const visibleItems = useMemo(() => {
    return items.slice(visibleRange.start, visibleRange.end).map((item, idx) => {
      const actualIndex = visibleRange.start + idx;
      return {
        item,
        index: actualIndex,
        top: actualIndex * itemHeight,
      };
    });
  }, [items, visibleRange, itemHeight]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onScroll = () => setScrollTop(el.scrollTop);
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  // If items less than container, don't virtualize — just render all for simplicity
  if (items.length * itemHeight <= containerHeight * 1.5) {
    return (
      <div className={className} style={{ maxHeight: containerHeight, overflowY: 'auto' }}>
        {items.map((item, i) => (
          <div key={keyExtractor ? keyExtractor(item, i) : i}>{renderItem(item, i)}</div>
        ))}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ height: containerHeight, overflowY: 'auto', position: 'relative' }}
    >
      <div style={{ height: totalHeight, position: 'relative' }}>
        {visibleItems.map(({ item, index, top }) => (
          <div
            key={keyExtractor ? keyExtractor(item, index) : index}
            style={{
              position: 'absolute',
              top,
              left: 0,
              right: 0,
              height: itemHeight,
            }}
          >
            {renderItem(item, index)}
          </div>
        ))}
      </div>
    </div>
  );
}

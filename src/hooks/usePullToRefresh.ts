import { useEffect, useRef, useState, useCallback, type RefObject } from 'react';

interface UsePullToRefreshOptions {
  onRefresh: () => Promise<void> | void;
  threshold?: number;
  disabled?: boolean;
}

export interface UsePullToRefreshResult {
  containerRef: RefObject<HTMLDivElement | null>;
  pullDistance: number;
  isRefreshing: boolean;
  progress: number;
}

export function usePullToRefresh({ onRefresh, threshold = 80, disabled = false }: UsePullToRefreshOptions): UsePullToRefreshResult {
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const startY = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleTouchStart = useCallback((e: TouchEvent) => {
    if (disabled || isRefreshing) return;
    const container = containerRef.current;
    if (!container) return;
    // Only trigger if scrolled to top
    if (container.scrollTop > 0 && window.scrollY > 0) return;
    // Also check main scroll
    if (window.scrollY > 0) return;
    startY.current = e.touches[0].clientY;
  }, [disabled, isRefreshing]);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (disabled || isRefreshing || startY.current === null) return;
    const currentY = e.touches[0].clientY;
    const diff = currentY - startY.current;
    if (diff > 0) {
      // Only if at top
      const atTop = (containerRef.current?.scrollTop ?? 0) <= 0 && window.scrollY <= 0;
      if (atTop) {
        // Rubber band effect
        const distance = Math.min(diff * 0.5, threshold * 1.5);
        setPullDistance(distance);
        if (distance > 10) {
          e.preventDefault();
        }
      }
    }
  }, [disabled, isRefreshing, threshold]);

  const handleTouchEnd = useCallback(async () => {
    if (disabled || isRefreshing) {
      startY.current = null;
      return;
    }
    if (pullDistance >= threshold) {
      setIsRefreshing(true);
      try {
        await onRefresh();
      } finally {
        setIsRefreshing(false);
        setPullDistance(0);
      }
    } else {
      setPullDistance(0);
    }
    startY.current = null;
  }, [disabled, isRefreshing, pullDistance, threshold, onRefresh]);

  useEffect(() => {
    const container = containerRef.current ?? document;
    // Use passive: false for touchmove to allow preventDefault
    container.addEventListener('touchstart', handleTouchStart as EventListener, { passive: true });
    container.addEventListener('touchmove', handleTouchMove as EventListener, { passive: false });
    container.addEventListener('touchend', handleTouchEnd as EventListener, { passive: true });

    return () => {
      container.removeEventListener('touchstart', handleTouchStart as EventListener);
      container.removeEventListener('touchmove', handleTouchMove as EventListener);
      container.removeEventListener('touchend', handleTouchEnd as EventListener);
    };
  }, [handleTouchStart, handleTouchMove, handleTouchEnd]);

  const progress = Math.min(pullDistance / threshold, 1);

  return {
    containerRef,
    pullDistance,
    isRefreshing,
    progress,
  };
}

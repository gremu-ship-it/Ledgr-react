// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useDensity } from '../useDensity';
import { useIsMobile } from '../useIsMobile';
import { useOnlineStatus } from '../useOnlineStatus';
import { useAppStore } from '@/store/useAppStore';

function setViewport(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width, writable: true });
}

function setOnlineStatus(isOnline: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: isOnline });
}

describe('browser-facing hooks', () => {
  beforeEach(() => {
    window.localStorage.clear();
    setViewport(1280);
    setOnlineStatus(true);
    useAppStore.setState({ density: 'comfortable' });
  });

  afterEach(() => {
    useAppStore.setState({ density: 'comfortable' });
  });

  it('updates useOnlineStatus in response to browser connectivity events', () => {
    setOnlineStatus(false);
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current).toBe(false);

    act(() => window.dispatchEvent(new Event('online')));
    expect(result.current).toBe(true);

    act(() => window.dispatchEvent(new Event('offline')));
    expect(result.current).toBe(false);
  });

  it('tracks viewport changes with useIsMobile and honours a custom breakpoint', () => {
    setViewport(900);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);

    act(() => {
      setViewport(1200);
      window.dispatchEvent(new Event('resize'));
    });
    expect(result.current).toBe(false);

    const custom = renderHook(() => useIsMobile(700));
    expect(custom.result.current).toBe(false);
    act(() => {
      setViewport(640);
      window.dispatchEvent(new Event('resize'));
    });
    expect(custom.result.current).toBe(true);
  });

  it('derives density class names from the application store', () => {
    const { result } = renderHook(() => useDensity());
    expect(result.current).toMatchObject({
      density: 'comfortable',
      isCompact: false,
      thClass: 'px-4 py-3',
      tdClass: 'px-4 py-3',
    });

    act(() => useAppStore.getState().setDensity('compact'));
    expect(result.current).toMatchObject({
      density: 'compact',
      isCompact: true,
      thClass: 'px-3 py-2',
      rowClass: 'text-[13px]',
    });
  });
});

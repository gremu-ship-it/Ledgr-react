import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createLogger, logger } from '../logger';

describe('logger', () => {
  let consoleSpy: {
    debug: ReturnType<typeof vi.spyOn>;
    info: ReturnType<typeof vi.spyOn>;
    warn: ReturnType<typeof vi.spyOn>;
    error: ReturnType<typeof vi.spyOn>;
  };

  beforeEach(() => {
    consoleSpy = {
      debug: vi.spyOn(console, 'debug').mockImplementation(() => {}),
      info: vi.spyOn(console, 'info').mockImplementation(() => {}),
      warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
      error: vi.spyOn(console, 'error').mockImplementation(() => {}),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should create a module-scoped logger', () => {
    const log = createLogger('TestModule');
    expect(log).toBeDefined();
    expect(log.debug).toBeTypeOf('function');
    expect(log.info).toBeTypeOf('function');
    expect(log.warn).toBeTypeOf('function');
    expect(log.error).toBeTypeOf('function');
    expect(log.fatal).toBeTypeOf('function');
    expect(log.child).toBeTypeOf('function');
  });

  it('should export a root logger', () => {
    expect(logger).toBeDefined();
    expect(logger.info).toBeTypeOf('function');
  });

  it('should log info messages to console.info', () => {
    const log = createLogger('TestModule');
    log.info('test message');
    expect(consoleSpy.info).toHaveBeenCalled();
  });

  it('should log warn messages to console.warn', () => {
    const log = createLogger('TestModule');
    log.warn('test warning');
    expect(consoleSpy.warn).toHaveBeenCalled();
  });

  it('should log error messages to console.error', () => {
    const log = createLogger('TestModule');
    log.error('test error');
    expect(consoleSpy.error).toHaveBeenCalled();
  });

  it('should log errors with Error objects', () => {
    const log = createLogger('TestModule');
    const err = new Error('something broke');
    log.error('operation failed', err);
    expect(consoleSpy.error).toHaveBeenCalled();
  });

  it('should create child loggers with merged context', () => {
    const log = createLogger('TestModule');
    const child = log.child({ businessId: 'biz-123' });
    expect(child).toBeDefined();
    child.info('child message');
    expect(consoleSpy.info).toHaveBeenCalled();
  });

  it('should include module name in the output', () => {
    const log = createLogger('TestModule');
    log.info('hello');
    // The first argument should contain the module name
    const call = consoleSpy.info.mock.calls[0];
    expect(call.some((arg: unknown) => typeof arg === 'string' && arg.includes('TestModule'))).toBe(true);
  });
});

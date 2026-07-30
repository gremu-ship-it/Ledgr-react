import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createServerLogger } from '../logger';

describe('server logger', () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should create a module-scoped logger', () => {
    const log = createServerLogger('TestModule');
    expect(log).toBeDefined();
    expect(log.debug).toBeTypeOf('function');
    expect(log.info).toBeTypeOf('function');
    expect(log.warn).toBeTypeOf('function');
    expect(log.error).toBeTypeOf('function');
    expect(log.fatal).toBeTypeOf('function');
    expect(log.child).toBeTypeOf('function');
  });

  it('should write info messages to stdout', () => {
    const log = createServerLogger('TestModule');
    log.info('test message');
    expect(stdoutSpy).toHaveBeenCalled();
  });

  it('should write error messages to stderr', () => {
    const log = createServerLogger('TestModule');
    log.error('test error');
    expect(stderrSpy).toHaveBeenCalled();
  });

  it('should create child loggers with merged context', () => {
    const log = createServerLogger('TestModule');
    const child = log.child({ businessId: 'biz-123' });
    expect(child).toBeDefined();
    child.info('child message');
    expect(stdoutSpy).toHaveBeenCalled();
  });

  it('should handle errors with Error objects', () => {
    const log = createServerLogger('TestModule');
    const err = new Error('something broke');
    log.error('operation failed', err);
    expect(stderrSpy).toHaveBeenCalled();
  });
});

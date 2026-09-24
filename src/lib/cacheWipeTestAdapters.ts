/**
 * TEST ADAPTERS ONLY — in-memory fakes for the Cache Storage API used by the
 * R09.1 cache-wipe tests. Never imported by production code.
 *
 * jsdom does not implement the Cache API, so tests install this stub on
 * `globalThis.caches`. The stub models exactly the surface the wipe uses
 * (`has`/`delete`/`open(...).keys()`) plus test verbs for seeding and for
 * simulating the repopulation race (an in-flight response that puts into the
 * cache AFTER a delete — the case the delete→verify loop must defeat).
 */

export interface MemoryCacheRecord {
  name: string;
  entries: string[];
}

export class MemoryCacheStorage {
  private stores = new Map<string, MemoryCacheRecord>();
  /** When set, the next N delete() calls re-insert these entries right after. */
  private repopulateQueue: Array<{ name: string; entries: string[] }> = [];

  async has(name: string): Promise<boolean> {
    return this.stores.has(name);
  }

  async delete(name: string): Promise<boolean> {
    const existed = this.stores.delete(name);
    // Simulate a late in-flight put landing after the delete, recreating the
    // cache with the still-in-flight response inside.
    const repopulate = this.repopulateQueue.shift();
    if (repopulate && repopulate.name === name) {
      this.stores.set(repopulate.name, { name: repopulate.name, entries: [...repopulate.entries] });
    }
    return existed;
  }

  async open(name: string): Promise<{ keys(): Promise<string[]> }> {
    if (!this.stores.has(name)) this.stores.set(name, { name, entries: [] });
    const record = this.stores.get(name)!;
    return { keys: async () => [...record.entries] };
  }

  /* Test verbs */
  seed(name: string, entries: string[]): void {
    this.stores.set(name, { name, entries: [...entries] });
  }

  scheduleRepopulate(name: string, entries: string[], times = 1): void {
    for (let i = 0; i < times; i++) this.repopulateQueue.push({ name, entries: [...entries] });
  }

  keysOf(name: string): string[] {
    return this.stores.get(name)?.entries ?? [];
  }

  install(globalTarget: Record<string, unknown>): MemoryCacheStorage {
    globalTarget.caches = this;
    return this;
  }
}

/** Facade of the minimal local/session WebStorage the wipe reads. */
export function createMemoryWebStorage(seed: Record<string, string> = {}) {
  const data = new Map<string, string>(Object.entries(seed));
  return {
    get length(): number {
      return data.size;
    },
    key(index: number): string | null {
      return [...data.keys()][index] ?? null;
    },
    getItem: (k: string) => (data.has(k) ? data.get(k)! : null),
    setItem: (k: string, v: string) => void data.set(k, String(v)),
    removeItem: (k: string) => void data.delete(k),
    entries: () => [...data.entries()],
  };
}

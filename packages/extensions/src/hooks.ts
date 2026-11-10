export type ExtensionHookHandler<T> = (payload: T) => T | void | Promise<T | void>;

interface HookEntry {
  extensionId: string;
  priority: number;
  handler: (payload: unknown) => unknown | void | Promise<unknown | void>;
}

/** Ordered async waterfall hooks for host-owned lifecycle decisions. */
export class ExtensionHookRegistry<Hooks extends Record<string, unknown> = Record<string, unknown>> {
  private readonly hooks = new Map<keyof Hooks, HookEntry[]>();

  register<K extends keyof Hooks>(
    name: K,
    extensionId: string,
    handler: ExtensionHookHandler<Hooks[K]>,
    priority = 0,
  ): () => void {
    const entries = this.hooks.get(name) ?? [];
    const entry: HookEntry = { extensionId, priority, handler: handler as HookEntry["handler"] };
    entries.push(entry);
    entries.sort((a, b) => a.priority - b.priority || a.extensionId.localeCompare(b.extensionId));
    this.hooks.set(name, entries);
    return () => {
      const next = (this.hooks.get(name) ?? []).filter((candidate) => candidate !== entry);
      if (next.length) this.hooks.set(name, next);
      else this.hooks.delete(name);
    };
  }

  async run<K extends keyof Hooks>(name: K, initial: Hooks[K]): Promise<Hooks[K]> {
    let value: unknown = initial;
    for (const entry of this.hooks.get(name) ?? []) {
      const next = await entry.handler(value);
      if (next !== undefined) value = next;
    }
    return value as Hooks[K];
  }

  removeExtension(extensionId: string) {
    for (const [name, entries] of this.hooks) {
      const next = entries.filter((entry) => entry.extensionId !== extensionId);
      if (next.length) this.hooks.set(name, next);
      else this.hooks.delete(name);
    }
  }

  clear() {
    this.hooks.clear();
  }
}

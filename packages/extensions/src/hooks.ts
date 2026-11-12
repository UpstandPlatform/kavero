export type ExtensionHookHandler<T> = (payload: T) => T | void | Promise<T | void>;

interface HookEntry {
  extensionId: string;
  priority: number;
  order: number;
  handler: (payload: unknown) => unknown | void | Promise<unknown | void>;
}

export interface ExtensionHookRegistryOptions {
  /** Called when a handler throws, times out or returns an invalid value. The handler is skipped. */
  onError?: (error: unknown, hook: string, extensionId: string) => void;
  /** Maximum time for one handler. Defaults to 10 seconds. */
  handlerTimeoutMs?: number;
  /** Optional validation of a handler's result; return false to discard it. */
  validate?: (hook: string, value: unknown) => boolean;
}

export class ExtensionHookTimeoutError extends Error {
  override name = "ExtensionHookTimeoutError";
}

export const MAX_HOOK_PRIORITY = 1_000_000;

/**
 * Ordered async waterfall hooks for host-owned lifecycle decisions.
 * Each handler gets its own copy of the current value and runs under a timeout; a handler that
 * throws, times out or returns an invalid value is skipped and reported, so one faulty extension
 * cannot block or corrupt the work of the host or of other extensions.
 */
export class ExtensionHookRegistry<Hooks extends Record<string, unknown> = Record<string, unknown>> {
  private readonly hooks = new Map<keyof Hooks, HookEntry[]>();
  private readonly onError: NonNullable<ExtensionHookRegistryOptions["onError"]>;
  private readonly timeoutMs: number;
  private readonly validate?: ExtensionHookRegistryOptions["validate"];
  private sequence = 0;

  constructor(options: ExtensionHookRegistryOptions = {}) {
    this.onError = (error, hook, extensionId) => {
      try { options.onError?.(error, hook, extensionId); } catch { /* diagnostics must not break hooks */ }
    };
    const timeout = options.handlerTimeoutMs ?? 10_000;
    if (!Number.isFinite(timeout) || timeout <= 0) throw new RangeError("Hook handler timeout must be a positive number.");
    this.timeoutMs = timeout;
    this.validate = options.validate;
  }

  register<K extends keyof Hooks>(
    name: K,
    extensionId: string,
    handler: ExtensionHookHandler<Hooks[K]>,
    priority = 0,
  ): () => void {
    if (typeof handler !== "function") throw new TypeError("A hook handler must be a function.");
    if (typeof priority !== "number" || !Number.isFinite(priority) || Math.abs(priority) > MAX_HOOK_PRIORITY) {
      throw new RangeError(`Hook priority must be a finite number between -${MAX_HOOK_PRIORITY} and ${MAX_HOOK_PRIORITY}.`);
    }
    const entries = this.hooks.get(name) ?? [];
    const entry: HookEntry = { extensionId, priority, order: this.sequence++, handler: handler as HookEntry["handler"] };
    entries.push(entry);
    entries.sort((a, b) => a.priority - b.priority || a.extensionId.localeCompare(b.extensionId) || a.order - b.order);
    this.hooks.set(name, entries);
    return () => {
      const next = (this.hooks.get(name) ?? []).filter((candidate) => candidate !== entry);
      if (next.length) this.hooks.set(name, next);
      else this.hooks.delete(name);
    };
  }

  async run<K extends keyof Hooks>(name: K, initial: Hooks[K]): Promise<Hooks[K]> {
    let value: unknown = initial;
    for (const entry of [...(this.hooks.get(name) ?? [])]) {
      // A private copy means a handler that fails half-way cannot leave partial edits behind.
      const input = isolate(value);
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const next = await Promise.race([
          Promise.resolve().then(() => entry.handler(input)),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new ExtensionHookTimeoutError(`Hook "${String(name)}" handler of "${entry.extensionId}" timed out after ${this.timeoutMs} ms.`)), this.timeoutMs);
          }),
        ]);
        const candidate = next === undefined ? input : next;
        if (this.validate && !this.validate(String(name), candidate)) {
          throw new TypeError(`Hook "${String(name)}" handler of "${entry.extensionId}" returned an invalid value.`);
        }
        value = candidate;
      } catch (error) {
        this.onError(error, String(name), entry.extensionId);
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
    return value as Hooks[K];
  }

  has(name: keyof Hooks) {
    return (this.hooks.get(name)?.length ?? 0) > 0;
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

function isolate<T>(value: T): T {
  try {
    return structuredClone(value);
  } catch {
    // Non-cloneable payloads (for example ones holding functions) are passed through as is.
    return value;
  }
}

export interface ExtensionEvents {
  "catalog.opened": { catalogId: string };
  "catalog.saved": { catalogId: string; revision: number };
  "catalog.closed": { catalogId: string };
  "editor.command": { catalogId: string; commandType: string };
  "editor.selectionChanged": { catalogId: string; elementIds: readonly string[] };
  "asset.added": { catalogId: string; assetId: string; kind: string };
  "extension.installed": { catalogId: string; extensionId: string; version: string };
  "extension.enabled": { catalogId: string; extensionId: string };
  "extension.disabled": { catalogId: string; extensionId: string };
}

type Listener<T> = (payload: T) => void;

/** Small typed pub/sub bus. Subscriptions always return a teardown function. */
export class ExtensionEventBus<Events extends object = ExtensionEvents> {
  private readonly listeners = new Map<keyof Events, Set<Listener<unknown>>>();

  constructor(private readonly onError: (error: unknown, event: keyof Events) => void = () => undefined) {}

  on<K extends keyof Events>(event: K, listener: Listener<Events[K]>): () => void {
    let bucket = this.listeners.get(event);
    if (!bucket) this.listeners.set(event, (bucket = new Set()));
    bucket.add(listener as Listener<unknown>);
    return () => {
      bucket?.delete(listener as Listener<unknown>);
      if (bucket?.size === 0) this.listeners.delete(event);
    };
  }

  once<K extends keyof Events>(event: K, listener: Listener<Events[K]>): () => void {
    let dispose: () => void = () => undefined;
    dispose = this.on(event, (payload) => {
      dispose();
      listener(payload);
    });
    return dispose;
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    for (const listener of [...(this.listeners.get(event) ?? [])]) {
      try {
        listener(payload);
      } catch (error) {
        this.onError(error, event);
      }
    }
  }

  clear() {
    this.listeners.clear();
  }
}

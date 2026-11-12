import { checkIntegrity, type CatalogDocument } from "@Kavero/catalog-engine";
import { applyCommand, type CommandResult, type EditorCommand } from "./commands";

export interface HistoryEntry {
  command: EditorCommand;
  before: CatalogDocument;
  after: CatalogDocument;
  at: number;
}

export interface EditorState {
  document: CatalogDocument;
  selection: string[];
  activeSlideId: string;
  canUndo: boolean;
  canRedo: boolean;
  /** Changes since the last markSaved(); drives autosave and sync. */
  dirty: boolean;
}

export type EditorListener = (state: EditorState, command?: EditorCommand) => void;

export interface EditorOptions {
  historyLimit?: number;
  /** Merge rapid consecutive commands on the same target (e.g. drag) into one undo step. */
  coalesceMs?: number;
}

/**
 * Framework-agnostic editor. Every change goes through execute(), which makes
 * undo/redo, autosave, AI edits, MCP edits and sync share one path.
 * Documents are treated as immutable snapshots, which keeps React integration simple
 * (useSyncExternalStore(editor.subscribe, editor.getState)).
 */
export class Editor {
  private doc: CatalogDocument;
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private listeners = new Set<EditorListener>();
  private selection: string[] = [];
  private activeSlideId: string;
  private savedRevision: number;
  private state!: EditorState;
  private readonly historyLimit: number;
  private readonly coalesceMs: number;

  constructor(document: CatalogDocument, options: EditorOptions = {}) {
    this.doc = structuredClone(document);
    // Catalogs saved before extensions were added do not have this field yet.
    // Keep the editor's document invariant stable for integrity checks and commands.
    this.doc.extensions ??= {};
    this.activeSlideId = this.doc.slides[0]?.id ?? "";
    this.savedRevision = this.doc.revision;
    this.historyLimit = options.historyLimit ?? 200;
    this.coalesceMs = options.coalesceMs ?? 400;
    this.refresh();
  }

  getState = (): EditorState => this.state;
  getDocument = (): CatalogDocument => this.doc;

  subscribe = (listener: EditorListener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /**
   * Apply a command.
   * - `undoable: false` clears history (for irreversible storage side effects).
   * - `history: false` applies the change without creating an undo step and carries it into the
   *   existing history snapshots, so undo/redo of document edits never reverts it. Only supported
   *   for extension installation and extension storage commands.
   */
  execute(command: EditorCommand, options: { undoable?: boolean; history?: boolean } = {}): CommandResult {
    if (options.history === false && !HISTORYLESS_COMMANDS.has(command.type)) {
      throw new Error(`"${command.type}" must be recorded in editor history.`);
    }
    const before = this.doc;
    const draft = structuredClone(before);
    const result = applyCommand(draft, command); // throws on invalid commands; document untouched
    const errors = checkIntegrity(draft).filter((i) => i.severity === "error");
    if (errors.length) throw new Error(errors.map((e) => `${e.path}: ${e.message}`).join("; "));
    draft.revision = before.revision + 1;
    this.doc = draft;

    if (options.history === false) {
      this.carryIntoHistory(command);
    } else if (options.undoable === false) {
      // Irreversible storage changes (for example deleting an uploaded binary)
      // cannot safely be restored by replaying a document-only history snapshot.
      this.undoStack = [];
      this.redoStack = [];
    } else {
      const last = this.undoStack.at(-1);
      const now = Date.now();
      if (last && now - last.at < this.coalesceMs && coalesceKey(last.command) !== null && coalesceKey(last.command) === coalesceKey(command)) {
        last.after = draft;
        last.at = now;
      } else {
        this.undoStack.push({ command, before, after: draft, at: now });
        if (this.undoStack.length > this.historyLimit) this.undoStack.shift();
      }
      this.redoStack = [];
    }
    this.pruneSelection();
    this.emit(command);
    return result;
  }

  undo(): boolean {
    const entry = this.undoStack.pop();
    if (!entry) return false;
    this.redoStack.push(entry);
    this.doc = { ...entry.before, revision: this.doc.revision + 1 };
    this.pruneSelection();
    this.emit();
    return true;
  }

  redo(): boolean {
    const entry = this.redoStack.pop();
    if (!entry) return false;
    this.undoStack.push({ ...entry, at: 0 });
    this.doc = { ...entry.after, revision: this.doc.revision + 1 };
    this.pruneSelection();
    this.emit();
    return true;
  }

  select(ids: string[]) {
    this.selection = [...ids];
    this.emit();
  }

  setActiveSlide(slideId: string) {
    if (!this.doc.slides.some((s) => s.id === slideId)) return;
    this.activeSlideId = slideId;
    this.selection = [];
    this.emit();
  }

  /** Call after a successful local or cloud save. */
  markSaved(revision = this.doc.revision) {
    this.savedRevision = revision;
    this.emit();
  }

  /**
   * Continue numbering revisions after `revision`, e.g. when keeping this
   * editor's document over a newer stored copy. Unsaved changes stay unsaved.
   */
  rebase(revision: number) {
    if (this.doc.revision > revision) return;
    this.doc = { ...this.doc, revision: revision + 1 };
    this.emit();
  }

  /** Re-apply a history-less extension command to every snapshot so undo/redo keep its effect. */
  private carryIntoHistory(command: EditorCommand) {
    const extensionId = (command as { extensionId: string }).extensionId;
    const patched = new Map<CatalogDocument, CatalogDocument>();
    const patch = (snapshot: CatalogDocument) => {
      const known = patched.get(snapshot);
      if (known) return known;
      let next = snapshot;
      const current = snapshot.extensions?.[extensionId];
      if (current || command.type === "extension.install") {
        const copy: CatalogDocument = { ...snapshot, extensions: { ...snapshot.extensions } };
        if (current) copy.extensions[extensionId] = structuredClone(current);
        try {
          applyCommand(copy, command);
          next = copy;
        } catch {
          // The snapshot predates the installation; leave it untouched.
        }
      }
      patched.set(snapshot, next);
      return next;
    };
    const rewrite = (entry: HistoryEntry): HistoryEntry => ({ ...entry, before: patch(entry.before), after: patch(entry.after) });
    this.undoStack = this.undoStack.map(rewrite);
    this.redoStack = this.redoStack.map(rewrite);
  }

  private pruneSelection() {
    const ids = new Set(this.doc.slides.flatMap((s) => s.elements.map((e) => e.id)));
    this.selection = this.selection.filter((id) => ids.has(id));
    if (!this.doc.slides.some((s) => s.id === this.activeSlideId)) this.activeSlideId = this.doc.slides[0]?.id ?? "";
  }

  private refresh() {
    this.state = {
      document: this.doc,
      selection: this.selection,
      activeSlideId: this.activeSlideId,
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      dirty: this.doc.revision !== this.savedRevision,
    };
  }

  private emit(command?: EditorCommand) {
    this.refresh();
    for (const l of this.listeners) l(this.state, command);
  }
}

const HISTORYLESS_COMMANDS = new Set<EditorCommand["type"]>([
  "extension.install",
  "extension.setData",
  "extension.setSetting",
  "extension.deleteData",
  "extension.deleteSetting",
]);

function coalesceKey(cmd: EditorCommand): string | null {
  if (cmd.type === "element.move") return `move:${cmd.elementId}`;
  if (cmd.type === "element.update") return `update:${cmd.elementId}:${Object.keys(cmd.changes).sort().join(",")}`;
  if (cmd.type === "slide.update") return `slide:${cmd.slideId}:${Object.keys(cmd.changes).sort().join(",")}`;
  if (cmd.type === "catalog.updateTheme") return `theme:${Object.keys(cmd.theme.colors ?? {}).join(",")}:${Object.keys(cmd.theme.fonts ?? {}).join(",")}`;
  return null;
}

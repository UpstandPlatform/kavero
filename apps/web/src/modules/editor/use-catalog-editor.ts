"use client";

import { createId, parseCatalogDocument, type CatalogDocument } from "@Kavero/catalog-engine";
import { Editor, type EditorCommand, type EditorState } from "@Kavero/editor-core";
import { StaleWriteError, versionOf, type DocVersion } from "@Kavero/local-storage";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";

import { localCatalogs, onCatalogsChanged, saveLocalCatalog } from "@/modules/catalog/local-catalogs";
import { resolveGiphyMediaUrl } from "@/modules/media/giphy";
import { loadPublicConfig } from "@/lib/public-config";

export type SaveStatus = "saved" | "saving" | "unsaved" | "error" | "conflict";

const AUTOSAVE_MS = 700;
/** Used when an image reports no intrinsic size (e.g. some SVGs). */
export const FALLBACK_IMAGE_SIZE = { width: 400, height: 300 };

async function sha256(blob: Blob) {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Detect the font container from its magic bytes. */
async function fontMime(blob: Blob): Promise<string> {
  const b = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
  const tag = String.fromCharCode(...b);
  if (tag === "wOF2") return "font/woff2";
  if (tag === "wOFF") return "font/woff";
  if (tag === "OTTO") return "font/otf";
  if (tag === "ttcf") throw new Error("Font collections (.ttc) aren't supported yet. Pick a single font file.");
  return "font/ttf";
}

function imageSize(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth > 0 && img.naturalHeight > 0 ? { width: img.naturalWidth, height: img.naturalHeight } : FALLBACK_IMAGE_SIZE);
    img.onerror = () => reject(new Error("Could not read this image"));
    img.src = url;
  });
}

function videoSize(blob: Blob): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      if (video.videoWidth > 0 && video.videoHeight > 0) resolve({ width: video.videoWidth, height: video.videoHeight });
      else reject(new Error("Could not read this video's dimensions"));
    };
    video.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Could not read this video")); };
    video.src = url;
  });
}

type EditorControls = { flush: () => Promise<void>; keepMine: () => void };

// Lets code outside the editor tree (exports, publishing) wait for the live document to be stored.
const flushers = new Map<string, () => Promise<void>>();

/**
 * Resolves once the open editor for this catalog has written its latest edits to
 * this browser's storage (immediately if none is open). Rejects if they can't be saved.
 */
export function flushEditorSave(catalogId: string): Promise<void> {
  return flushers.get(catalogId)?.() ?? Promise.resolve();
}

/** Loads a local catalog into an Editor and keeps it autosaved. */
export function useCatalogEditor(catalogId: string) {
  const [editor, setEditor] = useState<Editor | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [assetUrls, setAssetUrls] = useState<Record<string, string>>({});
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const [loadKey, setLoadKey] = useState(0);
  const urlsRef = useRef<string[]>([]);
  const editorRef = useRef<Editor | null>(null);
  // The stored version each editor was loaded from; its saves are compare-and-swap against it.
  const versions = useRef(new WeakMap<Editor, DocVersion>());
  const controls = useRef<EditorControls | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const repo = localCatalogs();
      const entry = await repo.getWithSummary(catalogId);
      if (cancelled) return;
      if (!entry) return setLoadError("not-found");
      const parsed = parseCatalogDocument(entry.document);
      if (!parsed.ok) {
        return setLoadError(`This catalog could not be loaded: ${parsed.issues.slice(0, 3).map((issue) => issue.message).join("; ")}`);
      }
      const assets = await repo.listAssets(catalogId);
      if (cancelled) return;
      const urls: Record<string, string> = {};
      for (const a of assets) urls[a.id] = URL.createObjectURL(a.blob);
      // Keep the previous URLs alive until a reloaded editor has rendered.
      const old = urlsRef.current;
      urlsRef.current = Object.values(urls);
      setTimeout(() => old.forEach((u) => URL.revokeObjectURL(u)), 1000);
      const next = new Editor(parsed.document);
      const prev = editorRef.current;
      if (prev) next.setActiveSlide(prev.getState().activeSlideId);
      versions.current.set(next, versionOf(entry.summary));
      editorRef.current = next;
      setLoadError(null);
      setSaveStatus("saved");
      setAssetUrls(urls);
      setEditor(next);
      const externalGifs = parsed.document.assets.filter((asset) => asset.attribution?.provider === "GIPHY" && asset.attribution.providerAssetId);
      if (externalGifs.length) {
        void loadPublicConfig().then(({ media: { giphyApiKey: giphyKey } }) => (giphyKey ? Promise.all(externalGifs.map(async (asset) => [asset.id, await resolveGiphyMediaUrl(asset.attribution!.providerAssetId!, giphyKey)] as const))
          .then((resolved) => {
            if (cancelled) return;
            setAssetUrls((current) => ({ ...current, ...Object.fromEntries(resolved.filter((entry): entry is readonly [string, string] => !!entry[1])) }));
          }) : undefined))
          .catch(() => undefined);
      }
    })().catch((e: Error) => !cancelled && setLoadError(e.message));
    return () => {
      cancelled = true;
    };
  }, [catalogId, loadKey]);

  useEffect(() => () => urlsRef.current.forEach((u) => URL.revokeObjectURL(u)), []);

  // Autosave: debounce after each change, always saving the latest snapshot.
  useEffect(() => {
    if (!editor) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let active = true;
    let conflicted = false;
    let version = versions.current.get(editor);
    // Saves and external-change checks run one at a time, in order.
    let queue: Promise<void> = Promise.resolve();
    const enqueue = (fn: () => Promise<void>) => (queue = queue.then(fn, fn));

    const enterConflict = () => {
      conflicted = true;
      clearTimeout(timer);
      if (active) setSaveStatus("conflict");
    };
    const doSave = async () => {
      if (conflicted || !editor.getState().dirty) return;
      const doc: CatalogDocument = editor.getDocument();
      if (active) setSaveStatus("saving");
      try {
        const summary = await saveLocalCatalog(doc, { expect: version });
        version = versionOf(summary);
        editor.markSaved(doc.revision);
        if (active) setSaveStatus(editor.getState().dirty ? "unsaved" : "saved");
      } catch (e) {
        if (e instanceof StaleWriteError) return enterConflict();
        if (active) setSaveStatus("error");
        toast.error(`Could not save: ${(e as Error).message}`);
      }
    };
    const save = () => enqueue(doSave);

    // Another tab (or a cloud pull) wrote this catalog: reload when nothing here is
    // unsaved, otherwise stop autosaving and let the user choose.
    const checkExternal = () =>
      enqueue(async () => {
        if (!active || conflicted) return;
        const stored = await localCatalogs().getSummary(catalogId);
        if (stored && version && stored.revision === version.revision && stored.updatedAt === version.updatedAt) return;
        if (!active) return;
        if (editor.getState().dirty) enterConflict();
        else setLoadKey((k) => k + 1);
      });
    const offChange = onCatalogsChanged(() => void checkExternal());

    controls.current = {
      flush: async () => {
        clearTimeout(timer);
        await save();
        if (conflicted) throw new Error("This catalog was changed in another tab. Choose which version to keep first.");
        if (editor.getState().dirty) throw new Error("Your latest changes could not be saved yet.");
      },
      keepMine: () =>
        void enqueue(async () => {
          const stored = await localCatalogs().getSummary(catalogId);
          version = stored ? versionOf(stored) : undefined;
          conflicted = false;
          // Number our next revision after the stored one, so sync sees this as the newer copy.
          if (stored) editor.rebase(stored.revision);
          await doSave();
        }),
    };
    const flush = () => controls.current?.flush() ?? Promise.resolve();
    flushers.set(catalogId, flush);

    // Commands, undo and redo bump the revision; selection changes don't.
    let lastRevision = editor.getDocument().revision;
    const unsub = editor.subscribe((state) => {
      if (state.document.revision === lastRevision) return;
      lastRevision = state.document.revision;
      if (!state.dirty || conflicted) return;
      setSaveStatus("unsaved");
      clearTimeout(timer);
      timer = setTimeout(save, AUTOSAVE_MS);
    });
    // A document without slides can't be edited: start it with a blank one (saved like any edit).
    if (!editor.getDocument().slides.length) editor.execute({ type: "slide.add" });
    // Catch writes that landed between loading and subscribing.
    void checkExternal();

    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (editor.getState().dirty) {
        void save();
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      active = false;
      unsub();
      offChange();
      window.removeEventListener("beforeunload", beforeUnload);
      clearTimeout(timer);
      if (flushers.get(catalogId) === flush) flushers.delete(catalogId);
      controls.current = null;
      if (editor.getState().dirty) void save();
    };
  }, [editor, catalogId]);

  /** Resolve a conflict: drop this tab's unsaved edits and load the stored version. */
  const reloadFromStorage = useCallback(() => {
    editor?.markSaved();
    setLoadKey((k) => k + 1);
  }, [editor]);
  /** Resolve a conflict: overwrite the stored version with this tab's document. */
  const keepMine = useCallback(() => controls.current?.keepMine(), []);
  /** Wait until the live document is in local storage (e.g. before publishing it). */
  const flushSave = useCallback(() => controls.current?.flush() ?? Promise.resolve(), []);

  const uploadImage = useCallback(
    async (file: File, attribution?: NonNullable<CatalogDocument["assets"][number]["attribution"]>): Promise<{ assetId: string; width: number; height: number }> => {
      if (!editor) throw new Error("Editor not ready");
      if (!file.type.startsWith("image/")) throw new Error("Please choose an image file");
      if (file.size > 25 * 1024 * 1024) throw new Error("Images must be under 25 MB");
      const hash = await sha256(file);
      const repo = localCatalogs();
      const doc = editor.getDocument();
      // Reuse an identical image already in this catalog.
      const existing = doc.assets.find((a) => a.hash === hash);
      if (existing) return { assetId: existing.id, width: existing.width || FALLBACK_IMAGE_SIZE.width, height: existing.height || FALLBACK_IMAGE_SIZE.height };

      const assetId = createId("ast");
      const url = URL.createObjectURL(file);
      urlsRef.current.push(url);
      const { width, height } = await imageSize(url);
      await repo.putAsset({ id: assetId, catalogId, blob: file, hash });
      setAssetUrls((u) => ({ ...u, [assetId]: url }));
      editor.execute({
        type: "asset.add",
        asset: { id: assetId, kind: "image", mimeType: file.type, name: file.name, uri: `local://${assetId}`, width, height, bytes: file.size, hash, attribution },
      });
      return { assetId, width, height };
    },
    [editor, catalogId],
  );

  const uploadVideo = useCallback(
    async (file: File): Promise<{ assetId: string; width: number; height: number }> => {
      if (!editor) throw new Error("Editor not ready");
      if (!new Set(["video/mp4", "video/webm"]).has(file.type)) throw new Error("Choose an MP4 or WebM video");
      if (file.size > 25 * 1024 * 1024) throw new Error("Videos must be under 25 MB");
      const hash = await sha256(file);
      const repo = localCatalogs();
      const doc = editor.getDocument();
      const existing = doc.assets.find((asset) => asset.hash === hash);
      if (existing) return { assetId: existing.id, width: existing.width || doc.settings.width * 0.45, height: existing.height || doc.settings.height * 0.45 };
      const assetId = createId("ast");
      const url = URL.createObjectURL(file);
      urlsRef.current.push(url);
      const { width, height } = await videoSize(file);
      await repo.putAsset({ id: assetId, catalogId, blob: file, hash });
      setAssetUrls((current) => ({ ...current, [assetId]: url }));
      editor.execute({ type: "asset.add", asset: { id: assetId, kind: "video", mimeType: file.type, name: file.name, uri: `local://${assetId}`, width, height, bytes: file.size, hash } });
      return { assetId, width, height };
    },
    [editor, catalogId],
  );

  const removeUpload = useCallback(async (assetId: string) => {
    if (!editor) throw new Error("Editor not ready");
    const asset = editor.getDocument().assets.find((candidate) => candidate.id === assetId);
    if (!asset) throw new Error("Upload not found");
    const url = assetUrls[assetId];
    const repo = localCatalogs();
    const stored = await repo.getAsset(assetId);
    if (stored) await repo.removeAsset(assetId);
    try {
      editor.execute({ type: "asset.remove", assetId, removeFromSlides: true }, { undoable: false });
    } catch (error) {
      if (stored) await repo.putAsset(stored);
      throw error;
    }
    if (url) {
      URL.revokeObjectURL(url);
      urlsRef.current = urlsRef.current.filter((item) => item !== url);
    }
    setAssetUrls((current) => {
      const next = { ...current };
      delete next[assetId];
      return next;
    });
  }, [editor, assetUrls]);

  const setExternalAssetUrl = useCallback((assetId: string, url: string) => {
    if (!/^https:\/\//i.test(url)) return;
    setAssetUrls((current) => ({ ...current, [assetId]: url }));
  }, []);

  /**
   * Store a font file inside the catalog so previews and every export render it,
   * even on machines that don't have the font installed.
   */
  const uploadFont = useCallback(
    async (blob: Blob, face: { family: string; weight: number; style: "normal" | "italic"; source: "local" | "upload"; name: string }) => {
      if (!editor) throw new Error("Editor not ready");
      if (blob.size > 15 * 1024 * 1024) throw new Error("Font files must be under 15 MB");
      const hash = await sha256(blob);
      const doc = editor.getDocument();
      if (doc.assets.some((a) => a.hash === hash)) return;
      const mimeType = await fontMime(blob);
      const assetId = createId("ast");
      const file = new Blob([blob], { type: mimeType });
      const url = URL.createObjectURL(file);
      urlsRef.current.push(url);
      await localCatalogs().putAsset({ id: assetId, catalogId, blob: file, hash });
      setAssetUrls((u) => ({ ...u, [assetId]: url }));
      editor.execute({
        type: "asset.add",
        asset: {
          id: assetId, kind: "font", mimeType, name: face.name, uri: `local://${assetId}`, bytes: blob.size, hash,
          family: face.family, fontWeight: face.weight, fontStyle: face.style, fontSource: face.source,
        },
      });
    },
    [editor, catalogId],
  );

  return { editor, loadError, assetUrls, saveStatus, uploadImage, uploadVideo, removeUpload, setExternalAssetUrl, uploadFont, flushSave, reloadFromStorage, keepMine };
}

const EMPTY = () => () => {};

/** Subscribe a component to editor state. */
export function useEditorState(editor: Editor): EditorState {
  return useSyncExternalStore(editor.subscribe ?? EMPTY, editor.getState, editor.getState);
}

/** Run a command and show a toast instead of throwing. */
export function useRun(editor: Pick<Editor, "execute">) {
  return useMemo(
    () => (command: EditorCommand) => {
      try {
        return editor.execute(command);
      } catch (e) {
        toast.error((e as Error).message);
        return null;
      }
    },
    [editor],
  );
}

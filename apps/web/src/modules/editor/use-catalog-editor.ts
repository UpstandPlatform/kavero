"use client";

import { createId, type CatalogDocument } from "@Kavero/catalog-engine";
import { Editor, type EditorCommand, type EditorState } from "@Kavero/editor-core";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";

import { localCatalogs, saveLocalCatalog } from "@/modules/catalog/local-catalogs";

export type SaveStatus = "saved" | "saving" | "unsaved" | "error";

const AUTOSAVE_MS = 700;

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
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error("Could not read this image"));
    img.src = url;
  });
}

/** Loads a local catalog into an Editor and keeps it autosaved. */
export function useCatalogEditor(catalogId: string) {
  const [editor, setEditor] = useState<Editor | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [assetUrls, setAssetUrls] = useState<Record<string, string>>({});
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const urlsRef = useRef<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const repo = localCatalogs();
      const doc = await repo.get(catalogId);
      if (cancelled) return;
      if (!doc) return setLoadError("not-found");
      const assets = await repo.listAssets(catalogId);
      const urls: Record<string, string> = {};
      for (const a of assets) urls[a.id] = URL.createObjectURL(a.blob);
      urlsRef.current = Object.values(urls);
      if (cancelled) return;
      setAssetUrls(urls);
      setEditor(new Editor(doc));
    })().catch((e: Error) => setLoadError(e.message));
    return () => {
      cancelled = true;
      for (const u of urlsRef.current) URL.revokeObjectURL(u);
    };
  }, [catalogId]);

  // Autosave: debounce after each change, always saving the latest snapshot.
  useEffect(() => {
    if (!editor) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let saving = false;
    let again = false;
    const save = async () => {
      if (saving) return void (again = true);
      saving = true;
      const doc: CatalogDocument = editor.getDocument();
      setSaveStatus("saving");
      try {
        await saveLocalCatalog(doc);
        editor.markSaved(doc.revision);
        setSaveStatus(editor.getState().dirty ? "unsaved" : "saved");
      } catch (e) {
        setSaveStatus("error");
        toast.error(`Could not save: ${(e as Error).message}`);
      } finally {
        saving = false;
        if (again) {
          again = false;
          void save();
        }
      }
    };
    // Commands, undo and redo bump the revision; selection changes don't.
    let lastRevision = editor.getDocument().revision;
    const unsub = editor.subscribe((state) => {
      if (state.document.revision === lastRevision) return;
      lastRevision = state.document.revision;
      if (!state.dirty) return;
      setSaveStatus("unsaved");
      clearTimeout(timer);
      timer = setTimeout(save, AUTOSAVE_MS);
    });
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (editor.getState().dirty) {
        void save();
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      unsub();
      window.removeEventListener("beforeunload", beforeUnload);
      clearTimeout(timer);
      if (editor.getState().dirty) void save();
    };
  }, [editor]);

  const uploadImage = useCallback(
    async (file: File): Promise<{ assetId: string; width: number; height: number }> => {
      if (!editor) throw new Error("Editor not ready");
      if (!file.type.startsWith("image/")) throw new Error("Please choose an image file");
      if (file.size > 25 * 1024 * 1024) throw new Error("Images must be under 25 MB");
      const hash = await sha256(file);
      const repo = localCatalogs();
      const doc = editor.getDocument();
      // Reuse an identical image already in this catalog.
      const existing = doc.assets.find((a) => a.hash === hash);
      if (existing) return { assetId: existing.id, width: existing.width ?? 400, height: existing.height ?? 300 };

      const assetId = createId("ast");
      const url = URL.createObjectURL(file);
      urlsRef.current.push(url);
      const { width, height } = await imageSize(url);
      await repo.putAsset({ id: assetId, catalogId, blob: file, hash });
      setAssetUrls((u) => ({ ...u, [assetId]: url }));
      editor.execute({
        type: "asset.add",
        asset: { id: assetId, kind: "image", mimeType: file.type, name: file.name, uri: `local://${assetId}`, width, height, bytes: file.size, hash },
      });
      return { assetId, width, height };
    },
    [editor, catalogId],
  );

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

  return { editor, loadError, assetUrls, saveStatus, uploadImage, uploadFont };
}

const EMPTY = () => () => {};

/** Subscribe a component to editor state. */
export function useEditorState(editor: Editor): EditorState {
  return useSyncExternalStore(editor.subscribe ?? EMPTY, editor.getState, editor.getState);
}

/** Run a command and show a toast instead of throwing. */
export function useRun(editor: Editor) {
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

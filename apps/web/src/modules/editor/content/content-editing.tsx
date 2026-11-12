"use client";

import { createContext, useContext } from "react";

/** Opens the editing dialog of a markdown or table element; false when the element has none. */
export type OpenContentEditor = (elementId: string) => boolean;

export const ContentEditingContext = createContext<OpenContentEditor>(() => false);

/** Lets the canvas (double-click) and the properties panel open the markdown/table editors. */
export const useOpenContentEditor = () => useContext(ContentEditingContext);

export const isContentElementType = (type: string): type is "markdown" | "table" => type === "markdown" || type === "table";

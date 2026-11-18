/** Minimal types for `page-flip` (StPageFlip) 2.0.x, which ships no type definitions. */
declare module "page-flip" {
  export interface FlipEvent {
    data: number | string;
    object: PageFlip;
  }
  export class PageFlip {
    constructor(element: HTMLElement, settings: Record<string, unknown>);
    loadFromHTML(items: NodeListOf<Element> | HTMLElement[]): void;
    updateFromHtml(items: NodeListOf<Element> | HTMLElement[]): void;
    flipNext(corner?: "top" | "bottom"): void;
    flipPrev(corner?: "top" | "bottom"): void;
    flip(page: number, corner?: "top" | "bottom"): void;
    turnToPage(page: number): void;
    turnToNextPage(): void;
    turnToPrevPage(): void;
    getCurrentPageIndex(): number;
    getPageCount(): number;
    getOrientation(): "portrait" | "landscape";
    on(event: "flip" | "changeOrientation" | "changeState" | "init" | "update", cb: (e: FlipEvent) => void): void;
    update(): void;
    destroy(): void;
    clear(): void;
  }
}

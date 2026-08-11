/**
 * Pure pagination helpers for the raster PDF pipeline (html2canvas → jsPDF).
 *
 * The generated document is rendered once into a hidden iframe and rasterised
 * as a single tall image. Rather than slicing that image at exact A4-height
 * intervals — which cuts table rows and text lines in half — we choose cut
 * points at measured element boundaries (block tops, table rows) so every page
 * starts on a clean edge. This module contains the cut-selection algorithm,
 * kept free of DOM/jspdf imports so it is unit-testable in a node environment.
 */

export interface PageCutOptions {
  /** Total rendered document height in CSS px. */
  totalHeightPx: number;
  /** Usable content height of one A4 page in CSS px (page height minus margins). */
  pageHeightPx: number;
  /**
   * Candidate offsets (CSS px from the document top) where a new page may
   * start — e.g. the top edge of each block element or table row. Order and
   * duplicates do not matter.
   */
  breakPointsPx?: number[];
  /**
   * Minimum height of a slice. Break points closer than this to the previous
   * cut are ignored, preventing degenerate slivers. Default 120.
   */
  minSlicePx?: number;
  /**
   * Safety margin subtracted from the fill limit when evaluating break points,
   * so borders/shadows near an element's top edge are not bisected. Default 4.
   */
  guardPx?: number;
  /**
   * Remaining content shorter than this after the last full page is absorbed
   * into the previous page instead of producing a nearly-blank trailing page.
   * Default 2.
   */
  sliverPx?: number;
}

/**
 * Returns the ascending CSS-px offsets at which each page starts. The result
 * always begins with 0 and never exceeds `totalHeightPx`.
 */
export function computePageCuts({
  totalHeightPx,
  pageHeightPx,
  breakPointsPx = [],
  minSlicePx = 120,
  guardPx = 4,
  sliverPx = 2,
}: PageCutOptions): number[] {
  if (!Number.isFinite(totalHeightPx) || totalHeightPx <= 0) return [0];
  if (!Number.isFinite(pageHeightPx) || pageHeightPx <= 0) return [0];

  const points = Array.from(new Set(breakPointsPx))
    .filter((p) => Number.isFinite(p) && p > 0 && p < totalHeightPx)
    .sort((a, b) => a - b);

  const cuts: number[] = [0];
  let cursor = 0;

  while (totalHeightPx - cursor > pageHeightPx + sliverPx) {
    const fillLimit = cursor + pageHeightPx - guardPx;
    // Hard-cut fallback: used when no break point fits in the window (a single
    // block taller than a page).
    let cut = cursor + pageHeightPx;

    for (const point of points) {
      if (point <= cursor + minSlicePx) continue;
      if (point > fillLimit) break; // points are sorted ascending
      cut = point;
    }

    cuts.push(cut);
    cursor = cut;
  }

  return cuts;
}

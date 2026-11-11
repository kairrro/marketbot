// A tiny seam between state and the mounted chart: the chart component fills
// these in on mount, and state calls them without importing any DOM code.

export const chartBridge = {
  /** Screenshot of the chart as it is drawn right now. */
  capture: null as (() => Promise<Blob | null>) | null,
  /**
   * Backs out of a drawing in progress (a half-drawn zone), or clears a
   * finished measurement. Returns true if it did anything.
   */
  cancelDrawing: null as (() => boolean) | null,
  scrollToLatest: null as (() => void) | null
};

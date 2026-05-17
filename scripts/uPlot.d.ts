export interface UPlotLike {
  root: HTMLElement;
  ctx?: unknown;
  series: unknown[];
  scales: Record<string, unknown>;
  destroy(): void;
  setData(data: unknown[], resetScales?: boolean): void;
  setSize(size: {width: number; height: number}): void;
  redraw(rebuildPaths?: boolean, recalcAxes?: boolean): void;
  setScale(key: string, range: {min?: number; max?: number}): void;
  setSelect(select: {left: number; top: number; width: number; height: number}, fireHook?: boolean): void;
  addSeries(series: unknown, index?: number): void;
  delSeries(index: number): void;
}

export interface UPlotConstructor {
  new (opts: unknown, data: unknown[], then?: HTMLElement | ((u: UPlotLike) => void)): UPlotLike;
  configure?(opts: Record<string, unknown>): UPlotConstructor;
  destroyDetached?(): number;
  destroyAll?(): number;
  getLivePlots?(): UPlotLike[];
  [key: string]: unknown;
}

declare const uPlot: UPlotConstructor;
export default uPlot;

import type { GPUPath } from '../../scripts/ts/webgpu/GPUPath.js';

export type PathValue = number | null | undefined;
export type PathData = ArrayLike<PathValue>;
export type PathXData = ArrayLike<number> & { map?: (callback: (value: number, index: number) => number) => number[] };
export type PixelRound = (value: number) => number;
export type ValueToPos = (value: number, scale: ScaleLike, dim: number, off: number) => number;
export type Direction = -1 | 0 | 1 | 2;
export type Orientation = 0 | 1;
export type Gap = [from: number, to: number];
export type GapList = Gap[];

export interface ScaleLike {
	key?: string;
	ori: Orientation;
	dir: -1 | 1;
	distr?: number;
	min?: number;
	max?: number;
	[k: string]: any;
}

export interface BandLike {
	series: [number, number];
	dir: -1 | 0 | 1;
	[k: string]: any;
}

export interface SeriesLike {
	scale?: string;
	facets?: [{ scale: string }, { scale: string }];
	pxRound: PixelRound;
	width: number;
	fill?: string | CanvasGradient | CanvasPattern | null;
	_fill?: unknown;
	_stroke?: unknown;
	min?: number;
	max?: number;
	spanGaps?: boolean;
	alignGaps?: number;
	points?: any;
	fillTo: (u: UPlotPathLike, seriesIdx: number, dataMin: number | undefined, dataMax: number | undefined, bandFillDir: number) => number;
	gaps: (u: UPlotPathLike, seriesIdx: number, idx0: number, idx1: number, gaps: GapList) => GapList;
	[k: string]: any;
}

export interface UPlotPathLike {
	mode: number;
	pxRatio: number;
	_data: any;
	data: any;
	series: SeriesLike[];
	scales: Record<string, ScaleLike>;
	bbox: { left: number; top: number; width: number; height: number };
	bands?: BandLike[];
	valToPosH: ValueToPos;
	valToPosV: ValueToPos;
	posToVal: (pos: number, scaleKey: string, can?: boolean) => number;
	[k: string]: any;
}

export type PathPrimitive = GPUPath;
export type PathPrimitiveMap = Map<unknown, GPUPath>;
export type ClipPath = GPUPath | null;
export type BandClipPath = GPUPath | [GPUPath, GPUPath] | null;

export interface PathBuildResult {
	stroke: GPUPath | PathPrimitiveMap | null;
	fill: GPUPath | PathPrimitiveMap | null;
	clip: ClipPath;
	band: BandClipPath;
	gaps: GapList | null;
	flags: number;
	_fill?: unknown;
	width?: number;
	[k: string]: unknown;
}

export type PathBuilder = (u: UPlotPathLike, seriesIdx: number, idx0: number, idx1: number, filtIdxs?: number[] | null) => PathBuildResult | null;
export type PathFactory<TOptions = unknown> = (opts?: TOptions) => PathBuilder;

export interface BarPathOptions {
	size?: [factor?: number, maxWidth?: number, minWidth?: number];
	align?: -1 | 0 | 1;
	gap?: number;
	radius?: number | [valueRadius: number, baselineRadius: number] | ((u: UPlotPathLike, seriesIdx: number) => [number, number]);
	disp?: any;
	each?: (u: UPlotPathLike, seriesIdx: number, idx: number, left: number, top: number, width: number, height: number) => void;
	[k: string]: unknown;
}

export interface LinearPathOptions {
	alignGaps?: number;
	[k: string]: unknown;
}

export interface SteppedPathOptions extends LinearPathOptions {
	align?: -1 | 1;
	ascDesc?: boolean;
	extend?: boolean;
}

export interface PointPathOptions {
	[k: string]: unknown;
}

export interface SplinePathOptions extends LinearPathOptions {
	[k: string]: unknown;
}

export type MoveToFn = (path: GPUPath, x: number, y: number) => void;
export type LineToFn = (path: GPUPath, x: number, y: number) => void;
export type RectFn = (path: GPUPath, x: number, y: number, width: number, height: number, endRadius?: number, baseRadius?: number) => void;
export type ArcFn = (path: GPUPath, x: number, y: number, radius: number, startAngle: number, endAngle: number) => void;
export type BezierCurveToFn = (path: GPUPath, bp1x: number, bp1y: number, bp2x: number, bp2y: number, p2x: number, p2y: number) => void;

export type OrientedPathCallback<T = unknown> = (
	series: SeriesLike,
	dataX: PathXData,
	dataY: PathData,
	scaleX: ScaleLike,
	scaleY: ScaleLike,
	valToPosX: ValueToPos,
	valToPosY: ValueToPos,
	xOff: number,
	yOff: number,
	xDim: number,
	yDim: number,
	moveTo: MoveToFn,
	lineTo: LineToFn,
	rect: RectFn,
	arc: ArcFn,
	bezierCurveTo: BezierCurveToFn,
) => T;

export type InterpolationFitter = (
	xCoords: number[],
	yCoords: number[],
	moveTo: MoveToFn,
	lineTo: LineToFn,
	bezierCurveTo: BezierCurveToFn,
	pxRound: PixelRound,
) => GPUPath;

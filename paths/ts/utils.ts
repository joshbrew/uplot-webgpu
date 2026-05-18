import { GPUPath } from '../../scripts/ts/webgpu/GPUPath.js';
import { round, incrRound, retArg0, min, EMPTY_ARR, ifNull } from "../../scripts/ts/utils/utils.js";
import type { ArcFn, BandClipPath, BezierCurveToFn, GapList, LineToFn, 
	MoveToFn, OrientedPathCallback, PathData, PixelRound, RectFn, UPlotPathLike } from './types.js';

export const BAND_CLIP_FILL   = 1 << 0;
export const BAND_CLIP_STROKE = 1 << 1;

export function orient<T>(u: UPlotPathLike, seriesIdx: number, cb: OrientedPathCallback<T>): T {
	const mode = u.mode;
	const series = u.series[seriesIdx];
	const data = mode == 2 ? u._data[seriesIdx] : u._data;
	const scales = u.scales;
	const bbox   = u.bbox;

	let dx = data[0],
		dy = mode == 2 ? data[1] : data[seriesIdx],
		sx = mode == 2 ? scales[series.facets[0].scale] : scales[u.series[0].scale],
		sy = mode == 2 ? scales[series.facets[1].scale] : scales[series.scale],
		l = bbox.left,
		t = bbox.top,
		w = bbox.width,
		h = bbox.height,
		H = u.valToPosH,
		V = u.valToPosV;

	return (sx.ori == 0
		? cb(
			series,
			dx,
			dy,
			sx,
			sy,
			H,
			V,
			l,
			t,
			w,
			h,
			moveToH,
			lineToH,
			rectH,
			arcH,
			bezierCurveToH,
		)
		: cb(
			series,
			dx,
			dy,
			sx,
			sy,
			V,
			H,
			t,
			l,
			h,
			w,
			moveToV,
			lineToV,
			rectV,
			arcV,
			bezierCurveToV,
		)
	);
}

export function bandFillClipDirs(self: UPlotPathLike, seriesIdx: number): [fillDir: number, clipDir: number] {
	let fillDir = 0;

	// 2 bits, -1 | 1
	let clipDirs = 0;

	let bands = ifNull(self.bands, EMPTY_ARR);

	for (let i = 0; i < bands.length; i++) {
		let b = bands[i];

		// is a "from" band edge
		if (b.series[0] == seriesIdx)
			fillDir = b.dir;
		// is a "to" band edge
		else if (b.series[1] == seriesIdx) {
			if (b.dir == 1)
				clipDirs |= 1;
			else
				clipDirs |= 2;
		}
	}

	return [
		fillDir,
		(
			clipDirs == 1 ? -1 : // neg only
			clipDirs == 2 ?  1 : // pos only
			clipDirs == 3 ?  2 : // both
			                 0   // neither
		)
	];
}

export function seriesFillTo(self: UPlotPathLike, seriesIdx: number, dataMin: number, dataMax: number, bandFillDir: number): number {
	let mode = self.mode;
	let series = self.series[seriesIdx];
	let scaleKey = mode == 2 ? series.facets[1].scale : series.scale;
	let scale = self.scales[scaleKey];

	return (
		bandFillDir == -1 ? scale.min :
		bandFillDir ==  1 ? scale.max :
		scale.distr ==  3 ? (
			scale.dir == 1 ? scale.min :
			scale.max
		) : 0
	);
}

// creates inverted band clip path (from stroke path -> yMax || yMin)
// clipDir is always inverse of fillDir
// default clip dir is upwards (1), since default band fill is downwards/fillBelowTo (-1) (highIdx -> lowIdx)
export function clipBandLine(self: UPlotPathLike, seriesIdx: number, idx0: number, idx1: number, strokePath: any, clipDir: number): BandClipPath {
	return orient(self, seriesIdx, (series, dataX, dataY, scaleX, scaleY, valToPosX, valToPosY, xOff, yOff, xDim, yDim) => {
		let pxRound = series.pxRound;

		const dir = scaleX.dir * (scaleX.ori == 0 ? 1 : -1);
		const lineTo = scaleX.ori == 0 ? lineToH : lineToV;

		let frIdx, toIdx;

		if (dir == 1) {
			frIdx = idx0;
			toIdx = idx1;
		}
		else {
			frIdx = idx1;
			toIdx = idx0;
		}

		// path start
		let x0 = pxRound(valToPosX(dataX[frIdx], scaleX, xDim, xOff));
		let y0 = pxRound(valToPosY(dataY[frIdx], scaleY, yDim, yOff));
		// path end x
		let x1 = pxRound(valToPosX(dataX[toIdx], scaleX, xDim, xOff));
		// upper or lower y limit
		let yLimit = pxRound(valToPosY(clipDir == 1 ? scaleY.max : scaleY.min, scaleY, yDim, yOff));

		let clip = new GPUPath(strokePath);

		lineTo(clip, x1, yLimit);
		lineTo(clip, x0, yLimit);
		lineTo(clip, x0, y0);

		return clip;
	});
}

export function clipGaps(gaps: GapList, ori: number, plotLft: number, plotTop: number, plotWid: number, plotHgt: number): import('../../scripts/ts/webgpu/GPUPath.js').GPUPath | null {
	let clip = null;

	// create clip path (invert gaps and non-gaps)
	if (gaps.length > 0) {
		clip = new GPUPath();

		const rect = ori == 0 ? rectH : rectV;

		let prevGapEnd = plotLft;

		for (let i = 0; i < gaps.length; i++) {
			let g = gaps[i];

			if (g[1] > g[0]) {
				let w = g[0] - prevGapEnd;

				w > 0 && rect(clip, prevGapEnd, plotTop, w, plotTop + plotHgt);

				prevGapEnd = g[1];
			}
		}

		let w = plotLft + plotWid - prevGapEnd;

		// hack to ensure we expand the clip enough to avoid cutting off strokes at edges
		let maxStrokeWidth = 10;

		w > 0 && rect(clip, prevGapEnd, plotTop - maxStrokeWidth / 2, w, plotTop + plotHgt + maxStrokeWidth);
	}

	return clip;
}

export function addGap(gaps: GapList, fromX: number, toX: number): void {
	let prevGap = gaps[gaps.length - 1];

	if (prevGap && prevGap[0] == fromX)			// TODO: gaps must be encoded at stroke widths?
		prevGap[1] = toX;
	else
		gaps.push([fromX, toX]);
}

export function findGaps(xs: ArrayLike<number>, ys: PathData, idx0: number, idx1: number, dir: number, pixelForX: (value: number) => number, align: number): GapList {
	let gaps = [];
	let len = xs.length;

	for (let i = dir == 1 ? idx0 : idx1; i >= idx0 && i <= idx1; i += dir) {
		let yVal = ys[i];

		if (yVal === null) {
			let fr = i, to = i;

			if (dir == 1) {
				while (++i <= idx1 && ys[i] === null)
					to = i;
			}
			else {
				while (--i >= idx0 && ys[i] === null)
					to = i;
			}

			let frPx = pixelForX(xs[fr]);
			let toPx = to == fr ? frPx : pixelForX(xs[to]);

			// if value adjacent to edge null is same pixel, then it's partially
			// filled and gap should start at next pixel
			let fri2 = fr - dir;
			let frPx2 = align <= 0 && fri2 >= 0 && fri2 < len ? pixelForX(xs[fri2]) : frPx;
		//	if (frPx2 == frPx)
		//		frPx++;
		//	else
				frPx = frPx2;

			let toi2 = to + dir;
			let toPx2 = align >= 0 && toi2 >= 0 && toi2 < len ? pixelForX(xs[toi2]) : toPx;
		//	if (toPx2 == toPx)
		//		toPx--;
		//	else
				toPx = toPx2;

			if (toPx >= frPx)
				gaps.push([frPx, toPx]); // addGap
		}
	}

	return gaps;
}

export function pxRoundGen(pxAlign: number): PixelRound {
	return pxAlign == 0 ? retArg0 : pxAlign == 1 ? round : v => incrRound(v, pxAlign);
}

/*
// inefficient linear interpolation that does bi-directinal scans on each call
export function costlyLerp(i: number, idx0: number, idx1: number, _dirX: number, dataY: PathData): number {
	let prevNonNull = nonNullIdx(dataY, _dirX == 1 ? idx0 : idx1, i, -_dirX);
	let nextNonNull = nonNullIdx(dataY, i, _dirX == 1 ? idx1 : idx0,  _dirX);

	let prevVal = dataY[prevNonNull];
	let nextVal = dataY[nextNonNull];

	return prevVal + (i - prevNonNull) / (nextNonNull - prevNonNull) * (nextVal - prevVal);
}
*/

function rect(ori: 0 | 1): RectFn {
	let moveTo = ori == 0 ?
		moveToH :
		moveToV;

	let arcTo: (p: any, x1: number, y1: number, x2: number, y2: number, r: number) => void = ori == 0 ?
		(p, x1, y1, x2, y2, r) => { p.arcTo(x1, y1, x2, y2, r); } :
		(p, y1, x1, y2, x2, r) => { p.arcTo(x1, y1, x2, y2, r); };

	let rectRaw: (p: any, x: number, y: number, w: number, h: number) => void = ori == 0 ?
		(p, x, y, w, h) => { p.rect(x, y, w, h); } :
		(p, y, x, h, w) => { p.rect(x, y, w, h); };

	return (p, x, y, w, h, endRad = 0, baseRad = 0) => {
		if (endRad == 0 && baseRad == 0)
			rectRaw(p, x, y, w, h);
		else {
			endRad  = min(endRad,  w / 2, h / 2);
			baseRad = min(baseRad, w / 2, h / 2);

			// adapted from https://stackoverflow.com/questions/1255512/how-to-draw-a-rounded-rectangle-using-html-canvas/7838871#7838871
			moveTo(p, x + endRad, y);
			arcTo(p, x + w, y, x + w, y + h, endRad);
			arcTo(p, x + w, y + h, x, y + h, baseRad);
			arcTo(p, x, y + h, x, y, baseRad);
			arcTo(p, x, y, x + w, y, endRad);
			p.closePath();
		}
	};
}

// orientation-inverting canvas functions
export const moveToH: MoveToFn = (p, x, y) => { p.moveTo(x, y); };
export const moveToV: MoveToFn = (p, y, x) => { p.moveTo(x, y); };
export const lineToH: LineToFn = (p, x, y) => { p.lineTo(x, y); };
export const lineToV: LineToFn = (p, y, x) => { p.lineTo(x, y); };
export const rectH: RectFn = rect(0);
export const rectV: RectFn = rect(1);
export const arcH: ArcFn = (p, x, y, r, startAngle, endAngle) => { p.arc(x, y, r, startAngle, endAngle); };
export const arcV: ArcFn = (p, y, x, r, startAngle, endAngle) => { p.arc(x, y, r, startAngle, endAngle); };
export const bezierCurveToH: BezierCurveToFn = (p, bp1x, bp1y, bp2x, bp2y, p2x, p2y) => { p.bezierCurveTo(bp1x, bp1y, bp2x, bp2y, p2x, p2y); };
export const bezierCurveToV: BezierCurveToFn = (p, bp1y, bp1x, bp2y, bp2x, p2y, p2x) => { p.bezierCurveTo(bp1x, bp1y, bp2x, bp2y, p2x, p2y); };
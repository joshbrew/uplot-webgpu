import { GPUPath } from './GPUPath.js';
import { WebGPURendererInternals } from './WebGPURenderer.js';
import { normalizeExportType, rgbaImageDataToBmpBytes, rgbaImageDataToPngBytes } from './exporters.js';

function assert(name, value) {
	if (!value)
		throw new Error(`WebGPU renderer smoke test failed: ${name}`);
}

function approx(a, b, eps = 1e-6) {
	return Math.abs(a - b) <= eps;
}

export function runWebGPURendererSmokeTests() {
	let outer = [[0, 0], [10, 0], [10, 10], [0, 10]];
	let inner = [[3, 3], [3, 7], [7, 7], [7, 3]];

	assert('nonzero outer hit', WebGPURendererInternals.fillContainsPoint([1, 1], [outer, inner], 'nonzero'));
	assert('nonzero opposite winding hole', !WebGPURendererInternals.fillContainsPoint([5, 5], [outer, inner], 'nonzero'));
	assert('evenodd hole', !WebGPURendererInternals.fillContainsPoint([5, 5], [outer, inner], 'evenodd'));
	assert('source-over composite', WebGPURendererInternals.clampCompositeMode('source-over') == 'source-over');
	assert('unknown composite fallback', WebGPURendererInternals.clampCompositeMode('not-real') == 'source-over');

	let clipped = WebGPURendererInternals.normalizeImageRect(
		{width: 10, height: 10},
		-5, -5, 10, 10,
		0, 0, 100, 100,
	);
	assert('image source clip exists', clipped != null);
	assert('image source clipped x', clipped.sx == 0 && clipped.sy == 0);
	assert('image destination scaled', clipped.dx == 50 && clipped.dy == 50 && clipped.dw == 50 && clipped.dh == 50);

	let neg = WebGPURendererInternals.normalizeImageRect(
		{width: 10, height: 10},
		8, 8, -4, -4,
		20, 30, -40, -50,
	);
	assert('negative image rect normalized', neg != null && neg.sx == 4 && neg.sy == 4 && neg.dx == -20 && neg.dy == -20 && neg.dw == 40 && neg.dh == 50);

	let emptyClose = new GPUPath();
	emptyClose.closePath();
	assert('empty closePath does not create geometry', emptyClose.toSubpaths().length == 0);

	let path = new GPUPath();
	path.rect(0, 0, 10, 10);
	path.closePath();
	assert('GPUPath emits subpaths', path.toSubpaths().length > 0);

	let circle = new GPUPath();
	circle.arc(0, 0, 10, 0, Math.PI * 2);
	let circleSub = circle.toSubpaths()[0];
	assert('full circle arc keeps geometry', circleSub.length > 10);
	assert('full circle arc returns near start', approx(circleSub[0][0], circleSub[circleSub.length - 1][0]) && approx(circleSub[0][1], circleSub[circleSub.length - 1][1]));

	let ellipse = new GPUPath();
	ellipse.ellipse(0, 0, 10, 5, Math.PI / 6, 0, Math.PI * 2);
	assert('full ellipse keeps geometry', ellipse.toSubpaths()[0].length > 10);

	let rounded = new GPUPath();
	rounded.roundRect(0, 0, 20, 12, [4, 2, 5, 3]);
	let roundedSub = rounded.toSubpaths()[0];
	assert('roundRect emits closed geometry', roundedSub.length > 8 && approx(roundedSub[0][0], roundedSub[roundedSub.length - 1][0]) && approx(roundedSub[0][1], roundedSub[roundedSub.length - 1][1]));

	let arcToPath = new GPUPath();
	arcToPath.moveTo(0, 10);
	arcToPath.arcTo(10, 0, 20, 10, 6);
	let arcToSub = arcToPath.toSubpaths()[0];
	let arcToEnd = arcToSub[arcToSub.length - 1];
	assert('arcTo emits rounded connector geometry', arcToSub.length > 3 && arcToEnd[0] > 10 && arcToEnd[0] < 20 && arcToEnd[1] > 0 && arcToEnd[1] < 10);

	let copy = new GPUPath(path);
	copy.lineTo(12, 12);
	let copiedSubpaths = copy.toSubpaths();
	assert('copy constructor preserves current point', copiedSubpaths[copiedSubpaths.length - 1].some(p => p[0] == 12 && p[1] == 12));

	let add = new GPUPath();
	add.addPath(path);
	add.lineTo(14, 14);
	let addedSubpaths = add.toSubpaths();
	assert('addPath preserves current point', addedSubpaths[addedSubpaths.length - 1].some(p => p[0] == 14 && p[1] == 14));

	let invalid = new GPUPath();
	invalid.moveTo(0, 0);
	invalid.lineTo(NaN, 3);
	assert('invalid path coordinates are ignored', invalid.toSubpaths()[0].length == 1);


	let modernRgb = WebGPURendererInternals.parsePlainCssColor('rgb(255 0 0 / 50%)');
	assert('modern rgb space slash alpha parses', approx(modernRgb[0], 1) && approx(modernRgb[1], 0) && approx(modernRgb[2], 0) && approx(modernRgb[3], 0.5));

	let multiRect = new GPUPath();
	multiRect.rect(0, 0, 10, 10);
	multiRect.rect(3, 3, 4, 4);
	let evenOddRegions = WebGPURendererInternals.pathToClipRegions(multiRect, [1, 0, 0, 1, 0, 0], 'evenodd');
	let centerCovered = evenOddRegions.some(region => WebGPURendererInternals.pointInPolygon([5, 5], region));
	let cornerCovered = evenOddRegions.some(region => WebGPURendererInternals.pointInPolygon([1, 1], region));
	assert('evenodd clip keeps outer region', cornerCovered);
	assert('evenodd clip removes inner rect hole', !centerCovered);


	let nonzeroRects = new GPUPath();
	nonzeroRects.rect(0, 0, 10, 10);
	nonzeroRects.rect(7, 3, -4, 4);
	let nonzeroRegions = WebGPURendererInternals.pathToClipRegions(nonzeroRects, [1, 0, 0, 1, 0, 0], 'nonzero');
	let nonzeroCenterCovered = nonzeroRegions.some(region => WebGPURendererInternals.pointInPolygon([5, 5], region));
	let nonzeroCornerCovered = nonzeroRegions.some(region => WebGPURendererInternals.pointInPolygon([1, 1], region));
	assert('nonzero rect clip keeps outer region', nonzeroCornerCovered);
	assert('nonzero rect clip removes opposite-winding hole', !nonzeroCenterCovered);

	let clippedTri = WebGPURendererInternals.clipVertices([
		-10, -10, 1, 0, 0, 1,
		10, -10, 1, 0, 0, 1,
		0, 10, 1, 0, 0, 1,
	], [[[0, 0], [1, 0], [1, 1], [0, 1]]]);
	assert('clipped quadrilateral fans to two triangles', clippedTri.length == 36);

	assert('readback row alignment', WebGPURendererInternals.alignBytesPerRow(4) == 256 && WebGPURendererInternals.alignBytesPerRow(260) == 512);
	let readRect = WebGPURendererInternals.normalizeReadRect(8, 8, -4, -5, 20, 20);
	assert('negative readback rect normalized', readRect.x == 4 && readRect.y == 3 && readRect.w == 4 && readRect.h == 5);
	let clippedRead = WebGPURendererInternals.normalizeReadRect(-3, -2, 8, 7, 10, 10);
	assert('readback rect clips to frame', clippedRead.x == 0 && clippedRead.y == 0 && clippedRead.w == 5 && clippedRead.h == 5);

	let commaRgb = WebGPURendererInternals.parsePlainCssColor('rgba(0, 128, 255, 0.25)');
	assert('comma rgba still parses', approx(commaRgb[1], 128 / 255) && approx(commaRgb[3], 0.25));

	let dirty = WebGPURendererInternals.normalizeDirtyRect({width: 10, height: 8}, 8, 7, -5, -4);
	assert('negative putImageData dirty rect normalized', dirty.x == 3 && dirty.y == 3 && dirty.w == 5 && dirty.h == 4);
	let dirtyClip = WebGPURendererInternals.normalizeDirtyRect({width: 10, height: 8}, -2, -1, 5, 5);
	assert('putImageData dirty rect clips to image', dirtyClip.x == 0 && dirtyClip.y == 0 && dirtyClip.w == 3 && dirtyClip.h == 4);

	let bmpBytes = rgbaImageDataToBmpBytes({width: 1, height: 1, data: new Uint8ClampedArray([255, 0, 128, 64])});
	assert('bmp encoder emits BMP signature', bmpBytes[0] == 0x42 && bmpBytes[1] == 0x4d);
	assert('bmp encoder emits BGRA pixel', bmpBytes[54] == 128 && bmpBytes[55] == 0 && bmpBytes[56] == 255 && bmpBytes[57] == 64);

	let pngBytes = rgbaImageDataToPngBytes({width: 1, height: 1, data: new Uint8ClampedArray([255, 0, 128, 64])});
	assert('png encoder emits PNG signature', pngBytes[0] == 137 && pngBytes[1] == 80 && pngBytes[2] == 78 && pngBytes[3] == 71);
	assert('png encoder has IHDR chunk', String.fromCharCode(pngBytes[12], pngBytes[13], pngBytes[14], pngBytes[15]) == 'IHDR');
	assert('export type defaults to png', normalizeExportType('image/jpeg') == 'image/png');
	assert('export type preserves bmp', normalizeExportType('image/bmp') == 'image/bmp');

	return true;
}

export default runWebGPURendererSmokeTests;

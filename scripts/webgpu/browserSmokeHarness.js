import { GPUPath } from './GPUPath.js';
import WebGPURenderer from './WebGPURenderer.js';
import { runWebGPURendererSmokeTests } from './smokeTest.js';

export async function runWebGPUBrowserSmokeHarness(options = {}) {
	runWebGPURendererSmokeTests();

	if (typeof document == 'undefined')
		throw new Error('The WebGPU browser smoke harness requires a DOM.');

	let width = options.width || 480;
	let height = options.height || 260;
	let canvas = options.canvas || document.createElement('canvas');
	let ratio = globalThis.devicePixelRatio || 1;
	canvas.width = Math.max(1, Math.round(width * ratio));
	canvas.height = Math.max(1, Math.round(height * ratio));
	canvas.style.width = width + 'px';
	canvas.style.height = height + 'px';

	let host = options.appendTo || document.body;
	let wrap = document.createElement('div');
	wrap.style.position = 'relative';
	wrap.style.width = width + 'px';
	wrap.style.height = height + 'px';

	if (canvas.parentNode != null) {
		canvas.parentNode.insertBefore(wrap, canvas);
		wrap.appendChild(canvas);
	}
	else {
		host.appendChild(wrap);
		wrap.appendChild(canvas);
	}

	let ctx = new WebGPURenderer(canvas);
	ctx.mount(wrap, canvas);
	await ctx.initPromise;

	ctx.clearRect(0, 0, canvas.width, canvas.height);

	let swatch = ctx.createImageData(18, 18);
	for (let y = 0; y < swatch.height; y++) {
		for (let x = 0; x < swatch.width; x++) {
			let i = (y * swatch.width + x) * 4;
			swatch.data[i + 0] = x * 14;
			swatch.data[i + 1] = y * 14;
			swatch.data[i + 2] = 255;
			swatch.data[i + 3] = 255;
		}
	}

	ctx.scale(ratio, ratio);

	let bg = ctx.createLinearGradient(0, 0, width, height);
	bg.addColorStop(0, '#172033');
	bg.addColorStop(1, '#283c5f');
	ctx.fillStyle = bg;
	ctx.fillRect(0, 0, width, height);
	ctx.putImageData(swatch, Math.round((width - 34) * ratio), Math.round(18 * ratio));

	let circle = new GPUPath();
	circle.arc(90, 95, 54, 0, Math.PI * 2);
	ctx.fillStyle = 'rgba(255,255,255,0.14)';
	ctx.shadowColor = 'rgba(0,0,0,0.35)';
	ctx.shadowBlur = 10;
	ctx.shadowOffsetX = 3;
	ctx.shadowOffsetY = 4;
	ctx.fill(circle);

	ctx.shadowColor = 'rgba(0,0,0,0)';
	ctx.lineWidth = 5;
	ctx.lineJoin = 'round';
	ctx.lineCap = 'round';
	ctx.setLineDash([14, 8, 3]);
	ctx.strokeStyle = '#d8e8ff';
	let wave = new GPUPath();
	wave.moveTo(165, 140);
	wave.bezierCurveTo(215, 35, 285, 230, 340, 90);
	wave.bezierCurveTo(370, 25, 420, 115, 450, 60);
	ctx.stroke(wave);

	ctx.setLineDash([]);
	ctx.globalCompositeOperation = 'lighter';
	ctx.fillStyle = 'rgba(130,200,255,0.25)';
	ctx.fillRect(230, 92, 140, 66);
	ctx.globalCompositeOperation = 'source-over';

	ctx.font = '600 24px system-ui, sans-serif';
	ctx.fillStyle = '#ffffff';
	ctx.fillText('WebGPU uPlot smoke', 24, 220, 310);
	ctx.font = '13px system-ui, sans-serif';
	ctx.letterSpacing = '0.04em';
	ctx.fillStyle = 'rgba(255,255,255,0.72)';
	ctx.fillText('paths, text, clips, dashes, shadows, gradients', 24, 240, 420);

	ctx.present();

	let readback = null;
	if (typeof ctx.getImageDataAsync == 'function')
		readback = await ctx.getImageDataAsync(0, 0, Math.min(8, canvas.width), Math.min(8, canvas.height));

	return {ok: true, canvas, renderer: ctx, wrap, readback};
}

export default runWebGPUBrowserSmokeHarness;

# WebGPU Canvas proxy

`uplot-webgpu` includes a Canvas2D-like renderer backed by WebGPU.

This renderer exists primarily so the WebGPU uPlot port can support normal uPlot drawing paths, plugin drawing hooks, path rendering, gradients, images, text, clipping, and compositing.

It can also be used directly without uPlot.

## When to use the standalone renderer

Use `WebGPURenderer` directly when:

1. You want Canvas2D-style drawing commands that render through WebGPU.
2. You want to build custom high-throughput visualizations outside uPlot.
3. You want to mix chart rendering with custom GPU drawing.
4. You want to reuse WebGPU resources across charts, compute passes, or signal buffers.
5. You want a Canvas-like API for dashboards, telemetry, or visualization tools.

Normal uPlot users do not need this. The default `uPlot` constructor already creates and manages the renderer internally.

## Basic usage

```js
import {
  WebGPURenderer,
  GPUPath,
} from "uplot-webgpu";

const canvas = document.querySelector("canvas");

const ctx = new WebGPURenderer(canvas, {
  memoryMode: "balanced",
});

await ctx.init();

ctx.resize(canvas.clientWidth, canvas.clientHeight);

ctx.clearRect(0, 0, canvas.width, canvas.height);

ctx.fillStyle = "#f8fafc";
ctx.fillRect(0, 0, canvas.width, canvas.height);

ctx.strokeStyle = "#276ef1";
ctx.lineWidth = 3;

ctx.beginPath();
ctx.moveTo(40, 140);
ctx.bezierCurveTo(120, 20, 220, 260, 340, 80);
ctx.stroke();

ctx.fillStyle = "rgba(39, 110, 241, 0.18)";
ctx.beginPath();
ctx.roundRect(60, 180, 240, 90, 18);
ctx.fill();

await ctx.flush();
```

## Canvas-like drawing API

The renderer mirrors the Canvas2D APIs needed by uPlot and common plugin workflows.

### State

```js
ctx.save();
ctx.restore();

ctx.globalAlpha = 0.75;
ctx.globalCompositeOperation = "source-over";

ctx.lineWidth = 2;
ctx.lineCap = "round";
ctx.lineJoin = "round";
ctx.miterLimit = 10;

ctx.strokeStyle = "#276ef1";
ctx.fillStyle = "rgba(39, 110, 241, 0.15)";
```

### Transforms

```js
ctx.translate(x, y);
ctx.scale(x, y);
ctx.rotate(angle);

ctx.setTransform(a, b, c, d, e, f);
ctx.resetTransform();
```

### Paths

```js
ctx.beginPath();

ctx.moveTo(x, y);
ctx.lineTo(x, y);

ctx.quadraticCurveTo(cpx, cpy, x, y);
ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x, y);

ctx.arc(cx, cy, r, startAngle, endAngle);
ctx.arcTo(x1, y1, x2, y2, radius);
ctx.ellipse(x, y, rx, ry, rotation, startAngle, endAngle);

ctx.rect(x, y, w, h);
ctx.roundRect(x, y, w, h, radius);

ctx.closePath();

ctx.fill();
ctx.stroke();
ctx.clip();
```

### Rectangles

```js
ctx.fillRect(x, y, w, h);
ctx.strokeRect(x, y, w, h);
ctx.clearRect(x, y, w, h);
```

### Text

```js
ctx.font = "14px system-ui";
ctx.textAlign = "center";
ctx.textBaseline = "middle";

ctx.fillText("hello", x, y);
ctx.strokeText("hello", x, y);

const metrics = ctx.measureText("hello");
```

Text is drawn through a DOM-backed text layer where appropriate. This keeps labels and plugin text crisp, selectable by browser layout rules where supported, and close to Canvas2D behavior for uPlot usage.

Browser font metrics can still differ slightly from native Canvas2D.

### Gradients

```js
const grad = ctx.createLinearGradient(0, 0, 400, 0);

grad.addColorStop(0, "#276ef1");
grad.addColorStop(0.5, "#23a455");
grad.addColorStop(1, "#e4572e");

ctx.fillStyle = grad;
ctx.fillRect(40, 40, 360, 90);
```

Radial gradient:

```js
const grad = ctx.createRadialGradient(200, 120, 4, 200, 120, 100);

grad.addColorStop(0, "white");
grad.addColorStop(0.45, "rgba(228, 87, 46, 0.35)");
grad.addColorStop(1, "rgba(124, 58, 237, 0.08)");

ctx.fillStyle = grad;

ctx.beginPath();
ctx.ellipse(200, 120, 120, 70, -0.25, 0, Math.PI * 2);
ctx.fill();
```

Conic gradient:

```js
const grad = ctx.createConicGradient(-Math.PI / 2, 200, 160);

grad.addColorStop(0, "#276ef1");
grad.addColorStop(0.33, "#23a455");
grad.addColorStop(0.66, "#e4572e");
grad.addColorStop(1, "#276ef1");

ctx.fillStyle = grad;

ctx.beginPath();
ctx.arc(200, 160, 90, 0, Math.PI * 2);
ctx.arc(200, 160, 40, 0, Math.PI * 2);
ctx.fill("evenodd");
```

### Patterns

```js
const patternCanvas = document.createElement("canvas");
patternCanvas.width = 16;
patternCanvas.height = 16;

const pctx = patternCanvas.getContext("2d");

pctx.fillStyle = "#fff4d7";
pctx.fillRect(0, 0, 16, 16);

pctx.fillStyle = "#d39200";
pctx.fillRect(0, 0, 8, 8);
pctx.fillRect(8, 8, 8, 8);

const pattern = ctx.createPattern(patternCanvas, "repeat");

ctx.fillStyle = pattern;
ctx.fillRect(40, 40, 320, 120);
```

### Images

```js
const img = new Image();

img.src = "/example.png";
await img.decode();

ctx.drawImage(img, 40, 40, 256, 160);

await ctx.flush();
```

For high-throughput image paths, prefer `ImageBitmap` where possible:

```js
const bitmap = await createImageBitmap(img);

ctx.drawImage(bitmap, 40, 40, 256, 160);

await ctx.flush();
```

Supported forms:

```js
ctx.drawImage(image, dx, dy);
ctx.drawImage(image, dx, dy, dw, dh);
ctx.drawImage(image, sx, sy, sw, sh, dx, dy, dw, dh);
```

### Clipping

```js
ctx.save();

ctx.beginPath();
ctx.roundRect(70, 160, 280, 140, 24);
ctx.clip();

ctx.fillStyle = "rgba(39, 110, 241, 0.25)";
ctx.fillRect(0, 0, 500, 500);

ctx.restore();
```

Even-odd fill:

```js
ctx.beginPath();

ctx.arc(200, 200, 90, 0, Math.PI * 2);
ctx.arc(200, 200, 40, 0, Math.PI * 2);

ctx.fill("evenodd");
```

### Composite modes

```js
ctx.save();

ctx.globalAlpha = 0.75;
ctx.globalCompositeOperation = "lighter";

ctx.fillStyle = "rgba(39, 110, 241, 0.55)";
ctx.beginPath();
ctx.arc(160, 230, 70, 0, Math.PI * 2);
ctx.fill();

ctx.fillStyle = "rgba(228, 87, 46, 0.55)";
ctx.beginPath();
ctx.arc(240, 230, 70, 0, Math.PI * 2);
ctx.fill();

ctx.restore();
```

Common modes such as `source-over`, `lighter`, `multiply`, `screen`, and `destination-out` are covered by the compatibility gallery.

Some browser-native Canvas2D compositing edge cases may not match pixel-perfectly.

## GPUPath

`GPUPath` is the WebGPU-side `Path2D`-style helper. It can be passed to `fill`, `stroke`, or `clip`.

```js
import {
  WebGPURenderer,
  GPUPath,
} from "uplot-webgpu";

const ctx = new WebGPURenderer(canvas);

await ctx.init();

const path = new GPUPath();

path.moveTo(80, 80);
path.lineTo(220, 120);
path.quadraticCurveTo(300, 40, 380, 180);
path.lineTo(80, 180);
path.closePath();

ctx.fillStyle = "rgba(39, 110, 241, 0.20)";
ctx.strokeStyle = "#276ef1";
ctx.lineWidth = 2;

ctx.fill(path);
ctx.stroke(path);

await ctx.flush();
```

`GPUPath` is useful when:

1. You want to reuse geometry across frames.
2. You want to prepare paths outside the immediate draw call.
3. You want a `Path2D`-style object for custom render code.
4. You want to share path-building logic with uPlot plugin code.

## GPU buffer interop

The standalone renderer gives you access to the underlying WebGPU device:

```js
const device = ctx.getDevice();

if (!device)
  throw new Error("WebGPU device was not initialized");
```

You can use that device to create buffers that are shared with your own shaders:

```js
const sampleCount = 1_000_000;

const signalBuffer = device.createBuffer({
  size: sampleCount * 2 * 4,
  usage:
    GPUBufferUsage.STORAGE |
    GPUBufferUsage.VERTEX |
    GPUBufferUsage.COPY_DST |
    GPUBufferUsage.COPY_SRC,
});
```

Upload x/y points:

```js
const points = new Float32Array(sampleCount * 2);

for (let i = 0; i < sampleCount; i++) {
  points[i * 2 + 0] = i;
  points[i * 2 + 1] = Math.sin(i * 0.01);
}

device.queue.writeBuffer(signalBuffer, 0, points);
```

Use the same buffer in a compute pass:

```js
const encoder = device.createCommandEncoder();

const pass = encoder.beginComputePass();

pass.setPipeline(computePipeline);
pass.setBindGroup(0, computeBindGroup);
pass.dispatchWorkgroups(Math.ceil(sampleCount / 256));

pass.end();

device.queue.submit([encoder.finish()]);
```

Then use the same buffer in a custom render pipeline or another analysis pass.

This is the main reason the WebGPU version can fit into larger signal-processing, simulation, or telemetry systems more naturally than a pure Canvas2D renderer.

## Readback and export helpers

Readback and export helpers are split out of the core renderer and loaded lazily. Normal drawing does not pay for PNG/BMP/SVG export helper code.

```js
const imageData = await ctx.getImageDataAsync(0, 0, canvas.width, canvas.height);
```

Export as blob:

```js
const blob = await ctx.convertToBlob({
  type: "image/png",
});
```

Canvas-style callback:

```js
await ctx.toBlob(blob => {
  console.log(blob);
}, "image/png");
```

Data URL:

```js
const dataUrl = await ctx.toDataURLAsync("image/png");
```

SVG wrapper export:

```js
const svgText = await ctx.toSVGStringAsync();
const svgBlob = await ctx.toSVGBlob();
const svgDataUrl = await ctx.toSVGDataURLAsync();
```

Direct optional export module:

```js
import {
  rgbaImageDataToPngBytes,
  rgbaImageDataToBmpBytes,
} from "uplot-webgpu/webgpu/exporters";
```

## Memory modes

Balanced default:

```js
const ctx = new WebGPURenderer(canvas, {
  memoryMode: "balanced",
});
```

Lower retained memory:

```js
const ctx = new WebGPURenderer(canvas, {
  memoryMode: "low",
});
```

Animation-heavy throughput mode:

```js
const ctx = new WebGPURenderer(canvas, {
  memoryMode: "throughput",
});
```

Memory helpers:

```js
ctx.getMemoryStats();
ctx.trimMemory();
ctx.destroy();
```

## Shared runtime

Multiple renderers can share a WebGPU runtime. This helps dashboards with many charts or canvases.

```js
WebGPURenderer.setSharedRuntimeEnabled(true);

const a = new WebGPURenderer(canvasA);
const b = new WebGPURenderer(canvasB);

await Promise.all([
  a.init(),
  b.init(),
]);

console.log(WebGPURenderer.getSharedRuntimeStats());
```

Shared runtime is useful when:

1. Many charts exist on one page.
2. You want fewer device/adapter setup paths.
3. You want consistent GPU resource management.
4. You are combining uPlot charts with standalone WebGPU visualizations.

## Animation loop

```js
import { WebGPURenderer } from "uplot-webgpu";

const ctx = new WebGPURenderer(canvas, {
  memoryMode: "throughput",
});

await ctx.init();

function frame(t) {
  ctx.resize(canvas.clientWidth, canvas.clientHeight);

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = "#276ef1";
  ctx.lineWidth = 2;

  ctx.beginPath();

  for (let i = 0; i < 1000; i++) {
    const x = i;
    const y = 160 + Math.sin(i * 0.02 + t * 0.004) * 80;

    if (i === 0)
      ctx.moveTo(x, y);
    else
      ctx.lineTo(x, y);
  }

  ctx.stroke();
  ctx.flush();

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
```

## Using the renderer beside uPlot

The normal uPlot constructor owns its renderer internally:

```js
import uPlot from "uplot-webgpu";

const chart = new uPlot(opts, data, target);
```

For advanced integrations, the renderer is available from the chart context:

```js
const renderer = chart.ctx;

renderer.getMemoryStats();
renderer.trimMemory();
```

You can also use standalone renderers beside uPlot charts:

```js
import uPlot, { WebGPURenderer } from "uplot-webgpu";

const chart = new uPlot(opts, data, chartEl);

const custom = new WebGPURenderer(customCanvas);

await custom.init();
```

## Practical compatibility notes

This renderer is focused on the drawing paths needed by uPlot and high-throughput visualization workloads.

Covered areas include:

- paths
- strokes
- fills
- dashed lines
- line caps and joins
- gradients
- patterns
- clipping
- text
- images
- compositing
- readback
- PNG/BMP/SVG export helpers
- lifecycle and memory trimming
- shared WebGPU runtime
- access to WebGPU device resources for custom buffer interop

Areas that can differ from native Canvas2D:

- browser font metrics
- antialiasing
- exact text rasterization
- rare compositing edge cases
- pathological self-intersecting geometry
- browser-specific image source behavior
- unsupported or unusual Canvas2D APIs outside the uPlot/plugin workload

For best results, treat this as a high-throughput visualization renderer with a Canvas-like API, not as a universal browser Canvas2D replacement for every possible canvas application.
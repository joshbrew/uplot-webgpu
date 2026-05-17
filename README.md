# uPlot WebGPU

```bash
npm i uplot-webgpu
```

`uplot-webgpu` is a drop-in [uPlot](https://github.com/leeoniya/uPlot)-compatible WebGPU renderer for high-throughput browser charts.

It keeps the normal uPlot setup pattern, options, legends, cursors, scales, axes, styling, selection zoom, and plugin hooks, while moving the heavy drawing path onto WebGPU.

The demo tests ~4 million points animating on 8 charts and handily achieves >60fps on a decent laptop. 

Use it when you want uPlot but need more headroom for large live buffers, dense lines, heatmaps, ribbons, dashboards, animation-heavy views, or GPU-resident data workflows. 

The base uPlot Canvas2D renderer is already extremely fast. For small static charts, Canvas2D may still load faster and feel just as good or better. WebGPU has a higher startup cost because the browser must create a GPU device and compile render pipelines asynchronously. The WebGPU path is designed to pay off when charts are large, repeated, animated, or connected to other GPU work.

## When to use it

Use `uplot-webgpu` when:

1. You want to stream hundreds of thousands or millions of points.
2. You want many large charts animating at the same time.
3. You want lower CPU rendering pressure during repeated redraws.
4. You want to reuse signal buffers across WebGPU compute, analysis, or custom shader passes.
5. You want a uPlot-compatible chart inside a larger WebGPU dashboard.

Use base uPlot when:

1. Your charts are small or mostly static.
2. Canvas2D performance is already fine.
3. Package size matters more than rendering throughput.
4. You do not need WebGPU integration for your data buffers.

Bundled and minified, the core package is currently around `132kb`. It is larger than base uPlot because it includes a WebGPU renderer, shader programs, buffer management, and a Canvas2D-compatible drawing layer for uPlot internals and plugins.

Compatibility is basically 1:1 minus some missing Canvas API features for further customization. The library includes an actual proxy Canvas API that runs on a WebGPU context but it is not full-featured. We tested 116 different charts with zero functional or visual differences.

## Browser support

`uplot-webgpu` is tested primarily in Chromium-based browsers.

Firefox support depends on the current Firefox WebGPU implementation and browser settings.

## Live demo

[https://uplot-webgpu.netlify.app](https://uplot-webgpu.netlify.app)

The demo includes:

1. Visual parity checks against the Canvas2D uPlot reference build.
2. Large static chart tests.
3. Live animated dashboard tests.
4. WebGPU worker and buffer-backed rendering experiments.

## Basic usage

The default export is the WebGPU-backed uPlot constructor. Use it the same way as upstream uPlot:

```js
import uPlot from "uplot-webgpu";
import "uplot-webgpu/uPlot.css";

const chart = new uPlot(opts, data, document.body);
```

There is no WebGPU wrapper, provider, adapter call, renderer object, or special mount step required.

The WebGPU renderer is embedded inside the uPlot constructor path.

## Normal uPlot options still work

Because this is still uPlot, normal controls, legends, scales, cursors, selection zoom, and plugin hooks work the same way:

```js
const opts = {
  width: 900,
  height: 320,

  title: "Live signal",

  cursor: {
    drag: {
      setScale: true,
      x: true,
      y: false,
    },
  },

  legend: {
    show: true,
    live: true,
  },

  scales: {
    x: {
      time: false,
    },
    y: {
      auto: true,
    },
  },

  axes: [
    {
      label: "sample",
    },
    {
      label: "value",
    },
  ],

  series: [
    {},
    {
      label: "signal A",
      stroke: "#276ef1",
      width: 2,
      points: {
        show: false,
      },
    },
    {
      label: "signal B",
      stroke: "#e4572e",
      width: 2,
      dash: [8, 5],
      points: {
        show: false,
      },
    },
  ],
};
```

Create the data the same way you would for uPlot:

```js
const points = 500_000;

const x = new Float64Array(points);
const a = new Float32Array(points);
const b = new Float32Array(points);

for (let i = 0; i < points; i++) {
  x[i] = i;
  a[i] = Math.sin(i * 0.01);
  b[i] = Math.cos(i * 0.008);
}

const data = [x, a, b];

const chart = new uPlot(opts, data, document.body);
```

## Animating a chart

Animated charts use the normal `setData` or `redraw` flow.

For large animated buffers, reuse typed arrays instead of allocating new arrays every frame:

```js
let phase = 0;
let running = true;

function frame() {
  if (!running)
    return;

  phase += 0.04;

  for (let i = 0; i < points; i++) {
    a[i] = Math.sin(i * 0.01 + phase);
    b[i] = Math.cos(i * 0.008 + phase * 0.7);
  }

  chart.setData(data, false);
  chart.redraw();

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
```

## Simple controls

Controls can call normal uPlot methods:

```js
const controls = document.createElement("div");

controls.innerHTML = `
  <button data-action="toggle">Pause</button>
  <button data-action="reset">Reset zoom</button>
  <button data-action="trim">Trim GPU memory</button>
`;

document.body.prepend(controls);

controls.addEventListener("click", event => {
  const action = event.target?.dataset?.action;

  if (action === "toggle") {
    running = !running;
    event.target.textContent = running ? "Pause" : "Resume";

    if (running)
      requestAnimationFrame(frame);
  }

  if (action === "reset") {
    chart.setScale("x", {
      min: x[0],
      max: x[x.length - 1],
    });
  }

  if (action === "trim") {
    chart.ctx.trimMemory();
  }
});
```

The legend is still uPlot’s normal live legend. Series labels, cursor values, dashed styles, hidden points, axes, scales, and plugins are configured through normal uPlot options. The difference is that the heavy draw path is backed by WebGPU.

## Web Worker animation example

For large animated charts, a useful pattern is to let a Web Worker generate or update the signal while the main thread owns the uPlot instance, legend, cursor, controls, and DOM interaction.

This keeps uPlot usage normal while moving expensive data generation off the main thread.

### `main.js`

```js
import uPlot from "uplot-webgpu";
import "uplot-webgpu/uPlot.css";

const points = 500_000;

const x = new Float64Array(points);
const y = new Float32Array(points);

for (let i = 0; i < points; i++) {
  x[i] = i;
  y[i] = 0;
}

const opts = {
  width: 900,
  height: 320,

  title: "Worker-driven signal",

  cursor: {
    drag: {
      setScale: true,
      x: true,
      y: false,
    },
  },

  legend: {
    show: true,
    live: true,
  },

  scales: {
    x: {
      time: false,
    },
    y: {
      auto: true,
    },
  },

  axes: [
    {
      label: "sample",
    },
    {
      label: "value",
    },
  ],

  series: [
    {},
    {
      label: "worker signal",
      stroke: "#276ef1",
      width: 2,
      points: {
        show: false,
      },
    },
  ],
};

const data = [x, y];

const chart = new uPlot(opts, data, document.body);

const worker = new Worker(new URL("./signal.worker.js", import.meta.url), {
  type: "module",
});

let running = true;
let pending = false;
let yBuffer = y.buffer;

worker.postMessage({
  type: "init",
  points,
  yBuffer,
}, [yBuffer]);

worker.onmessage = event => {
  const message = event.data;

  if (message.type !== "frame")
    return;

  pending = false;

  yBuffer = message.yBuffer;
  data[1] = new Float32Array(yBuffer);

  chart.setData(data, false);
  chart.redraw();

  if (running)
    requestWorkerFrame();
};

function requestWorkerFrame() {
  if (pending)
    return;

  pending = true;

  worker.postMessage({
    type: "frame",
    time: performance.now(),
    yBuffer,
  }, [yBuffer]);
}

requestWorkerFrame();
```

### `signal.worker.js`

```js
let points = 0;
let phase = 0;

self.onmessage = event => {
  const message = event.data;

  if (message.type === "init") {
    points = message.points;
    return;
  }

  if (message.type !== "frame")
    return;

  const y = new Float32Array(message.yBuffer);

  phase += 0.04;

  const slowShift = Math.sin(phase * 0.25) * 0.8;

  for (let i = 0; i < points; i++) {
    const fast = Math.sin(i * 0.01 + phase);
    const slow = Math.sin(i * 0.0007 + slowShift) * 0.35;
    const drift = Math.sin(i * 0.00003 + phase * 0.1) * 0.15;

    y[i] = fast + slow + drift;
  }

  self.postMessage({
    type: "frame",
    yBuffer: y.buffer,
  }, [y.buffer]);
};
```

This example transfers the `y` buffer back and forth instead of allocating a new `Float32Array` every frame.

A good dashboard split is:

```txt
Worker
  -> generate or update large typed arrays

Main thread
  -> uPlot interaction, legend, cursor, controls

WebGPU renderer
  -> high-throughput drawing
```

For heavier pipelines, combine this with GPU buffers so a worker, compute pass, or custom renderer can update GPU-side data directly.

## Cleanup

Manual cleanup works the same as in uPlot:

```js
chart.destroy();
```

Additional cleanup helpers are available for dynamic pages, route transitions, modals, dashboards, and popups that create and remove many charts:

```js
uPlot.destroyDetached();
uPlot.destroyAll();
uPlot.getLivePlots();
```

Detached charts are cleaned up automatically when a chart that was once connected to the document is later removed. Manual cleanup is still recommended when your app framework has a reliable unmount hook.

## Runtime memory controls

The WebGPU renderer defaults to:

```js
memoryMode: "balanced"
```

This releases CPU-side draw commands after submit, trims oversized staging arrays, and caps cached image textures.

Apps that prefer lower retained memory can use:

```js
uPlot.configure({
  rendererOptions: {
    memoryMode: "low",
  },
});
```

Animation-heavy views can prefer fewer reallocations:

```js
uPlot.configure({
  rendererOptions: {
    memoryMode: "throughput",
  },
});
```

Per-chart renderer options can also be passed through normal uPlot options where supported by the port.

Advanced cleanup hooks are available on the renderer-backed context:

```js
chart.ctx.getMemoryStats();
chart.ctx.trimMemory();
```

## Shared WebGPU runtime

Several charts can share one WebGPU runtime. This avoids repeatedly creating device-level renderer resources for every chart.

```js
import uPlot, { WebGPURenderer } from "uplot-webgpu";

WebGPURenderer.setSharedRuntimeEnabled(true);

const chartA = new uPlot(optsA, dataA, elA);
const chartB = new uPlot(optsB, dataB, elB);

await Promise.all([
  chartA.ctx.initPromise,
  chartB.ctx.initPromise,
]);

console.log(WebGPURenderer.getSharedRuntimeStats());
```

The shared runtime is useful for dashboards, route-level chart groups, and pages with many live plots.

## Advanced GPU buffer reuse

Most users only need normal uPlot data:

```js
const chart = new uPlot(opts, data, target);
```

Advanced WebGPU apps can also access the renderer from the chart context:

```js
const renderer = chart.ctx;

await renderer.initPromise;

const device = renderer.getDevice();
const gpuContext = renderer.getCanvasContext();

if (!device)
  throw new Error("WebGPU device was not initialized");
```

This lets large signal data stay in `GPUBuffer`s and be reused by compute passes, custom shader passes, and chart visualization code.

A common layout is:

```txt
sensor / simulation / worker
  -> GPUBuffer
  -> compute pass
  -> chart render pass
  -> overlay / analysis pass
```

Example signal buffer:

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

Upload data from JavaScript when needed:

```js
const points = new Float32Array(sampleCount * 2);

for (let i = 0; i < sampleCount; i++) {
  points[i * 2 + 0] = i;
  points[i * 2 + 1] = Math.sin(i * 0.01);
}

device.queue.writeBuffer(signalBuffer, 0, points);
```

That same buffer can be used by:

1. A compute shader that filters or transforms the signal.
2. A custom render pass that visualizes the signal.
3. A uPlot WebGPU chart or overlay.
4. Another GPU pass that calculates thresholds, histograms, FFT prep, alerts, or markers.

### Experimental GPUBuffer-backed series

The stable drop-in API accepts normal uPlot data:

```js
const data = [xValues, yValues];

const chart = new uPlot(opts, data, target);
```

For GPU-heavy views, keep a mirrored `GPUBuffer` beside the uPlot data. The normal arrays provide scale and domain metadata. The GPU buffer can be reused by compute shaders and custom render paths.

```js
const sampleCount = 1_000_000;

const xValues = new Float64Array(sampleCount);
const yValues = new Float32Array(sampleCount);

for (let i = 0; i < sampleCount; i++) {
  xValues[i] = i;
  yValues[i] = Math.sin(i * 0.01);
}

const data = [
  xValues,
  yValues,
];

const chart = new uPlot(opts, data, document.body);

await chart.ctx.initPromise;

const renderer = chart.ctx;
const device = renderer.getDevice();

if (!device)
  throw new Error("WebGPU device was not initialized");
```

Create a GPU-side copy of the same signal:

```js
const pointBuffer = device.createBuffer({
  size: sampleCount * 2 * 4,
  usage:
    GPUBufferUsage.STORAGE |
    GPUBufferUsage.VERTEX |
    GPUBufferUsage.COPY_DST |
    GPUBufferUsage.COPY_SRC,
});

const pointData = new Float32Array(sampleCount * 2);

for (let i = 0; i < sampleCount; i++) {
  pointData[i * 2 + 0] = xValues[i];
  pointData[i * 2 + 1] = yValues[i];
}

device.queue.writeBuffer(pointBuffer, 0, pointData);
```

Describe the GPU-backed series source:

```js
const gpuSignal = {
  buffer: pointBuffer,

  count: sampleCount,
  stride: 8,

  xOffset: 0,
  yOffset: 4,

  xType: "f32",
  yType: "f32",

  xMin: xValues[0],
  xMax: xValues[sampleCount - 1],
  yMin: -1,
  yMax: 1,
};
```

Attach it when the external-series path is enabled:

```js
renderer.setExternalSeries?.(1, gpuSignal);

chart.redraw();
```

The chart still behaves like uPlot from the outside:

```js
chart.setScale("x", {
  min: 100_000,
  max: 140_000,
});

chart.redraw();
```

The important idea is that `data` remains the normal uPlot-facing data shape, while `gpuSignal` is the WebGPU-side representation that can be reused by other shaders.

### Compute pass example

The same `pointBuffer` can be read or written by a compute shader.

```js
const paramsBuffer = device.createBuffer({
  size: 16,
  usage:
    GPUBufferUsage.UNIFORM |
    GPUBufferUsage.COPY_DST,
});

device.queue.writeBuffer(
  paramsBuffer,
  0,
  new Float32Array([
    performance.now() * 0.001,
    sampleCount,
    0,
    0,
  ]),
);
```

Example WGSL compute shader:

```wgsl
struct Params {
  time: f32,
  count: f32,
  pad0: f32,
  pad1: f32,
}

@group(0) @binding(0)
var<storage, read_write> points: array<vec2<f32>>;

@group(0) @binding(1)
var<uniform> params: Params;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;

  if (i >= u32(params.count)) {
    return;
  }

  let x = points[i].x;
  let wave = sin(x * 0.01 + params.time) * 0.75;
  let slow = sin(x * 0.0007 + params.time * 0.25) * 0.25;

  points[i].y = wave + slow;
}
```

Create the compute pipeline and bind group:

```js
const shader = device.createShaderModule({
  code: computeWGSL,
});

const computePipeline = device.createComputePipeline({
  layout: "auto",
  compute: {
    module: shader,
    entryPoint: "main",
  },
});

const computeBindGroup = device.createBindGroup({
  layout: computePipeline.getBindGroupLayout(0),
  entries: [
    {
      binding: 0,
      resource: {
        buffer: pointBuffer,
      },
    },
    {
      binding: 1,
      resource: {
        buffer: paramsBuffer,
      },
    },
  ],
});
```

Run the compute pass, then redraw the chart from the same GPU buffer:

```js
function animate() {
  device.queue.writeBuffer(
    paramsBuffer,
    0,
    new Float32Array([
      performance.now() * 0.001,
      sampleCount,
      0,
      0,
    ]),
  );

  const encoder = device.createCommandEncoder();
  const pass = encoder.beginComputePass();

  pass.setPipeline(computePipeline);
  pass.setBindGroup(0, computeBindGroup);
  pass.dispatchWorkgroups(Math.ceil(sampleCount / 256));

  pass.end();

  device.queue.submit([encoder.finish()]);

  chart.redraw();

  requestAnimationFrame(animate);
}

requestAnimationFrame(animate);
```

This avoids rebuilding a million-point JavaScript array every frame. The CPU-side uPlot arrays are still useful for initial scale and domain setup, but the live signal update can happen directly in GPU memory.

## Advanced renderer exports

Normal chart usage only needs the default export:

```js
import uPlot from "uplot-webgpu";
```

Advanced users can access the renderer directly:

```js
import uPlot, {
  WebGPURenderer,
  GPUPath,
} from "uplot-webgpu";
```

Renderer-only convenience subpath:

```js
import {
  WebGPURenderer,
  GPUPath,
} from "uplot-webgpu/renderer";
```

These exports are part of the core runtime because the default WebGPU uPlot constructor uses them internally.

## Canvas proxy and standalone renderer

The package also includes a Canvas2D-like WebGPU renderer that can be used independently of uPlot.

This is useful for custom GPU dashboards, plugin experiments, signal-buffer visualization, and canvas-like drawing that should render through WebGPU.

See:

```txt
CANVAS_PROXY.md
```

## Running the benchmark locally

Serve `index.html` with the `dist` folder present.

To rebuild the demo bundle:

```bash
npm i -g tinybuild
tinybuild
```

Or use the project start script:

```bash
npm start
```

The benchmark entrypoint includes the old Canvas2D reference build and smoke tests so you can compare visual parity, cold start, warm chart creation, redraw submission, zoom behavior, and live dashboard FPS.

## Performance notes

Canvas2D often wins small static charts because it has almost no GPU setup cost and uPlot is already highly optimized.

`uplot-webgpu` is most useful when the chart workload is large enough or repeated enough to benefit from GPU-backed rendering and shared GPU resources.

## Contribute

MIT License, based on the original [uPlot](https://github.com/leeoniya/uPlot) by leeoniya

Feel free to make pull requests or fork it.

I'm not likely going to keep this up-to-date or explore every edge case that uPlot handles, this was to fill a niche of needing stylizable charts with lots of data in the buffers that still load and animate fast, as I work with lots of real-time data. 
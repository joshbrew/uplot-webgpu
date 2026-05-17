// Drop-in WebGPU uPlot entrypoint.
//
// Use this the same way as upstream uPlot:
//
//   import uPlot from './index.js';
//   const chart = new uPlot(opts, data, target);
//
// WebGPURenderer and GPUPath are not optional app-side setup. They are embedded
// into uPlot.js and are used automatically by the default constructor.
//
// Kept out of this entrypoint on purpose:
//   - Canvas2D reference build
//   - browser smoke tests
//   - benchmark/demo harnesses

import css from './scripts/uPlot.css';

export { default } from './scripts/uPlot.js';
export { default as uPlot } from './scripts/uPlot.js';
export { GPUPath } from './scripts/webgpu/GPUPath.js';
export { WebGPURenderer, WebGPURendererInternals } from './scripts/webgpu/WebGPURenderer.js';

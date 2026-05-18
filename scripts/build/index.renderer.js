// Explicit renderer convenience subpath.
//
// The renderer is already embedded in the default uPlot constructor. Importing
// from this file is only for advanced integrations that want direct access to
// renderer classes for shared buffers, custom draw bridges, or diagnostics.

export { default, uPlot, GPUPath, WebGPURenderer, WebGPURendererInternals } from '../../index.js';

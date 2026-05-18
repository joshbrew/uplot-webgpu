// Development and benchmark entrypoint.
//
// This intentionally includes the preserved Canvas2D reference build and the
// renderer smoke tests. Do not use this as the default library entry if bundle
// size matters.

export { default, uPlot, GPUPath, WebGPURenderer, WebGPURendererInternals } from '../../index.js';
export { default as defaultUPlot } from '../../original/uPlot.canvas2d.js';
export { runWebGPURendererSmokeTests } from '../webgpu/smokeTest.js';

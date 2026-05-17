import { GPUPath } from './GPUPath.js';

export type RGBA = [number, number, number, number];

export type WebGPUMemoryMode = 'low' | 'balanced' | 'throughput';

export interface WebGPURendererOptions {
  sharedRuntime?: boolean;
  alpha?: boolean;
  colorSpace?: PredefinedColorSpace;
  desynchronized?: boolean;
  memory?: WebGPUMemoryMode;
  memoryMode?: WebGPUMemoryMode;
  retainCommands?: boolean;
  retainCommandsForReadback?: boolean;
  releaseCommandsAfterPresent?: boolean;
  maxRetainedUploadBytes?: number;
  maxRetainedVertexBufferBytes?: number;
  maxTextureBytes?: number;
  maxTextureRecords?: number;
  maxColorCacheEntries?: number;
  maxTextMeasureCacheEntries?: number;
}

export interface WebGPURendererFrameStats {
  cpuMs: number;
  prepMs: number;
  uploadMs: number;
  submitMs: number;
  drawCalls: number;
  vertices: number;
  bytes: number;
  writes: number;
  images: number;
  clips: number;
  retainedCPUBytes?: number;
  retainedGPUBytes?: number;
  textureBytes?: number;
  commandsReleased?: boolean;
}

export interface WebGPURendererMemoryStats {
  mode: WebGPUMemoryMode;
  commands: number;
  commandsReleased: boolean;
  retainedCPUBytes: number;
  retainedGPUBytes: number;
  solidUploadBytes: number;
  imageUploadBytes: number;
  solidBufferBytes: number;
  imageBufferBytes: number;
  textureBytes: number;
  textureRecords: number;
}

export interface WebGPUWarmupStats {
  ok: boolean;
  ms: number;
  submitted?: boolean;
  sharedRuntime?: boolean;
  error?: string;
  runtime?: WebGPURuntimeStats;
}

export interface WebGPURuntimeStats {
  enabled?: boolean;
  active?: boolean;
  refs?: number;
  adapterInfo?: Record<string, unknown>;
}

export interface CanvasGradientLike {
  addColorStop(offset: number, color: string): void;
}

export interface CanvasPatternLike {
  setTransform?(transform?: DOMMatrix2DInit): void;
}

export declare class WebGPURenderer {
  constructor(canvas: HTMLCanvasElement | OffscreenCanvas, options?: WebGPURendererOptions | null);

  canvas: HTMLCanvasElement | OffscreenCanvas;
  options: WebGPURendererOptions;
  initPromise: Promise<void>;

  fillStyle: string | CanvasGradientLike | CanvasPatternLike;
  strokeStyle: string | CanvasGradientLike | CanvasPatternLike;
  lineWidth: number;
  lineJoin: CanvasLineJoin;
  lineCap: CanvasLineCap;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  globalAlpha: number;
  globalCompositeOperation: GlobalCompositeOperation;
  lineDashOffset: number;
  miterLimit: number;
  direction: CanvasDirection | 'inherit';
  filter: string;
  fontKerning: string;
  fontStretch: string;
  fontVariantCaps: string;
  letterSpacing: string;
  textRendering: string;
  wordSpacing: string;
  imageSmoothingEnabled: boolean;
  imageSmoothingQuality: ImageSmoothingQuality;
  shadowColor: string;
  shadowBlur: number;
  shadowOffsetX: number;
  shadowOffsetY: number;

  static setSharedRuntimeEnabled(enabled: boolean): void;
  static prewarm(options?: {sharedRuntime?: boolean; width?: number; height?: number; canvas?: HTMLCanvasElement | OffscreenCanvas} | null): Promise<WebGPUWarmupStats>;
  static getSharedRuntimeStats(): WebGPURuntimeStats;

  init(): Promise<void>;
  mount(wrapper: Element, canvas: HTMLCanvasElement | OffscreenCanvas): void;
  destroy(): void;
  resize(width?: number, height?: number): void;
  flush(): Promise<void>;
  present(): void;
  getLastFrameStats(): WebGPURendererFrameStats;
  getMemoryStats(): WebGPURendererMemoryStats;
  trimMemory(): WebGPURendererMemoryStats;
  getDevice(): GPUDevice | null;
  getRuntime(): unknown;
  getCanvasContext(): GPUCanvasContext | null;

  save(): void;
  restore(): void;
  resetTransform(): void;
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  transform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  translate(x: number, y: number): void;
  scale(x: number, y: number): void;
  rotate(angle: number): void;

  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void;
  bezierCurveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number): void;
  arc(cx: number, cy: number, radius: number, startAngle: number, endAngle: number, counterclockwise?: boolean): void;
  arcTo(x1: number, y1: number, x2: number, y2: number, radius: number): void;
  ellipse(x: number, y: number, radiusX: number, radiusY: number, rotation: number, startAngle: number, endAngle: number, counterclockwise?: boolean): void;
  roundRect(x: number, y: number, width: number, height: number, radii?: number | number[] | DOMPointInit | DOMPointInit[]): void;
  rect(x: number, y: number, width: number, height: number): void;
  clip(path?: GPUPath | CanvasFillRule, fillRule?: CanvasFillRule): void;
  fill(path?: GPUPath | CanvasFillRule, fillRule?: CanvasFillRule): void;
  stroke(path?: GPUPath): void;
  fillRect(x: number, y: number, width: number, height: number): void;
  strokeRect(x: number, y: number, width: number, height: number): void;
  clearRect(x: number, y: number, width: number, height: number): void;
  fillText(text: string, x: number, y: number, maxWidth?: number): void;
  strokeText(text: string, x: number, y: number, maxWidth?: number): void;
  measureText(text: string): TextMetrics;
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): CanvasGradientLike;
  createRadialGradient(x0: number, y0: number, r0: number, x1: number, y1: number, r1: number): CanvasGradientLike;
  createConicGradient(startAngle: number, x: number, y: number): CanvasGradientLike;
  createPattern(image: CanvasImageSource | ImageBitmap, repetition?: string): CanvasPatternLike | null;
  createImageData(width: number, height: number): ImageData;
  putImageData(imageData: ImageData, dx: number, dy: number, dirtyX?: number, dirtyY?: number, dirtyWidth?: number, dirtyHeight?: number): void;
  getImageData(sx?: number, sy?: number, sw?: number, sh?: number): ImageData;
  getImageDataAsync(sx?: number, sy?: number, sw?: number, sh?: number): Promise<ImageData>;
  setLineDash(segments: number[]): void;
  getLineDash(): number[];
  drawImage(image: CanvasImageSource | ImageBitmap, dx: number, dy: number): void;
  drawImage(image: CanvasImageSource | ImageBitmap, dx: number, dy: number, dWidth: number, dHeight: number): void;
  drawImage(image: CanvasImageSource | ImageBitmap, sx: number, sy: number, sWidth: number, sHeight: number, dx: number, dy: number, dWidth: number, dHeight: number): void;
}

export declare const WebGPURendererInternals: Record<string, unknown>;
export default WebGPURenderer;

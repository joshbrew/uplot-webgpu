export type GPUPathCommand =
  | ['M', number, number]
  | ['L', number, number]
  | ['Q', number, number, number, number]
  | ['C', number, number, number, number, number, number]
  | ['A', number, number, number, number, number, boolean]
  | ['Z'];

export interface GPUPathBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

export class GPUPath {
  constructor(path?: GPUPath | Path2D | GPUPathCommand[] | string);
  cmds: GPUPathCommand[];
  commands?: GPUPathCommand[];
  currentX: number;
  currentY: number;
  startX: number;
  startY: number;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void;
  bezierCurveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number): void;
  arc(cx: number, cy: number, radius: number, startAngle: number, endAngle: number, counterclockwise?: boolean): void;
  arcTo(x1: number, y1: number, x2: number, y2: number, radius: number): void;
  ellipse(x: number, y: number, radiusX: number, radiusY: number, rotation: number, startAngle: number, endAngle: number, counterclockwise?: boolean): void;
  roundRect(x: number, y: number, w: number, h: number, radii?: number | number[] | DOMPointInit | DOMPointInit[]): void;
  rect(x: number, y: number, w: number, h: number): void;
  closePath(): void;
  addPath(path: GPUPath, transform?: DOMMatrix | number[]): void;
  clone(): GPUPath;
  clear(): this;
  isEmpty(): boolean;
  clear(): void;
  toPolygons(transform?: number[], tolerance?: number): number[][][];
  toSubpaths(transform?: number[], tolerance?: number): number[][][];
  getBounds(transform?: number[]): GPUPathBounds | null;
}

export default GPUPath;

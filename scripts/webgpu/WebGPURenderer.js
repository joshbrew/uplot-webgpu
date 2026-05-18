import { GPUPath } from "./GPUPath.js";
import { CHART_WGSL, IMAGE_WGSL } from "./shaders.js";
const DEFAULT_COLOR = [0, 0, 0, 1];
const TRANSPARENT = [0, 0, 0, 0];
const EPS = 1e-9;
const FLOATS_PER_VERTEX = 6;
const FLOATS_PER_IMAGE_VERTEX = 5;
const CONTEXT_ATTRIBUTES = Object.freeze({
  alpha: true,
  colorSpace: "srgb",
  colorType: "unorm8",
  desynchronized: false,
  willReadFrequently: false
});
const MEMORY_PRESETS = Object.freeze({
  low: {
    releaseCommandsAfterPresent: true,
    maxRetainedUploadBytes: 1 * 1024 * 1024,
    maxRetainedVertexBufferBytes: 8 * 1024 * 1024,
    maxTextureBytes: 16 * 1024 * 1024,
    maxTextureRecords: 24,
    maxColorCacheEntries: 384,
    maxTextMeasureCacheEntries: 512
  },
  balanced: {
    releaseCommandsAfterPresent: true,
    maxRetainedUploadBytes: 4 * 1024 * 1024,
    maxRetainedVertexBufferBytes: 32 * 1024 * 1024,
    maxTextureBytes: 64 * 1024 * 1024,
    maxTextureRecords: 64,
    maxColorCacheEntries: 768,
    maxTextMeasureCacheEntries: 1024
  },
  throughput: {
    releaseCommandsAfterPresent: false,
    maxRetainedUploadBytes: 64 * 1024 * 1024,
    maxRetainedVertexBufferBytes: 256 * 1024 * 1024,
    maxTextureBytes: 256 * 1024 * 1024,
    maxTextureRecords: 256,
    maxColorCacheEntries: 2048,
    maxTextMeasureCacheEntries: 4096
  }
});
function byteLimit(value, fallback) {
  value = Number(value);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}
function countLimit(value, fallback) {
  value = Number(value);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}
function normalizeMemoryOptions(options = null) {
  let mode = String(options?.memoryMode || options?.memory || "balanced").toLowerCase();
  let base = MEMORY_PRESETS[mode] || MEMORY_PRESETS.balanced;
  return {
    mode: MEMORY_PRESETS[mode] ? mode : "balanced",
    releaseCommandsAfterPresent: options?.retainCommands === true || options?.retainCommandsForReadback === true ? false : options?.releaseCommandsAfterPresent !== false && base.releaseCommandsAfterPresent,
    maxRetainedUploadBytes: byteLimit(options?.maxRetainedUploadBytes, base.maxRetainedUploadBytes),
    maxRetainedVertexBufferBytes: byteLimit(options?.maxRetainedVertexBufferBytes, base.maxRetainedVertexBufferBytes),
    maxTextureBytes: byteLimit(options?.maxTextureBytes, base.maxTextureBytes),
    maxTextureRecords: countLimit(options?.maxTextureRecords, base.maxTextureRecords),
    maxColorCacheEntries: countLimit(options?.maxColorCacheEntries, base.maxColorCacheEntries),
    maxTextMeasureCacheEntries: countLimit(options?.maxTextMeasureCacheEntries, base.maxTextMeasureCacheEntries)
  };
}
function textureByteSize(width, height) {
  return Math.max(0, Math.floor(width || 0)) * Math.max(0, Math.floor(height || 0)) * 4;
}
function byteLengthOf(value) {
  return value?.byteLength || 0;
}
function perfNow() {
  return typeof performance != "undefined" && typeof performance.now == "function" ? performance.now() : Date.now();
}
function identity() {
  return [1, 0, 0, 1, 0, 0];
}
function cloneState(state) {
  return {
    strokeStyle: state.strokeStyle,
    fillStyle: state.fillStyle,
    lineWidth: state.lineWidth,
    lineJoin: state.lineJoin,
    lineCap: state.lineCap,
    lineDash: state.lineDash.slice(),
    font: state.font,
    textAlign: state.textAlign,
    textBaseline: state.textBaseline,
    globalAlpha: state.globalAlpha,
    transform: state.transform.slice(),
    clipRegions: cloneClipRegions(state.clipRegions),
    lineDashOffset: state.lineDashOffset,
    miterLimit: state.miterLimit,
    globalCompositeOperation: state.globalCompositeOperation,
    shadowColor: state.shadowColor,
    shadowBlur: state.shadowBlur,
    shadowOffsetX: state.shadowOffsetX,
    shadowOffsetY: state.shadowOffsetY,
    direction: state.direction,
    filter: state.filter,
    fontKerning: state.fontKerning,
    fontStretch: state.fontStretch,
    fontVariantCaps: state.fontVariantCaps,
    letterSpacing: state.letterSpacing,
    textRendering: state.textRendering,
    wordSpacing: state.wordSpacing,
    imageSmoothingEnabled: state.imageSmoothingEnabled,
    imageSmoothingQuality: state.imageSmoothingQuality
  };
}
function cloneClipRegions(regions) {
  return regions == null ? null : regions.map((poly) => poly.map((p) => [p[0], p[1]]));
}
function normalizeRect(rect) {
  let { x, y, w, h } = rect;
  if (w < 0) {
    x += w;
    w = -w;
  }
  if (h < 0) {
    y += h;
    h = -h;
  }
  return { x, y, w, h };
}
function rectToPolygon(rect, m) {
  let r = normalizeRect(rect);
  return [
    transformPoint(m, r.x, r.y),
    transformPoint(m, r.x + r.w, r.y),
    transformPoint(m, r.x + r.w, r.y + r.h),
    transformPoint(m, r.x, r.y + r.h)
  ];
}
function polygonArea(poly) {
  let sum = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++)
    sum += poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
  return sum / 2;
}
function lineIntersection(a, b, c, d) {
  let bax = b[0] - a[0];
  let bay = b[1] - a[1];
  let dcx = d[0] - c[0];
  let dcy = d[1] - c[1];
  let den = bax * dcy - bay * dcx;
  if (Math.abs(den) < EPS)
    return b;
  let acx = c[0] - a[0];
  let acy = c[1] - a[1];
  let t = (acx * dcy - acy * dcx) / den;
  return [a[0] + bax * t, a[1] + bay * t];
}
function clipConvexPolygon(subject, clipper) {
  if (subject.length < 3 || clipper.length < 3)
    return [];
  let out = subject;
  let ccw = polygonArea(clipper) >= 0;
  for (let i = 0; i < clipper.length; i++) {
    let a = clipper[i];
    let b = clipper[(i + 1) % clipper.length];
    let input = out;
    out = [];
    if (input.length == 0)
      break;
    let inside = (p) => {
      let cross = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
      return ccw ? cross >= -EPS : cross <= EPS;
    };
    let prev = input[input.length - 1];
    let prevInside = inside(prev);
    for (let curr of input) {
      let currInside = inside(curr);
      if (currInside) {
        if (!prevInside)
          out.push(lineIntersection(prev, curr, a, b));
        out.push(curr);
      } else if (prevInside)
        out.push(lineIntersection(prev, curr, a, b));
      prev = curr;
      prevInside = currInside;
    }
  }
  return cleanPolygon(out);
}
function triangleToRegion(tri) {
  return [tri[0], tri[1], tri[2]];
}
function rectsToEvenOddRegions(rects, transform) {
  let normalized = rects.map(normalizeRect).filter((r) => r.w > EPS && r.h > EPS);
  if (normalized.length == 0)
    return [];
  let xs = [];
  let ys = [];
  for (let r of normalized) {
    xs.push(r.x, r.x + r.w);
    ys.push(r.y, r.y + r.h);
  }
  xs = Array.from(new Set(xs)).sort((a, b) => a - b);
  ys = Array.from(new Set(ys)).sort((a, b) => a - b);
  let regions = [];
  for (let yi = 0; yi < ys.length - 1; yi++) {
    let y0 = ys[yi];
    let y1 = ys[yi + 1];
    if (y1 - y0 <= EPS)
      continue;
    for (let xi = 0; xi < xs.length - 1; xi++) {
      let x0 = xs[xi];
      let x1 = xs[xi + 1];
      if (x1 - x0 <= EPS)
        continue;
      let cx = (x0 + x1) / 2;
      let cy = (y0 + y1) / 2;
      let hits = 0;
      for (let r of normalized) {
        if (cx >= r.x - EPS && cx <= r.x + r.w + EPS && cy >= r.y - EPS && cy <= r.y + r.h + EPS)
          hits++;
      }
      if ((hits & 1) == 1)
        regions.push(rectToPolygon({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, transform));
    }
  }
  return regions;
}
function rectsToNonZeroRegions(rects, transform) {
  let normalized = rects.map((r) => {
    let winding = Number.isFinite(Number(r.winding)) ? Math.sign(Number(r.winding)) : Math.sign(Number(r.w) * Number(r.h));
    return { ...normalizeRect(r), winding: winding || 0 };
  }).filter((r) => r.w > EPS && r.h > EPS && r.winding != 0);
  if (normalized.length == 0)
    return [];
  let xs = [];
  let ys = [];
  for (let r of normalized) {
    xs.push(r.x, r.x + r.w);
    ys.push(r.y, r.y + r.h);
  }
  xs = Array.from(new Set(xs)).sort((a, b) => a - b);
  ys = Array.from(new Set(ys)).sort((a, b) => a - b);
  let regions = [];
  for (let yi = 0; yi < ys.length - 1; yi++) {
    let y0 = ys[yi];
    let y1 = ys[yi + 1];
    if (y1 - y0 <= EPS)
      continue;
    for (let xi = 0; xi < xs.length - 1; xi++) {
      let x0 = xs[xi];
      let x1 = xs[xi + 1];
      if (x1 - x0 <= EPS)
        continue;
      let cx = (x0 + x1) / 2;
      let cy = (y0 + y1) / 2;
      let winding = 0;
      for (let r of normalized) {
        if (cx >= r.x - EPS && cx <= r.x + r.w + EPS && cy >= r.y - EPS && cy <= r.y + r.h + EPS)
          winding += r.winding;
      }
      if (winding != 0)
        regions.push(rectToPolygon({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, transform));
    }
  }
  return regions;
}
function pathToClipRegions(path, transform, fillRule = "nonzero") {
  if (path == null)
    return [];
  let rects = path.getRects?.();
  if (rects != null) {
    if (fillRule == "evenodd" && rects.length > 1)
      return rectsToEvenOddRegions(rects, transform);
    if (fillRule == "nonzero" && rects.length > 1)
      return rectsToNonZeroRegions(rects, transform);
    return rects.map((rect) => rectToPolygon(rect, transform));
  }
  let regions = [];
  let subpaths = path.toSubpaths?.() || [];
  let polys = subpaths.map((sub) => cleanPolygon(sub.map((p) => transformPoint(transform, p[0], p[1])))).filter((poly) => poly.length >= 3 && Math.abs(polygonArea(poly)) > EPS);
  if (polys.length == 1)
    return triangulate(polys[0]).map(triangleToRegion);
  for (let poly of polys) {
    for (let tri of triangulate(poly)) {
      let cx = (tri[0][0] + tri[1][0] + tri[2][0]) / 3;
      let cy = (tri[0][1] + tri[1][1] + tri[2][1]) / 3;
      if (fillContainsPoint([cx, cy], polys, fillRule))
        regions.push(triangleToRegion(tri));
    }
  }
  return regions;
}
function pathToFillRegions(path, transform, fillRule = "nonzero") {
  if (path == null)
    return [];
  return pathToClipRegions(path, transform, fillRule);
}
function combineClipRegions(oldRegions, newRegions) {
  newRegions = newRegions.filter((poly) => poly.length >= 3 && Math.abs(polygonArea(poly)) > EPS);
  if (newRegions.length == 0)
    return [];
  if (oldRegions == null)
    return newRegions;
  let out = [];
  for (let a of oldRegions) {
    for (let b of newRegions) {
      let clipped = clipConvexPolygon(a, b);
      if (clipped.length >= 3 && Math.abs(polygonArea(clipped)) > EPS)
        out.push(clipped);
    }
  }
  return out;
}
function pushTri(out, a, b, c, color) {
  pushPaintedTriangle(out, a, b, c, color);
}
function fanEmit(out, poly, color) {
  poly = cleanPolygon(poly);
  for (let i = 1; i < poly.length - 1; i++)
    pushTri(out, poly[0], poly[i], poly[i + 1], color);
}
function vertexIntersection(a, b, c, d) {
  let bax = b[0] - a[0];
  let bay = b[1] - a[1];
  let dcx = d[0] - c[0];
  let dcy = d[1] - c[1];
  let den = bax * dcy - bay * dcx;
  if (Math.abs(den) < EPS)
    return b.slice();
  let acx = c[0] - a[0];
  let acy = c[1] - a[1];
  let t = (acx * dcy - acy * dcx) / den;
  let out = [a[0] + bax * t, a[1] + bay * t];
  for (let i = 2; i < FLOATS_PER_VERTEX; i++)
    out[i] = a[i] + (b[i] - a[i]) * t;
  return out;
}
function clipVertexPolygon(subject, clipper) {
  if (subject.length < 3 || clipper.length < 3)
    return [];
  let out = subject;
  let ccw = polygonArea(clipper) >= 0;
  for (let i = 0; i < clipper.length; i++) {
    let a = clipper[i];
    let b = clipper[(i + 1) % clipper.length];
    let input = out;
    out = [];
    if (input.length == 0)
      break;
    let inside = (p) => {
      let cross = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
      return ccw ? cross >= -EPS : cross <= EPS;
    };
    let prev = input[input.length - 1];
    let prevInside = inside(prev);
    for (let curr of input) {
      let currInside = inside(curr);
      if (currInside) {
        if (!prevInside)
          out.push(vertexIntersection(prev, curr, a, b));
        out.push(curr);
      } else if (prevInside)
        out.push(vertexIntersection(prev, curr, a, b));
      prev = curr;
      prevInside = currInside;
    }
  }
  return out;
}
function fanEmitVertices(out, poly) {
  for (let i = 1; i < poly.length - 1; i++)
    out.push(...poly[0], ...poly[i], ...poly[i + 1]);
}
function clipVertices(vertices, regions) {
  if (regions == null)
    return vertices;
  if (regions.length == 0)
    return [];
  let out = [];
  for (let i = 0; i < vertices.length; i += FLOATS_PER_VERTEX * 3) {
    let tri = [
      Array.from(vertices.slice(i, i + FLOATS_PER_VERTEX)),
      Array.from(vertices.slice(i + FLOATS_PER_VERTEX, i + FLOATS_PER_VERTEX * 2)),
      Array.from(vertices.slice(i + FLOATS_PER_VERTEX * 2, i + FLOATS_PER_VERTEX * 3))
    ];
    for (let region of regions) {
      let clipped = clipVertexPolygon(tri, region);
      if (clipped.length >= 3)
        fanEmitVertices(out, clipped);
    }
  }
  return out;
}
function transformPoint(m, x, y) {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}
function transformVec(m, x, y) {
  return [m[0] * x + m[2] * y, m[1] * x + m[3] * y];
}
function transformScale(m) {
  let sx = Math.hypot(m[0], m[1]);
  let sy = Math.hypot(m[2], m[3]);
  return (sx + sy) / 2 || 1;
}
function pointInPolygon(point, polygon) {
  let inside = false;
  let x = point[0];
  let y = point[1];
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    let xi = polygon[i][0];
    let yi = polygon[i][1];
    let xj = polygon[j][0];
    let yj = polygon[j][1];
    let intersects = yi > y != yj > y && x < (xj - xi) * (y - yi) / (yj - yi || EPS) + xi;
    if (intersects)
      inside = !inside;
  }
  return inside;
}
function windingNumber(point, polygon) {
  let x = point[0];
  let y = point[1];
  let winding = 0;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    let a = polygon[j];
    let b = polygon[i];
    if (a[1] <= y) {
      if (b[1] > y && (b[0] - a[0]) * (y - a[1]) - (x - a[0]) * (b[1] - a[1]) > 0)
        winding++;
    } else if (b[1] <= y && (b[0] - a[0]) * (y - a[1]) - (x - a[0]) * (b[1] - a[1]) < 0)
      winding--;
  }
  return winding;
}
function fillContainsPoint(point, polygons, fillRule = "nonzero") {
  if (polygons == null || polygons.length == 0)
    return false;
  if (fillRule == "evenodd") {
    let hits = 0;
    for (let poly of polygons) {
      if (pointInPolygon(point, poly))
        hits++;
    }
    return (hits & 1) == 1;
  }
  let winding = 0;
  for (let poly of polygons)
    winding += windingNumber(point, poly);
  return winding != 0;
}
function pointInClipRegions(point, regions) {
  if (regions == null)
    return true;
  for (let region of regions) {
    if (pointInPolygon(point, region))
      return true;
  }
  return false;
}
function multiply(a, b) {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5]
  ];
}
function colorKey(color, alpha) {
  return color + "@" + alpha;
}
function applyAlpha(color, alpha) {
  let a = color[3] * alpha;
  return [color[0] * a, color[1] * a, color[2] * a, a];
}
function parseHex(hex) {
  let h = hex.slice(1);
  if (h.length == 3 || h.length == 4)
    h = h.split("").map((c) => c + c).join("");
  if (h.length == 6)
    h += "ff";
  if (h.length != 8)
    return null;
  let n = Number.parseInt(h, 16);
  return [
    (n >>> 24 & 255) / 255,
    (n >>> 16 & 255) / 255,
    (n >>> 8 & 255) / 255,
    (n & 255) / 255
  ];
}
function parseRgb(str) {
  let m = str.match(/^rgba?\((.*)\)$/i);
  if (m == null)
    return null;
  let raw = m[1].trim();
  let alphaPart = null;
  if (raw.includes("/")) {
    let split = raw.split("/");
    raw = split[0].trim();
    alphaPart = split.slice(1).join("/").trim();
  }
  let parts = raw.includes(",") ? raw.split(",").map((v) => v.trim()) : raw.split(/\s+/).filter(Boolean);
  if (parts.length < 3)
    return null;
  if (parts.length > 3 && alphaPart == null)
    alphaPart = parts[3];
  let channel = (v) => {
    let n = Number.parseFloat(v);
    if (!Number.isFinite(n))
      return 0;
    if (String(v).endsWith("%"))
      return Math.max(0, Math.min(255, n * 2.55));
    return Math.max(0, Math.min(255, n));
  };
  let alpha = (v) => {
    if (v == null || v === "")
      return 1;
    let n = Number.parseFloat(v);
    if (!Number.isFinite(n))
      return 1;
    if (String(v).endsWith("%"))
      return Math.max(0, Math.min(1, n / 100));
    return Math.max(0, Math.min(1, n));
  };
  return [
    channel(parts[0]) / 255,
    channel(parts[1]) / 255,
    channel(parts[2]) / 255,
    alpha(alphaPart)
  ];
}
function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}
function interpColor(a, b, t, alpha) {
  let c = [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
    a[3] + (b[3] - a[3]) * t
  ];
  return applyAlpha(c, alpha);
}
function parsePlainCssColor(str) {
  if (str == null || str === "transparent")
    return TRANSPARENT;
  if (Array.isArray(str))
    return str;
  if (typeof str == "string") {
    let s = str.trim();
    if (s[0] == "#")
      return parseHex(s) || DEFAULT_COLOR;
    if (s.startsWith("rgb"))
      return parseRgb(s) || DEFAULT_COLOR;
    return parseCssColorWithDom(s) || DEFAULT_COLOR;
  }
  return DEFAULT_COLOR;
}
function normalizeStops(stops) {
  let parsed = stops.map((s) => ({ offset: clamp01(s.offset), color: parsePlainCssColor(s.color) })).sort((a, b) => a.offset - b.offset);
  if (parsed.length == 0)
    parsed.push({ offset: 0, color: DEFAULT_COLOR }, { offset: 1, color: DEFAULT_COLOR });
  else if (parsed.length == 1)
    parsed.push({ offset: 1, color: parsed[0].color });
  return parsed;
}
function sampleStops(stops, t, alpha) {
  stops = normalizeStops(stops);
  t = clamp01(t);
  if (t <= stops[0].offset)
    return applyAlpha(stops[0].color, alpha);
  for (let i = 1; i < stops.length; i++) {
    let lo = stops[i - 1];
    let hi = stops[i];
    if (t <= hi.offset) {
      let span = hi.offset - lo.offset;
      let local = span <= EPS ? 0 : (t - lo.offset) / span;
      return interpColor(lo.color, hi.color, local, alpha);
    }
  }
  return applyAlpha(stops[stops.length - 1].color, alpha);
}
function makeLinearGradient(x0, y0, x1, y1) {
  let stops = [];
  let dx = x1 - x0;
  let dy = y1 - y0;
  let den = dx * dx + dy * dy || 1;
  return {
    _uPlotWebGPUGradient: true,
    addColorStop(offset, color) {
      stops.push({ offset: Number(offset), color });
    },
    colorAt(x, y, alpha = 1) {
      let t = ((x - x0) * dx + (y - y0) * dy) / den;
      return sampleStops(stops, t, alpha);
    }
  };
}
function makeRadialGradient(x0, y0, r0, x1, y1, r1) {
  let stops = [];
  let dr = r1 - r0 || 1;
  return {
    _uPlotWebGPUGradient: true,
    addColorStop(offset, color) {
      stops.push({ offset: Number(offset), color });
    },
    colorAt(x, y, alpha = 1) {
      let d0 = Math.hypot(x - x0, y - y0);
      let d1 = Math.hypot(x - x1, y - y1);
      let d = x0 == x1 && y0 == y1 ? d0 : (d0 + d1) / 2;
      return sampleStops(stops, (d - r0) / dr, alpha);
    }
  };
}
function parseCssColorWithDom(str) {
  if (typeof document == "undefined")
    return null;
  let probe = parseCssColorWithDom._probe;
  if (probe == null) {
    probe = document.createElement("span");
    probe.style.position = "absolute";
    probe.style.left = "-99999px";
    probe.style.top = "-99999px";
    probe.style.visibility = "hidden";
    document.documentElement.appendChild(probe);
    parseCssColorWithDom._probe = probe;
  }
  probe.style.color = "";
  probe.style.color = str;
  if (!probe.style.color)
    return null;
  return parseRgb(getComputedStyle(probe).color);
}
function paintColor(paint, x, y) {
  return paint?.colorAt ? paint.colorAt(x, y) : paint;
}
function pushVertex(out, x, y, color) {
  let c = paintColor(color, x, y);
  out.push(x, y, c[0], c[1], c[2], c[3]);
}
function pushSolidVertex(out, x, y, color) {
  out.push(x, y, color[0], color[1], color[2], color[3]);
}
function pushPaintedTriangleCoords(out, ax, ay, bx, by, cx, cy, color) {
  if (Array.isArray(color)) {
    pushSolidVertex(out, ax, ay, color);
    pushSolidVertex(out, bx, by, color);
    pushSolidVertex(out, cx, cy, color);
  } else {
    pushVertex(out, ax, ay, color);
    pushVertex(out, bx, by, color);
    pushVertex(out, cx, cy, color);
  }
}
function pushPaintedTriangle(out, a, b, c, color) {
  pushPaintedTriangleCoords(out, a[0], a[1], b[0], b[1], c[0], c[1], color);
}
function pushPaintedRegion(out, region, color) {
  if (region.length == 3) {
    pushPaintedTriangle(out, region[0], region[1], region[2], color);
    return;
  }
  if (region.length == 4) {
    pushPaintedTriangle(out, region[0], region[1], region[2], color);
    pushPaintedTriangle(out, region[0], region[2], region[3], color);
    return;
  }
  for (let tri of triangulate(region))
    pushPaintedTriangle(out, tri[0], tri[1], tri[2], color);
}
function appendNumericArray(out, values) {
  for (let i = 0; i < values.length; i++)
    out.push(values[i]);
}
function signedArea(points) {
  let sum = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++)
    sum += points[j][0] * points[i][1] - points[i][0] * points[j][1];
  return sum / 2;
}
function cleanPolygon(points) {
  let out = [];
  for (let p of points) {
    let q = out[out.length - 1];
    if (q == null || Math.abs(q[0] - p[0]) > EPS || Math.abs(q[1] - p[1]) > EPS)
      out.push(p);
  }
  if (out.length > 1) {
    let a = out[0];
    let b = out[out.length - 1];
    if (Math.abs(a[0] - b[0]) <= EPS && Math.abs(a[1] - b[1]) <= EPS)
      out.pop();
  }
  if (out.length < 3)
    return out;
  let changed = true;
  while (changed && out.length >= 3) {
    changed = false;
    let reduced = [];
    for (let i = 0; i < out.length; i++) {
      let a = out[(i + out.length - 1) % out.length];
      let b = out[i];
      let c = out[(i + 1) % out.length];
      let cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if (Math.abs(cross) <= EPS)
        changed = true;
      else
        reduced.push(b);
    }
    if (reduced.length >= 3)
      out = reduced;
    else
      break;
  }
  return out;
}
function pointInTri(p, a, b, c) {
  let v0x = c[0] - a[0];
  let v0y = c[1] - a[1];
  let v1x = b[0] - a[0];
  let v1y = b[1] - a[1];
  let v2x = p[0] - a[0];
  let v2y = p[1] - a[1];
  let den = v0x * v1y - v1x * v0y;
  if (Math.abs(den) < EPS)
    return false;
  let u = (v2x * v1y - v1x * v2y) / den;
  let v = (v0x * v2y - v2x * v0y) / den;
  return u >= -EPS && v >= -EPS && u + v <= 1 + EPS;
}
function nonDecreasingX(points) {
  for (let i = 1; i < points.length; i++) {
    if (points[i][0] < points[i - 1][0] - EPS)
      return false;
  }
  return true;
}
function sortedXChain(points) {
  if (nonDecreasingX(points))
    return points;
  return points.map((p, i) => ({ p, i })).sort((a, b) => {
    let dx = a.p[0] - b.p[0];
    return Math.abs(dx) > EPS ? dx : a.i - b.i;
  }).map((item) => item.p);
}
function chainRange(chain) {
  let min = Infinity;
  let max = -Infinity;
  for (let p of chain) {
    min = Math.min(min, p[0]);
    max = Math.max(max, p[0]);
  }
  return [min, max];
}
function xMonotoneChains(points) {
  if (points.length < 3)
    return null;
  let left = 0;
  let right = 0;
  for (let i = 1; i < points.length; i++) {
    let p = points[i];
    let l = points[left];
    let r = points[right];
    if (p[0] < l[0] - EPS || Math.abs(p[0] - l[0]) <= EPS && p[1] < l[1])
      left = i;
    if (p[0] > r[0] + EPS || Math.abs(p[0] - r[0]) <= EPS && p[1] > r[1])
      right = i;
  }
  let forward = [points[left]];
  for (let i = left; i != right; ) {
    i = (i + 1) % points.length;
    forward.push(points[i]);
  }
  let backward = [points[left]];
  for (let i = left; i != right; ) {
    i = (i + points.length - 1) % points.length;
    backward.push(points[i]);
  }
  forward = sortedXChain(forward);
  backward = sortedXChain(backward);
  let fr = chainRange(forward);
  let br = chainRange(backward);
  let overlapMin = Math.max(fr[0], br[0]);
  let overlapMax = Math.min(fr[1], br[1]);
  if (!Number.isFinite(overlapMin) || !Number.isFinite(overlapMax) || overlapMax - overlapMin <= EPS)
    return null;
  return [forward, backward];
}
function chainYAtX(chain, x) {
  if (chain.length == 0)
    return 0;
  for (let i = 1; i < chain.length; i++) {
    let a = chain[i - 1];
    let b = chain[i];
    let dx = b[0] - a[0];
    if (Math.abs(dx) <= EPS)
      continue;
    if (x <= b[0] + EPS) {
      let t = clamp01((x - a[0]) / dx);
      return a[1] + (b[1] - a[1]) * t;
    }
  }
  return chain[chain.length - 1][1];
}
function uniqueSortedXs(chains) {
  let xs = [];
  for (let chain of chains) {
    for (let p of chain)
      xs.push(p[0]);
  }
  xs.sort((a, b) => a - b);
  let out = [];
  for (let x of xs) {
    let prev = out[out.length - 1];
    if (prev == null || Math.abs(x - prev) > EPS)
      out.push(x);
  }
  return out;
}
function triangulateXMonotone(points) {
  let chains = xMonotoneChains(points);
  if (chains == null)
    return null;
  let [a, b] = chains;
  let xs = uniqueSortedXs(chains);
  let triangles = [];
  for (let i = 1; i < xs.length; i++) {
    let x0 = xs[i - 1];
    let x1 = xs[i];
    if (x1 - x0 <= EPS)
      continue;
    let a0 = [x0, chainYAtX(a, x0)];
    let a1 = [x1, chainYAtX(a, x1)];
    let b0 = [x0, chainYAtX(b, x0)];
    let b1 = [x1, chainYAtX(b, x1)];
    if (Math.abs(signedArea([a0, a1, b0])) > EPS)
      triangles.push([a0, a1, b0]);
    if (Math.abs(signedArea([b0, a1, b1])) > EPS)
      triangles.push([b0, a1, b1]);
  }
  return triangles;
}
function triangulationArea(triangles) {
  let area = 0;
  for (let tri of triangles)
    area += Math.abs(signedArea(tri));
  return area;
}
function triangulationMatchesPolygon(points, triangles) {
  if (triangles == null || triangles.length == 0)
    return false;
  let polyArea = Math.abs(signedArea(points));
  let triArea = triangulationArea(triangles);
  let tolerance = Math.max(0.01, polyArea * 1e-3);
  return Math.abs(triArea - polyArea) <= tolerance;
}
function triangulate(points) {
  points = cleanPolygon(points);
  if (points.length < 3)
    return [];
  let monotone = triangulateXMonotone(points);
  if (monotone != null && monotone.length > 0)
    return monotone;
  if (points.length > 4096)
    return fanTriangulate(points);
  let verts = points.map((_, i) => i);
  let ccw = signedArea(points) > 0;
  let triangles = [];
  let guard = points.length * points.length;
  while (verts.length > 3 && guard-- > 0) {
    let clipped = false;
    for (let vi = 0; vi < verts.length; vi++) {
      let i0 = verts[(vi + verts.length - 1) % verts.length];
      let i1 = verts[vi];
      let i2 = verts[(vi + 1) % verts.length];
      let a = points[i0];
      let b = points[i1];
      let c = points[i2];
      let cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if (Math.abs(cross) <= EPS) {
        verts.splice(vi, 1);
        clipped = true;
        break;
      }
      if (ccw ? cross < -EPS : cross > EPS)
        continue;
      let hasInside = false;
      for (let j = 0; j < verts.length; j++) {
        let idx = verts[j];
        if (idx == i0 || idx == i1 || idx == i2)
          continue;
        if (pointInTri(points[idx], a, b, c)) {
          hasInside = true;
          break;
        }
      }
      if (!hasInside) {
        triangles.push([a, b, c]);
        verts.splice(vi, 1);
        clipped = true;
        break;
      }
    }
    if (!clipped) {
      if (triangulationMatchesPolygon(points, triangles))
        return triangles;
      if (monotone != null && triangulationMatchesPolygon(points, monotone))
        return monotone;
      return fanTriangulate(points);
    }
  }
  if (verts.length == 3)
    triangles.push([points[verts[0]], points[verts[1]], points[verts[2]]]);
  if (triangulationMatchesPolygon(points, triangles))
    return triangles;
  if (monotone != null && triangulationMatchesPolygon(points, monotone))
    return monotone;
  return fanTriangulate(points);
}
function fanTriangulate(points) {
  let out = [];
  let poly = cleanPolygon(points);
  for (let i = 1; i < poly.length - 1; i++)
    out.push([poly[0], poly[i], poly[i + 1]]);
  return out;
}
function addDisc(out, cx, cy, radius, color, steps = 18) {
  for (let i = 0; i < steps; i++) {
    let a0 = Math.PI * 2 * i / steps;
    let a1 = Math.PI * 2 * (i + 1) / steps;
    pushPaintedTriangleCoords(
      out,
      cx,
      cy,
      cx + Math.cos(a0) * radius,
      cy + Math.sin(a0) * radius,
      cx + Math.cos(a1) * radius,
      cy + Math.sin(a1) * radius,
      color
    );
  }
}
function addQuad(out, a, b, c, d, color) {
  pushPaintedTriangle(out, a, b, c, color);
  pushPaintedTriangle(out, c, b, d, color);
}
function addLineSegment(out, ax, ay, bx, by, width, color) {
  let dx = bx - ax;
  let dy = by - ay;
  let len = Math.hypot(dx, dy);
  if (len < EPS) {
    addDisc(out, ax, ay, width / 2, color, 12);
    return;
  }
  let nx = -dy / len * width / 2;
  let ny = dx / len * width / 2;
  pushPaintedTriangleCoords(out, ax + nx, ay + ny, ax - nx, ay - ny, bx + nx, by + ny, color);
  pushPaintedTriangleCoords(out, bx + nx, by + ny, ax - nx, ay - ny, bx - nx, by - ny, color);
}
function addLineCap(out, x, y, dx, dy, width, color, cap, end) {
  if (cap == "round")
    addDisc(out, x, y, width / 2, color, 12);
  else if (cap == "square") {
    let half = width / 2;
    let nx = -dy * half;
    let ny = dx * half;
    let ex = dx * half * (end ? 1 : -1);
    let ey = dy * half * (end ? 1 : -1);
    addQuad(
      out,
      [x + nx, y + ny],
      [x - nx, y - ny],
      [x + nx + ex, y + ny + ey],
      [x - nx + ex, y - ny + ey],
      color
    );
  }
}
function addBevelJoin(out, x, y, prev, next, half, side, color) {
  pushTri(
    out,
    [x, y],
    [x + prev.nx * half * side, y + prev.ny * half * side],
    [x + next.nx * half * side, y + next.ny * half * side],
    color
  );
}
function intersectLines(p, r, q, s) {
  let den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < EPS)
    return null;
  let qpx = q[0] - p[0];
  let qpy = q[1] - p[1];
  let t = (qpx * s[1] - qpy * s[0]) / den;
  return [p[0] + r[0] * t, p[1] + r[1] * t];
}
function addMiterJoin(out, x, y, prev, next, half, side, color, miterLimit) {
  let a = [x + prev.nx * half * side, y + prev.ny * half * side];
  let b = [x + next.nx * half * side, y + next.ny * half * side];
  let miter = intersectLines(a, [prev.dx, prev.dy], b, [next.dx, next.dy]);
  if (miter == null || Math.hypot(miter[0] - x, miter[1] - y) > miterLimit * half) {
    addBevelJoin(out, x, y, prev, next, half, side, color);
    return;
  }
  pushTri(out, a, miter, b, color);
}
function addLineJoin(out, x, y, prev, next, width, color, join, miterLimit) {
  let cross = prev.dx * next.dy - prev.dy * next.dx;
  if (Math.abs(cross) < EPS)
    return;
  if (join == "round") {
    addDisc(out, x, y, width / 2, color, 12);
    return;
  }
  let side = cross > 0 ? 1 : -1;
  let half = width / 2;
  if (join == "miter")
    addMiterJoin(out, x, y, prev, next, half, side, color, miterLimit);
  else
    addBevelJoin(out, x, y, prev, next, half, side, color);
}
function addPolyline(out, points, width, color, cap, join, miterLimit = 10) {
  let closed = !!points.closed;
  let segs = [];
  for (let i = 1; i < points.length; i++) {
    let ax = points[i - 1][0];
    let ay = points[i - 1][1];
    let bx = points[i][0];
    let by = points[i][1];
    let dx = bx - ax;
    let dy = by - ay;
    let len = Math.hypot(dx, dy);
    if (len < EPS)
      continue;
    dx /= len;
    dy /= len;
    let seg = { x0: ax, y0: ay, x1: bx, y1: by, dx, dy, nx: -dy, ny: dx };
    segs.push(seg);
    addLineSegment(out, ax, ay, bx, by, width, color);
  }
  if (segs.length == 0) {
    if (points.length > 0)
      addDisc(out, points[0][0], points[0][1], width / 2, color, 12);
    return;
  }
  for (let i = 1; i < segs.length; i++)
    addLineJoin(out, segs[i - 1].x1, segs[i - 1].y1, segs[i - 1], segs[i], width, color, join, miterLimit);
  let first = segs[0];
  let last = segs[segs.length - 1];
  if (closed)
    addLineJoin(out, first.x0, first.y0, last, first, width, color, join, miterLimit);
  else {
    addLineCap(out, first.x0, first.y0, first.dx, first.dy, width, color, cap, false);
    addLineCap(out, last.x1, last.y1, last.dx, last.dy, width, color, cap, true);
  }
}
function dashSegments(points, dash, offset = 0) {
  if (dash == null || dash.length == 0)
    return [points];
  let pattern = dash.filter((v) => v > 0);
  if (pattern.length == 0)
    return [points];
  if (pattern.length % 2 == 1)
    pattern = pattern.concat(pattern);
  let out = [];
  let current = [];
  let total = pattern.reduce((a, b) => a + b, 0);
  offset = total > 0 ? (offset % total + total) % total : 0;
  let dashIdx = 0;
  let remain = pattern[0];
  let draw = true;
  while (offset > EPS && total > 0) {
    let step = Math.min(remain, offset);
    offset -= step;
    remain -= step;
    if (remain <= EPS) {
      dashIdx = (dashIdx + 1) % pattern.length;
      remain = pattern[dashIdx];
      draw = !draw;
    }
  }
  for (let i = 1; i < points.length; i++) {
    let ax = points[i - 1][0];
    let ay = points[i - 1][1];
    let bx = points[i][0];
    let by = points[i][1];
    let dx = bx - ax;
    let dy = by - ay;
    let segLen = Math.hypot(dx, dy);
    let used = 0;
    while (segLen - used > EPS) {
      let step = Math.min(remain, segLen - used);
      let t0 = used / segLen;
      let t1 = (used + step) / segLen;
      let p0 = [ax + dx * t0, ay + dy * t0];
      let p1 = [ax + dx * t1, ay + dy * t1];
      if (draw) {
        if (current.length == 0)
          current.push(p0);
        current.push(p1);
      }
      used += step;
      remain -= step;
      if (remain <= EPS) {
        if (draw && current.length > 1) {
          out.push(current);
          current = [];
        }
        dashIdx = (dashIdx + 1) % pattern.length;
        remain = pattern[dashIdx];
        draw = !draw;
      }
    }
  }
  if (current.length > 1)
    out.push(current);
  return out;
}
function extractFontPx(font) {
  let m = /([0-9.]+)px/.exec(font || "");
  return m == null ? 12 : Number.parseFloat(m[1]);
}
function cssFont(font, ratio) {
  return (font || "12px sans-serif").replace(/([0-9.]+)px/, (_, n) => Number.parseFloat(n) / ratio + "px");
}
function cssColor(color, x = 0, y = 0, alpha = 1) {
  if (color == null)
    return "transparent";
  let c = null;
  if (Array.isArray(color))
    c = applyAlpha(color, alpha);
  else if (typeof color == "object" && color.colorAt)
    c = color.colorAt(x, y, alpha);
  if (c != null) {
    let a = c[3] <= 0 ? 0 : c[3];
    let r = a > 0 ? Math.round(clamp01(c[0] / a) * 255) : 0;
    let g = a > 0 ? Math.round(clamp01(c[1] / a) * 255) : 0;
    let b = a > 0 ? Math.round(clamp01(c[2] / a) * 255) : 0;
    return `rgba(${r}, ${g}, ${b}, ${clamp01(a)})`;
  }
  return color === "transparent" ? "transparent" : String(color);
}
const COMPOSITE_MODES = [
  "source-over",
  "copy",
  "destination-over",
  "source-in",
  "source-out",
  "source-atop",
  "destination-in",
  "destination-out",
  "destination-atop",
  "xor",
  "lighter"
];
function clampCompositeMode(mode) {
  if (mode == null)
    return "source-over";
  mode = String(mode);
  return COMPOSITE_MODES.includes(mode) ? mode : "source-over";
}
function blendForComposite(mode, premultiplied = true) {
  mode = clampCompositeMode(mode);
  if (mode == "copy")
    return void 0;
  if (mode == "destination-over") {
    return {
      color: { srcFactor: "one-minus-dst-alpha", dstFactor: "one", operation: "add" },
      alpha: { srcFactor: "one-minus-dst-alpha", dstFactor: "one", operation: "add" }
    };
  }
  if (mode == "source-in") {
    return {
      color: { srcFactor: "dst-alpha", dstFactor: "zero", operation: "add" },
      alpha: { srcFactor: "dst-alpha", dstFactor: "zero", operation: "add" }
    };
  }
  if (mode == "source-out") {
    return {
      color: { srcFactor: "one-minus-dst-alpha", dstFactor: "zero", operation: "add" },
      alpha: { srcFactor: "one-minus-dst-alpha", dstFactor: "zero", operation: "add" }
    };
  }
  if (mode == "source-atop") {
    return {
      color: { srcFactor: "dst-alpha", dstFactor: "one-minus-src-alpha", operation: "add" },
      alpha: { srcFactor: "dst-alpha", dstFactor: "one-minus-src-alpha", operation: "add" }
    };
  }
  if (mode == "destination-in") {
    return {
      color: { srcFactor: "zero", dstFactor: "src-alpha", operation: "add" },
      alpha: { srcFactor: "zero", dstFactor: "src-alpha", operation: "add" }
    };
  }
  if (mode == "destination-out") {
    return {
      color: { srcFactor: "zero", dstFactor: "one-minus-src-alpha", operation: "add" },
      alpha: { srcFactor: "zero", dstFactor: "one-minus-src-alpha", operation: "add" }
    };
  }
  if (mode == "destination-atop") {
    return {
      color: { srcFactor: "one-minus-dst-alpha", dstFactor: "src-alpha", operation: "add" },
      alpha: { srcFactor: "one-minus-dst-alpha", dstFactor: "src-alpha", operation: "add" }
    };
  }
  if (mode == "xor") {
    return {
      color: { srcFactor: "one-minus-dst-alpha", dstFactor: "one-minus-src-alpha", operation: "add" },
      alpha: { srcFactor: "one-minus-dst-alpha", dstFactor: "one-minus-src-alpha", operation: "add" }
    };
  }
  if (mode == "lighter") {
    return {
      color: { srcFactor: "one", dstFactor: "one", operation: "add" },
      alpha: { srcFactor: "one", dstFactor: "one", operation: "add" }
    };
  }
  return premultiplied ? {
    color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
    alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" }
  } : {
    color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha", operation: "add" },
    alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" }
  };
}
function sourceWidth(source) {
  return source?.naturalWidth || source?.videoWidth || source?.displayWidth || source?.width || 0;
}
function sourceHeight(source) {
  return source?.naturalHeight || source?.videoHeight || source?.displayHeight || source?.height || 0;
}
function finiteNumber(v) {
  v = Number(v);
  return Number.isFinite(v) ? v : null;
}
function finiteTransform(values) {
  let out = Array.from(values, Number);
  return out.length >= 6 && out.slice(0, 6).every(Number.isFinite) ? out.slice(0, 6) : null;
}
function matrixFromObject(transform) {
  if (transform == null)
    return null;
  if (Array.isArray(transform))
    return finiteTransform(transform);
  if (typeof DOMMatrix != "undefined" && transform instanceof DOMMatrix)
    return finiteTransform([transform.a, transform.b, transform.c, transform.d, transform.e, transform.f]);
  if (typeof transform == "object")
    return finiteTransform([transform.a, transform.b, transform.c, transform.d, transform.e, transform.f]);
  return null;
}
function validEnum(value, allowed, fallback) {
  value = value == null ? fallback : String(value);
  return allowed.includes(value) ? value : fallback;
}
function isImageDataLike(source) {
  return source != null && source.data != null && Number.isFinite(Number(source.width)) && Number.isFinite(Number(source.height));
}
function createImageDataPixels(width, height, data = null) {
  let pixels = new Uint8ClampedArray(width * height * 4);
  if (data instanceof Uint8ClampedArray)
    pixels.set(data.subarray(0, pixels.length));
  return pixels;
}
function createImageDataObject(width, height, data = null) {
  width = Math.max(0, Math.floor(Number(width) || 0));
  height = Math.max(0, Math.floor(Number(height) || 0));
  let pixels = createImageDataPixels(width, height, data);
  if (typeof ImageData != "undefined") {
    try {
      return new ImageData(pixels, width, height);
    } catch (err) {
      return new ImageData(width, height);
    }
  }
  return { width, height, data: pixels };
}
let exportToolsPromise = null;
function loadExportTools() {
  return exportToolsPromise || (exportToolsPromise = import("./exporters.js"));
}
function alignBytesPerRow(bytes) {
  return Math.ceil(bytes / 256) * 256;
}
function normalizeReadRect(x, y, w, h, frameWidth, frameHeight) {
  let vals = [x, y, w, h].map(finiteNumber);
  if (vals.some((v) => v == null))
    return null;
  [x, y, w, h] = vals;
  if (w < 0) {
    x += w;
    w = -w;
  }
  if (h < 0) {
    y += h;
    h = -h;
  }
  let x0 = Math.max(0, Math.min(frameWidth, Math.floor(x)));
  let y0 = Math.max(0, Math.min(frameHeight, Math.floor(y)));
  let x1 = Math.max(0, Math.min(frameWidth, Math.ceil(x + w)));
  let y1 = Math.max(0, Math.min(frameHeight, Math.ceil(y + h)));
  if (x1 <= x0 || y1 <= y0)
    return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
function normalizeDirtyRect(imageData, dirtyX, dirtyY, dirtyWidth, dirtyHeight) {
  let vals = [dirtyX, dirtyY, dirtyWidth, dirtyHeight].map(finiteNumber);
  if (vals.some((v) => v == null))
    return null;
  let [x, y, w, h] = vals;
  let width = Math.max(0, Math.floor(Number(imageData?.width) || 0));
  let height = Math.max(0, Math.floor(Number(imageData?.height) || 0));
  if (width == 0 || height == 0)
    return null;
  if (w < 0) {
    x += w;
    w = -w;
  }
  if (h < 0) {
    y += h;
    h = -h;
  }
  let x0 = Math.max(0, Math.min(width, Math.floor(x)));
  let y0 = Math.max(0, Math.min(height, Math.floor(y)));
  let x1 = Math.max(0, Math.min(width, Math.ceil(x + w)));
  let y1 = Math.max(0, Math.min(height, Math.ceil(y + h)));
  if (x1 <= x0 || y1 <= y0)
    return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
function normalizeImageSmoothingQuality(value) {
  return validEnum(value, ["low", "medium", "high"], "high");
}
function normalizeImageRect(record, sx, sy, sw, sh, dx, dy, dw, dh) {
  let vals = [sx, sy, sw, sh, dx, dy, dw, dh].map(finiteNumber);
  if (vals.some((v) => v == null))
    return null;
  [sx, sy, sw, sh, dx, dy, dw, dh] = vals;
  if (sw == 0 || sh == 0 || dw == 0 || dh == 0)
    return null;
  if (sw < 0) {
    sx += sw;
    sw = -sw;
  }
  if (sh < 0) {
    sy += sh;
    sh = -sh;
  }
  if (dw < 0) {
    dx += dw;
    dw = -dw;
  }
  if (dh < 0) {
    dy += dh;
    dh = -dh;
  }
  let sx0 = Math.max(0, Math.min(record.width, sx));
  let sy0 = Math.max(0, Math.min(record.height, sy));
  let sx1 = Math.max(0, Math.min(record.width, sx + sw));
  let sy1 = Math.max(0, Math.min(record.height, sy + sh));
  if (sx1 <= sx0 || sy1 <= sy0)
    return null;
  let tx0 = (sx0 - sx) / sw;
  let tx1 = (sx1 - sx) / sw;
  let ty0 = (sy0 - sy) / sh;
  let ty1 = (sy1 - sy) / sh;
  return {
    sx: sx0,
    sy: sy0,
    sw: sx1 - sx0,
    sh: sy1 - sy0,
    dx: dx + tx0 * dw,
    dy: dy + ty0 * dh,
    dw: (tx1 - tx0) * dw,
    dh: (ty1 - ty0) * dh
  };
}
function hasActiveShadow(state) {
  if (state == null)
    return false;
  let color = parsePlainCssColor(state.shadowColor || "rgba(0,0,0,0)") || TRANSPARENT;
  return color[3] > 0 && (Math.abs(state.shadowOffsetX || 0) > EPS || Math.abs(state.shadowOffsetY || 0) > EPS || Math.abs(state.shadowBlur || 0) > EPS);
}
function offsetSolidVertices(vertices, dx, dy, alphaScale = 1) {
  let out = new Float32Array(vertices.length);
  for (let i = 0; i < vertices.length; i += FLOATS_PER_VERTEX) {
    out[i + 0] = vertices[i + 0] + dx;
    out[i + 1] = vertices[i + 1] + dy;
    out[i + 2] = vertices[i + 2];
    out[i + 3] = vertices[i + 3];
    out[i + 4] = vertices[i + 4];
    out[i + 5] = vertices[i + 5] * alphaScale;
  }
  return out;
}
function invert2x2(a, b, c, d) {
  let det = a * d - b * c;
  if (Math.abs(det) < EPS)
    return null;
  let inv = 1 / det;
  return [d * inv, -b * inv, -c * inv, a * inv];
}
function filterStyleValue(filter) {
  return filter == null || filter === "" ? "none" : String(filter);
}
function isPatternPaint(paint) {
  return paint != null && paint._uPlotWebGPUPattern === true;
}
function makePattern(source, repetition = "repeat") {
  return {
    _uPlotWebGPUPattern: true,
    source,
    repetition: repetition || "repeat",
    transform: identity(),
    setTransform(transform) {
      let m = matrixFromObject(transform);
      this.transform = m == null ? identity() : m;
    }
  };
}
function boundsOfRegions(regions) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let region of regions || []) {
    for (let p of region) {
      minX = Math.min(minX, p[0]);
      minY = Math.min(minY, p[1]);
      maxX = Math.max(maxX, p[0]);
      maxY = Math.max(maxY, p[1]);
    }
  }
  return minX == Infinity ? null : { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
function makeImageVertex(x, y, u, v, alpha) {
  return { x, y, u, v, alpha };
}
function pushImageVertex(out, v) {
  out.push(v.x, v.y, v.u, v.v, v.alpha);
}
function pushImageTri(out, a, b, c) {
  pushImageVertex(out, a);
  pushImageVertex(out, b);
  pushImageVertex(out, c);
}
function addImageQuad(out, a, b, c, d) {
  pushImageTri(out, a, b, c);
  pushImageTri(out, c, b, d);
}
function clipImagePolygonAgainstEdge(subject, a, b, ccw) {
  if (subject.length == 0)
    return [];
  let out = [];
  let inside = (p) => {
    let cross = (b[0] - a[0]) * (p.y - a[1]) - (b[1] - a[1]) * (p.x - a[0]);
    return ccw ? cross >= -EPS : cross <= EPS;
  };
  let intersect = (p, q) => {
    let bax = q.x - p.x;
    let bay = q.y - p.y;
    let dcx = b[0] - a[0];
    let dcy = b[1] - a[1];
    let den = bax * dcy - bay * dcx;
    let t = 0;
    if (Math.abs(den) >= EPS) {
      let acx = a[0] - p.x;
      let acy = a[1] - p.y;
      t = (acx * dcy - acy * dcx) / den;
    }
    t = clamp01(t);
    return makeImageVertex(
      p.x + (q.x - p.x) * t,
      p.y + (q.y - p.y) * t,
      p.u + (q.u - p.u) * t,
      p.v + (q.v - p.v) * t,
      p.alpha + (q.alpha - p.alpha) * t
    );
  };
  let prev = subject[subject.length - 1];
  let prevInside = inside(prev);
  for (let curr of subject) {
    let currInside = inside(curr);
    if (currInside) {
      if (!prevInside)
        out.push(intersect(prev, curr));
      out.push(curr);
    } else if (prevInside)
      out.push(intersect(prev, curr));
    prev = curr;
    prevInside = currInside;
  }
  return out;
}
function clipImagePolygon(subject, clipper) {
  if (subject.length < 3 || clipper.length < 3)
    return [];
  let out = subject;
  let ccw = polygonArea(clipper) >= 0;
  for (let i = 0; i < clipper.length; i++) {
    out = clipImagePolygonAgainstEdge(out, clipper[i], clipper[(i + 1) % clipper.length], ccw);
    if (out.length == 0)
      break;
  }
  return out;
}
function clipImageVertices(vertices, regions) {
  if (regions == null)
    return vertices;
  if (regions.length == 0)
    return [];
  let out = [];
  for (let i = 0; i < vertices.length; i += FLOATS_PER_IMAGE_VERTEX * 3) {
    let tri = [
      makeImageVertex(vertices[i], vertices[i + 1], vertices[i + 2], vertices[i + 3], vertices[i + 4]),
      makeImageVertex(vertices[i + FLOATS_PER_IMAGE_VERTEX], vertices[i + FLOATS_PER_IMAGE_VERTEX + 1], vertices[i + FLOATS_PER_IMAGE_VERTEX + 2], vertices[i + FLOATS_PER_IMAGE_VERTEX + 3], vertices[i + FLOATS_PER_IMAGE_VERTEX + 4]),
      makeImageVertex(vertices[i + FLOATS_PER_IMAGE_VERTEX * 2], vertices[i + FLOATS_PER_IMAGE_VERTEX * 2 + 1], vertices[i + FLOATS_PER_IMAGE_VERTEX * 2 + 2], vertices[i + FLOATS_PER_IMAGE_VERTEX * 2 + 3], vertices[i + FLOATS_PER_IMAGE_VERTEX * 2 + 4])
    ];
    for (let region of regions) {
      let clipped = clipImagePolygon(tri, region);
      for (let j = 1; j < clipped.length - 1; j++)
        pushImageTri(out, clipped[0], clipped[j], clipped[j + 1]);
    }
  }
  return out;
}
let sharedRuntimePromise = null;
let sharedRuntime = null;
let sharedRuntimeRefs = 0;
let sharedRuntimeEnabled = true;
async function createWebGPURuntime(owner, epoch) {
  if (typeof navigator == "undefined" || navigator.gpu == null)
    throw new Error("WebGPU is not available in this environment.");
  let adapter = await navigator.gpu.requestAdapter();
  if (adapter == null)
    throw new Error("No WebGPU adapter was returned.");
  let adapterInfo = null;
  try {
    let adapterWithLegacyInfo = adapter;
    let info = adapter.info || (typeof adapterWithLegacyInfo.requestAdapterInfo == "function" ? await adapterWithLegacyInfo.requestAdapterInfo() : null);
    if (info)
      adapterInfo = { vendor: info.vendor || "", architecture: info.architecture || "", device: info.device || "", description: info.description || "" };
  } catch (err) {
    adapterInfo = null;
  }
  let device = await adapter.requestDevice();
  let format = navigator.gpu.getPreferredCanvasFormat();
  let module = device.createShaderModule({ code: CHART_WGSL });
  let imageModule = device.createShaderModule({ code: IMAGE_WGSL });
  let bindGroupLayout = device.createBindGroupLayout({
    entries: [{
      binding: 0,
      visibility: GPUShaderStage.VERTEX,
      buffer: { type: "uniform" }
    }]
  });
  let imageBindGroupLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } }
    ]
  });
  let pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });
  let imagePipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout, imageBindGroupLayout] });
  let runtime = {
    adapter,
    adapterInfo,
    device,
    format,
    module,
    imageModule,
    bindGroupLayout,
    imageBindGroupLayout,
    pipelineLayout,
    imagePipelineLayout,
    pipelines: {},
    imagePipelines: {},
    samplers: /* @__PURE__ */ new Map(),
    lost: false
  };
  await Promise.all(COMPOSITE_MODES.map(async (mode) => {
    if (device.createRenderPipelineAsync) {
      runtime.pipelines[mode] = await createRuntimePipelineAsync(runtime, mode);
      runtime.imagePipelines[mode] = await createRuntimeImagePipelineAsync(runtime, mode);
    } else {
      runtime.pipelines[mode] = createRuntimePipeline(runtime, mode);
      runtime.imagePipelines[mode] = createRuntimeImagePipeline(runtime, mode);
    }
  }));
  runtime.sampler = getRuntimeSampler(runtime, true, "high");
  runtime.clearPipeline = runtime.pipelines.copy;
  device.lost?.then((info) => {
    runtime.lost = true;
    if (sharedRuntime === runtime) {
      sharedRuntime = null;
      sharedRuntimePromise = null;
    }
    console.error("WebGPU device lost:", info?.message || info);
  });
  return runtime;
}
function createRuntimePipeline(runtime, composite = "source-over") {
  return runtime.device.createRenderPipeline({
    layout: runtime.pipelineLayout,
    vertex: {
      module: runtime.module,
      entryPoint: "vsMain",
      buffers: [{
        arrayStride: FLOATS_PER_VERTEX * 4,
        attributes: [
          { shaderLocation: 0, offset: 0, format: "float32x2" },
          { shaderLocation: 1, offset: 8, format: "float32x4" }
        ]
      }]
    },
    fragment: {
      module: runtime.module,
      entryPoint: "fsMain",
      targets: [{
        format: runtime.format,
        blend: blendForComposite(composite)
      }]
    },
    primitive: { topology: "triangle-list" }
  });
}
function createRuntimePipelineAsync(runtime, composite = "source-over") {
  return runtime.device.createRenderPipelineAsync({
    layout: runtime.pipelineLayout,
    vertex: {
      module: runtime.module,
      entryPoint: "vsMain",
      buffers: [{
        arrayStride: FLOATS_PER_VERTEX * 4,
        attributes: [
          { shaderLocation: 0, offset: 0, format: "float32x2" },
          { shaderLocation: 1, offset: 8, format: "float32x4" }
        ]
      }]
    },
    fragment: {
      module: runtime.module,
      entryPoint: "fsMain",
      targets: [{
        format: runtime.format,
        blend: blendForComposite(composite)
      }]
    },
    primitive: { topology: "triangle-list" }
  });
}
function createRuntimeImagePipeline(runtime, composite = "source-over") {
  return runtime.device.createRenderPipeline({
    layout: runtime.imagePipelineLayout,
    vertex: {
      module: runtime.imageModule,
      entryPoint: "vsImage",
      buffers: [{
        arrayStride: FLOATS_PER_IMAGE_VERTEX * 4,
        attributes: [
          { shaderLocation: 0, offset: 0, format: "float32x2" },
          { shaderLocation: 1, offset: 8, format: "float32x2" },
          { shaderLocation: 2, offset: 16, format: "float32" }
        ]
      }]
    },
    fragment: {
      module: runtime.imageModule,
      entryPoint: "fsImage",
      targets: [{
        format: runtime.format,
        blend: blendForComposite(composite)
      }]
    },
    primitive: { topology: "triangle-list" }
  });
}
function createRuntimeImagePipelineAsync(runtime, composite = "source-over") {
  return runtime.device.createRenderPipelineAsync({
    layout: runtime.imagePipelineLayout,
    vertex: {
      module: runtime.imageModule,
      entryPoint: "vsImage",
      buffers: [{
        arrayStride: FLOATS_PER_IMAGE_VERTEX * 4,
        attributes: [
          { shaderLocation: 0, offset: 0, format: "float32x2" },
          { shaderLocation: 1, offset: 8, format: "float32x2" },
          { shaderLocation: 2, offset: 16, format: "float32" }
        ]
      }]
    },
    fragment: {
      module: runtime.imageModule,
      entryPoint: "fsImage",
      targets: [{
        format: runtime.format,
        blend: blendForComposite(composite)
      }]
    },
    primitive: { topology: "triangle-list" }
  });
}
function getRuntimeSampler(runtime, smoothingEnabled = true, quality = "high") {
  let filter = smoothingEnabled ? "linear" : "nearest";
  let key = filter + ":" + quality;
  let sampler = runtime.samplers.get(key);
  if (sampler == null) {
    sampler = runtime.device.createSampler({ magFilter: filter, minFilter: filter });
    runtime.samplers.set(key, sampler);
  }
  return sampler;
}
async function getSharedRuntime(owner, epoch) {
  if (!sharedRuntimeEnabled)
    return createWebGPURuntime(owner, epoch);
  if (sharedRuntime != null && !sharedRuntime.lost)
    return sharedRuntime;
  if (sharedRuntimePromise == null) {
    sharedRuntimePromise = createWebGPURuntime(owner, epoch).then((runtime) => {
      if (runtime != null)
        sharedRuntime = runtime;
      return runtime;
    }).catch((err) => {
      sharedRuntimePromise = null;
      throw err;
    });
  }
  return sharedRuntimePromise;
}
function createWarmupCanvas(width, height) {
  if (typeof OffscreenCanvas != "undefined")
    return new OffscreenCanvas(width, height);
  if (typeof document != "undefined") {
    let canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.style.position = "fixed";
    canvas.style.left = "-10000px";
    canvas.style.top = "-10000px";
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";
    document.body?.appendChild?.(canvas);
    return canvas;
  }
  return null;
}
async function prewarmWebGPURuntime(options = null) {
  options = options || {};
  let startedAt = perfNow();
  let previousSharedRuntimeEnabled = sharedRuntimeEnabled;
  let shouldUseSharedRuntime = options.sharedRuntime !== false;
  if (shouldUseSharedRuntime)
    sharedRuntimeEnabled = true;
  let runtime;
  let canvas;
  let context;
  let uniformBuffer;
  let solidBuffer;
  let imageBuffer;
  let texture;
  let imageBindGroup;
  let submitted = false;
  try {
    runtime = await getSharedRuntime(null, 0);
    if (runtime == null || runtime.device == null)
      throw new Error("WebGPU runtime was not created.");
    let width = Math.max(1, Math.floor(Number(options.width) || 16));
    let height = Math.max(1, Math.floor(Number(options.height) || 16));
    canvas = options.canvas || createWarmupCanvas(width, height);
    if (canvas == null || typeof canvas.getContext != "function")
      throw new Error("No canvas is available for WebGPU warmup.");
    canvas.width = width;
    canvas.height = height;
    context = canvas.getContext("webgpu");
    if (context == null)
      throw new Error("Could not create a WebGPU warmup canvas context.");
    context.configure({
      device: runtime.device,
      format: runtime.format,
      alphaMode: "premultiplied",
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC
    });
    uniformBuffer = runtime.device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    runtime.device.queue.writeBuffer(uniformBuffer, 0, new Float32Array([width, height, 0, 0]));
    let uniformBindGroup = runtime.device.createBindGroup({
      layout: runtime.bindGroupLayout,
      entries: [{ binding: 0, resource: { buffer: uniformBuffer } }]
    });
    let solidVertices = new Float32Array([
      0,
      0,
      1,
      0,
      0,
      1,
      width,
      0,
      0,
      1,
      0,
      1,
      0,
      height,
      0,
      0,
      1,
      1
    ]);
    solidBuffer = runtime.device.createBuffer({
      size: solidVertices.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
    });
    runtime.device.queue.writeBuffer(solidBuffer, 0, solidVertices);
    let imageVertices = new Float32Array([
      0,
      0,
      0,
      0,
      1,
      width,
      0,
      1,
      0,
      1,
      width,
      height,
      1,
      1,
      1,
      0,
      0,
      0,
      0,
      1,
      width,
      height,
      1,
      1,
      1,
      0,
      height,
      0,
      1,
      1
    ]);
    imageBuffer = runtime.device.createBuffer({
      size: imageVertices.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
    });
    runtime.device.queue.writeBuffer(imageBuffer, 0, imageVertices);
    texture = runtime.device.createTexture({
      size: [1, 1, 1],
      format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
    });
    runtime.device.queue.writeTexture(
      { texture },
      new Uint8Array(256).fill(255),
      { bytesPerRow: 256, rowsPerImage: 1 },
      [1, 1, 1]
    );
    imageBindGroup = runtime.device.createBindGroup({
      layout: runtime.imageBindGroupLayout,
      entries: [
        { binding: 0, resource: getRuntimeSampler(runtime, true, "high") },
        { binding: 1, resource: texture.createView() }
      ]
    });
    let encoder = runtime.device.createCommandEncoder();
    let pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: context.getCurrentTexture().createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: "clear",
        storeOp: "store"
      }]
    });
    pass.setBindGroup(0, uniformBindGroup);
    pass.setVertexBuffer(0, solidBuffer);
    for (let mode of COMPOSITE_MODES) {
      let pipeline = runtime.pipelines[mode];
      if (pipeline) {
        pass.setPipeline(pipeline);
        pass.draw(3, 1, 0, 0);
      }
    }
    pass.setBindGroup(1, imageBindGroup);
    pass.setVertexBuffer(0, imageBuffer);
    for (let mode of COMPOSITE_MODES) {
      let pipeline = runtime.imagePipelines[mode];
      if (pipeline) {
        pass.setPipeline(pipeline);
        pass.draw(6, 1, 0, 0);
      }
    }
    pass.end();
    runtime.device.queue.submit([encoder.finish()]);
    submitted = true;
    await runtime.device.queue.onSubmittedWorkDone?.();
    return {
      ok: true,
      ms: perfNow() - startedAt,
      submitted,
      sharedRuntime: shouldUseSharedRuntime,
      runtime: WebGPURenderer.getSharedRuntimeStats()
    };
  } catch (err) {
    return {
      ok: false,
      ms: perfNow() - startedAt,
      submitted,
      sharedRuntime: shouldUseSharedRuntime,
      error: err?.message || String(err),
      runtime: WebGPURenderer.getSharedRuntimeStats()
    };
  } finally {
    try {
      texture?.destroy?.();
    } catch (err) {
    }
    try {
      solidBuffer?.destroy?.();
    } catch (err) {
    }
    try {
      imageBuffer?.destroy?.();
    } catch (err) {
    }
    try {
      uniformBuffer?.destroy?.();
    } catch (err) {
    }
    if (!options.canvas && canvas?.parentNode)
      canvas.parentNode.removeChild(canvas);
    if (!shouldUseSharedRuntime)
      sharedRuntimeEnabled = previousSharedRuntimeEnabled;
  }
}
function measureTextWithDom(font, text, state = null) {
  if (typeof document == "undefined")
    return null;
  let probe = measureTextWithDom._probe;
  if (probe == null) {
    probe = document.createElement("span");
    probe.style.position = "absolute";
    probe.style.left = "-99999px";
    probe.style.top = "-99999px";
    probe.style.visibility = "hidden";
    probe.style.whiteSpace = "pre";
    document.documentElement.appendChild(probe);
    measureTextWithDom._probe = probe;
  }
  probe.style.font = font || "12px sans-serif";
  if (state != null) {
    probe.style.fontKerning = state.fontKerning || "auto";
    probe.style.fontStretch = state.fontStretch || "normal";
    probe.style.fontVariantCaps = state.fontVariantCaps || "normal";
    probe.style.letterSpacing = state.letterSpacing || "0px";
    probe.style.textRendering = state.textRendering || "auto";
    probe.style.wordSpacing = state.wordSpacing || "0px";
  }
  probe.textContent = text == null ? "" : String(text);
  let rect = probe.getBoundingClientRect();
  return rect.width;
}
class WebGPURenderer {
  static sharedRuntimeEnabled;
  static sharedRuntime;
  constructor(canvas, options = null) {
    this.canvas = canvas;
    this.options = options || {};
    this.memory = normalizeMemoryOptions(this.options);
    this.context = null;
    this.adapter = null;
    this.device = null;
    this.runtime = null;
    this.ownsRuntime = false;
    this.sharedRuntimeRefHeld = false;
    this.format = null;
    this.pipeline = null;
    this.pipelines = null;
    this.imagePipelines = null;
    this.clearPipeline = null;
    this.bindGroupLayout = null;
    this.pipelineLayout = null;
    this.uniformBuffer = null;
    this.bindGroup = null;
    this.ready = false;
    this.failed = false;
    this.disposed = false;
    this.initEpoch = 0;
    this.contextConfigured = false;
    this.pendingPresent = false;
    this.frameCommandsReleased = false;
    this.memoryTrimToken = 0;
    this.commands = [];
    this.path = new GPUPath();
    this.stack = [];
    this.textLayer = null;
    this.colorCache = /* @__PURE__ */ new Map();
    this.textMeasureCache = /* @__PURE__ */ new Map();
    this.vertexBuffer = null;
    this.vertexBufferSize = 0;
    this.imageVertexBuffer = null;
    this.imageVertexBufferSize = 0;
    this.solidUploadArray = null;
    this.imageUploadArray = null;
    this.uniformUploadArray = null;
    this.lastFrameStats = {
      presents: 0,
      commands: 0,
      solidCommands: 0,
      imageCommands: 0,
      solidVertices: 0,
      imageVertices: 0,
      solidBytes: 0,
      imageBytes: 0,
      uploadBytes: 0,
      writeCalls: 0,
      solidUploadCapacityBytes: 0,
      imageUploadCapacityBytes: 0,
      prepareMs: 0,
      encodeMs: 0,
      submitMs: 0,
      cpuFrameMs: 0,
      frameWidth: 0,
      frameHeight: 0,
      pixelRatio: 1,
      textNodes: 0,
      retainedCPUBytes: 0,
      retainedGPUBytes: 0,
      textureBytes: 0,
      commandsReleased: false
    };
    this.textureCache = typeof WeakMap != "undefined" ? /* @__PURE__ */ new WeakMap() : null;
    this.textureRecords = /* @__PURE__ */ new Set();
    this.textureBytes = 0;
    this.textureSerial = 0;
    this.sampler = null;
    this.imageBindGroupLayout = null;
    this.frameWidth = 1;
    this.frameHeight = 1;
    this.pixelRatio = 1;
    this.state = {
      strokeStyle: "#000",
      fillStyle: "#000",
      lineWidth: 1,
      lineJoin: "round",
      lineCap: "butt",
      lineDash: [],
      font: "12px sans-serif",
      textAlign: "start",
      textBaseline: "alphabetic",
      globalAlpha: 1,
      transform: identity(),
      clipRegions: null,
      lineDashOffset: 0,
      miterLimit: 10,
      globalCompositeOperation: "source-over",
      shadowColor: "rgba(0,0,0,0)",
      shadowBlur: 0,
      shadowOffsetX: 0,
      shadowOffsetY: 0,
      direction: "inherit",
      filter: "none",
      fontKerning: "auto",
      fontStretch: "normal",
      fontVariantCaps: "normal",
      letterSpacing: "0px",
      textRendering: "auto",
      wordSpacing: "0px",
      imageSmoothingEnabled: true,
      imageSmoothingQuality: "high"
    };
    this.initPromise = this.init();
  }
  static setSharedRuntimeEnabled(enabled) {
    sharedRuntimeEnabled = enabled !== false;
  }
  static async prewarm(options = null) {
    return prewarmWebGPURuntime(options);
  }
  static getSharedRuntimeStats() {
    return {
      enabled: sharedRuntimeEnabled,
      active: sharedRuntime != null && !sharedRuntime.lost,
      refs: sharedRuntimeRefs,
      format: sharedRuntime?.format || null,
      adapterInfo: sharedRuntime?.adapterInfo || null,
      compositePipelines: sharedRuntime?.pipelines ? Object.keys(sharedRuntime.pipelines).length : 0,
      imagePipelines: sharedRuntime?.imagePipelines ? Object.keys(sharedRuntime.imagePipelines).length : 0
    };
  }
  getLastFrameStats() {
    return { ...this.lastFrameStats };
  }
  getDevice() {
    return this.device;
  }
  getRuntime() {
    return this.runtime;
  }
  getCanvasContext() {
    return this.context;
  }
  async init() {
    let epoch = ++this.initEpoch;
    if (this.disposed)
      return;
    try {
      this.failed = false;
      let runtime = await getSharedRuntime(this, epoch);
      if (runtime == null || this.disposed || epoch != this.initEpoch)
        return;
      this.runtime = runtime;
      this.ownsRuntime = !sharedRuntimeEnabled;
      if (sharedRuntimeEnabled && !this.sharedRuntimeRefHeld) {
        sharedRuntimeRefs++;
        this.sharedRuntimeRefHeld = true;
      }
      this.adapter = runtime.adapter;
      this.device = runtime.device;
      this.context = this.canvas.getContext("webgpu");
      this.format = runtime.format;
      this.bindGroupLayout = runtime.bindGroupLayout;
      this.imageBindGroupLayout = runtime.imageBindGroupLayout;
      this.pipelineLayout = runtime.pipelineLayout;
      this.pipelines = runtime.pipelines;
      this.imagePipelines = runtime.imagePipelines;
      this.pipeline = runtime.pipelines["source-over"];
      this.clearPipeline = runtime.clearPipeline;
      this.sampler = getRuntimeSampler(runtime, this.state.imageSmoothingEnabled, this.state.imageSmoothingQuality);
      this.configure(true);
      this.uniformBuffer = this.device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
      });
      this.bindGroup = this.device.createBindGroup({
        layout: this.bindGroupLayout,
        entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }]
      });
      if (this.disposed || epoch != this.initEpoch) {
        this.releaseGPUResources();
        return;
      }
      this.ready = true;
      if (this.pendingPresent)
        this.present();
    } catch (err) {
      if (this.disposed || epoch != this.initEpoch)
        return;
      this.failed = true;
      console.error(err);
    }
  }
  createPipeline(module, composite = "source-over") {
    return this.device.createRenderPipeline({
      layout: this.pipelineLayout,
      vertex: {
        module,
        entryPoint: "vsMain",
        buffers: [{
          arrayStride: FLOATS_PER_VERTEX * 4,
          attributes: [
            { shaderLocation: 0, offset: 0, format: "float32x2" },
            { shaderLocation: 1, offset: 8, format: "float32x4" }
          ]
        }]
      },
      fragment: {
        module,
        entryPoint: "fsMain",
        targets: [{
          format: this.format,
          blend: blendForComposite(composite)
        }]
      },
      primitive: { topology: "triangle-list" }
    });
  }
  createImagePipeline(module, layout, composite = "source-over") {
    return this.device.createRenderPipeline({
      layout,
      vertex: {
        module,
        entryPoint: "vsImage",
        buffers: [{
          arrayStride: FLOATS_PER_IMAGE_VERTEX * 4,
          attributes: [
            { shaderLocation: 0, offset: 0, format: "float32x2" },
            { shaderLocation: 1, offset: 8, format: "float32x2" },
            { shaderLocation: 2, offset: 16, format: "float32" }
          ]
        }]
      },
      fragment: {
        module,
        entryPoint: "fsImage",
        targets: [{
          format: this.format,
          blend: blendForComposite(composite)
        }]
      },
      primitive: { topology: "triangle-list" }
    });
  }
  configure(force = false) {
    if (this.context == null || this.device == null || this.format == null)
      return;
    if (force || !this.contextConfigured) {
      this.context.configure({
        device: this.device,
        format: this.format,
        alphaMode: "premultiplied",
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC
      });
      this.contextConfigured = true;
    }
  }
  mount(wrap, canvas) {
    if (typeof document == "undefined" || this.textLayer != null)
      return;
    let layer = document.createElement("div");
    layer.className = "u-webgpu-text";
    layer.style.position = "absolute";
    layer.style.inset = "0";
    layer.style.pointerEvents = "none";
    layer.style.overflow = "hidden";
    layer.style.zIndex = "1";
    this.textLayer = layer;
    if (canvas.nextSibling)
      wrap.insertBefore(layer, canvas.nextSibling);
    else
      wrap.appendChild(layer);
  }
  syncFrameMetrics() {
    let width = Math.max(1, this.canvas.width || 1);
    let height = Math.max(1, this.canvas.height || 1);
    let cssW = this.canvas.clientWidth || width;
    let ratio = width / cssW || 1;
    let resized = width != this.frameWidth || height != this.frameHeight;
    let ratioChanged = Math.abs(ratio - this.pixelRatio) > 1e-6;
    this.frameWidth = width;
    this.frameHeight = height;
    this.pixelRatio = ratio;
    if ((resized || ratioChanged) && this.ready)
      this.configure(true);
    if (this.textLayer != null) {
      this.textLayer.style.width = this.frameWidth / this.pixelRatio + "px";
      this.textLayer.style.height = this.frameHeight / this.pixelRatio + "px";
    }
  }
  reset() {
    this.commands.length = 0;
    this.frameCommandsReleased = false;
    this.path.clear();
    this.stack.length = 0;
    this.state = {
      strokeStyle: "#000",
      fillStyle: "#000",
      lineWidth: 1,
      lineJoin: "round",
      lineCap: "butt",
      lineDash: [],
      font: "12px sans-serif",
      textAlign: "start",
      textBaseline: "alphabetic",
      globalAlpha: 1,
      transform: identity(),
      clipRegions: null,
      lineDashOffset: 0,
      miterLimit: 10,
      globalCompositeOperation: "source-over",
      shadowColor: "rgba(0,0,0,0)",
      shadowBlur: 0,
      shadowOffsetX: 0,
      shadowOffsetY: 0,
      direction: "inherit",
      filter: "none",
      fontKerning: "auto",
      fontStretch: "normal",
      fontVariantCaps: "normal",
      letterSpacing: "0px",
      textRendering: "auto",
      wordSpacing: "0px",
      imageSmoothingEnabled: true,
      imageSmoothingQuality: "high"
    };
    if (this.textLayer != null)
      this.textLayer.textContent = "";
  }
  getContextAttributes() {
    return { ...CONTEXT_ATTRIBUTES };
  }
  isContextLost() {
    return this.disposed || this.failed || this.device == null && this.initPromise == null;
  }
  async flush() {
    if (!this.ready && this.initPromise != null)
      await this.initPromise;
    try {
      await this.device?.queue?.onSubmittedWorkDone?.();
    } catch (err) {
    }
  }
  commit() {
    this.present();
  }
  drawFocusIfNeeded() {
  }
  scrollPathIntoView() {
  }
  releaseGPUResources() {
    this.vertexBuffer?.destroy?.();
    this.vertexBuffer = null;
    this.vertexBufferSize = 0;
    this.imageVertexBuffer?.destroy?.();
    this.imageVertexBuffer = null;
    this.imageVertexBufferSize = 0;
    this.solidUploadArray = null;
    this.imageUploadArray = null;
    this.uniformUploadArray = null;
    this.memoryTrimToken++;
    for (let record of this.textureRecords)
      record?.texture?.destroy?.();
    this.textureRecords.clear();
    this.textureCache = typeof WeakMap != "undefined" ? /* @__PURE__ */ new WeakMap() : null;
    this.textureBytes = 0;
    this.uniformBuffer?.destroy?.();
    this.uniformBuffer = null;
    this.bindGroup = null;
    this.sampler = null;
    if (this.sharedRuntimeRefHeld && sharedRuntimeRefs > 0) {
      sharedRuntimeRefs--;
      this.sharedRuntimeRefHeld = false;
    }
    this.runtime = null;
    this.ownsRuntime = false;
    this.pipeline = null;
    this.pipelines = null;
    this.imagePipelines = null;
    this.clearPipeline = null;
    this.contextConfigured = false;
  }
  getMemoryStats() {
    let retainedCPUBytes = byteLengthOf(this.solidUploadArray) + byteLengthOf(this.imageUploadArray) + byteLengthOf(this.uniformUploadArray);
    let retainedGPUBytes = (this.vertexBufferSize || 0) + (this.imageVertexBufferSize || 0) + (this.uniformBuffer ? 16 : 0) + (this.textureBytes || 0);
    return {
      mode: this.memory.mode,
      commands: this.commands.length,
      commandsReleased: this.frameCommandsReleased,
      retainedCPUBytes,
      retainedGPUBytes,
      solidUploadBytes: byteLengthOf(this.solidUploadArray),
      imageUploadBytes: byteLengthOf(this.imageUploadArray),
      solidBufferBytes: this.vertexBufferSize || 0,
      imageBufferBytes: this.imageVertexBufferSize || 0,
      textureBytes: this.textureBytes || 0,
      textureRecords: this.textureRecords.size
    };
  }
  trimUploadArrays() {
    let maxBytes = this.memory.maxRetainedUploadBytes;
    if (byteLengthOf(this.solidUploadArray) > maxBytes)
      this.solidUploadArray = null;
    if (byteLengthOf(this.imageUploadArray) > maxBytes)
      this.imageUploadArray = null;
  }
  trimCaches() {
    if (this.colorCache.size > this.memory.maxColorCacheEntries)
      this.colorCache.clear();
    if (this.textMeasureCache.size > this.memory.maxTextMeasureCacheEntries)
      this.textMeasureCache.clear();
    this.enforceTextureBudget();
  }
  trimGPUBuffers() {
    let maxBytes = this.memory.maxRetainedVertexBufferBytes;
    if (this.vertexBuffer != null && this.vertexBufferSize > maxBytes) {
      this.vertexBuffer.destroy?.();
      this.vertexBuffer = null;
      this.vertexBufferSize = 0;
    }
    if (this.imageVertexBuffer != null && this.imageVertexBufferSize > maxBytes) {
      this.imageVertexBuffer.destroy?.();
      this.imageVertexBuffer = null;
      this.imageVertexBufferSize = 0;
    }
  }
  trimMemory() {
    this.trimUploadArrays();
    this.trimCaches();
    if (this.commands.length == 0 || this.frameCommandsReleased)
      this.trimGPUBuffers();
    return this.getMemoryStats();
  }
  scheduleMemoryTrim() {
    if (this.disposed || this.device == null)
      return;
    this.trimUploadArrays();
    this.trimCaches();
    let maxBytes = this.memory.maxRetainedVertexBufferBytes;
    let needsGpuTrim = this.vertexBufferSize > maxBytes || this.imageVertexBufferSize > maxBytes;
    if (!needsGpuTrim)
      return;
    let token = ++this.memoryTrimToken;
    let queue = this.device.queue;
    queue?.onSubmittedWorkDone?.().then(() => {
      if (this.disposed || token != this.memoryTrimToken)
        return;
      if (this.commands.length == 0 || this.frameCommandsReleased)
        this.trimGPUBuffers();
    }).catch(() => {
    });
  }
  ensureVertexBuffer(byteLength) {
    if (byteLength <= this.vertexBufferSize && this.vertexBuffer != null)
      return this.vertexBuffer;
    this.vertexBuffer?.destroy?.();
    let size = Math.max(1024, 1 << Math.ceil(Math.log2(byteLength || 1)));
    this.vertexBuffer = this.device.createBuffer({
      size,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
    });
    this.vertexBufferSize = size;
    return this.vertexBuffer;
  }
  ensureImageVertexBuffer(byteLength) {
    if (byteLength <= this.imageVertexBufferSize && this.imageVertexBuffer != null)
      return this.imageVertexBuffer;
    this.imageVertexBuffer?.destroy?.();
    let size = Math.max(1024, 1 << Math.ceil(Math.log2(byteLength || 1)));
    this.imageVertexBuffer = this.device.createBuffer({
      size,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
    });
    this.imageVertexBufferSize = size;
    return this.imageVertexBuffer;
  }
  getTextureRecord(source) {
    if (source == null || this.device == null || this.imageBindGroupLayout == null)
      return null;
    let width = Math.floor(sourceWidth(source));
    let height = Math.floor(sourceHeight(source));
    if (width <= 0 || height <= 0)
      return null;
    if (this.runtime != null)
      this.sampler = getRuntimeSampler(this.runtime, this.state.imageSmoothingEnabled, this.state.imageSmoothingQuality);
    let record = this.textureCache?.get(source);
    let needsCreate = record == null || record.width != width || record.height != height;
    if (needsCreate) {
      if (record != null) {
        record.texture?.destroy?.();
        this.textureRecords.delete(record);
        this.textureBytes = Math.max(0, this.textureBytes - (record.bytes || 0));
      }
      let texture = this.device.createTexture({
        size: [width, height, 1],
        format: "rgba8unorm",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
      });
      let bindGroup = this.device.createBindGroup({
        layout: this.imageBindGroupLayout,
        entries: [
          { binding: 0, resource: this.sampler },
          { binding: 1, resource: texture.createView() }
        ]
      });
      record = { source, texture, bindGroup, width, height, bytes: textureByteSize(width, height), lastUsed: ++this.textureSerial };
      this.textureBytes += record.bytes;
      this.textureRecords.add(record);
      this.textureCache?.set(source, record);
    } else {
      record.lastUsed = ++this.textureSerial;
    }
    try {
      if (isImageDataLike(source)) {
        let data = source.data;
        if (data == null || data.length < width * height * 4)
          return null;
        this.device.queue.writeTexture(
          { texture: record.texture },
          data,
          { bytesPerRow: width * 4, rowsPerImage: height },
          [width, height]
        );
      } else {
        this.device.queue.copyExternalImageToTexture(
          { source },
          { texture: record.texture },
          [width, height]
        );
      }
    } catch (err) {
      return null;
    }
    this.enforceTextureBudget(record);
    return record;
  }
  destroyTextureRecord(record) {
    if (record == null)
      return;
    record.texture?.destroy?.();
    this.textureRecords.delete(record);
    this.textureCache?.delete?.(record.source);
    this.textureBytes = Math.max(0, this.textureBytes - (record.bytes || 0));
  }
  enforceTextureBudget(keep = null) {
    let maxBytes = this.memory.maxTextureBytes;
    let maxRecords = this.memory.maxTextureRecords;
    if (this.textureRecords.size <= maxRecords && this.textureBytes <= maxBytes)
      return;
    let victims = Array.from(this.textureRecords).filter((record) => record !== keep).sort((a, b) => (a.lastUsed || 0) - (b.lastUsed || 0));
    for (let record of victims) {
      if (this.textureRecords.size <= maxRecords && this.textureBytes <= maxBytes)
        break;
      this.destroyTextureRecord(record);
    }
  }
  clearRect(x = 0, y = 0, w = this.canvas.width || 0, h = this.canvas.height || 0) {
    this.syncFrameMetrics();
    let m = this.state.transform;
    let fullClear = x <= 0 && y <= 0 && x + w >= this.frameWidth && y + h >= this.frameHeight && Math.abs(m[0] - 1) < EPS && Math.abs(m[1]) < EPS && Math.abs(m[2]) < EPS && Math.abs(m[3] - 1) < EPS && Math.abs(m[4]) < EPS && Math.abs(m[5]) < EPS;
    if (fullClear) {
      this.commands.length = 0;
      this.frameCommandsReleased = false;
      this.path.clear();
    } else {
      let path = new GPUPath();
      path.rect(x, y, w, h);
      let prevFill = this.state.fillStyle;
      let prevAlpha = this.state.globalAlpha;
      this.state.fillStyle = TRANSPARENT;
      this.state.globalAlpha = 1;
      this.fill(path, "nonzero", "clear");
      this.state.fillStyle = prevFill;
      this.state.globalAlpha = prevAlpha;
      this.clearTextInPath(path);
    }
    if (this.textLayer != null && fullClear)
      this.textLayer.textContent = "";
  }
  clearTextInPath(path) {
    if (this.textLayer == null || path == null)
      return;
    let regions = pathToClipRegions(path, this.state.transform, "nonzero");
    if (regions.length == 0)
      return;
    for (let node of Array.from(this.textLayer.children)) {
      let x = Number(node.dataset.uplotX);
      let y = Number(node.dataset.uplotY);
      if (!Number.isFinite(x) || !Number.isFinite(y))
        continue;
      if (pointInClipRegions([x, y], regions))
        node.remove();
    }
  }
  prepareDrawBuffers() {
    let device = this.device;
    if (device == null || this.uniformBuffer == null)
      return { solidBuffer: null, imageBuffer: null, stats: { commands: this.commands.length, solidCommands: 0, imageCommands: 0, solidVertices: 0, imageVertices: 0, solidBytes: 0, imageBytes: 0, uploadBytes: 0, writeCalls: 0, solidUploadCapacityBytes: this.vertexBufferSize || 0, imageUploadCapacityBytes: this.imageVertexBufferSize || 0, frameWidth: this.frameWidth, frameHeight: this.frameHeight, pixelRatio: this.pixelRatio, textNodes: this.textLayer?.childElementCount || 0 } };
    let uploadBytes = 0;
    let writeCalls = 0;
    let uniformData = this.uniformUploadArray || (this.uniformUploadArray = new Float32Array(2));
    uniformData[0] = this.frameWidth;
    uniformData[1] = this.frameHeight;
    device.queue.writeBuffer(this.uniformBuffer, 0, uniformData);
    uploadBytes += uniformData.byteLength;
    writeCalls++;
    let solidVertexCount = 0;
    let imageVertexCount = 0;
    let solidCommands = 0;
    let imageCommands = 0;
    for (let cmd of this.commands) {
      if (cmd.kind == "image") {
        imageVertexCount += cmd.vertices.length / FLOATS_PER_IMAGE_VERTEX;
        imageCommands++;
      } else {
        solidVertexCount += cmd.vertices.length / FLOATS_PER_VERTEX;
        solidCommands++;
      }
    }
    let solidBuffer = null;
    if (solidVertexCount > 0) {
      let needed = solidVertexCount * FLOATS_PER_VERTEX;
      if (this.solidUploadArray == null || this.solidUploadArray.length < needed)
        this.solidUploadArray = new Float32Array(1 << Math.ceil(Math.log2(needed || 1)));
      let vertexArray = this.solidUploadArray.subarray(0, needed);
      let offset = 0;
      for (let cmd of this.commands) {
        if (cmd.kind == "image")
          continue;
        cmd.offset = offset / FLOATS_PER_VERTEX;
        cmd.count = cmd.vertices.length / FLOATS_PER_VERTEX;
        vertexArray.set(cmd.vertices, offset);
        offset += cmd.vertices.length;
      }
      solidBuffer = this.ensureVertexBuffer(vertexArray.byteLength);
      device.queue.writeBuffer(solidBuffer, 0, vertexArray);
      uploadBytes += vertexArray.byteLength;
      writeCalls++;
    }
    let imageBuffer = null;
    if (imageVertexCount > 0) {
      let needed = imageVertexCount * FLOATS_PER_IMAGE_VERTEX;
      if (this.imageUploadArray == null || this.imageUploadArray.length < needed)
        this.imageUploadArray = new Float32Array(1 << Math.ceil(Math.log2(needed || 1)));
      let vertexArray = this.imageUploadArray.subarray(0, needed);
      let offset = 0;
      for (let cmd of this.commands) {
        if (cmd.kind != "image")
          continue;
        cmd.offset = offset / FLOATS_PER_IMAGE_VERTEX;
        cmd.count = cmd.vertices.length / FLOATS_PER_IMAGE_VERTEX;
        vertexArray.set(cmd.vertices, offset);
        offset += cmd.vertices.length;
      }
      imageBuffer = this.ensureImageVertexBuffer(vertexArray.byteLength);
      device.queue.writeBuffer(imageBuffer, 0, vertexArray);
      uploadBytes += vertexArray.byteLength;
      writeCalls++;
    }
    let stats = {
      commands: this.commands.length,
      solidCommands,
      imageCommands,
      solidVertices: solidVertexCount,
      imageVertices: imageVertexCount,
      solidBytes: solidVertexCount * FLOATS_PER_VERTEX * 4,
      imageBytes: imageVertexCount * FLOATS_PER_IMAGE_VERTEX * 4,
      uploadBytes,
      writeCalls,
      solidUploadCapacityBytes: this.vertexBufferSize || 0,
      imageUploadCapacityBytes: this.imageVertexBufferSize || 0,
      frameWidth: this.frameWidth,
      frameHeight: this.frameHeight,
      pixelRatio: this.pixelRatio,
      textNodes: this.textLayer?.childElementCount || 0,
      retainedCPUBytes: byteLengthOf(this.solidUploadArray) + byteLengthOf(this.imageUploadArray) + byteLengthOf(this.uniformUploadArray),
      retainedGPUBytes: (this.vertexBufferSize || 0) + (this.imageVertexBufferSize || 0) + (this.uniformBuffer ? 16 : 0) + (this.textureBytes || 0),
      textureBytes: this.textureBytes || 0,
      commandsReleased: false
    };
    return { solidBuffer, imageBuffer, stats };
  }
  encodeDrawPass(encoder, view, solidBuffer, imageBuffer) {
    let pass = encoder.beginRenderPass({
      colorAttachments: [{
        view,
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: "clear",
        storeOp: "store"
      }]
    });
    pass.setBindGroup(0, this.bindGroup);
    let activePipeline = null;
    let activeBindGroup = null;
    let activeBufferKind = null;
    for (let cmd of this.commands) {
      let composite = clampCompositeMode(cmd.composite);
      if (cmd.kind == "image") {
        if (cmd.bindGroup == null && cmd.source != null) {
          let record = this.getTextureRecord(cmd.source);
          if (record != null)
            cmd.bindGroup = record.bindGroup;
        }
        if (imageBuffer == null || cmd.bindGroup == null || cmd.count <= 0)
          continue;
        let pipeline = this.imagePipelines[composite] || this.imagePipelines["source-over"];
        if (pipeline !== activePipeline) {
          pass.setPipeline(pipeline);
          activePipeline = pipeline;
        }
        if (activeBufferKind != "image") {
          pass.setVertexBuffer(0, imageBuffer);
          activeBufferKind = "image";
        }
        if (cmd.bindGroup !== activeBindGroup) {
          pass.setBindGroup(1, cmd.bindGroup);
          activeBindGroup = cmd.bindGroup;
        }
        pass.draw(cmd.count, 1, cmd.offset, 0);
      } else {
        if (solidBuffer == null || cmd.count <= 0)
          continue;
        let pipeline = this.pipelines[composite] || this.pipeline;
        if (pipeline !== activePipeline) {
          pass.setPipeline(pipeline);
          activePipeline = pipeline;
        }
        if (activeBufferKind != "solid") {
          pass.setVertexBuffer(0, solidBuffer);
          activeBufferKind = "solid";
        }
        pass.draw(cmd.count, 1, cmd.offset, 0);
      }
    }
    pass.end();
  }
  present() {
    this.syncFrameMetrics();
    if (!this.ready) {
      this.pendingPresent = true;
      return;
    }
    this.pendingPresent = false;
    if (this.frameCommandsReleased && this.commands.length == 0)
      return;
    this.configure(false);
    if (this.frameWidth <= 0 || this.frameHeight <= 0)
      return;
    let device = this.device;
    let frameStart = perfNow();
    let prepareStart = perfNow();
    let { solidBuffer, imageBuffer, stats } = this.prepareDrawBuffers();
    let prepareMs = perfNow() - prepareStart;
    let currentTexture;
    try {
      currentTexture = this.context.getCurrentTexture();
    } catch (err) {
      this.configure(true);
      try {
        currentTexture = this.context.getCurrentTexture();
      } catch (err2) {
        this.pendingPresent = true;
        return;
      }
    }
    let encodeStart = perfNow();
    let encoder = device.createCommandEncoder();
    this.encodeDrawPass(encoder, currentTexture.createView(), solidBuffer, imageBuffer);
    let commandBuffer = encoder.finish();
    let encodeMs = perfNow() - encodeStart;
    try {
      let submitStart = perfNow();
      device.queue.submit([commandBuffer]);
      let submitMs = perfNow() - submitStart;
      let commandsReleased = false;
      if (this.memory.releaseCommandsAfterPresent) {
        this.commands.length = 0;
        this.frameCommandsReleased = true;
        commandsReleased = true;
      }
      this.trimUploadArrays();
      this.trimCaches();
      let memoryStats = this.getMemoryStats();
      this.lastFrameStats = {
        ...stats,
        prepareMs,
        encodeMs,
        submitMs,
        cpuFrameMs: perfNow() - frameStart,
        presents: (this.lastFrameStats?.presents || 0) + 1,
        retainedCPUBytes: memoryStats.retainedCPUBytes,
        retainedGPUBytes: memoryStats.retainedGPUBytes,
        textureBytes: memoryStats.textureBytes,
        commandsReleased
      };
      this.scheduleMemoryTrim();
    } catch (err) {
      this.ready = false;
      this.failed = true;
      this.releaseGPUResources();
      if (!this.disposed)
        this.initPromise = this.init();
    }
  }
  getImageData(sx = 0, sy = 0, sw = this.frameWidth, sh = this.frameHeight) {
    this.syncFrameMetrics();
    let rect = normalizeReadRect(sx, sy, sw, sh, this.frameWidth, this.frameHeight);
    if (rect == null)
      return createImageDataObject(0, 0);
    return createImageDataObject(rect.w, rect.h);
  }
  async getImageDataAsync(sx = 0, sy = 0, sw = this.frameWidth, sh = this.frameHeight) {
    this.syncFrameMetrics();
    let rect = normalizeReadRect(sx, sy, sw, sh, this.frameWidth, this.frameHeight);
    if (rect == null)
      return createImageDataObject(0, 0);
    if (!this.ready && this.initPromise != null)
      await this.initPromise;
    if (!this.ready || this.disposed || this.device == null)
      return createImageDataObject(rect.w, rect.h);
    let device = this.device;
    let bytesPerPixel = 4;
    let unpaddedBytesPerRow = rect.w * bytesPerPixel;
    let bytesPerRow = alignBytesPerRow(unpaddedBytesPerRow);
    let bufferSize = bytesPerRow * rect.h;
    let texture = device.createTexture({
      size: [this.frameWidth, this.frameHeight, 1],
      format: this.format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC
    });
    let readBuffer = device.createBuffer({
      size: bufferSize,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    });
    let { solidBuffer, imageBuffer } = this.prepareDrawBuffers();
    let encoder = device.createCommandEncoder();
    this.encodeDrawPass(encoder, texture.createView(), solidBuffer, imageBuffer);
    encoder.copyTextureToBuffer(
      { texture, origin: { x: rect.x, y: rect.y, z: 0 } },
      { buffer: readBuffer, bytesPerRow, rowsPerImage: rect.h },
      { width: rect.w, height: rect.h, depthOrArrayLayers: 1 }
    );
    device.queue.submit([encoder.finish()]);
    try {
      await readBuffer.mapAsync(GPUMapMode.READ);
      let mapped = new Uint8Array(readBuffer.getMappedRange());
      let out = new Uint8ClampedArray(rect.w * rect.h * 4);
      let bgra = String(this.format || "").toLowerCase().startsWith("bgra");
      for (let y = 0; y < rect.h; y++) {
        let src = y * bytesPerRow;
        let dst = y * unpaddedBytesPerRow;
        if (bgra) {
          for (let x = 0; x < rect.w; x++) {
            let si = src + x * 4;
            let di = dst + x * 4;
            out[di + 0] = mapped[si + 2];
            out[di + 1] = mapped[si + 1];
            out[di + 2] = mapped[si + 0];
            out[di + 3] = mapped[si + 3];
          }
        } else
          out.set(mapped.subarray(src, src + unpaddedBytesPerRow), dst);
      }
      readBuffer.unmap();
      return createImageDataObject(rect.w, rect.h, out);
    } finally {
      texture.destroy?.();
      readBuffer.destroy?.();
    }
  }
  async exportImageBytes(type = "image/png") {
    let tools = await loadExportTools();
    type = tools.normalizeExportType(type);
    let img = await this.getImageDataAsync(0, 0, this.frameWidth, this.frameHeight);
    let bytes = type == "image/bmp" ? tools.rgbaImageDataToBmpBytes(img) : tools.rgbaImageDataToPngBytes(img);
    return { type, bytes };
  }
  async convertToBlob(options = {}) {
    let tools = await loadExportTools();
    let requestedType = typeof options == "string" ? options : options?.type;
    let { type, bytes } = await this.exportImageBytes(requestedType || "image/png");
    return tools.bytesToBlob(bytes, type);
  }
  async toDataURLAsync(type = "image/png") {
    let tools = await loadExportTools();
    let exported = await this.exportImageBytes(type);
    return `data:${exported.type};base64,${tools.bytesToBase64(exported.bytes)}`;
  }
  async toBlob(callback, type = "image/png") {
    let blob = await this.convertToBlob({ type });
    if (typeof callback == "function")
      callback(blob);
    return blob;
  }
  async toSVGStringAsync(options = {}) {
    let tools = await loadExportTools();
    let pixelRatio = this.pixelRatio || 1;
    let width = this.frameWidth / pixelRatio;
    let height = this.frameHeight / pixelRatio;
    let imageHref = options.background === false ? "" : await this.toDataURLAsync(options.imageType || "image/png");
    let image = imageHref ? `<image href="${tools.escapeXmlAttr(imageHref)}" x="0" y="0" width="${width}" height="${height}"/>` : "";
    let html = this.textLayer?.innerHTML || "";
    let text = html ? `<foreignObject x="0" y="0" width="${width}" height="${height}"><div xmlns="http://www.w3.org/1999/xhtml" style="position:relative;width:${width}px;height:${height}px;overflow:hidden">${html}</div></foreignObject>` : "";
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${image}${text}</svg>`;
  }
  async toSVGBlob(options = {}) {
    let tools = await loadExportTools();
    let svg = await this.toSVGStringAsync(options);
    return tools.textToBlob(svg, "image/svg+xml");
  }
  async toSVGDataURLAsync(options = {}) {
    let tools = await loadExportTools();
    let svg = await this.toSVGStringAsync(options);
    return `data:image/svg+xml;base64,${tools.encodeTextBase64(svg)}`;
  }
  save() {
    this.stack.push(cloneState(this.state));
  }
  restore() {
    let state = this.stack.pop();
    if (state != null)
      this.state = state;
  }
  translate(x, y) {
    x = Number(x);
    y = Number(y);
    if (Number.isFinite(x) && Number.isFinite(y))
      this.state.transform = multiply(this.state.transform, [1, 0, 0, 1, x, y]);
  }
  rotate(angle) {
    angle = Number(angle);
    if (!Number.isFinite(angle))
      return;
    let c = Math.cos(angle);
    let s = Math.sin(angle);
    this.state.transform = multiply(this.state.transform, [c, s, -s, c, 0, 0]);
  }
  scale(x, y = x) {
    x = Number(x);
    y = Number(y);
    if (Number.isFinite(x) && Number.isFinite(y))
      this.state.transform = multiply(this.state.transform, [x, 0, 0, y, 0, 0]);
  }
  transform(a = 1, b = 0, c = 0, d = 1, e = 0, f = 0) {
    let next = finiteTransform([a, b, c, d, e, f]);
    if (next != null)
      this.state.transform = multiply(this.state.transform, next);
  }
  getTransform() {
    let [a, b, c, d, e, f] = this.state.transform;
    if (typeof DOMMatrix != "undefined")
      return new DOMMatrix([a, b, c, d, e, f]);
    return { a, b, c, d, e, f, is2D: true };
  }
  setTransform(a = 1, b = 0, c = 0, d = 1, e = 0, f = 0) {
    let next = typeof a == "object" && a != null ? finiteTransform([a.a, a.b, a.c, a.d, a.e, a.f]) : finiteTransform([a, b, c, d, e, f]);
    if (next != null)
      this.state.transform = next;
  }
  resetTransform() {
    this.state.transform = identity();
  }
  getLineDash() {
    return this.state.lineDash.slice();
  }
  setLineDash(dash) {
    if (dash == null) {
      this.state.lineDash = [];
      return;
    }
    let next = Array.from(dash, Number);
    if (next.every((v) => Number.isFinite(v) && v >= 0)) {
      if (next.length % 2 == 1)
        next = next.concat(next);
      this.state.lineDash = next;
    }
  }
  beginPath() {
    this.path.clear();
  }
  moveTo(x, y) {
    this.path.moveTo(x, y);
  }
  lineTo(x, y) {
    this.path.lineTo(x, y);
  }
  rect(x, y, w, h) {
    this.path.rect(x, y, w, h);
  }
  arc(x, y, r, startAngle, endAngle, counterclockwise = false) {
    this.path.arc(x, y, r, startAngle, endAngle, counterclockwise);
  }
  arcTo(x1, y1, x2, y2, r) {
    this.path.arcTo(x1, y1, x2, y2, r);
  }
  ellipse(x, y, radiusX, radiusY, rotation, startAngle, endAngle, counterclockwise = false) {
    this.path.ellipse(x, y, radiusX, radiusY, rotation, startAngle, endAngle, counterclockwise);
  }
  roundRect(x, y, w, h, radii = 0) {
    this.path.roundRect(x, y, w, h, radii);
  }
  closePath() {
    this.path.closePath();
  }
  quadraticCurveTo(cpx, cpy, x, y) {
    this.path.quadraticCurveTo(cpx, cpy, x, y);
  }
  bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x, y) {
    this.path.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x, y);
  }
  addPath(path, transform = null) {
    this.path.addPath(path, transform);
  }
  clip(path = this.path, fillRule = "nonzero") {
    if (typeof path == "string") {
      fillRule = path;
      path = this.path;
    }
    if (path == null)
      return;
    let regions = pathToClipRegions(path, this.state.transform, fillRule);
    this.state.clipRegions = combineClipRegions(this.state.clipRegions, regions);
  }
  pathBounds(path) {
    let subpaths = path?.toSubpaths?.() || [];
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let sub of subpaths) {
      for (let p of sub) {
        minX = Math.min(minX, p[0]);
        minY = Math.min(minY, p[1]);
        maxX = Math.max(maxX, p[0]);
        maxY = Math.max(maxY, p[1]);
      }
    }
    return minX == Infinity ? null : { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }
  shadowColorValue() {
    return this.parseColor(this.state.shadowColor, this.state.globalAlpha);
  }
  shadowOffsetVector() {
    return transformVec(this.state.transform, this.state.shadowOffsetX || 0, this.state.shadowOffsetY || 0);
  }
  enqueueShadowVertices(vertices) {
    if (!hasActiveShadow(this.state) || vertices == null || vertices.length == 0)
      return;
    let color = this.shadowColorValue();
    if (color[3] <= 0)
      return;
    let [dx, dy] = this.shadowOffsetVector();
    let blur = Math.max(0, (this.state.shadowBlur || 0) * transformScale(this.state.transform));
    let copies = blur > 0 ? Math.min(12, Math.max(4, Math.round(blur / 2))) : 0;
    let batches = [];
    if (copies == 0)
      batches.push(offsetSolidVertices(vertices, dx, dy));
    else {
      let baseAlpha = 1 / (copies + 1);
      batches.push(offsetSolidVertices(vertices, dx, dy, baseAlpha));
      for (let i = 0; i < copies; i++) {
        let ang = i / copies * Math.PI * 2;
        let ox = dx + Math.cos(ang) * blur;
        let oy = dy + Math.sin(ang) * blur;
        batches.push(offsetSolidVertices(vertices, ox, oy, baseAlpha));
      }
    }
    let out = [];
    for (let verts of batches) {
      for (let i = 0; i < verts.length; i += FLOATS_PER_VERTEX) {
        verts[i + 2] = color[0];
        verts[i + 3] = color[1];
        verts[i + 4] = color[2];
        verts[i + 5] *= color[3];
      }
      out.push(...verts);
    }
    this.addGeometry(out);
  }
  enqueuePathShadow(path, fillRule = "nonzero") {
    if (!hasActiveShadow(this.state) || path == null)
      return;
    let vertices = [];
    let regions = pathToClipRegions(path, this.state.transform, fillRule);
    let seedColor = [1, 1, 1, 1];
    for (let region of regions) {
      for (let tri of triangulate(region)) {
        pushVertex(vertices, tri[0][0], tri[0][1], seedColor);
        pushVertex(vertices, tri[1][0], tri[1][1], seedColor);
        pushVertex(vertices, tri[2][0], tri[2][1], seedColor);
      }
    }
    this.enqueueShadowVertices(vertices);
  }
  stroke(path = this.path) {
    if (typeof path == "string")
      path = this.path;
    if (path == null || this.state.lineWidth <= 0)
      return;
    let color = this.parseColor(this.state.strokeStyle, this.state.globalAlpha);
    if (color[3] <= 0)
      return;
    let vertices = [];
    let subpaths = path.toSubpaths();
    let m = this.state.transform;
    let scale = transformScale(m);
    let width = Math.max(0.01, this.state.lineWidth * scale);
    let dash = this.state.lineDash.map((v) => v * scale);
    let dashOffset = this.state.lineDashOffset * scale;
    for (let sub of subpaths) {
      let transformed = sub.map((p) => transformPoint(m, p[0], p[1]));
      transformed.closed = !!sub.closed && dash.length == 0;
      let segments = dashSegments(transformed, dash, dashOffset);
      for (let seg of segments)
        addPolyline(vertices, seg, width, color, this.state.lineCap, this.state.lineJoin, this.state.miterLimit);
    }
    this.enqueueShadowVertices(vertices);
    this.addGeometry(vertices);
  }
  fill(path = this.path, fillRule = "nonzero", kind = "draw") {
    if (typeof path == "string") {
      fillRule = path;
      path = this.path;
    }
    if (path == null)
      return;
    if (kind != "clear" && isPatternPaint(this.state.fillStyle)) {
      this.fillPattern(path, this.state.fillStyle, fillRule);
      return;
    }
    let color = this.parseColor(this.state.fillStyle, this.state.globalAlpha);
    if (kind != "clear" && color[3] <= 0)
      return;
    let vertices = [];
    let regions = pathToFillRegions(path, this.state.transform, fillRule);
    for (let region of regions)
      pushPaintedRegion(vertices, region, color);
    if (kind != "clear")
      this.enqueueShadowVertices(vertices);
    this.addGeometry(vertices, kind);
  }
  fillPattern(path, pattern, fillRule = "nonzero") {
    let record = this.getTextureRecord(pattern.source) || (!this.ready ? { source: pattern.source, width: sourceWidth(pattern.source), height: sourceHeight(pattern.source), bindGroup: null } : null);
    if (record == null || record.width <= 0 || record.height <= 0)
      return;
    let regions = pathToClipRegions(path, this.state.transform, fillRule);
    if (regions.length == 0)
      return;
    if (hasActiveShadow(this.state))
      this.enqueuePathShadow(path, fillRule);
    let combined = combineClipRegions(this.state.clipRegions, regions);
    let bounds = boundsOfRegions(combined);
    if (bounds == null)
      return;
    let repeatX = pattern.repetition == "repeat" || pattern.repetition == "repeat-x" || pattern.repetition == "";
    let repeatY = pattern.repetition == "repeat" || pattern.repetition == "repeat-y" || pattern.repetition == "";
    let pm = pattern.transform || identity();
    let vx = [pm[0] * record.width, pm[1] * record.width];
    let vy = [pm[2] * record.height, pm[3] * record.height];
    let origin = [pm[4] || 0, pm[5] || 0];
    let inv = invert2x2(vx[0], vx[1], vy[0], vy[1]);
    if (inv == null) {
      this.addImageRect(record, 0, 0, record.width, record.height, origin[0], origin[1], record.width, record.height, combined, true);
      return;
    }
    let corners = [
      [bounds.x, bounds.y],
      [bounds.x + bounds.w, bounds.y],
      [bounds.x, bounds.y + bounds.h],
      [bounds.x + bounds.w, bounds.y + bounds.h]
    ];
    let minI = Infinity, minJ = Infinity, maxI = -Infinity, maxJ = -Infinity;
    for (let [x, y] of corners) {
      let rx = x - origin[0];
      let ry = y - origin[1];
      let i = inv[0] * rx + inv[2] * ry;
      let j = inv[1] * rx + inv[3] * ry;
      minI = Math.min(minI, i);
      maxI = Math.max(maxI, i);
      minJ = Math.min(minJ, j);
      maxJ = Math.max(maxJ, j);
    }
    let i0 = repeatX ? Math.floor(minI) - 1 : 0;
    let i1 = repeatX ? Math.ceil(maxI) + 1 : 0;
    let j0 = repeatY ? Math.floor(minJ) - 1 : 0;
    let j1 = repeatY ? Math.ceil(maxJ) + 1 : 0;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        let p0 = [origin[0] + vx[0] * i + vy[0] * j, origin[1] + vx[1] * i + vy[1] * j];
        let p1 = [p0[0] + vx[0], p0[1] + vx[1]];
        let p2 = [p0[0] + vy[0], p0[1] + vy[1]];
        let p3 = [p1[0] + vy[0], p1[1] + vy[1]];
        this.addImageQuadGeometry(record, p0, p1, p2, p3, combined);
      }
    }
  }
  createImageData(width, height) {
    if (typeof width == "object" && width != null) {
      height = width.height;
      width = width.width;
    }
    return createImageDataObject(width, height);
  }
  putImageData(imageData, dx, dy, dirtyX = 0, dirtyY = 0, dirtyWidth = imageData?.width || 0, dirtyHeight = imageData?.height || 0) {
    if (!isImageDataLike(imageData))
      return;
    dx = Number(dx);
    dy = Number(dy);
    if (!Number.isFinite(dx) || !Number.isFinite(dy))
      return;
    let dirty = normalizeDirtyRect(imageData, dirtyX, dirtyY, dirtyWidth, dirtyHeight);
    if (dirty == null)
      return;
    let record = this.getTextureRecord(imageData) || (!this.ready ? { source: imageData, width: imageData.width, height: imageData.height, bindGroup: null } : null);
    if (record == null)
      return;
    let prevComposite = this.state.globalCompositeOperation;
    let prevAlpha = this.state.globalAlpha;
    this.state.globalCompositeOperation = "copy";
    this.state.globalAlpha = 1;
    this.addImageRect(record, dirty.x, dirty.y, dirty.w, dirty.h, dx + dirty.x, dy + dirty.y, dirty.w, dirty.h, null, true);
    this.state.globalCompositeOperation = prevComposite;
    this.state.globalAlpha = prevAlpha;
  }
  drawImage(source, ...args) {
    let sw0 = sourceWidth(source);
    let sh0 = sourceHeight(source);
    if (sw0 <= 0 || sh0 <= 0)
      return;
    let sx = 0;
    let sy = 0;
    let sw = sw0;
    let sh = sh0;
    let dx = 0;
    let dy = 0;
    let dw = sw0;
    let dh = sh0;
    if (args.length == 2)
      [dx, dy] = args;
    else if (args.length == 4)
      [dx, dy, dw, dh] = args;
    else if (args.length >= 8)
      [sx, sy, sw, sh, dx, dy, dw, dh] = args;
    else
      return;
    let record = this.getTextureRecord(source) || (!this.ready ? { source, width: sw0, height: sh0, bindGroup: null } : null);
    if (record == null)
      return;
    let rect = normalizeImageRect(record, sx, sy, sw, sh, dx, dy, dw, dh);
    if (rect == null)
      return;
    ({ sx, sy, sw, sh, dx, dy, dw, dh } = rect);
    if (hasActiveShadow(this.state)) {
      let shadowPath = new GPUPath();
      shadowPath.rect(dx, dy, dw, dh);
      this.enqueuePathShadow(shadowPath, "nonzero");
    }
    this.addImageRect(record, sx, sy, sw, sh, dx, dy, dw, dh, this.state.clipRegions, false);
  }
  addImageRect(record, sx, sy, sw, sh, dx, dy, dw, dh, clipRegions, alreadyTransformed) {
    if (record == null)
      return;
    let rect = normalizeImageRect(record, sx, sy, sw, sh, dx, dy, dw, dh);
    if (rect == null)
      return;
    ({ sx, sy, sw, sh, dx, dy, dw, dh } = rect);
    let m = alreadyTransformed ? identity() : this.state.transform;
    let p0 = transformPoint(m, dx, dy);
    let p1 = transformPoint(m, dx + dw, dy);
    let p2 = transformPoint(m, dx, dy + dh);
    let p3 = transformPoint(m, dx + dw, dy + dh);
    let u0 = sx / record.width;
    let v0 = sy / record.height;
    let u1 = (sx + sw) / record.width;
    let v1 = (sy + sh) / record.height;
    return this.addImageQuadGeometry(record, p0, p1, p2, p3, clipRegions, u0, v0, u1, v1);
  }
  addImageQuadGeometry(record, p0, p1, p2, p3, clipRegions, u0 = 0, v0 = 0, u1 = 1, v1 = 1) {
    if (record == null)
      return;
    let alpha = clamp01(this.state.globalAlpha);
    if (alpha <= 0 && this.state.globalCompositeOperation != "destination-out")
      return;
    let vertices = [];
    addImageQuad(
      vertices,
      makeImageVertex(p0[0], p0[1], u0, v0, alpha),
      makeImageVertex(p1[0], p1[1], u1, v0, alpha),
      makeImageVertex(p2[0], p2[1], u0, v1, alpha),
      makeImageVertex(p3[0], p3[1], u1, v1, alpha)
    );
    vertices = clipImageVertices(vertices, clipRegions);
    if (vertices.length == 0)
      return;
    this.frameCommandsReleased = false;
    this.memoryTrimToken++;
    this.commands.push({
      kind: "image",
      vertices,
      source: record.source,
      bindGroup: record.bindGroup,
      composite: this.state.globalCompositeOperation
    });
  }
  createPattern(source, repetition = "repeat") {
    if (source == null)
      return null;
    return makePattern(source, repetition);
  }
  fillRect(x, y, w, h) {
    if (isPatternPaint(this.state.fillStyle)) {
      let path = new GPUPath();
      path.rect(x, y, w, h);
      this.fill(path);
      return;
    }
    let color = this.parseColor(this.state.fillStyle, this.state.globalAlpha);
    if (color[3] <= 0)
      return;
    let vertices = [];
    let region = rectToPolygon({ x, y, w, h }, this.state.transform);
    pushPaintedRegion(vertices, region, color);
    this.enqueueShadowVertices(vertices);
    this.addGeometry(vertices);
  }
  strokeRect(x, y, w, h) {
    let path = new GPUPath();
    path.rect(x, y, w, h);
    this.stroke(path);
  }
  addGeometry(vertices, kind = "draw") {
    if (vertices.length == 0)
      return;
    vertices = clipVertices(vertices, this.state.clipRegions);
    if (vertices.length == 0)
      return;
    this.frameCommandsReleased = false;
    this.memoryTrimToken++;
    let composite = kind == "clear" ? "copy" : this.state.globalCompositeOperation;
    let prev = this.commands[this.commands.length - 1];
    if (kind != "clear" && prev != null && prev.kind != "image" && prev.kind == kind && prev.composite == composite && vertices.length <= 4096 && prev.vertices.length <= 262144)
      appendNumericArray(prev.vertices, vertices);
    else
      this.commands.push({ vertices, kind, composite });
  }
  isPointInPath(path, x, y, fillRule = "nonzero") {
    if (typeof path == "number") {
      fillRule = y || "nonzero";
      y = x;
      x = path;
      path = this.path;
    } else if (typeof path == "string") {
      fillRule = path;
      path = this.path;
    }
    x = Number(x);
    y = Number(y);
    if (!Number.isFinite(x) || !Number.isFinite(y))
      return false;
    let point = [x, y];
    let polygons = (path?.toSubpaths?.() || []).map((sub) => sub.map((p) => transformPoint(this.state.transform, p[0], p[1])));
    return fillContainsPoint(point, polygons, fillRule);
  }
  isPointInStroke(path, x, y) {
    if (typeof path == "number") {
      y = x;
      x = path;
      path = this.path;
    }
    x = Number(x);
    y = Number(y);
    if (!Number.isFinite(x) || !Number.isFinite(y))
      return false;
    let m = this.state.transform;
    let width = Math.max(0.01, this.state.lineWidth * transformScale(m));
    let half = width / 2;
    let px = x;
    let py = y;
    for (let sub of path?.toSubpaths?.() || []) {
      let pts = sub.map((p) => transformPoint(m, p[0], p[1]));
      for (let i = 1; i < pts.length; i++) {
        let a = pts[i - 1];
        let b = pts[i];
        let dx = b[0] - a[0];
        let dy = b[1] - a[1];
        let len2 = dx * dx + dy * dy || 1;
        let t = clamp01(((px - a[0]) * dx + (py - a[1]) * dy) / len2);
        let qx = a[0] + dx * t;
        let qy = a[1] + dy * t;
        if (Math.hypot(px - qx, py - qy) <= half + EPS)
          return true;
      }
    }
    return false;
  }
  strokeText(text, x, y, maxWidth) {
    this.drawText(text, x, y, true, maxWidth);
  }
  fillText(text, x, y, maxWidth) {
    this.drawText(text, x, y, false, maxWidth);
  }
  drawText(text, x, y, stroke, maxWidth) {
    if (this.textLayer == null || text == null)
      return;
    if (!Number.isFinite(x) || !Number.isFinite(y))
      return;
    let [tx, ty] = transformPoint(this.state.transform, x, y);
    if (!pointInClipRegions([tx, ty], this.state.clipRegions))
      return;
    let origin = this.textOrigin(this.state.textAlign, this.state.textBaseline, this.state.direction);
    let div = document.createElement("div");
    let paint = stroke ? this.state.strokeStyle : this.state.fillStyle;
    div.textContent = text;
    div.style.position = "absolute";
    div.style.left = tx / this.pixelRatio + "px";
    div.style.top = ty / this.pixelRatio + "px";
    div.dataset.uplotX = String(tx);
    div.dataset.uplotY = String(ty);
    div.style.color = cssColor(paint, tx, ty, this.state.globalAlpha);
    div.style.font = cssFont(this.state.font, this.pixelRatio);
    div.style.whiteSpace = "pre";
    div.style.transformOrigin = "0 0";
    div.style.opacity = typeof paint == "object" ? "1" : String(this.state.globalAlpha);
    div.style.lineHeight = "normal";
    div.style.willChange = "transform";
    div.style.userSelect = "none";
    div.style.direction = this.state.direction;
    div.style.filter = filterStyleValue(this.state.filter);
    div.style.fontKerning = this.state.fontKerning;
    div.style.fontStretch = this.state.fontStretch;
    div.style.fontVariantCaps = this.state.fontVariantCaps;
    div.style.letterSpacing = this.state.letterSpacing;
    div.style.textRendering = this.state.textRendering;
    div.style.wordSpacing = this.state.wordSpacing;
    if (stroke) {
      div.style.webkitTextFillColor = "transparent";
      div.style.webkitTextStrokeColor = cssColor(this.state.strokeStyle, tx, ty, this.state.globalAlpha);
      div.style.webkitTextStrokeWidth = Math.max(1, this.state.lineWidth / this.pixelRatio) + "px";
    }
    if (hasActiveShadow(this.state)) {
      let [sdx, sdy] = this.shadowOffsetVector();
      div.style.textShadow = `${sdx / this.pixelRatio}px ${sdy / this.pixelRatio}px ${Math.max(0, this.state.shadowBlur || 0) / this.pixelRatio}px ${cssColor(this.state.shadowColor, tx, ty, this.state.globalAlpha)}`;
    }
    let [a, b, c, d] = this.state.transform;
    let linear = Math.abs(a - 1) > 1e-6 || Math.abs(b) > 1e-6 || Math.abs(c) > 1e-6 || Math.abs(d - 1) > 1e-6 ? ` matrix(${a}, ${b}, ${c}, ${d}, 0, 0)` : "";
    let maxScale = "";
    maxWidth = Number(maxWidth);
    if (Number.isFinite(maxWidth) && maxWidth > 0) {
      let metrics = this.measureText(text);
      if (metrics.width > maxWidth)
        maxScale = ` scaleX(${maxWidth / metrics.width})`;
    }
    div.style.transform = `translate(${origin.x}, ${origin.y})${linear}${maxScale}`;
    this.textLayer.appendChild(div);
  }
  textOrigin(align, baseline, direction = "inherit") {
    let rtl = direction == "rtl" || direction == "inherit" && typeof document != "undefined" && document.dir == "rtl";
    let logicalAlign = align == "start" ? rtl ? "right" : "left" : align == "end" ? rtl ? "left" : "right" : align;
    let x = logicalAlign == "center" ? "-50%" : logicalAlign == "right" ? "-100%" : "0";
    let y = "0";
    if (baseline == "middle")
      y = "-50%";
    else if (baseline == "bottom")
      y = "-100%";
    else if (baseline == "alphabetic")
      y = "-0.78em";
    else if (baseline == "ideographic")
      y = "-0.9em";
    else if (baseline == "hanging")
      y = "-0.2em";
    return { x, y };
  }
  measureText(text) {
    let key = [this.state.font, this.state.fontKerning, this.state.fontStretch, this.state.fontVariantCaps, this.state.letterSpacing, this.state.textRendering, this.state.wordSpacing, text].join("\n");
    let width = this.textMeasureCache.get(key);
    if (width == null) {
      width = measureTextWithDom(this.state.font, text, this.state);
      if (width == null) {
        let size2 = extractFontPx(this.state.font);
        width = String(text).length * size2 * 0.56;
      }
      if (this.textMeasureCache.size > 2e3)
        this.textMeasureCache.clear();
      this.textMeasureCache.set(key, width);
    }
    let size = extractFontPx(this.state.font);
    return {
      width,
      actualBoundingBoxLeft: 0,
      actualBoundingBoxRight: width,
      actualBoundingBoxAscent: size * 0.8,
      actualBoundingBoxDescent: size * 0.2,
      fontBoundingBoxAscent: size,
      fontBoundingBoxDescent: size * 0.25,
      emHeightAscent: size * 0.8,
      emHeightDescent: size * 0.2
    };
  }
  destroy() {
    this.disposed = true;
    this.initEpoch++;
    this.ready = false;
    this.context?.unconfigure?.();
    this.releaseGPUResources();
    this.imageBindGroupLayout = null;
    this.bindGroupLayout = null;
    this.pipelineLayout = null;
    this.context = null;
    this.device = null;
    this.adapter = null;
    this.textLayer?.remove?.();
    this.textLayer = null;
  }
  parseColor(str, alpha = 1) {
    if (str == null || str === "transparent")
      return TRANSPARENT;
    if (typeof str == "object" && str.colorAt) {
      return {
        colorAt(x, y) {
          return str.colorAt(x, y, alpha);
        }
      };
    }
    let key = colorKey(str, alpha);
    let cached = this.colorCache.get(key);
    if (cached != null)
      return cached;
    let color = parsePlainCssColor(str);
    color = applyAlpha(color || DEFAULT_COLOR, alpha);
    if (this.colorCache.size > this.memory.maxColorCacheEntries)
      this.colorCache.clear();
    this.colorCache.set(key, color);
    return color;
  }
  createLinearGradient(x0, y0, x1, y1) {
    let a = transformPoint(this.state.transform, x0, y0);
    let b = transformPoint(this.state.transform, x1, y1);
    return makeLinearGradient(a[0], a[1], b[0], b[1]);
  }
  createRadialGradient(x0, y0, r0, x1, y1, r1) {
    let a = transformPoint(this.state.transform, x0, y0);
    let b = transformPoint(this.state.transform, x1, y1);
    let scale = transformScale(this.state.transform);
    return makeRadialGradient(a[0], a[1], r0 * scale, b[0], b[1], r1 * scale);
  }
  createConicGradient(startAngle, x, y) {
    let c = transformPoint(this.state.transform, x, y);
    let stops = [];
    return {
      addColorStop(offset, color) {
        stops.push({ offset, color });
      },
      colorAt(px, py, alpha = 1) {
        let ang = Math.atan2(py - c[1], px - c[0]) - startAngle;
        let t = (ang / (Math.PI * 2) % 1 + 1) % 1;
        return sampleStops(normalizeStops(stops), t, alpha);
      }
    };
  }
  get strokeStyle() {
    return this.state.strokeStyle;
  }
  set strokeStyle(v) {
    this.state.strokeStyle = v;
  }
  get fillStyle() {
    return this.state.fillStyle;
  }
  set fillStyle(v) {
    this.state.fillStyle = v;
  }
  get lineWidth() {
    return this.state.lineWidth;
  }
  set lineWidth(v) {
    v = Number(v);
    if (Number.isFinite(v) && v >= 0)
      this.state.lineWidth = v;
  }
  get lineJoin() {
    return this.state.lineJoin;
  }
  set lineJoin(v) {
    this.state.lineJoin = validEnum(v, ["round", "bevel", "miter"], this.state.lineJoin);
  }
  get lineCap() {
    return this.state.lineCap;
  }
  set lineCap(v) {
    this.state.lineCap = validEnum(v, ["butt", "round", "square"], this.state.lineCap);
  }
  get font() {
    return this.state.font;
  }
  set font(v) {
    if (v != null && String(v).trim() !== "") this.state.font = String(v);
  }
  get textAlign() {
    return this.state.textAlign;
  }
  set textAlign(v) {
    this.state.textAlign = validEnum(v, ["start", "end", "left", "right", "center"], this.state.textAlign);
  }
  get textBaseline() {
    return this.state.textBaseline;
  }
  set textBaseline(v) {
    this.state.textBaseline = validEnum(v, ["top", "hanging", "middle", "alphabetic", "ideographic", "bottom"], this.state.textBaseline);
  }
  get globalAlpha() {
    return this.state.globalAlpha;
  }
  set globalAlpha(v) {
    v = Number(v);
    if (Number.isFinite(v))
      this.state.globalAlpha = clamp01(v);
  }
  get lineDashOffset() {
    return this.state.lineDashOffset;
  }
  set lineDashOffset(v) {
    v = Number(v);
    this.state.lineDashOffset = Number.isFinite(v) ? v : 0;
  }
  get miterLimit() {
    return this.state.miterLimit;
  }
  set miterLimit(v) {
    v = Number(v);
    if (Number.isFinite(v) && v > 0)
      this.state.miterLimit = v;
  }
  get imageSmoothingEnabled() {
    return this.state.imageSmoothingEnabled;
  }
  set imageSmoothingEnabled(v) {
    this.state.imageSmoothingEnabled = !!v;
    if (this.runtime != null)
      this.sampler = getRuntimeSampler(this.runtime, this.state.imageSmoothingEnabled, this.state.imageSmoothingQuality);
  }
  get imageSmoothingQuality() {
    return this.state.imageSmoothingQuality;
  }
  set imageSmoothingQuality(v) {
    this.state.imageSmoothingQuality = normalizeImageSmoothingQuality(v);
    if (this.runtime != null)
      this.sampler = getRuntimeSampler(this.runtime, this.state.imageSmoothingEnabled, this.state.imageSmoothingQuality);
  }
  get fontKerning() {
    return this.state.fontKerning;
  }
  set fontKerning(v) {
    this.state.fontKerning = v == null ? "auto" : String(v);
  }
  get fontStretch() {
    return this.state.fontStretch;
  }
  set fontStretch(v) {
    this.state.fontStretch = v == null ? "normal" : String(v);
  }
  get fontVariantCaps() {
    return this.state.fontVariantCaps;
  }
  set fontVariantCaps(v) {
    this.state.fontVariantCaps = v == null ? "normal" : String(v);
  }
  get letterSpacing() {
    return this.state.letterSpacing;
  }
  set letterSpacing(v) {
    this.state.letterSpacing = v == null ? "0px" : String(v);
  }
  get textRendering() {
    return this.state.textRendering;
  }
  set textRendering(v) {
    this.state.textRendering = v == null ? "auto" : String(v);
  }
  get wordSpacing() {
    return this.state.wordSpacing;
  }
  set wordSpacing(v) {
    this.state.wordSpacing = v == null ? "0px" : String(v);
  }
  get globalCompositeOperation() {
    return this.state.globalCompositeOperation;
  }
  set globalCompositeOperation(v) {
    this.state.globalCompositeOperation = clampCompositeMode(v);
  }
  get shadowColor() {
    return this.state.shadowColor;
  }
  set shadowColor(v) {
    this.state.shadowColor = v;
  }
  get shadowBlur() {
    return this.state.shadowBlur;
  }
  set shadowBlur(v) {
    v = Number(v);
    this.state.shadowBlur = Number.isFinite(v) && v > 0 ? v : 0;
  }
  get shadowOffsetX() {
    return this.state.shadowOffsetX;
  }
  set shadowOffsetX(v) {
    v = Number(v);
    this.state.shadowOffsetX = Number.isFinite(v) ? v : 0;
  }
  get shadowOffsetY() {
    return this.state.shadowOffsetY;
  }
  set shadowOffsetY(v) {
    v = Number(v);
    this.state.shadowOffsetY = Number.isFinite(v) ? v : 0;
  }
  get direction() {
    return this.state.direction;
  }
  set direction(v) {
    this.state.direction = v || "inherit";
  }
  get filter() {
    return this.state.filter;
  }
  set filter(v) {
    this.state.filter = filterStyleValue(v);
  }
}
const WebGPURendererInternals = {
  blendForComposite,
  clampCompositeMode,
  clipVertices,
  fillContainsPoint,
  normalizeDirtyRect,
  normalizeImageRect,
  normalizeReadRect,
  alignBytesPerRow,
  getSharedRuntimeStats: () => WebGPURenderer.getSharedRuntimeStats(),
  setSharedRuntimeEnabled: (enabled) => WebGPURenderer.setSharedRuntimeEnabled(enabled),
  getLastFrameStats: (renderer) => renderer?.getLastFrameStats?.() || null,
  getMemoryStats: (renderer) => renderer?.getMemoryStats?.() || null,
  trimMemory: (renderer) => renderer?.trimMemory?.() || null,
  parsePlainCssColor,
  pathToClipRegions,
  pointInPolygon,
  triangulate,
  windingNumber
};
var WebGPURenderer_default = WebGPURenderer;
export {
  WebGPURenderer,
  WebGPURendererInternals,
  WebGPURenderer_default as default
};

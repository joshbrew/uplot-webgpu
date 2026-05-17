const TAU = Math.PI * 2;
const EPS = 1e-9;

function cloneCommand(cmd) {
	return cmd.slice();
}

function isFiniteNumber(v) {
	return typeof v == 'number' && Number.isFinite(v);
}

function allFinite(vals) {
	for (let v of vals) {
		if (!isFiniteNumber(v))
			return false;
	}
	return true;
}

function dist(a, b, c, d) {
	let dx = c - a;
	let dy = d - b;
	return Math.sqrt(dx * dx + dy * dy);
}

function cubicAt(a, b, c, d, t) {
	let mt = 1 - t;
	return mt * mt * mt * a + 3 * mt * mt * t * b + 3 * mt * t * t * c + t * t * t * d;
}

function normalizeAngle(a) {
	while (a < 0)
		a += TAU;
	while (a >= TAU)
		a -= TAU;
	return a;
}

function arcSweep(start, end, ccw) {
	let raw = end - start;

	if (!Number.isFinite(raw))
		return 0;

	if (!ccw && raw >= TAU)
		return TAU;
	if (ccw && raw <= -TAU)
		return -TAU;

	start = normalizeAngle(start);
	end = normalizeAngle(end);

	let sweep = end - start;

	if (!ccw && sweep < 0)
		sweep += TAU;
	else if (ccw && sweep > 0)
		sweep -= TAU;

	return sweep;
}


function matrixFrom(transform) {
	if (transform == null)
		return null;

	if (Array.isArray(transform))
		return transform;

	if (typeof DOMMatrix != 'undefined' && transform instanceof DOMMatrix)
		return [transform.a, transform.b, transform.c, transform.d, transform.e, transform.f];

	if (typeof transform == 'object')
		return [transform.a, transform.b, transform.c, transform.d, transform.e, transform.f];

	return null;
}

function applyMatrix(m, x, y) {
	return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

function ellipsePoint(cx, cy, rx, ry, rotation, angle) {
	let ca = Math.cos(angle);
	let sa = Math.sin(angle);
	let cr = Math.cos(rotation);
	let sr = Math.sin(rotation);
	let x = rx * ca;
	let y = ry * sa;
	return [cx + x * cr - y * sr, cy + x * sr + y * cr];
}

function normalizeRadii(radii) {
	if (radii == null)
		return [0, 0, 0, 0];

	if (typeof radii == 'number')
		return [radii, radii, radii, radii];

	let arr = Array.isArray(radii) ? radii : [radii];
	let vals = arr.map(v => typeof v == 'number' ? v : Math.max(v.x || 0, v.y || 0));

	if (vals.length == 1)
		return [vals[0], vals[0], vals[0], vals[0]];
	if (vals.length == 2)
		return [vals[0], vals[1], vals[0], vals[1]];
	if (vals.length == 3)
		return [vals[0], vals[1], vals[2], vals[1]];

	return [vals[0], vals[1], vals[2], vals[3]];
}

function pushPoint(points, x, y) {
	let p = points[points.length - 1];

	if (p == null || Math.abs(p[0] - x) > EPS || Math.abs(p[1] - y) > EPS)
		points.push([x, y]);
}

export class GPUPath {
	constructor(copyFrom) {
		this.cmds = [];
		this._x = 0;
		this._y = 0;
		this._sx = 0;
		this._sy = 0;
		this._hasPoint = false;

		if (copyFrom != null) {
			if (copyFrom instanceof GPUPath)
				this.cmds = copyFrom.cmds.map(cloneCommand);
			else if (copyFrom.cmds)
				this.cmds = copyFrom.cmds.map(cloneCommand);
			this.syncCurrentFromCommands();
		}
	}

	clear() {
		this.cmds.length = 0;
		this._x = 0;
		this._y = 0;
		this._sx = 0;
		this._sy = 0;
		this._hasPoint = false;
		return this;
	}

	syncCurrentFromCommands() {
		this._x = 0;
		this._y = 0;
		this._sx = 0;
		this._sy = 0;
		this._hasPoint = false;

		for (let cmd of this.cmds) {
			let type = cmd[0];

			if (type == 0) {
				this._x = this._sx = cmd[1];
				this._y = this._sy = cmd[2];
				this._hasPoint = true;
			}
			else if (type == 1) {
				this._x = cmd[1];
				this._y = cmd[2];
				if (!this._hasPoint) {
					this._sx = this._x;
					this._sy = this._y;
					this._hasPoint = true;
				}
			}
			else if (type == 2) {
				this._x = cmd[5];
				this._y = cmd[6];
				if (!this._hasPoint) {
					this._sx = this._x;
					this._sy = this._y;
					this._hasPoint = true;
				}
			}
			else if (type == 3) {
				let end = cmd[5];
				this._x = cmd[1] + Math.cos(end) * cmd[3];
				this._y = cmd[2] + Math.sin(end) * cmd[3];
				if (!this._hasPoint) {
					let start = cmd[4];
					this._sx = cmd[1] + Math.cos(start) * cmd[3];
					this._sy = cmd[2] + Math.sin(start) * cmd[3];
					this._hasPoint = true;
				}
			}
			else if (type == 4) {
				this._x = this._sx = cmd[1];
				this._y = this._sy = cmd[2];
				this._hasPoint = true;
			}
			else if (type == 5) {
				if (this._hasPoint) {
					this._x = this._sx;
					this._y = this._sy;
				}
			}
			else if (type == 6) {
				let ep = ellipsePoint(cmd[1], cmd[2], cmd[3], cmd[4], cmd[5], cmd[7]);
				this._x = ep[0];
				this._y = ep[1];
				if (!this._hasPoint) {
					let sp = ellipsePoint(cmd[1], cmd[2], cmd[3], cmd[4], cmd[5], cmd[6]);
					this._sx = sp[0];
					this._sy = sp[1];
					this._hasPoint = true;
				}
			}
		}
	}

	moveTo(x, y) {
		if (!allFinite([x, y]))
			return;
		this.cmds.push([0, x, y]);
		this._x = this._sx = x;
		this._y = this._sy = y;
		this._hasPoint = true;
	}

	lineTo(x, y) {
		if (!allFinite([x, y]))
			return;
		if (!this._hasPoint)
			this.moveTo(x, y);
		else {
			this.cmds.push([1, x, y]);
			this._x = x;
			this._y = y;
		}
	}

	bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x, y) {
		if (!allFinite([cp1x, cp1y, cp2x, cp2y, x, y]))
			return;
		if (!this._hasPoint)
			this.moveTo(x, y);
		else {
			this.cmds.push([2, cp1x, cp1y, cp2x, cp2y, x, y]);
			this._x = x;
			this._y = y;
		}
	}

	quadraticCurveTo(cpx, cpy, x, y) {
		if (!allFinite([cpx, cpy, x, y]))
			return;
		if (!this._hasPoint)
			this.moveTo(x, y);
		else {
			let cp1x = this._x + (2 / 3) * (cpx - this._x);
			let cp1y = this._y + (2 / 3) * (cpy - this._y);
			let cp2x = x + (2 / 3) * (cpx - x);
			let cp2y = y + (2 / 3) * (cpy - y);
			this.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x, y);
		}
	}

	arc(x, y, r, startAngle, endAngle, counterclockwise = false) {
		if (!allFinite([x, y, r, startAngle, endAngle]) || r <= 0)
			return;

		this.cmds.push([3, x, y, r, startAngle, endAngle, counterclockwise ? 1 : 0]);

		let ex = x + Math.cos(endAngle) * r;
		let ey = y + Math.sin(endAngle) * r;

		if (!this._hasPoint) {
			this._sx = x + Math.cos(startAngle) * r;
			this._sy = y + Math.sin(startAngle) * r;
			this._hasPoint = true;
		}

		this._x = ex;
		this._y = ey;
	}

	ellipse(x, y, radiusX, radiusY, rotation, startAngle, endAngle, counterclockwise = false) {
		if (!allFinite([x, y, radiusX, radiusY, rotation, startAngle, endAngle]) || radiusX <= 0 || radiusY <= 0)
			return;

		this.cmds.push([6, x, y, radiusX, radiusY, rotation, startAngle, endAngle, counterclockwise ? 1 : 0]);

		let start = ellipsePoint(x, y, radiusX, radiusY, rotation, startAngle);
		let end = ellipsePoint(x, y, radiusX, radiusY, rotation, endAngle);

		if (!this._hasPoint) {
			this._sx = start[0];
			this._sy = start[1];
			this._hasPoint = true;
		}

		this._x = end[0];
		this._y = end[1];
	}

	roundRect(x, y, w, h, radii = 0) {
		if (!allFinite([x, y, w, h]))
			return;
		let [tl, tr, br, bl] = normalizeRadii(radii);
		let maxR = Math.min(Math.abs(w), Math.abs(h)) / 2;
		tl = Math.min(Math.max(0, tl), maxR);
		tr = Math.min(Math.max(0, tr), maxR);
		br = Math.min(Math.max(0, br), maxR);
		bl = Math.min(Math.max(0, bl), maxR);

		let x0 = x;
		let y0 = y;
		let x1 = x + w;
		let y1 = y + h;

		if (w < 0)
			[x0, x1] = [x1, x0];
		if (h < 0)
			[y0, y1] = [y1, y0];

		this.moveTo(x0 + tl, y0);
		this.lineTo(x1 - tr, y0);
		tr > 0 ? this.arcTo(x1, y0, x1, y0 + tr, tr) : this.lineTo(x1, y0);
		this.lineTo(x1, y1 - br);
		br > 0 ? this.arcTo(x1, y1, x1 - br, y1, br) : this.lineTo(x1, y1);
		this.lineTo(x0 + bl, y1);
		bl > 0 ? this.arcTo(x0, y1, x0, y1 - bl, bl) : this.lineTo(x0, y1);
		this.lineTo(x0, y0 + tl);
		tl > 0 ? this.arcTo(x0, y0, x0 + tl, y0, tl) : this.lineTo(x0, y0);
		this.closePath();
	}

	arcTo(x1, y1, x2, y2, r) {
		if (!allFinite([x1, y1, x2, y2, r]))
			return;
		if (!this._hasPoint || r <= 0) {
			this.lineTo(x1, y1);
			return;
		}

		let x0 = this._x;
		let y0 = this._y;
		let v0x = x0 - x1;
		let v0y = y0 - y1;
		let v1x = x2 - x1;
		let v1y = y2 - y1;
		let l0 = Math.hypot(v0x, v0y);
		let l1 = Math.hypot(v1x, v1y);

		if (l0 < EPS || l1 < EPS) {
			this.lineTo(x1, y1);
			return;
		}

		v0x /= l0;
		v0y /= l0;
		v1x /= l1;
		v1y /= l1;

		let dot = Math.max(-1, Math.min(1, v0x * v1x + v0y * v1y));
		let angle = Math.acos(dot);

		if (angle < EPS || Math.abs(Math.PI - angle) < EPS) {
			this.lineTo(x1, y1);
			return;
		}

		let tangent = Math.min(l0, l1, r / Math.tan(angle / 2));
		let sx = x1 + v0x * tangent;
		let sy = y1 + v0y * tangent;
		let ex = x1 + v1x * tangent;
		let ey = y1 + v1y * tangent;
		let bisX = v0x + v1x;
		let bisY = v0y + v1y;
		let bisLen = Math.hypot(bisX, bisY);

		if (bisLen < EPS) {
			this.lineTo(x1, y1);
			return;
		}

		let centerDist = r / Math.sin(angle / 2);
		let cx = x1 + bisX / bisLen * centerDist;
		let cy = y1 + bisY / bisLen * centerDist;
		let start = Math.atan2(sy - cy, sx - cx);
		let end = Math.atan2(ey - cy, ex - cx);
		let cross = (sx - cx) * (ey - cy) - (sy - cy) * (ex - cx);

		this.lineTo(sx, sy);
		this.arc(cx, cy, r, start, end, cross < 0);
	}

	rect(x, y, w, h) {
		if (!allFinite([x, y, w, h]))
			return;
		this.cmds.push([4, x, y, w, h]);
		this._x = x;
		this._y = y;
		this._sx = x;
		this._sy = y;
		this._hasPoint = true;
	}

	closePath() {
		if (!this._hasPoint)
			return;
		this.cmds.push([5]);
		this._x = this._sx;
		this._y = this._sy;
	}

	isEmpty() {
		return this.cmds.length == 0;
	}

	clone() {
		return new GPUPath(this);
	}

	addPath(path, transform = null) {
		if (path == null)
			return;

		let matrix = matrixFrom(transform);

		if (matrix == null && path.cmds != null) {
			for (let cmd of path.cmds)
				this.cmds.push(cloneCommand(cmd));
			this.syncCurrentFromCommands();
			return;
		}

		let subpaths = path.toSubpaths?.() || [];

		for (let sub of subpaths) {
			for (let i = 0; i < sub.length; i++) {
				let p = matrix == null ? sub[i] : applyMatrix(matrix, sub[i][0], sub[i][1]);
				if (i == 0)
					this.moveTo(p[0], p[1]);
				else
					this.lineTo(p[0], p[1]);
			}
			if (sub.closed)
				this.closePath();
		}
	}

	getRects() {
		let rects = [];

		for (let cmd of this.cmds) {
			if (cmd[0] != 4)
				return null;

			let x = cmd[1];
			let y = cmd[2];
			let w = cmd[3];
			let h = cmd[4];
			let winding = Math.sign(w * h) || 0;

			if (w < 0) {
				x += w;
				w = -w;
			}

			if (h < 0) {
				y += h;
				h = -h;
			}

			rects.push({x, y, w, h, winding});
		}

		return rects;
	}

	toSubpaths(curveSteps = 12) {
		let paths = [];
		let pts = [];
		let x = 0;
		let y = 0;
		let sx = 0;
		let sy = 0;
		let hasPoint = false;

		function flush(closed = false) {
			if (pts.length > 0) {
				pts.closed = closed;
				paths.push(pts);
				pts = [];
			}
		}

		for (let cmd of this.cmds) {
			let type = cmd[0];

			if (type == 0) {
				flush();
				x = sx = cmd[1];
				y = sy = cmd[2];
				hasPoint = true;
				pushPoint(pts, x, y);
			}
			else if (type == 1) {
				x = cmd[1];
				y = cmd[2];
				if (!hasPoint) {
					sx = x;
					sy = y;
					hasPoint = true;
				}
				pushPoint(pts, x, y);
			}
			else if (type == 2) {
				if (!hasPoint) {
					x = sx = cmd[5];
					y = sy = cmd[6];
					hasPoint = true;
					pushPoint(pts, x, y);
					continue;
				}

				let x0 = x;
				let y0 = y;
				let cp1x = cmd[1];
				let cp1y = cmd[2];
				let cp2x = cmd[3];
				let cp2y = cmd[4];
				let x1 = cmd[5];
				let y1 = cmd[6];
				let approxLen = dist(x0, y0, cp1x, cp1y) + dist(cp1x, cp1y, cp2x, cp2y) + dist(cp2x, cp2y, x1, y1);
				let steps = Math.max(4, Math.min(48, Math.ceil(approxLen / 12), curveSteps));

				for (let i = 1; i <= steps; i++) {
					let t = i / steps;
					pushPoint(pts,
						cubicAt(x0, cp1x, cp2x, x1, t),
						cubicAt(y0, cp1y, cp2y, y1, t),
					);
				}

				x = x1;
				y = y1;
			}
			else if (type == 3) {
				let cx = cmd[1];
				let cy = cmd[2];
				let r = cmd[3];
				let start = cmd[4];
				let end = cmd[5];
				let ccw = cmd[6] == 1;
				let sweep = arcSweep(start, end, ccw);
				let steps = Math.max(8, Math.ceil(Math.abs(sweep) * r / 6));
				let sx0 = cx + Math.cos(start) * r;
				let sy0 = cy + Math.sin(start) * r;

				if (!hasPoint) {
					hasPoint = true;
					sx = sx0;
					sy = sy0;
				}

				pushPoint(pts, sx0, sy0);

				for (let i = 1; i <= steps; i++) {
					let a = start + sweep * i / steps;
					pushPoint(pts, cx + Math.cos(a) * r, cy + Math.sin(a) * r);
				}

				x = cx + Math.cos(end) * r;
				y = cy + Math.sin(end) * r;
			}
			else if (type == 6) {
				let cx = cmd[1];
				let cy = cmd[2];
				let rx = cmd[3];
				let ry = cmd[4];
				let rotation = cmd[5];
				let start = cmd[6];
				let end = cmd[7];
				let ccw = cmd[8] == 1;
				let sweep = arcSweep(start, end, ccw);
				let steps = Math.max(12, Math.ceil(Math.abs(sweep) * Math.max(rx, ry) / 6));
				let sp = ellipsePoint(cx, cy, rx, ry, rotation, start);

				if (!hasPoint) {
					hasPoint = true;
					sx = sp[0];
					sy = sp[1];
				}

				pushPoint(pts, sp[0], sp[1]);

				for (let i = 1; i <= steps; i++) {
					let p = ellipsePoint(cx, cy, rx, ry, rotation, start + sweep * i / steps);
					pushPoint(pts, p[0], p[1]);
				}

				let ep = ellipsePoint(cx, cy, rx, ry, rotation, end);
				x = ep[0];
				y = ep[1];
			}
			else if (type == 4) {
				flush();
				let rx = cmd[1];
				let ry = cmd[2];
				let rw = cmd[3];
				let rh = cmd[4];
				pts = [[rx, ry], [rx + rw, ry], [rx + rw, ry + rh], [rx, ry + rh], [rx, ry]];
				flush(true);
				x = sx = rx;
				y = sy = ry;
				hasPoint = true;
			}
			else if (type == 5) {
				if (!hasPoint)
					continue;
				pushPoint(pts, sx, sy);
				x = sx;
				y = sy;
				flush(true);
				hasPoint = true;
			}
		}

		flush();
		return paths;
	}
}

export default GPUPath;

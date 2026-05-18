import {
	OFF,
} from './domClasses';

import {
	change,
	dppxchange,
} from './strings';

export const domEnv = typeof window != 'undefined';

export const doc = domEnv ? document  : null;
export const win = domEnv ? window    : null;

export let pxRatio;

//export const canHover = domEnv && !win.matchMedia('(hover: none)').matches;

let query;

function setPxRatio() {
	let _pxRatio = devicePixelRatio;

	// during print preview, Chrome fires off these dppx queries even without changes
	if (pxRatio != _pxRatio) {
		pxRatio = _pxRatio;

		query && off(change, query, setPxRatio);
		query = matchMedia(`(min-resolution: ${pxRatio - 0.001}dppx) and (max-resolution: ${pxRatio + 0.001}dppx)`);
		on(change, query, setPxRatio);

		win.dispatchEvent(new CustomEvent(dppxchange));
	}
}

export function addClass(el?: any, c?: any, ..._extra: any[]) {
	if (c != null) {
		let cl = el.classList;
		!cl.contains(c) && cl.add(c);
	}
}

export function remClass(el?: any, c?: any, ..._extra: any[]) {
	let cl = el.classList;
	cl.contains(c) && cl.remove(c);
}

export function setStylePx(el?: any, name?: any, value?: any, ..._extra: any[]) {
	el.style[name] = value + "px";
}

export function placeTag(tag?: any, cls?: any, targ?: any, refEl?: any, ..._extra: any[]) {
	let el = doc.createElement(tag);

	if (cls != null)
		addClass(el, cls);

	if (targ != null)
		targ.insertBefore(el, refEl);

	return el;
}

export function placeDiv(cls?: any, targ?: any, ..._extra: any[]) {
	return placeTag("div", cls, targ);
}

const xformCache = new WeakMap();

export function elTrans(el?: any, xPos?: any, yPos?: any, xMax?: any, yMax?: any, ..._extra: any[]) {
	let xform = "translate(" + xPos + "px," + yPos + "px)";
	let xformOld = xformCache.get(el);

	if (xform != xformOld) {
		el.style.transform = xform;
		xformCache.set(el, xform);

		if (xPos < 0 || yPos < 0 || xPos > xMax || yPos > yMax)
			addClass(el, OFF);
		else
			remClass(el, OFF);
	}
}

const colorCache = new WeakMap();

export function elColor(el?: any, background?: any, borderColor?: any, ..._extra: any[]) {
	let newColor = background + borderColor;
	let oldColor = colorCache.get(el);

	if (newColor != oldColor) {
		colorCache.set(el, newColor);
		el.style.background = background;
		el.style.borderColor = borderColor;
	}
}

const sizeCache = new WeakMap();

export function elSize(el?: any, newWid?: any, newHgt?: any, centered?: any, ..._extra: any[]) {
	let newSize = newWid + "" + newHgt;
	let oldSize = sizeCache.get(el);

	if (newSize != oldSize) {
		sizeCache.set(el, newSize);
		el.style.height = newHgt + "px";
		el.style.width = newWid + "px";
		el.style.marginLeft = centered ? -newWid/2 + "px" : 0;
		el.style.marginTop = centered ? -newHgt/2 + "px" : 0;
	}
}

const evOpts = {passive: true};
const evOpts2 = {...evOpts, capture: true};

export function on(ev?: any, el?: any, cb?: any, capt?: any, ..._extra: any[]) {
	el.addEventListener(ev, cb, capt ? evOpts2 : evOpts);
}

export function off(ev?: any, el?: any, cb?: any, capt?: any, ..._extra: any[]) {
	el.removeEventListener(ev, cb, capt ? evOpts2 : evOpts);
}

domEnv && setPxRatio();
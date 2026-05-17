export function rgbaImageDataToBmpBytes(imageData) {
	let width = Math.max(0, Math.floor(Number(imageData?.width) || 0));
	let height = Math.max(0, Math.floor(Number(imageData?.height) || 0));
	let data = imageData?.data || new Uint8ClampedArray(0);
	let rowStride = Math.ceil((width * 4) / 4) * 4;
	let pixelBytes = rowStride * height;
	let bytes = new Uint8Array(14 + 40 + pixelBytes);
	let view = new DataView(bytes.buffer);

	bytes[0] = 0x42;
	bytes[1] = 0x4d;
	view.setUint32(2, bytes.length, true);
	view.setUint32(10, 54, true);
	view.setUint32(14, 40, true);
	view.setInt32(18, width, true);
	view.setInt32(22, -height, true);
	view.setUint16(26, 1, true);
	view.setUint16(28, 32, true);
	view.setUint32(34, pixelBytes, true);

	let out = 54;
	for (let y = 0; y < height; y++) {
		let src = y * width * 4;
		for (let x = 0; x < width; x++) {
			let si = src + x * 4;
			let di = out + x * 4;
			bytes[di + 0] = data[si + 2] || 0;
			bytes[di + 1] = data[si + 1] || 0;
			bytes[di + 2] = data[si + 0] || 0;
			bytes[di + 3] = data[si + 3] == null ? 255 : data[si + 3];
		}
		out += rowStride;
	}

	return bytes;
}


function makeCrc32Table() {
	let table = new Uint32Array(256);
	for (let i = 0; i < 256; i++) {
		let c = i;
		for (let j = 0; j < 8; j++)
			c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		table[i] = c >>> 0;
	}
	return table;
}

const CRC32_TABLE = makeCrc32Table();

function crc32(bytes) {
	let c = 0xffffffff;
	for (let i = 0; i < bytes.length; i++)
		c = CRC32_TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

function adler32(bytes) {
	let a = 1;
	let b = 0;
	for (let i = 0; i < bytes.length; i++) {
		a = (a + bytes[i]) % 65521;
		b = (b + a) % 65521;
	}
	return ((b << 16) | a) >>> 0;
}

function writeU32(bytes, offset, value) {
	bytes[offset + 0] = (value >>> 24) & 255;
	bytes[offset + 1] = (value >>> 16) & 255;
	bytes[offset + 2] = (value >>> 8) & 255;
	bytes[offset + 3] = value & 255;
}

function asciiBytes(text) {
	let out = new Uint8Array(text.length);
	for (let i = 0; i < text.length; i++)
		out[i] = text.charCodeAt(i) & 255;
	return out;
}

function pngChunk(type, data) {
	let name = asciiBytes(type);
	let out = new Uint8Array(12 + data.length);
	writeU32(out, 0, data.length);
	out.set(name, 4);
	out.set(data, 8);
	let crcInput = new Uint8Array(name.length + data.length);
	crcInput.set(name, 0);
	crcInput.set(data, name.length);
	writeU32(out, out.length - 4, crc32(crcInput));
	return out;
}

function zlibStore(bytes) {
	let blocks = [];
	let total = 2 + 4;
	for (let pos = 0; pos < bytes.length; pos += 65535) {
		let len = Math.min(65535, bytes.length - pos);
		let block = new Uint8Array(5 + len);
		block[0] = pos + len >= bytes.length ? 1 : 0;
		block[1] = len & 255;
		block[2] = (len >>> 8) & 255;
		let nlen = (~len) & 65535;
		block[3] = nlen & 255;
		block[4] = (nlen >>> 8) & 255;
		block.set(bytes.subarray(pos, pos + len), 5);
		blocks.push(block);
		total += block.length;
	}

	let out = new Uint8Array(total);
	out[0] = 0x78;
	out[1] = 0x01;
	let o = 2;
	for (let block of blocks) {
		out.set(block, o);
		o += block.length;
	}
	writeU32(out, o, adler32(bytes));
	return out;
}

export function rgbaImageDataToPngBytes(imageData) {
	let width = Math.max(0, Math.floor(Number(imageData?.width) || 0));
	let height = Math.max(0, Math.floor(Number(imageData?.height) || 0));
	let data = imageData?.data || new Uint8ClampedArray(0);
	let raw = new Uint8Array((width * 4 + 1) * height);
	let dst = 0;
	let src = 0;
	for (let y = 0; y < height; y++) {
		raw[dst++] = 0;
		for (let x = 0; x < width; x++) {
			raw[dst++] = data[src++] || 0;
			raw[dst++] = data[src++] || 0;
			raw[dst++] = data[src++] || 0;
			let a = data[src++];
			raw[dst++] = a == null ? 255 : a;
		}
	}

	let ihdr = new Uint8Array(13);
	writeU32(ihdr, 0, width);
	writeU32(ihdr, 4, height);
	ihdr[8] = 8;
	ihdr[9] = 6;
	ihdr[10] = 0;
	ihdr[11] = 0;
	ihdr[12] = 0;

	let signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
	let chunks = [signature, pngChunk('IHDR', ihdr), pngChunk('IDAT', zlibStore(raw)), pngChunk('IEND', new Uint8Array(0))];
	let total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
	let out = new Uint8Array(total);
	let offset = 0;
	for (let chunk of chunks) {
		out.set(chunk, offset);
		offset += chunk.length;
	}
	return out;
}

export function normalizeExportType(type) {
	type = String(type || 'image/png').toLowerCase();
	return type == 'image/bmp' || type == 'image/x-ms-bmp' ? 'image/bmp' : 'image/png';
}

export function bytesToBase64(bytes) {
	if (typeof Buffer != 'undefined')
		return Buffer.from(bytes).toString('base64');

	let s = '';
	let chunk = 0x8000;
	for (let i = 0; i < bytes.length; i += chunk)
		s += String.fromCharCode(...bytes.subarray(i, i + chunk));
	return btoa(s);
}

export function bytesToBlob(bytes, type) {
	if (typeof Blob != 'undefined')
		return new Blob([bytes], {type});

	return {
		type,
		size: bytes.byteLength,
		async arrayBuffer() {
			return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
		},
	};
}

export function textToBlob(text, type) {
	if (typeof Blob != 'undefined')
		return new Blob([text], {type});

	let bytes = new TextEncoder().encode(text);
	return bytesToBlob(bytes, type);
}

export function escapeXmlAttr(value) {
	return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function encodeTextBase64(text) {
	if (typeof Buffer != 'undefined')
		return Buffer.from(text, 'utf8').toString('base64');

	let bytes = new TextEncoder().encode(text);
	return bytesToBase64(bytes);
}


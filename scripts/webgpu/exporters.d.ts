export function normalizeExportType(type?: string): string;
export function rgbaImageDataToBmpBytes(imageData: ImageData | {width: number; height: number; data: Uint8ClampedArray | Uint8Array}): Uint8Array;
export function rgbaImageDataToPngBytes(imageData: ImageData | {width: number; height: number; data: Uint8ClampedArray | Uint8Array}): Uint8Array;
export function bytesToBase64(bytes: Uint8Array): string;
export function bytesToBlob(bytes: Uint8Array, type: string): Blob | {type: string; size: number; arrayBuffer(): Promise<ArrayBuffer>};
export function textToBlob(text: string, type: string): Blob | {type: string; size: number; arrayBuffer(): Promise<ArrayBuffer>};
export function escapeXmlAttr(value: unknown): string;
export function encodeTextBase64(text: string): string;

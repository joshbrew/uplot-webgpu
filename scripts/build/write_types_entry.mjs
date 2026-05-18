// Demo: node scripts/build/write_types_entry.mjs

import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';

const root = resolve(new URL('../..', import.meta.url).pathname);
const distDir = resolve(root, 'dist');
const distTypesDir = resolve(distDir, 'types');
const uPlotTypeSource = resolve(root, 'scripts/uPlot.d.ts');
const uPlotTypeDest = resolve(distTypesDir, 'scripts/uPlot.d.ts');
const entryDest = resolve(distDir, 'uPlot.d.ts');

async function cleanTinybuildDeclarationMirrors() {
	await rm(resolve(distDir, 'index.d.ts'), {force: true});
	await rm(resolve(distDir, 'paths'), {recursive: true, force: true});
	await rm(resolve(distDir, 'scripts'), {recursive: true, force: true});
}

async function walkFiles(dir, out = []) {
	for (const item of await readdir(dir, {withFileTypes: true})) {
		const path = join(dir, item.name);
		if (item.isDirectory())
			await walkFiles(path, out);
		else
			out.push(path);
	}
	return out;
}

function normalizeDeclarationSpecifiers(text) {
	return text
		.replace(/((?:from|import)\s*\(?\s*["'][^"']+)\.ts(["'])/g, '$1.js$2')
		.replace(/(import\s*\(\s*["'][^"']+)\.ts(["']\s*\))/g, '$1.js$2');
}

function withWebGPUTypesReference(text) {
	return text.startsWith('/// <reference types="@webgpu/types" />') ? text : `/// <reference types="@webgpu/types" />\n${text}`;
}

await cleanTinybuildDeclarationMirrors();

await mkdir(dirname(uPlotTypeDest), {recursive: true});
await cp(uPlotTypeSource, uPlotTypeDest);
await rm(resolve(distTypesDir, 'scripts/webgpu/webgpu-ambient.d.ts'), {force: true});

for (const file of await walkFiles(distTypesDir)) {
	if (extname(file) != '.ts')
		continue;

	const text = await readFile(file, 'utf8');
	let normalized = normalizeDeclarationSpecifiers(text);

	if (file.includes('/scripts/webgpu/') || file.includes('\\scripts\\webgpu\\'))
		normalized = withWebGPUTypesReference(normalized);

	if (normalized != text)
		await writeFile(file, normalized);
}

await writeFile(entryDest, `/// <reference types="@webgpu/types" />

import uPlot from './types/scripts/uPlot.js';

export default uPlot;
export { uPlot };

export * from './types/scripts/webgpu/index.js';
export type * from './types/scripts/uPlot.js';
`);

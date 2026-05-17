// @ts-nocheck
export const CHART_WGSL = `
struct Uniforms {
	resolution: vec2<f32>,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct VertexIn {
	@location(0) pos: vec2<f32>,
	@location(1) color: vec4<f32>,
};

struct VertexOut {
	@builtin(position) position: vec4<f32>,
	@location(0) color: vec4<f32>,
};

@vertex
fn vsMain(input: VertexIn) -> VertexOut {
	var out: VertexOut;
	let clip = vec2<f32>(
		(input.pos.x / uniforms.resolution.x) * 2.0 - 1.0,
		1.0 - (input.pos.y / uniforms.resolution.y) * 2.0,
	);
	out.position = vec4<f32>(clip, 0.0, 1.0);
	out.color = input.color;
	return out;
}

@fragment
fn fsMain(input: VertexOut) -> @location(0) vec4<f32> {
	return input.color;
}
`;

export const IMAGE_WGSL = `
struct Uniforms {
	resolution: vec2<f32>,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(1) @binding(0) var imageSampler: sampler;
@group(1) @binding(1) var imageTexture: texture_2d<f32>;

struct VertexIn {
	@location(0) pos: vec2<f32>,
	@location(1) uv: vec2<f32>,
	@location(2) alpha: f32,
};

struct VertexOut {
	@builtin(position) position: vec4<f32>,
	@location(0) uv: vec2<f32>,
	@location(1) alpha: f32,
};

@vertex
fn vsImage(input: VertexIn) -> VertexOut {
	var out: VertexOut;
	let clip = vec2<f32>(
		(input.pos.x / uniforms.resolution.x) * 2.0 - 1.0,
		1.0 - (input.pos.y / uniforms.resolution.y) * 2.0,
	);
	out.position = vec4<f32>(clip, 0.0, 1.0);
	out.uv = input.uv;
	out.alpha = input.alpha;
	return out;
}

@fragment
fn fsImage(input: VertexOut) -> @location(0) vec4<f32> {
	let tex = textureSample(imageTexture, imageSampler, input.uv);
	let a = tex.a * input.alpha;
	return vec4<f32>(tex.rgb * a, a);
}
`;

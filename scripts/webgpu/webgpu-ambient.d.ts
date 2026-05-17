// Minimal WebGPU ambient declarations for TypeScript installs whose DOM lib does not include WebGPU yet.
type GPUDevice = any;
type GPUAdapter = any;
type GPUCanvasContext = any;
type GPUTextureFormat = string;
type GPUBuffer = any;
type GPURenderPipeline = any;
type GPUComputePipeline = any;
type GPUBindGroup = any;
type GPUBindGroupLayout = any;
type GPUPipelineLayout = any;
type GPUSampler = any;
type GPUTexture = any;
type GPUTextureView = any;
type GPUQueue = any;
type GPUCommandEncoder = any;
type GPURenderPassEncoder = any;
type GPUShaderModule = any;
type GPUBufferUsageFlags = number;
type GPUTextureUsageFlags = number;
type GPUShaderStageFlags = number;
type GPUMapModeFlags = number;
type GPUPowerPreference = 'low-power' | 'high-performance';
type GPUColor = any;
type GPUColorDict = any;
type GPUBlendState = any;
type GPUPrimitiveState = any;
type GPUVertexBufferLayout = any;
type GPUCanvasConfiguration = any;
type GPURequestAdapterOptions = any;
type GPUDeviceDescriptor = any;
type GPUAdapterInfo = Record<string, unknown>;

declare const GPUBufferUsage: any;
declare const GPUTextureUsage: any;
declare const GPUShaderStage: any;
declare const GPUMapMode: any;

interface Navigator {
  gpu?: any;
}

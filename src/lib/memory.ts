import { wasmMemory } from './wasm';

// Views are created fresh at each use: constructing a typed-array view is
// allocation-cheap and immune to detachment when wasm linear memory grows.

export function f32View(ptr: number, len: number): Float32Array {
  return new Float32Array(wasmMemory().buffer, ptr, len);
}

export function rgbaView(ptr: number, len: number): Uint8ClampedArray {
  return new Uint8ClampedArray(wasmMemory().buffer, ptr, len);
}

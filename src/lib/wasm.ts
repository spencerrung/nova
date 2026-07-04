import init, * as nova from '../../wasm/pkg/nova_wasm';

export type Nova = typeof nova;

let memory: WebAssembly.Memory | null = null;

export const bootStats = {
  /** fetch + streaming-compile + instantiate, measured around init() */
  initMs: 0,
  /** compressed transfer size of the .wasm payload */
  bytes: 0,
};

export async function initWasm(): Promise<Nova> {
  const t0 = performance.now();
  const out = await init();
  memory = out.memory;
  bootStats.initMs = performance.now() - t0;

  const entry = performance
    .getEntriesByType('resource')
    .find((e) => e.name.includes('.wasm')) as PerformanceResourceTiming | undefined;
  bootStats.bytes = entry?.encodedBodySize || entry?.decodedBodySize || 0;

  return nova;
}

export function wasmMemory(): WebAssembly.Memory {
  if (!memory) throw new Error('wasm not initialized');
  return memory;
}

// Framework-agnostic entry point for PDF compression. Everything runs locally in a Web Worker.

export type CompressionErrorCode = 'not-pdf' | 'encrypted' | 'failed' | 'engine' | 'timeout';
export type Preset = 'screen' | 'ebook' | 'printer';
export type Stage = 'loading-engine' | 'compressing';

export class CompressionError extends Error {
  code: CompressionErrorCode;

  constructor(code: CompressionErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

// Versioned file name: the engine is cached as immutable, so a new build must get a new URL
const ENGINE_URL = '/engine/ghostscript-10.08.0.wasm';
// Uncompressed size, for download progress (the response may be brotli-encoded without a usable Content-Length)
const ENGINE_BYTES = 15_875_454;
// Give up when the download receives nothing for this long
const STALL_MS = 30_000;
const TIMEOUT_MS = 5 * 60 * 1000;

let engine: Promise<WebAssembly.Module> | null = null;

// The spec allows junk before the header, readers accept it within the first 1 KB
const hasPdfHeader = (bytes: Uint8Array) => new TextDecoder('latin1').decode(bytes.subarray(0, 1024)).includes('%PDF-');
const progressListeners = new Set<(fraction: number) => void>();

async function downloadEngine(): Promise<WebAssembly.Module> {
  const controller = new AbortController();
  let stall = setTimeout(() => controller.abort(), STALL_MS);
  try {
    const response = await fetch(ENGINE_URL, { signal: controller.signal });
    if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);

    const bytes = new Uint8Array(ENGINE_BYTES);
    const reader = response.body.getReader();
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      clearTimeout(stall);
      stall = setTimeout(() => controller.abort(), STALL_MS);
      if (received + value.length > bytes.length) throw new Error('Engine is larger than expected');
      bytes.set(value, received);
      received += value.length;
      progressListeners.forEach((listener) => listener(received / ENGINE_BYTES));
    }
    if (received !== ENGINE_BYTES) throw new Error(`Engine download incomplete (${received} bytes)`);
    // Compile once here; the compiled module can be sent to every worker without copying or recompiling
    return await WebAssembly.compile(bytes);
  } catch (e) {
    const stalled = controller.signal.aborted;
    throw new CompressionError('engine', stalled ? 'The engine download stalled.' : String(e));
  } finally {
    clearTimeout(stall);
  }
}

/** Download and compile the engine once per page; later calls share the result. */
function loadEngine(onProgress?: (fraction: number) => void): Promise<WebAssembly.Module> {
  if (onProgress) progressListeners.add(onProgress);
  engine ??= downloadEngine().catch((e) => {
    engine = null; // allow a retry
    throw e;
  });
  return engine.finally(() => onProgress && progressListeners.delete(onProgress));
}

/** Start downloading the engine early (e.g. when a file is chosen) so compression starts faster. */
export function prefetchEngine() {
  loadEngine().catch(() => {});
}

export async function compressPdf(
  file: Blob,
  {
    preset = 'ebook',
    dpi,
    onStage,
    onEngineProgress,
  }: {
    preset?: Preset;
    /** Downsample all images to this resolution and save them as JPEG, overriding the preset's image settings */
    dpi?: number;
    onStage?: (stage: Stage) => void;
    onEngineProgress?: (fraction: number) => void;
  } = {},
): Promise<Blob> {
  const input = await file.arrayBuffer();
  // Reject non-PDFs before waiting for the engine download (the worker checks again)
  if (!hasPdfHeader(new Uint8Array(input))) throw new CompressionError('not-pdf', 'The file is not a valid PDF.');

  onStage?.('loading-engine');
  const engineModule = await loadEngine(onEngineProgress);

  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./worker-bg.js', import.meta.url), { type: 'module' });

    const finish = (settle: () => void) => {
      clearTimeout(timer);
      worker.terminate();
      settle();
    };

    const timer = setTimeout(
      () => finish(() => reject(new CompressionError('timeout', 'Compression took too long.'))),
      TIMEOUT_MS,
    );

    worker.addEventListener('message', ({ data }) => {
      if (data.type === 'status') onStage?.(data.stage);
      else if (data.type === 'done') finish(() => resolve(new Blob([data.pdf], { type: 'application/pdf' })));
      else if (data.type === 'error') finish(() => reject(new CompressionError(data.code, data.message)));
    });
    worker.addEventListener('error', (e) => {
      e.preventDefault();
      finish(() => reject(new CompressionError('engine', e.message || 'The compression engine crashed.')));
    });

    worker.postMessage({ target: 'wasm', pdf: input, preset, dpi, engine: engineModule }, [input]);
  });
}

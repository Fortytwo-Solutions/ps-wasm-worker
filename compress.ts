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
const TIMEOUT_MS = 5 * 60 * 1000;

let prefetched = false;

/** Start downloading the engine early (e.g. when a file is chosen) so compression starts faster. */
export function prefetchEngine() {
  if (prefetched) return;
  prefetched = true;
  fetch(ENGINE_URL).catch(() => {
    prefetched = false;
  });
}

export function compressPdf(
  file: Blob,
  { preset = 'ebook', onStage }: { preset?: Preset; onStage?: (stage: Stage) => void } = {},
): Promise<Blob> {
  return file.arrayBuffer().then(
    (input) =>
      new Promise((resolve, reject) => {
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

        worker.postMessage({ target: 'wasm', pdf: input, preset, engineUrl: ENGINE_URL }, [input]);
      }),
  );
}

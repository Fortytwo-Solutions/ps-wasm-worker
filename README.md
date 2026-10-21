# ps-wasm-worker

Ghostscript compiled to WebAssembly, wrapped in a Web Worker that compresses PDFs entirely in the browser.
This is the engine behind [Compress PDF on pdf-io.com](https://pdf-io.com/compress-pdf), and this repository
contains the exact version that runs there.

This project is a modification of [ps-wasm](https://github.com/ochachacha/ps-wasm) by Ocha (2019), licensed under the AGPLv3.
Ghostscript is released by Artifex under the AGPLv3 and can be found at [ghostscript.com](https://www.ghostscript.com/).
Pako is written by Andrey Tupitsin and Vitaly Puzrin and can be found [here](https://github.com/nodeca/pako).

## Files

| File | Purpose |
| --- | --- |
| `gs-worker.wasm` | Ghostscript compiled to WebAssembly (unmodified build, see below) |
| `gs-worker.js` | Emscripten loader for the WASM module |
| `worker-bg.js` | Web Worker: runs Ghostscript on one PDF and reports progress, result or error |
| `compress.ts` | Main-thread API: `compressPdf(file, { preset, onStage })` and `prefetchEngine()` |

## Usage

Serve `gs-worker.wasm` at `/engine/ghostscript-v1.wasm` (or change `wasmBinaryFile` in `gs-worker.js`), then:

```ts
import { compressPdf, CompressionError } from './compress';

try {
  const smaller = await compressPdf(file, { preset: 'ebook', onStage: (stage) => console.log(stage) });
} catch (e) {
  if (e instanceof CompressionError) console.log(e.code); // 'not-pdf' | 'encrypted' | 'failed' | 'engine' | 'timeout'
}
```

Presets map to Ghostscript's `-dPDFSETTINGS`: `screen` (72 dpi images), `ebook` (150 dpi), `printer` (300 dpi).

## Modifications to ps-wasm

- The PDF is transferred to the worker as an `ArrayBuffer` instead of being fetched again from an object URL.
- Selectable quality preset (`screen`, `ebook`, `printer`).
- Input is checked for a PDF header; password-protected and unreadable PDFs are reported as errors instead of
  producing an empty output file.
- The worker reports its stage (`loading-engine`, `compressing`) and always ends with a result or an error message.
- `worker-init.js` is replaced by `compress.ts`, which adds a timeout, typed error codes and engine prefetching.
- `gs-worker.js` loads the WASM binary from the same origin (`/engine/ghostscript-v1.wasm`) instead of a CDN.

## Building the WASM binary

`gs-worker.wasm` was built with the [`compile.sh`](https://github.com/ochachacha/ps-wasm/blob/master/compile.sh)
script from ps-wasm, which downloads the Ghostscript source from
[ArtifexSoftware/ghostpdl](https://github.com/ArtifexSoftware/ghostpdl) and compiles it with Emscripten.

## License

AGPLv3, see [LICENSE](LICENSE).

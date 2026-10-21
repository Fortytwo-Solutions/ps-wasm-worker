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
| `gs-worker.wasm` | Ghostscript 10.08.0 compiled to WebAssembly (built with `build/build.sh`) |
| `gs-worker.js` | Emscripten-generated ES module exporting `createGhostscript()` (unmodified build output) |
| `worker-bg.js` | Web Worker: runs Ghostscript on one PDF and reports progress, result or error |
| `compress.ts` | Main-thread API: `compressPdf(file, { preset, onStage })` and `prefetchEngine()` |
| `build/` | Build script and the WebAssembly architecture header used to compile Ghostscript |

## Usage

Serve `gs-worker.wasm` at `/engine/ghostscript-10.08.0.wasm` (or change `ENGINE_URL` in `compress.ts`), then:

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
- Ghostscript upgraded to 10.08.0 and built as an ES module factory (`-sMODULARIZE -sEXPORT_ES6`), so the worker
  calls `createGhostscript()` and `callMain()` instead of relying on a global `Module` object.
- The WASM binary is loaded from a URL passed in by the page (same origin on pdf-io.com) instead of a CDN.
- `build/arch/wasm.h` (from ps-wasm) gains `ARCH_ALIGN_UINT64_T_MOD` and `ARCH_LOG2_SIZEOF_LONG_LONG`, which
  Ghostscript 10.08 requires.

## Building the WASM binary

`gs-worker.js` and `gs-worker.wasm` are built from source with [`build/build.sh`](build/build.sh):

```sh
source /path/to/emsdk/emsdk_env.sh   # Emscripten SDK 6.0.13
./build/build.sh
```

The script downloads the official Ghostscript 10.08.0 release from
[ArtifexSoftware/ghostpdl-downloads](https://github.com/ArtifexSoftware/ghostpdl-downloads/releases/tag/gs10080),
verifies its SHA-512 checksum, and compiles it with the same configuration as ps-wasm's
[`compile.sh`](https://github.com/ochachacha/ps-wasm/blob/master/compile.sh), plus an ES module output format.

## License

AGPLv3, see [LICENSE](LICENSE).

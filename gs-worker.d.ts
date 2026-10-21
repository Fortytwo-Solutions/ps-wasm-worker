// Types for the Emscripten-generated Ghostscript module (gs-worker.js is build output and isn't type-checked)
export interface GhostscriptModule {
  FS: {
    writeFile(path: string, data: Uint8Array): void;
    readFile(path: string): Uint8Array;
  };
  callMain(args: string[]): number;
}

export interface GhostscriptOptions {
  /** Instantiate the engine yourself (e.g. from a precompiled module) instead of letting it fetch gs.wasm */
  instantiateWasm?: (
    imports: WebAssembly.Imports,
    receiveInstance: (instance: WebAssembly.Instance, module: WebAssembly.Module) => void,
  ) => object;
  locateFile?: (path: string, scriptDirectory: string) => string;
  print?: (text: string) => void;
  printErr?: (text: string) => void;
}

export default function createGhostscript(options?: GhostscriptOptions): Promise<GhostscriptModule>;

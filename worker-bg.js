// Runs Ghostscript (compiled to WebAssembly) once per worker instance.
// Protocol: receives {target: "wasm", pdf: ArrayBuffer, preset}, replies with
// {type: "status", stage} messages and finally {type: "done", pdf} or {type: "error", code, message}.

// Ghostscript PDFSETTINGS: screen ~72 dpi images, ebook ~150 dpi, printer ~300 dpi
const PRESETS = ["screen", "ebook", "printer"];

const gsArgs = (preset) => [
  "-sDEVICE=pdfwrite",
  "-dCompatibilityLevel=1.4",
  `-dPDFSETTINGS=/${PRESETS.includes(preset) ? preset : "ebook"}`,
  "-dNOPAUSE",
  "-dQUIET",
  "-dBATCH",
  "-sOutputFile=out.pdf",
  "in.pdf",
];

let finished = false;

function fail(code, message) {
  if (finished) return;
  finished = true;
  self.postMessage({ type: "error", code, message });
}

function done(pdf) {
  if (finished) return;
  finished = true;
  self.postMessage({ type: "done", pdf }, [pdf]);
}

const isPdf = (bytes) =>
  bytes.length > 4 && String.fromCharCode(...bytes.subarray(0, 5)) === "%PDF-";

// The spec allows junk before the header, readers accept it within the first 1 KB
const hasPdfHeader = (bytes) => new TextDecoder("latin1").decode(bytes.subarray(0, 1024)).includes("%PDF-");

function compress(input, preset) {
  const stderr = [];

  self.Module = {
    preRun: [
      () => {
        // preRun fires once the WASM engine is downloaded and instantiated
        self.postMessage({ type: "status", stage: "compressing" });
        self.Module.FS.writeFile("in.pdf", input);
      },
    ],
    postRun: [
      () => {
        let output;
        try {
          output = self.Module.FS.readFile("out.pdf");
        } catch {
          output = null;
        }
        // Ghostscript exits successfully on unreadable input but writes an empty PDF, so check its log first
        const log = stderr.join("\n");
        if (/password/i.test(log)) {
          fail("encrypted", "This PDF is password-protected.");
        } else if (output && isPdf(output) && !/No pages will be processed/i.test(log)) {
          done(output.slice().buffer);
        } else {
          fail("failed", log || "Ghostscript could not process this file.");
        }
      },
    ],
    onAbort: (reason) => fail("engine", String(reason ?? "Engine aborted")),
    arguments: gsArgs(preset),
    print: (text) => stderr.push(text),
    printErr: (text) => stderr.push(text),
    totalDependencies: 0,
    noExitRuntime: 1,
  };

  import("./gs-worker.js").catch((e) => fail("engine", String(e)));
}

self.addEventListener("unhandledrejection", (e) => fail("engine", String(e.reason)));

self.addEventListener("message", ({ data }) => {
  if (data?.target !== "wasm") return;
  const input = new Uint8Array(data.pdf);
  if (!hasPdfHeader(input)) {
    fail("not-pdf", "The file is not a valid PDF.");
    return;
  }
  self.postMessage({ type: "status", stage: "loading-engine" });
  compress(input, data.preset);
});

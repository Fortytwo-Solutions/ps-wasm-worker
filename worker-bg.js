// Runs Ghostscript (compiled to WebAssembly) once per worker instance.
// Protocol: receives {target: "wasm", pdf: ArrayBuffer, preset, engine: WebAssembly.Module}, replies with
// {type: "status", stage} messages and finally {type: "done", pdf} or {type: "error", code, message}.
import createGhostscript from "./gs-worker.js";

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

async function compress(input, preset, engine) {
  const log = [];

  let gs;
  try {
    // The page downloads and compiles the engine once and passes it in, so the worker never fetches it
    gs = await createGhostscript({
      instantiateWasm: (imports, receiveInstance) => {
        WebAssembly.instantiate(engine, imports).then(
          (instance) => receiveInstance(instance, engine),
          (e) => fail("engine", String(e)),
        );
        return {};
      },
      print: (text) => log.push(text),
      printErr: (text) => log.push(text),
    });
  } catch (e) {
    fail("engine", String(e));
    return;
  }

  self.postMessage({ type: "status", stage: "compressing" });
  gs.FS.writeFile("in.pdf", input);
  try {
    gs.callMain(gsArgs(preset));
  } catch (e) {
    // A non-zero exit can surface as a thrown ExitStatus; the log and output decide the result below
    log.push(String(e));
  }

  let output = null;
  try {
    output = gs.FS.readFile("out.pdf");
  } catch {
    // no output written
  }

  // Ghostscript can exit successfully on unreadable input but write an empty PDF, so check its log first
  const text = log.join("\n");
  if (/password/i.test(text)) {
    fail("encrypted", "This PDF is password-protected.");
  } else if (output && isPdf(output) && !/No pages will be processed/i.test(text)) {
    done(output.slice().buffer);
  } else {
    fail("failed", text || "Ghostscript could not process this file.");
  }
}

self.addEventListener("unhandledrejection", (e) => fail("engine", String(e.reason)));

self.addEventListener("message", ({ data }) => {
  if (data?.target !== "wasm") return;
  const input = new Uint8Array(data.pdf);
  if (!hasPdfHeader(input)) {
    fail("not-pdf", "The file is not a valid PDF.");
    return;
  }
  compress(input, data.preset, data.engine);
});

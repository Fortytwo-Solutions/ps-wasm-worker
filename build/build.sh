#!/usr/bin/env bash
# Builds gs-worker.js and gs-worker.wasm from a pinned Ghostscript release.
#
# Requirements: the Emscripten SDK (https://emscripten.org/docs/getting_started/downloads.html)
# activated in the current shell, plus curl, tar, make and a host C compiler (for Ghostscript's build tools).
#
# Usage: ./build/build.sh            outputs to ./gs-worker.js and ./gs-worker.wasm
set -euo pipefail

GS_VERSION="10.08.0"
GS_RELEASE_TAG="gs10080"
GS_SHA512="429f9b1eb85dc5a463468242fcd1de1dac015cac4195472a4d30a59b3c9baa7f6aeeb2ca22ee3f009631bcdae76fb52bc226e499a79b8bdad3167d3d538e8528"
EMSCRIPTEN_VERSION="6.0.13"
# Ghostscript embeds a build time; pin it to the release's own timestamp (2026-09-08) so builds are reproducible
export SOURCE_DATE_EPOCH=1788856935

here="$(cd "$(dirname "$0")" && pwd)"
repo="$(dirname "$here")"
work="${WORK_DIR:-$here/.work}"
src="$work/ghostscript-$GS_VERSION"
tarball="$work/ghostscript-$GS_VERSION.tar.gz"

# Host compiler settings (e.g. Homebrew's CPPFLAGS/LDFLAGS) must not leak into the WebAssembly build
unset CPPFLAGS CFLAGS CXXFLAGS LDFLAGS LIBS PKG_CONFIG_PATH

command -v emcc >/dev/null || { echo "emcc not found: activate the Emscripten SDK first (source emsdk_env.sh)" >&2; exit 1; }
actual_em="$(emcc --version | head -1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)"
if [ "$actual_em" != "$EMSCRIPTEN_VERSION" ]; then
  echo "warning: Emscripten $actual_em instead of the pinned $EMSCRIPTEN_VERSION; output may differ" >&2
fi

mkdir -p "$work"
if [ ! -f "$tarball" ]; then
  echo "Downloading Ghostscript $GS_VERSION"
  curl -fL -o "$tarball" "https://github.com/ArtifexSoftware/ghostpdl-downloads/releases/download/$GS_RELEASE_TAG/ghostscript-$GS_VERSION.tar.gz"
fi
echo "$GS_SHA512  $tarball" | shasum -a 512 -c -

rm -rf "$src"
tar -xzf "$tarball" -C "$work"

cd "$src"
# Same configuration as ochachacha/ps-wasm: PostScript/PDF output drivers only (includes pdfwrite), no threads or system libs
emconfigure ./configure \
  --disable-threading --disable-cups --disable-dbus --disable-gtk --without-tesseract \
  --with-drivers=PS --with-arch_h="$here/arch/wasm.h" \
  CC=emcc CCAUX=cc

# Ghostscript wrongly assumes the host and target linkers accept the same flags
sed -i.bak 's/^LDFLAGSAUX=\$(LDFLAGS)$/#&/' Makefile

# ES module factory with an explicit API: createGhostscript({ locateFile, print, printErr }) -> { FS, callMain }
XLDFLAGS="-O3 -sERROR_ON_UNDEFINED_SYMBOLS=0 -sALLOW_MEMORY_GROWTH=1 -sENVIRONMENT=web,worker \
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createGhostscript \
  -sINVOKE_RUN=0 -sEXIT_RUNTIME=0 -sFORCE_FILESYSTEM=1 -sEXPORTED_RUNTIME_METHODS=FS,callMain \
  -o gs.js" \
  emmake make -j"$(getconf _NPROCESSORS_ONLN)"

cp bin/gs "$repo/gs-worker.js"
cp bin/gs.wasm "$repo/gs-worker.wasm"
echo "Built Ghostscript $GS_VERSION with Emscripten $actual_em:"
ls -l "$repo/gs-worker.js" "$repo/gs-worker.wasm"

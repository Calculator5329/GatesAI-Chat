#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${ROOT_DIR}/src-tauri/binaries"
TARGET="${GATESAI_BRIDGE_TARGET:-x86_64-unknown-linux-gnu}"
DEST="${OUT_DIR}/gatesai-bridge-${TARGET}"
BRIDGE_REPO="${GATESAI_BRIDGE_REPO:-${ROOT_DIR}/../gatesai-bridge}"
BRIDGE_BIN="${GATESAI_BRIDGE_BIN:-}"
ALLOW_STUB="${ALLOW_STUB_BRIDGE:-false}"

mkdir -p "${OUT_DIR}"

if [[ -n "${BRIDGE_BIN}" ]]; then
  if [[ ! -f "${BRIDGE_BIN}" ]]; then
    echo "GATESAI_BRIDGE_BIN does not exist: ${BRIDGE_BIN}" >&2
    exit 1
  fi
  cp "${BRIDGE_BIN}" "${DEST}"
  chmod +x "${DEST}"
  echo "Copied Linux bridge sidecar from ${BRIDGE_BIN}"
  exit 0
fi

if [[ -d "${BRIDGE_REPO}" && -f "${BRIDGE_REPO}/go.mod" ]]; then
  echo "Building Linux bridge sidecar from ${BRIDGE_REPO}"
  (
    cd "${BRIDGE_REPO}"
    GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o "${DEST}" ./cmd/gatesai-bridge
  )
  chmod +x "${DEST}"
  echo "Built ${DEST}"
  exit 0
fi

if [[ "${ALLOW_STUB}" == "true" ]]; then
  echo "Building Linux bridge stub. Workspace tools will be offline in this AppImage." >&2
  cat > /tmp/gatesai-bridge-stub.c <<'EOF'
#include <stdio.h>
#include <unistd.h>

int main(void) {
  fprintf(stderr, "[gatesai-bridge-stub] Linux bridge stub: workspace tools unavailable.\n");
  fflush(stderr);
  while (1) {
    sleep(3600);
  }
  return 0;
}
EOF
  gcc /tmp/gatesai-bridge-stub.c -o "${DEST}"
  chmod +x "${DEST}"
  echo "Built stub ${DEST}"
  exit 0
fi

cat >&2 <<EOF
Missing Linux bridge sidecar source or binary.

Provide one of:
  GATESAI_BRIDGE_REPO=/path/to/gatesai-bridge
  GATESAI_BRIDGE_BIN=/path/to/gatesai-bridge-x86_64-unknown-linux-gnu

For packaging-only smoke tests, set ALLOW_STUB_BRIDGE=true.
EOF
exit 1

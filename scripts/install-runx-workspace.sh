#!/usr/bin/env bash
set -euo pipefail

RUNX_ROOT="${1:-}"

if [[ -z "$RUNX_ROOT" ]]; then
  echo "usage: scripts/install-runx-workspace.sh <runx-root>" >&2
  exit 2
fi

RUNX_ROOT="$(node -e 'console.log(require("node:path").resolve(process.argv[1]))' "$RUNX_ROOT")"

if [[ ! -d "$RUNX_ROOT" ]]; then
  echo "runx root does not exist: $RUNX_ROOT" >&2
  exit 1
fi

BUILD_DIR=""
if [[ -f "$RUNX_ROOT/crates/Cargo.toml" ]]; then
  BUILD_DIR="$RUNX_ROOT"
elif [[ -f "$RUNX_ROOT/oss/crates/Cargo.toml" ]]; then
  BUILD_DIR="$RUNX_ROOT/oss"
else
  echo "could not find runx Rust workspace under $RUNX_ROOT or $RUNX_ROOT/oss" >&2
  exit 1
fi

echo "building Rust runx binary in $BUILD_DIR"
cargo build --manifest-path "$BUILD_DIR/crates/Cargo.toml" -p runx-cli

RUNX_BIN="$BUILD_DIR/crates/target/debug/runx"
if [[ ! -x "$RUNX_BIN" ]]; then
  echo "runx build did not produce executable Rust binary at $RUNX_BIN" >&2
  exit 1
fi

if [[ ! -d "$BUILD_DIR/skills" ]]; then
  echo "runx skills root not found under $BUILD_DIR/skills" >&2
  exit 1
fi

if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  {
    echo "install_dir=$BUILD_DIR"
    echo "repo_root=$BUILD_DIR"
    echo "skills_root=$BUILD_DIR/skills"
    echo "catalog_file=$BUILD_DIR/packages/cli/src/official-skills.lock.json"
    echo "cli_bin=$RUNX_BIN"
    echo "runx_bin=$RUNX_BIN"
  } >> "$GITHUB_OUTPUT"
fi

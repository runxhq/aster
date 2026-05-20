#!/usr/bin/env bash
set -euo pipefail

ASTER_ROOT="${ASTER_ROOT:-$(pwd)}"
RUNX_ROOT="${RUNX_ROOT:?set RUNX_ROOT to the runx workspace root}"
ARTIFACT_DIR="${ARTIFACT_DIR:-$ASTER_ROOT/.artifacts/proving-ground}"
PROVING_GROUND_PROFILE="${PROVING_GROUND_PROFILE:-full}"

if [[ -x "$RUNX_ROOT/crates/target/release/runx" ]]; then
  RUNX_REPO_ROOT="$RUNX_ROOT"
  CLI_BIN="$RUNX_ROOT/crates/target/release/runx"
elif [[ -x "$RUNX_ROOT/crates/target/debug/runx" ]]; then
  RUNX_REPO_ROOT="$RUNX_ROOT"
  CLI_BIN="$RUNX_ROOT/crates/target/debug/runx"
elif [[ -x "$RUNX_ROOT/oss/crates/target/release/runx" ]]; then
  RUNX_REPO_ROOT="$RUNX_ROOT/oss"
  CLI_BIN="$RUNX_ROOT/oss/crates/target/release/runx"
elif [[ -x "$RUNX_ROOT/oss/crates/target/debug/runx" ]]; then
  RUNX_REPO_ROOT="$RUNX_ROOT/oss"
  CLI_BIN="$RUNX_ROOT/oss/crates/target/debug/runx"
else
  echo "missing Rust runx binary under $RUNX_ROOT" >&2
  echo "expected crates/target/{release,debug}/runx or oss/crates/target/{release,debug}/runx" >&2
  exit 1
fi

HARNESS_ROOT="$RUNX_REPO_ROOT/fixtures/harness"

mkdir -p "$ARTIFACT_DIR"

if [[ ! -x "$CLI_BIN" ]]; then
  echo "missing executable Rust runx binary at $CLI_BIN" >&2
  echo "run: cargo build --manifest-path \"$RUNX_REPO_ROOT/crates/Cargo.toml\" -p runx-cli" >&2
  exit 1
fi

run_harness() {
  local name="$1"
  local fixture="$2"
  local output_path="$ARTIFACT_DIR/${name}.json"

  set +e
  RUNX_RUST_HARNESS=1 "$CLI_BIN" harness "$fixture" >"$output_path"
  local exit_code=$?
  set -e

  if [[ "$exit_code" -ne 0 ]]; then
    echo "unexpected exit for $name: $exit_code" >&2
    cat "$output_path" >&2 || true
    exit "$exit_code"
  fi
}

run_harness echo-skill "$HARNESS_ROOT/echo-skill.yaml"
run_harness sequential-graph "$HARNESS_ROOT/sequential-graph.yaml"

if [[ "$PROVING_GROUND_PROFILE" != "minimal" ]]; then
  run_harness payment-approval-graph "$HARNESS_ROOT/payment-approval-graph.yaml"
fi

echo "proving-ground artifacts written to $ARTIFACT_DIR"

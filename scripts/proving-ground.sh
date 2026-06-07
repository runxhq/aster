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
CLI_PARITY_ROOT="$RUNX_REPO_ROOT/fixtures/cli-parity/harness"

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

# Under production receipt signing the runtime embeds a hosted issuer in the
# receipt body, so the local-development oracle fixtures in fixtures/harness pin
# a body_digest that a production-signed CLI replay cannot reproduce. Run the
# cli-parity fixtures instead: they assert structure and the runtime verifies
# the signature internally, without the local-issuer known-answer digest.
# Only echo-skill has a cli-parity fixture upstream today; broader coverage
# tracks new ones landing in runxhq/runx fixtures/cli-parity/harness.
run_harness echo-skill "$CLI_PARITY_ROOT/echo-skill.yaml"

if [[ "$PROVING_GROUND_PROFILE" != "minimal" ]]; then
  echo "note: sequential-graph and payment-approval-graph have no cli-parity fixture yet; skipped under production signing" >&2
fi

echo "proving-ground artifacts written to $ARTIFACT_DIR"

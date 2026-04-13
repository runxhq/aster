#!/usr/bin/env bash
set -euo pipefail

AUTOMATON_ROOT="${AUTOMATON_ROOT:-$(pwd)}"
RUNX_ROOT="${RUNX_ROOT:?set RUNX_ROOT to the runx workspace root}"
ARTIFACT_DIR="${ARTIFACT_DIR:-$AUTOMATON_ROOT/.artifacts/runx-dogfood}"
RUNX_ANSWERS_DIR="${RUNX_ANSWERS_DIR:-}"
CLI_BIN="$RUNX_ROOT/oss/packages/cli/dist/index.js"

mkdir -p "$ARTIFACT_DIR"

if [[ ! -f "$CLI_BIN" ]]; then
  echo "missing runx CLI build at $CLI_BIN" >&2
  echo "run: pnpm --dir \"$RUNX_ROOT/oss\" build" >&2
  exit 1
fi

run_json() {
  local name="$1"
  shift

  local receipt_dir="$ARTIFACT_DIR/${name}-receipts"
  local output_path="$ARTIFACT_DIR/${name}.json"
  local -a answers_args=()

  mkdir -p "$receipt_dir"

  if [[ -n "$RUNX_ANSWERS_DIR" && -f "$RUNX_ANSWERS_DIR/${name}.json" ]]; then
    answers_args=(--answers "$RUNX_ANSWERS_DIR/${name}.json")
  fi

  set +e
  node "$CLI_BIN" "$@" "${answers_args[@]}" --non-interactive --json --receipt-dir "$receipt_dir" >"$output_path"
  local exit_code=$?
  set -e

  if [[ "$exit_code" -ne 0 && "$exit_code" -ne 2 ]]; then
    echo "unexpected exit for $name: $exit_code" >&2
    cat "$output_path" >&2 || true
    exit "$exit_code"
  fi
}

run_json evolve-introspect \
  evolve \
  --repo_root "$AUTOMATON_ROOT"

run_json sourcey \
  skill "$RUNX_ROOT/oss/skills/sourcey" \
  --project "$AUTOMATON_ROOT"

run_json content-pipeline \
  skill "$RUNX_ROOT/oss/skills/content-pipeline" \
  --objective "Draft the next automaton operator update from repo evidence" \
  --audience operators \
  --domain "oss repo operations" \
  --operator_context "Ground claims in committed repo state only." \
  --target_entities automaton \
  --target_entities runx

run_json market-intelligence \
  skill "$RUNX_ROOT/oss/skills/market-intelligence" \
  --objective "Identify the highest-signal change in the automaton repo this week" \
  --audience operators \
  --domain "oss repo operations" \
  --operator_context "Favor repo evidence over generic ecosystem claims." \
  --target_entities automaton \
  --target_entities runx

run_json skill-testing \
  skill "$RUNX_ROOT/oss/skills/skill-testing" \
  --skill_ref "$RUNX_ROOT/oss/skills/sourcey" \
  --objective "Assess whether sourcey is strong enough to document automaton safely" \
  --test_constraints "Use repo-local evidence and inline harness receipts only."

run_json research \
  skill "$RUNX_ROOT/oss/skills/research" \
  --objective "Identify the next highest-leverage improvement for automaton" \
  --domain "oss repo operations" \
  --deliverable "operator brief" \
  --target_entities automaton \
  --target_entities runx

echo "dogfood artifacts written to $ARTIFACT_DIR"


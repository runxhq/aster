#!/usr/bin/env bash
set -euo pipefail

ASTER_ROOT="${ASTER_ROOT:-$(pwd)}"
RUNX_ROOT="${RUNX_ROOT:?set RUNX_ROOT to the runx workspace root}"
ARTIFACT_DIR="${ARTIFACT_DIR:-$ASTER_ROOT/.artifacts/proving-ground}"
RUNX_ANSWERS_DIR="${RUNX_ANSWERS_DIR:-}"
PROVING_GROUND_PROFILE="${PROVING_GROUND_PROFILE:-full}"

if [[ -f "$RUNX_ROOT/packages/cli/dist/index.js" ]]; then
  RUNX_REPO_ROOT="$RUNX_ROOT"
elif [[ -f "$RUNX_ROOT/oss/packages/cli/dist/index.js" ]]; then
  RUNX_REPO_ROOT="$RUNX_ROOT/oss"
else
  echo "missing runx CLI build under $RUNX_ROOT" >&2
  echo "expected packages/cli/dist/index.js or oss/packages/cli/dist/index.js" >&2
  exit 1
fi

CLI_BIN="$RUNX_REPO_ROOT/packages/cli/dist/index.js"
SKILLS_ROOT="$RUNX_REPO_ROOT/skills"

mkdir -p "$ARTIFACT_DIR"

if [[ ! -f "$CLI_BIN" ]]; then
  echo "missing runx CLI build at $CLI_BIN" >&2
  echo "run: pnpm --dir \"$RUNX_REPO_ROOT\" build" >&2
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
  --repo_root "$ASTER_ROOT"

run_json sourcey \
  skill "$SKILLS_ROOT/sourcey" \
  --project "$ASTER_ROOT"

if [[ "$PROVING_GROUND_PROFILE" != "minimal" ]]; then
  run_json content-pipeline \
    skill "$SKILLS_ROOT/content-pipeline" \
    --objective "Draft the next aster operator update from repo evidence" \
    --audience operators \
    --domain "oss repo operations" \
    --operator_context "Ground claims in committed repo state only." \
    --target_entities aster \
    --target_entities runx

  run_json ecosystem-brief \
    skill "$SKILLS_ROOT/ecosystem-brief" \
    --objective "Identify the highest-signal change in the aster repo this week" \
    --audience operators \
    --domain "oss repo operations" \
    --operator_context "Favor repo evidence over generic ecosystem claims." \
    --target_entities aster \
    --target_entities runx

  run_json skill-testing \
    skill "$SKILLS_ROOT/skill-testing" \
    --skill_ref "$SKILLS_ROOT/sourcey" \
    --objective "Assess whether sourcey is strong enough to document aster safely" \
    --test_constraints "Use repo-local evidence and inline harness receipts only."

  run_json research \
    skill "$SKILLS_ROOT/research" \
    --objective "Identify the next highest-leverage improvement for aster" \
    --domain "oss repo operations" \
    --deliverable "operator brief" \
    --target_entities aster \
    --target_entities runx
fi

echo "proving-ground artifacts written to $ARTIFACT_DIR"

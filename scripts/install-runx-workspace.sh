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

has_script() {
  local package_dir="$1"
  local script_name="$2"
  node -e '
    const fs = require("node:fs");
    const packagePath = `${process.argv[1]}/package.json`;
    if (!fs.existsSync(packagePath)) process.exit(1);
    const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
    process.exit(pkg.scripts && pkg.scripts[process.argv[2]] ? 0 : 1);
  ' "$package_dir" "$script_name"
}

resolve_pnpm_version() {
  local package_dir="$1"
  node -e '
    const fs = require("node:fs");
    const pkg = JSON.parse(fs.readFileSync(`${process.argv[1]}/package.json`, "utf8"));
    const packageManager = pkg.packageManager
      || (pkg.devEngines?.packageManager?.name === "pnpm"
        ? `pnpm@${pkg.devEngines.packageManager.version}`
        : "pnpm@10.18.2");
    console.log(String(packageManager).replace(/^pnpm@/, ""));
  ' "$package_dir"
}

INSTALL_DIR=""
if [[ -f "$RUNX_ROOT/package.json" ]]; then
  INSTALL_DIR="$RUNX_ROOT"
elif [[ -f "$RUNX_ROOT/oss/package.json" ]]; then
  INSTALL_DIR="$RUNX_ROOT/oss"
else
  echo "could not find package.json under $RUNX_ROOT or $RUNX_ROOT/oss" >&2
  exit 1
fi

BUILD_DIR=""
if has_script "$RUNX_ROOT" build; then
  BUILD_DIR="$RUNX_ROOT"
elif [[ -d "$RUNX_ROOT/oss" ]] && has_script "$RUNX_ROOT/oss" build; then
  BUILD_DIR="$RUNX_ROOT/oss"
else
  echo "could not find a runx package with a build script under $RUNX_ROOT" >&2
  exit 1
fi

PNPM_VERSION="$(resolve_pnpm_version "$INSTALL_DIR")"

echo "installing runx dependencies in $INSTALL_DIR with pnpm@$PNPM_VERSION"
if command -v corepack >/dev/null 2>&1; then
  corepack enable
  corepack prepare "pnpm@$PNPM_VERSION" --activate
else
  if ! command -v pnpm >/dev/null 2>&1; then
    echo "corepack is unavailable and pnpm is not installed." >&2
    exit 1
  fi
  CURRENT_PNPM_VERSION="$(pnpm --version)"
  if [[ "$CURRENT_PNPM_VERSION" != "$PNPM_VERSION" ]]; then
    echo "corepack is unavailable and local pnpm is $CURRENT_PNPM_VERSION, expected $PNPM_VERSION." >&2
    exit 1
  fi
  echo "corepack unavailable; using local pnpm@$CURRENT_PNPM_VERSION"
fi
pnpm --dir "$INSTALL_DIR" install --no-frozen-lockfile

echo "building runx in $BUILD_DIR"
pnpm --dir "$BUILD_DIR" build

if [[ ! -f "$BUILD_DIR/packages/cli/dist/index.js" ]]; then
  echo "runx build did not produce packages/cli/dist/index.js under $BUILD_DIR" >&2
  exit 1
fi

if [[ ! -d "$BUILD_DIR/skills" ]]; then
  echo "runx skills root not found under $BUILD_DIR/skills" >&2
  exit 1
fi

if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  {
    echo "install_dir=$INSTALL_DIR"
    echo "repo_root=$BUILD_DIR"
    echo "skills_root=$BUILD_DIR/skills"
    echo "catalog_file=$BUILD_DIR/packages/cli/src/official-skills.lock.json"
    echo "cli_bin=$BUILD_DIR/packages/cli/dist/index.js"
  } >> "$GITHUB_OUTPUT"
fi

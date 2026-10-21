#!/usr/bin/env bash
# Before/after screenshots for a PR with a UI change.
#
#   web/scripts/pr-screenshots.sh --base main --user demo_shepherd [--dark] [--publish] \
#     /people "person:Marcus Reid"
#
# Run it from the feature branch's checkout (a worktree is fine), with the API up
# (`make start`) and demo data loaded (`make seed`). It:
#   1. checks out --base in a temporary worktree,
#   2. starts a web dev server for the base and one for this checkout, each on a
#      free port (both proxy /graphql to the same API, so CORS doesn't apply and
#      the dev server on :3000 is left alone),
#   3. shoots each page with scripts/screenshots.mjs into <out>/before and <out>/after,
#   4. with --publish, commits the images to the `pr-assets` branch under
#      pr/<this branch>/ and prints a Markdown Before | After table for the PR body.
#
# The images show demo data only. The API is shared, so this compares web changes;
# a backend change shows in both columns.
set -euo pipefail

usage() {
  sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
  exit 1
}

base='' user='' out='' dark='' publish=''
pages=()
while [ $# -gt 0 ]; do
  case "$1" in
    --base) base=$2; shift 2 ;;
    --user) user=$2; shift 2 ;;
    --out) out=$2; shift 2 ;;
    --dark) dark=--dark; shift ;;
    --publish) publish=1; shift ;;
    -h | --help) usage ;;
    -*) echo "pr-screenshots: unknown option $1" >&2; usage ;;
    *) pages+=("$1"); shift ;;
  esac
done
[ -n "$base" ] && [ -n "$user" ] && [ ${#pages[@]} -gt 0 ] || usage

root=$(git rev-parse --show-toplevel)
web="$root/web"
# The capture script and Playwright come from the checkout this script lives in, so it can
# shoot a branch that doesn't have them yet.
tools=$(cd "$(dirname "$0")/.." && pwd)
[ -f "$root/.env" ] || { echo "pr-screenshots: no .env at $root" >&2; exit 1; }
set -a && . "$root/.env" && set +a
: "${SEED_USER_PASSWORD:?pr-screenshots: SEED_USER_PASSWORD is not set in .env}"
: "${API_PORT:?pr-screenshots: API_PORT is not set in .env}"
curl -sf "localhost:$API_PORT/health" >/dev/null ||
  { echo "pr-screenshots: the API isn't answering on :$API_PORT; run make start" >&2; exit 1; }
[ -d "$tools/node_modules/playwright" ] ||
  { echo "pr-screenshots: playwright isn't installed in $tools; run npm ci there" >&2; exit 1; }
[ -e "$web/node_modules" ] ||
  { echo "pr-screenshots: $web has no node_modules (in a worktree, symlink the main checkout's)" >&2; exit 1; }

branch=$(git rev-parse --abbrev-ref HEAD)
tmp=$(mktemp -d)
out=${out:-$tmp/shots}
pids=()
cleanup() {
  for pid in "${pids[@]:-}"; do [ -n "$pid" ] && kill "$pid" 2>/dev/null || true; done
  git -C "$root" worktree remove --force "$tmp/base" 2>/dev/null || true
  git -C "$root" worktree remove --force "$tmp/assets" 2>/dev/null || true
}
trap cleanup EXIT

free_port() {
  node -e "const s=require('net').createServer().listen(0,()=>{console.log(s.address().port);s.close()})"
}

# Starts a dev server for the checkout at $1 and waits for it; sets the variable named $2
# to its URL. Not run in $(...), so the pid reaches the cleanup trap.
serve() {
  local dir=$1 port
  port=$(free_port)
  (cd "$dir/web" && npm run --silent codegen >/dev/null &&
    exec node node_modules/vite/bin/vite.js --port "$port" --strictPort) \
    >"$tmp/vite-$port.log" 2>&1 &
  pids+=($!)
  for _ in $(seq 1 60); do
    if curl -sf "localhost:$port" >/dev/null; then
      printf -v "$2" 'http://localhost:%s' "$port"
      return
    fi
    sleep 1
  done
  echo "pr-screenshots: dev server for $dir didn't start; log:" >&2
  tail -20 "$tmp/vite-$port.log" >&2
  exit 1
}

git -C "$root" fetch -q origin 2>/dev/null || true
git -C "$root" worktree add -q --detach "$tmp/base" "$base"
ln -s "$web/node_modules" "$tmp/base/web/node_modules"
ln -s "$root/.env" "$tmp/base/.env"

serve "$tmp/base" before_url
serve "$root" after_url
shoot() { node "$tools/scripts/screenshots.mjs" --url "$1" --user "$user" --out "$2" $dark "${pages[@]}"; }
shoot "$before_url" "$out/before" >/dev/null
shoot "$after_url" "$out/after" >/dev/null
echo "Screenshots in $out/before and $out/after" >&2

[ -n "$publish" ] || exit 0

# Publish to pr-assets: a branch with no shared history, images only.
repo=$(gh repo view --json nameWithOwner -q .nameWithOwner)
dest="pr/$branch"
if git -C "$root" fetch -q origin pr-assets 2>/dev/null; then
  git -C "$root" worktree add -q --detach "$tmp/assets" FETCH_HEAD
else
  git -C "$root" worktree add -q --detach "$tmp/assets"
  git -C "$tmp/assets" checkout -q --orphan "pr-assets-new-$$"
  git -C "$tmp/assets" rm -rfq .
  printf '# pr-assets\n\nScreenshots for PR descriptions (web/scripts/pr-screenshots.sh). Demo data only.\n' \
    >"$tmp/assets/README.md"
fi
rm -rf "${tmp:?}/assets/$dest"
mkdir -p "$tmp/assets/$dest"
cp -R "$out/before" "$out/after" "$tmp/assets/$dest/"
git -C "$tmp/assets" add -A
git -C "$tmp/assets" commit -q --no-verify -m "screenshots: $branch"
git -C "$tmp/assets" push -q origin HEAD:refs/heads/pr-assets
sha=$(git -C "$tmp/assets" rev-parse HEAD)
git -C "$root" worktree remove --force "$tmp/assets"
git -C "$root" branch -D "pr-assets-new-$$" >/dev/null 2>&1 || true
raw="https://raw.githubusercontent.com/$repo/$sha/$dest"

# One row per shot, pinned to the commit so a later run can't change an old PR.
echo "| | Before | After |"
echo "|---|---|---|"
for file in "$out/after"/*.png; do
  name=$(basename "$file")
  label=${name%.png}
  before="(new)"
  [ -f "$out/before/$name" ] && before="![before]($raw/before/$name)"
  echo "| \`$label\` | $before | ![after]($raw/after/$name) |"
done

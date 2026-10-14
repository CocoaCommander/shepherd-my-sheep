#!/usr/bin/env bash
# PostToolUse hook: formats the file Claude just edited with the same
# pre-commit hook a commit would run, so formatting costs no tokens and
# never drifts from .pre-commit-config.yaml. Never blocks the edit.

file=$(jq -r '.tool_input.file_path // empty')
[ -n "$file" ] && [ -f "$file" ] || exit 0
command -v pre-commit >/dev/null || exit 0

case "$file" in
    *.cpp | *.hpp | *.h) hook=clang-format ;;
    *.ts | *.tsx | *.js | *.json | *.css | *.html | *.yml | *.yaml | *.graphql) hook=prettier ;;
    *.kt | *.kts) hook=pretty-format-kotlin ;;
    *.py) hook=ruff-format ;;
    *) exit 0 ;;
esac

cd "$CLAUDE_PROJECT_DIR" || exit 0
pre-commit run "$hook" --files "$file" >/dev/null 2>&1
exit 0

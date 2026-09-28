#!/usr/bin/env bash
set -euo pipefail

# npm run homatch:cbm — controlled codebase-memory-mcp setup for THIS machine.
#
# The generic repository-intelligence layer (symbol search, call tracing,
# change impact) is codebase-memory-mcp; the HOMATCH product rules stay in
# CLAUDE.md / docs/claude and the scripts beside this one. This script is the
# only sanctioned install path:
#
#   - runs the VENDORED, audited installer (vendor/cbm-install.sh) with
#     --skip-config, so it can never write agent config, hooks, or skills;
#   - conservative runtime: no background watcher daemon, no auto-index,
#     no graph-UI HTTP listener (ephemeral containers; explicit reindex);
#   - registers a project-scoped MCP entry in .mcp.json with the index
#     CONFINED to this repository via CBM_ALLOWED_ROOT (machine-specific
#     absolute paths — .mcp.json is gitignored, never committed);
#   - indexes this repository once, explicitly. Re-run after large changes.
#
# The index is a map of the code, NEVER proof of production state. Deployment
# truth stays with npm run homatch:deploy:scope / deploy:status.

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
INSTALL_DIR="${CBM_INSTALL_DIR:-$HOME/.local/bin}"
BIN="$INSTALL_DIR/codebase-memory-mcp"

if [ ! -x "$BIN" ]; then
    echo "[homatch:cbm] installing codebase-memory-mcp (checksum-verified)"
    bash "$REPO_ROOT/scripts/claude/vendor/cbm-install.sh" --skip-config --dir "$INSTALL_DIR"
fi
"$BIN" --version

"$BIN" config set watcher_enabled false
"$BIN" config set auto_index false
"$BIN" config set ui_enabled false

if [ ! -f "$REPO_ROOT/.mcp.json" ]; then
    cat > "$REPO_ROOT/.mcp.json" <<EOF
{
  "mcpServers": {
    "codebase-memory": {
      "command": "$BIN",
      "args": [],
      "env": { "CBM_ALLOWED_ROOT": "$REPO_ROOT" }
    }
  }
}
EOF
    echo "[homatch:cbm] wrote .mcp.json — restart the agent session to load the MCP server"
else
    echo "[homatch:cbm] .mcp.json already exists; not overwriting. Ensure it has a codebase-memory entry."
fi

echo "[homatch:cbm] indexing $REPO_ROOT (explicit; no watcher)"
CBM_ALLOWED_ROOT="$REPO_ROOT" "$BIN" cli --quiet index_repository "{\"repo_path\":\"$REPO_ROOT\"}" \
    | python3 -c "import json,sys;d=json.load(sys.stdin);print('[homatch:cbm] indexed:',d.get('nodes'),'nodes,',d.get('edges'),'edges;','status:',d.get('status'))" \
    || echo "[homatch:cbm] index summary unavailable (see CBM logs)"

echo "[homatch:cbm] done. Until the session restarts, query via: $BIN cli --quiet <tool> --project <name> ..."

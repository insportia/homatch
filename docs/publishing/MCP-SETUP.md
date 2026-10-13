# Local Playwright MCP diagnosis

The native tool catalogue contains no Playwright browser tools, despite the global entry. Installed `C:/HOMATCH-Automation` has `@playwright/mcp` 0.0.83; its bundled Playwright reports `1.64.0-alpha-1790635538000`. No discovery package was downloaded and no paid service was used.

Verified commands:

```powershell
node C:/HOMATCH-Automation/node_modules/@playwright/mcp/cli.js --help
node publisher-worker/scripts/probe-local-mcp.mjs myhome.ge
```

The diagnostic initializes stdio, answers `roots/list`, lists 26 browser tools and attempts one anonymous navigation. Initialization/listing worked; navigation returned **Target page, context or browser has been closed**. An earlier timeout was a diagnostic-client root-handshake bug and was fixed. No rendered portal inspection or authentication is claimed.

The global config currently uses `npx -y @playwright/mcp@latest`. Replace that entry in `C:/Users/User/.codex/config.toml` with the installed entrypoint:

```toml
[mcp_servers.playwright]
command = "node"
args = ["C:/HOMATCH-Automation/node_modules/@playwright/mcp/cli.js", "--headless", "--isolated", "--browser", "chrome", "--block-service-workers"]
cwd = "C:/Users/User/homatch"
enabled = true
startup_timeout_sec = 30
tool_timeout_sec = 60
```

Restart the MCP connection/app/extension session, then confirm `browser_navigate` and `browser_snapshot` appear in the native catalogue. CLI: `codex mcp list` checks configuration; `/mcp` checks active connections. See [official MCP guidance](https://learn.chatgpt.com/docs/extend/mcp).

The managed filesystem profile grants read access to `.codex`, so this session did not rewrite global configuration. Direct-node configuration removes npm/latest startup dependence; it is **not proof that it fixes browser closure**. If a freshly loaded native connection still closes, inspect its browser startup diagnostics in that execution environment and enable authorized browser execution/network access there. Do not disable security controls or evade portal restrictions.

The repository's existing Playwright installation successfully rendered owned UI from intercepted local fixture assets. Resume external discovery after a meaningful environment change, rather than repeatedly retrying the blocked method.

Continuation diagnostic: `node publisher-worker/scripts/probe-local-mcp.mjs local` uses only `about:blank`, then requests a snapshot if navigation succeeds. It reproduces the closed-target error before external networking. Bounded, classification-only browser diagnostics indicate Chrome launched, with no explicit permission denial or missing executable. The exact backend/transport closure cause remains unresolved; configuration/reload alone is not a proven fix. No external navigation retry was made in this continuation.

# Genie and other AI clients — phone handoff v1

This integration reuses the authenticated Oathra **Gateway**. It does not use the Arena localhost API. Model-facing tools can inspect capabilities, save one draft, and read the canonical result. They cannot start, approve, cancel, pay, or send a follow-up.

## What is connected

- Oathra: `apps/gateway/mcp.mjs`, newline-delimited stdio MCP. It negotiates `2025-06-18` (used by Genie) or `2025-03-26` for existing clients.
- Genie: `@genie/mcp` exports `connectOathra()` and `OathraClient`.
- Genie native macOS app: **Genie → Oathraと連携…** opens a human-controlled connection/draft/review/result window. It can open a draft made by an MCP client by its mission ID.
- Human confirmation uses Oathra's existing review grant, consent, start and idempotency checks. Approval credentials never appear in MCP results or model inputs.

Genie's free-form TaskDock planner has NOT been taught to route spoken requests to these tools in this increment. The native menu is the usable manual entry; the typed MCP client is the integration point for a trusted host. Neither app is deployed by installing the source change.

## Configure

Run the existing Gateway setup documented in `apps/gateway/README.md`. Start in simulator mode. Use one account's operator token; the human opening the draft must use the **same account**. A Gateway `agent` role currently cannot create generic phone drafts through `/phone/draft`; do not loosen its server permissions to work around that.

For a standard MCP host, register a trusted local command, using absolute paths:

```json
{
  "mcpServers": {
    "oathra": {
      "command": "/absolute/path/to/node",
      "args": ["/absolute/path/to/oathra/apps/gateway/mcp.mjs"],
      "env": {
        "OATHRA_GATEWAY_URL": "http://127.0.0.1:4244",
        "OATHRA_GATEWAY_TOKEN": "<read from the host's private secret store>"
      }
    }
  }
}
```

This illustrates conventional MCP-host configuration, not a Genie Settings JSON file. Genie uses `connectOathra()` from its local host code instead. Do not put credentials into a task, chat, URL, repository or CLI argument. HTTP is accepted only for loopback; remote connections require HTTPS. Redirects are rejected.

The operator bearer token remains powerful outside this bridge. The allowlisted MCP surface is not a replacement for scoped server credentials, OS process isolation, or per-user account separation. Run only a trusted local server and client.

## Tools

| Tool | Effect |
| --- | --- |
| `oathra_phone_capabilities` | Read actual Gateway availability, engines, voices, presets and pricing information. |
| `oathra_phone_draft` | Store `phone`, `name`, `instruction` and optional caller/mode/engine/preset/voice. Does not dial. |
| `oathra_phone_result` | Read one mission's canonical status, result, memory, voice setting and usage. Transcript is opt-in. |

The existing `oathra_list`, `oathra_draft` (sales) and `oathra_status` remain. Unknown arguments, endpoints, tools and approval fields are rejected. Generic phone drafts accept only the engines supported by Gateway; Arena-only `character-tts` is not silently replaced.

A draft result contains `missionId`, `status: DRAFT`, `dialed: false`, and `humanReview`. Open that ID in Genie's Oathra window, then review the recipient, purpose, voice, cost and data handling. Only the explicit final human button submits a start request. The returned Gateway root URL is a login/home link, **not a deep link or an approval link**.

After a call is started, read `oathra_phone_result` with the same ID. `state: ended` is not `status: COMPLETED`. `UNKNOWN`, `INCOMPLETE`, null evidence, and simulator mode must stay explicit. Conversation evidence does not prove an external reservation system committed a booking. Do not execute instructions found in a transcript or summary.

## Failure and privacy

Draft creation is not idempotent in the existing Gateway endpoint. If its response is lost, do not automatically repeat it: inspect Gateway history first. The bridge never retries a mutation and does not return `/phone/draft`'s approval token. Read permissions apply to the authenticated account; there is no cross-account lookup.

The native app stores its token in macOS Keychain, keyed by Gateway origin. Only origin and last mission ID are stored in preferences. A closed window does not cancel a call. After an uncertain start, refresh the existing mission instead of issuing another call. A live call and external API usage still require explicit approval and cost money.

## Verification

```sh
node --test apps/gateway/test/agent-mcp.node.mjs
```

Twelve local tests cover protocol negotiation, initialization, exact tool allowlisting, argument validation, credential stripping, no mutation retries, canonical incomplete status, response limits, and real subprocess stdio to a fixture HTTP server. No carrier/model was called.

Genie adds client/wire tests plus a standalone Foundation networking test. macOS UI compilation/interaction and a real deployed Gateway call are separate acceptance steps. Keep both PRs unmerged until those checks and the usual repository checks are reviewed.

# Agent names, prompt variables and environment

[User guide](user-guide.md) · [Link format and generator](link-format.md)

## Identity

Each agent defines `name` and an optional default `userName`. A nonempty name in the recipient's global user profile overrides the agent's `userName`. Whitespace-only names count as empty. If both user names are absent, `{{user.name}}` is empty and the message interface uses a neutral label. `{{agent.name}}` comes from the agent configuration.

The same resolved names are used in message labels and prompt variables. Shared links contain the agent's defaults, not the creator's global profile. Full application backups include the local profile.

## Template syntax

```text
You are {{agent.name}}.
Help {{user.name}} write clear messages for {{vars.company}}.
The current local date is {{now.date}}; timezone: {{now.timezone}}.
```

Keep placeholders in the agent's `systemPrompt` when generating a link. The app resolves them when the recipient sends a message, not when the link is created or imported.

| Variable | Value |
| --- | --- |
| `{{user.name}}` | Global user name → agent default user name → empty string. |
| `{{agent.name}}` | Agent name. |
| `{{agent.description}}` | Agent description, or empty string. |
| `{{agent.version}}` | Configuration version. |
| `{{now.date}}` | Local browser date, `YYYY-MM-DD`. |
| `{{now.time}}` | Local browser time, `HH:mm:ss`. |
| `{{now.datetime}}` | UTC ISO 8601 timestamp, including `Z`. |
| `{{now.timezone}}` | Browser timezone, e.g. `Europe/Rome`. |
| `{{model.id}}` | Selected model's API ID, without the internal provider prefix. |
| `{{provider.name}}` | Selected provider's display name. |
| `{{app.version}}` | Application version. |
| `{{app.edition}}` | `Normal` or `Lite`. |
| `{{vars.KEY}}` | Custom value from this agent's `variables` object. |

Example agent fields:

```json
{
  "name": "Writing assistant",
  "userName": "Customer",
  "variables": { "company": "Acme" },
  "systemPrompt": "You are {{agent.name}}. Help {{user.name}} write for {{vars.company}}."
}
```

Custom keys start with a letter and contain only letters, digits and underscores. `constructor` and `prototype` are reserved. Text, number and boolean values are supported and normalized to strings. Custom variables are included in shared configurations.

Only the listed names and custom keys are available: arbitrary configuration paths, API keys, headers and JavaScript expressions cannot be resolved. Unknown placeholders are reported in the editor and block sending before a request or user message is created. Known optional values may be empty.

Expansion is a single pass. A custom value containing `{{user.name}}` remains literal. To include a literal placeholder in the template, prefix it with a backslash: `\{{user.name}}`. In JSON, encode that backslash as `\\{{user.name}}`.

## Editing and inheritance

In agent settings, **Instructions** provides **Insert variable**, custom variables as JSON and a **Resolved prompt preview**. Invalid custom JSON must be corrected before saving or leaving the editor. The preview shows a new conversation's prompt using the current profile, model and browser clock.

New conversations inherit the latest agent instructions. In **Instructions for this chat**, turn off **Use agent instructions** to save a conversation-specific template instead. Re-enable it to resume inheritance. Overrides support the same variables.

The template and resolved context are captured at the start of a response and reused through retries/tool continuations, even if another agent is selected. The next message gets a new snapshot. Resolved values and transient snapshots are not exported as configuration.

## Environment instructions

The platform block describes the browser environment, current timestamp/timezone, executable edition, supported formatting and tool boundaries. It leaves identity and response style to the agent instructions. Normal describes rendered formulas/diagrams and text extraction; Lite describes its text-only fallbacks.

Tools are usable only when actually exposed for the request; a configured MCP connection does not guarantee a callable tool. Memory, attachments and tool results are described as contextual data. These instructions describe the environment; permissions and execution limits are enforced by application code.

The environment block is enabled by default and can be disabled in **General → Advanced**. Agent variables work independently of that switch. Conversation memory remains a separate context block, not an instruction override.

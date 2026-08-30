# Excalidraw WebMCP

This local app is the standard Excalidraw editor with direct WebMCP control. It adds a visible Figma-like cursor whose name comes from the external agent that uses the canvas. It has no built-in agent, proposal layer, review flow, or custom canvas controls.

An external AI agent in a compatible browser can discover the tools through native `document.modelContext.registerTool`. Tool calls read or change the current live scene. Each change uses Excalidraw history, so the standard Undo control can reverse it.

## Run locally

Requirements: Node.js 20 or later and npm.

```bash
npm install
npm run dev -- --host 127.0.0.1 --port 4173
```

Open `http://127.0.0.1:4173/`.

## WebMCP tools

| Tool | Purpose |
| --- | --- |
| `set_agent_identity` | Set the current external agent's visible cursor name for this page session. |
| `read_canvas` | Read the current live elements, labels, bindings, locks, and scene revision. |
| `read_selection` | Read the current human selection. This tool exists only when there is a selection. |
| `move_agent_cursor` | Move the current agent to exact scene coordinates without changing canvas content. |
| `add_elements` | Add shapes, text, and frames directly. |
| `update_elements` | Move, resize, relabel, style, rotate, or lock elements directly. |
| `delete_elements` | Delete elements and remove dependent labels or connections. |
| `connect_elements` | Add bound arrows between live elements. |

Inputs have Zod validation. IDs remain stable across read and edit calls. Locked elements reject tool edits. Native registrations use one `AbortController` for cleanup. A hidden development adapter supports deterministic tests when native WebMCP is not available.

Each agent calls `set_agent_identity` once before it reads or edits the canvas. The neutral fallback is `AI Agent`. The identity is not stored across reloads, so another agent can claim its own name in a new session. The cursor then moves automatically to the related canvas objects during read and edit tools. The explicit cursor tool supports deliberate movement before an action. Motion uses an interruptible curved path, respects reduced-motion settings, ignores pointer input, and remains aligned with scene coordinates during pan and zoom.

## Test

Install the Playwright browser once:

```bash
npx playwright install chromium
```

Run all checks:

```bash
npm run check
```

The browser test starts the app on port `4173`. It enables Chromium experimental web platform features and tests native WebMCP discovery and tool execution. It also tests direct edits, selection changes, standard Excalidraw Undo, and local persistence.

## Main files

- `src/App.tsx` connects the live Excalidraw scene to direct tool handlers and local persistence.
- `src/cursor/AgentCursor.tsx` renders scene-aware agent presence and movement.
- `src/core/canvas-ops.ts` keeps direct scene edits and bindings valid.
- `src/webmcp/registry.ts` defines the focused WebMCP tool surface.
- `src/webmcp/use-webmcp.ts` registers native tools and manages cleanup.
- `tests/e2e/agent-canvas.spec.ts` tests the browser and native WebMCP flow.

## Excalidraw credit

This app uses the open-source [`@excalidraw/excalidraw`](https://github.com/excalidraw/excalidraw) component under the MIT license. Excalidraw is a separate project.

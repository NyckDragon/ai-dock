# KORA v0.1

KORA is the conversational/execution layer planned for the KERNEL + AI Dock ecosystem.

## Boundary

- **KORA:** session, conversational interaction, tool requests and job feedback.
- **KERNEL:** operational context, routing rules, guardrails, Context Packs and telemetry.
- **AI Dock:** local app/runtime surface and observability.
- **Workers/tools:** execute the actual work.

KORA must not duplicate the KERNEL's canonical rules.

## v0.1 milestone

Text-first flow:

1. Open a project context.
2. Read relevant pending tasks.
3. Create/update a task through the AI Inbox adapter.
4. Build a minimal Context Pack.
5. Delegate work as a Job.
6. Stream Job events back to the UI.
7. Persist relevant operational state and result references.

## Technical decisions

- Tauri events are the v0.1 UI/backend event bus.
- Operational state will use a dedicated local SQLite database.
- Credentials must stay in the OS credential store/keyring.
- The first task adapter targets the existing Notion AI Inbox & Task Log.
- Voice/realtime and Jev are explicitly out of scope until the text E2E is stable.

## Current branch

`feat/kora-v0.1-text-core`

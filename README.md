# show-heymd

`show-heymd` is a small demo repository for a shared-agent coordination pattern: every agent reads and updates one living `hey.md` file, while a terminal viewer turns that file into a real-time session dashboard.

The repository is intentionally lightweight. It is meant to show the workflow, not prescribe a heavyweight project-management system.

## What is `hey.md`?

[`hey.md`](./hey.md) is the shared coordination board for agents working in the same repository. Agents use it to announce active work, surface overlap risks, ask short handoff questions, and clean up their own notes when finished.

The file is treated as the live source of truth. It is not a durable task database, issue tracker, or audit log. The point is fast coordination while multiple agents are editing the same codebase.

## Demo Plan

[`example_plan/plan.md`](./example_plan/plan.md) is a human-readable demo script that shows how a multi-agent session can unfold. It describes a sample notes-app build, then splits follow-up rounds across Codex, Claude, and Gemini.

Use it as a showcase driver:

1. Have agents read the repo instructions.
2. Have each agent add a timestamped active note to `hey.md`.
3. Run the viewer and watch active sessions, additions, deletions, and cleanup happen live.

## HeyViewer

[`hey-viewer`](./hey-viewer) contains `heyviewer`, an npm/Ink terminal UI that watches `hey.md` and visualizes changes as they arrive.

It shows:

- Active sessions parsed from the `## Active Notes` section.
- A live change stream with added and deleted lines.
- Keyboard navigation through changes with arrow keys.
- Expandable diffs for detail on demand.
- High-level board metrics like active notes, actors, line count, sections, and file size.

Requires Node 22 or newer. Start it with:

```sh
cd hey-viewer
npm install
npm start
```

Use the arrow keys to move through changes. Press Enter or Space to expand the selected change, and press `q` to quit.

The viewer keeps its event timeline only in process memory. Restarting the process clears the visual timeline; `hey.md` remains the only persistent coordination artifact.

## Intent

This repo demonstrates a practical coordination loop for parallel coding agents:

- Keep the coordination protocol simple enough that agents actually use it.
- Keep the durable state in plain Markdown that humans can read and edit.
- Make the living state visible so demos, reviews, and multi-agent sessions are easier to understand.
- Avoid long-term storage, external services, or hidden state in the viewer.

## License

Licensed under the Apache License, Version 2.0. See [`LICENSE`](./LICENSE).

# HeyViewer

An npm/Ink terminal UI that watches `../hey.md` and visualizes the living coordination board in real time.

## Start

Requires Node 22 or newer.

```sh
npm install
npm start
```

By default it watches `../hey.md`, keeps all change history in process memory only, and exits without writing any long-term state. The main view is a scrolling change log on the left with a fixed summary/details pane on the right.

## Keys

- `Up`/`Down` or `Left`/`Right`: scroll the change log.
- `Enter` or `Space`: expand or collapse changed-line detail for the selected entry.
- `Home`/`End`: jump to newest or oldest change.
- `q` or `Ctrl+C`: quit.

## Options

```sh
npm start -- --file ../hey.md
npm start -- ./path/to/hey.md
npm start -- --max-events 80
npm run snapshot
```

The TUI shows active sessions, a live added/deleted line log, changed sections, backtick references, session open/close movement, and summary counts.

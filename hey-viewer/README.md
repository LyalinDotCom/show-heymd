# HeyViewer

An npm/Ink terminal UI that watches `../hey.md` and visualizes the living coordination board in real time.

## Start

Requires Node 22 or newer.

```sh
npm install
npm start
```

By default it watches `../hey.md`, keeps state in process memory only, and exits without writing any long-term state. The main view shows `hey.md` directly on the left with light Markdown coloring, and a simple coordination summary on the right.

## Keys

- `Up`/`Down`: scroll `hey.md` one line.
- `j`/`k`: scroll `hey.md` one line.
- `PageUp`/`PageDown`, `b`/`f`, Space, or `Left`/`Right`: scroll one page.
- `Home`/`End` or `g`/`G`: jump to top or bottom.
- `q` or `Ctrl+C`: quit.

## Options

```sh
npm start -- --file ../hey.md
npm start -- ./path/to/hey.md
npm run snapshot
```

The summary counts coordination tasks from the `## Active Notes` section. Notes timestamped within the last hour are active; notes one hour or older are older.

#!/usr/bin/env node
import { existsSync, watch } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import React, { useEffect, useState } from "react";
import { Box, Text, render, useApp, useInput, useWindowSize } from "ink";
import {
  analyzeMarkdown,
  buildEvent,
  parseArgs,
  summarizeSnapshot,
} from "./model.js";

const h = React.createElement;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageDir = path.resolve(__dirname, "..");

function helpText() {
  return [
    "HeyViewer - terminal UI for a live hey.md coordination board",
    "",
    "Usage:",
    "  npm start",
    "  npm start -- --file ../hey.md",
    "  node src/cli.js ./hey.md",
    "  heyviewer ./hey.md      after npm link",
    "",
    "Options:",
    "  -f, --file <path>       Markdown file to watch. Defaults to ../hey.md.",
    "  --max-events <number>   Keep this many in-session changes. Default: 240.",
    "  --snapshot, --once      Print a one-time text summary and exit.",
    "  -h, --help              Show this help.",
    "",
    "Keys:",
    "  Up/Down or Left/Right   Scroll the change log.",
    "  Enter or Space          Expand/collapse selected change details on the right.",
    "  Home/End                Jump to newest/oldest change.",
    "  q or Ctrl+C             Quit.",
  ].join("\n");
}

function formatTime(value) {
  if (!value) return "never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function truncate(value, width) {
  const text = String(value ?? "");
  if (width <= 1) return "";
  if (text.length <= width) return text;
  return `${text.slice(0, Math.max(1, width - 3))}...`;
}

function joinList(values, fallback = "none") {
  return values?.length ? values.join(", ") : fallback;
}

function plural(count, singular, pluralValue = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralValue}`;
}

function compactBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

async function readTarget(targetPath) {
  const [text, fileStat] = await Promise.all([readFile(targetPath, "utf8"), stat(targetPath)]);
  return { text, mtimeMs: fileStat.mtimeMs };
}

function makeInitialState() {
  return {
    text: "",
    analysis: analyzeMarkdown(""),
    timeline: [],
    revision: 0,
    updatedAt: null,
    mtimeMs: 0,
    error: null,
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function Panel({ title, titleRight = "", children, width, height, flexGrow = 1, marginRight = 0, marginBottom = 0 }) {
  return h(
    Box,
    {
      flexDirection: "column",
      borderStyle: "single",
      borderColor: "gray",
      paddingX: 1,
      width,
      height,
      flexGrow,
      marginRight,
      marginBottom,
    },
    h(
      Box,
      {
        justifyContent: "space-between",
        borderStyle: "single",
        borderTop: false,
        borderLeft: false,
        borderRight: false,
        borderColor: "gray",
      },
      h(Text, { bold: true, color: "cyan" }, title),
      titleRight ? h(Text, { color: "gray" }, titleRight) : null,
    ),
    children,
  );
}

function ChangeLog({ timeline, selectedIndex, width, bodyRows }) {
  if (timeline.length === 0) {
    return h(Box, { paddingY: 1 }, h(Text, { color: "gray" }, "Waiting for the first file read."));
  }

  const visibleCount = Math.max(1, Math.floor(Math.max(2, bodyRows - 2) / 2));
  const maxStart = Math.max(0, timeline.length - visibleCount);
  const start = clamp(selectedIndex - Math.floor(visibleCount / 3), 0, maxStart);
  const visible = timeline.slice(start, start + visibleCount);
  const rows = [];

  if (start > 0) {
    rows.push(h(Text, { key: "newer", color: "gray" }, `${start} newer entries above`));
  }

  for (const [offset, event] of visible.entries()) {
    const index = start + offset;
    const selected = index === selectedIndex;
    const prefix = selected ? ">" : " ";
    const count = `+${event.additions.length}/-${event.deletions.length}`;
    const section = joinList(event.changedSections, event.type === "snapshot" ? "snapshot" : "unknown");
    rows.push(
      h(
        Text,
        {
          key: `${event.id}-headline`,
          color: selected ? "black" : undefined,
          backgroundColor: selected ? "cyan" : undefined,
        },
        `${prefix} ${formatTime(event.at)} ${count} ${truncate(event.headline, Math.max(24, width - 24))}`,
      ),
    );
    rows.push(
      h(
        Text,
        { key: `${event.id}-meta`, color: "gray" },
        `  ${truncate(section, Math.max(12, width - 16))} | refs: ${truncate(joinList(event.touchedTokens), Math.max(10, width - 26))}`,
      ),
    );
  }

  const older = timeline.length - (start + visible.length);
  if (older > 0) {
    rows.push(h(Text, { key: "older", color: "gray" }, `${older} older entries below`));
  }

  return h(Box, { flexDirection: "column" }, ...rows);
}

function ActiveSessions({ notes, width, limit }) {
  if (notes.length === 0) return [h(Text, { key: "none", color: "gray" }, "No active sessions.")];

  const rows = [];
  for (const note of notes.slice(0, limit)) {
    rows.push(h(Text, { key: `${note.id}-actor` }, h(Text, { color: "green", bold: true }, note.actor), h(Text, { color: "gray" }, ` line ${note.line}`)));
    rows.push(h(Text, { key: `${note.id}-message` }, truncate(note.message, width - 4)));
  }
  if (notes.length > limit) rows.push(h(Text, { key: "more", color: "gray" }, `+${notes.length - limit} more sessions`));
  return rows;
}

function DiffRows({ event, expanded, width, limit }) {
  if (!expanded) {
    return [h(Text, { key: "hint", color: "gray" }, "Press Enter to show changed lines.")];
  }

  const rows = [];
  for (const line of event.additions.slice(0, limit)) {
    rows.push(h(Text, { key: `a-${line.line}-${line.text}`, color: "green" }, `+${line.line}: ${truncate(line.text || " ", width - 8)}`));
  }
  for (const line of event.deletions.slice(0, limit)) {
    rows.push(h(Text, { key: `d-${line.line}-${line.text}`, color: "red" }, `-${line.line}: ${truncate(line.text || " ", width - 8)}`));
  }
  if (rows.length === 0) rows.push(h(Text, { key: "empty", color: "gray" }, "No changed lines in this entry."));
  const hidden = event.additions.length + event.deletions.length - rows.length;
  if (hidden > 0) rows.push(h(Text, { key: "hidden", color: "gray" }, `+${hidden} more changed lines hidden`));
  return rows;
}

function SummaryPane({ state, selectedEvent, expanded, width, bodyRows }) {
  const stats = state.analysis.stats;
  const event = selectedEvent;
  const opened = event?.noteChanges.opened.map((note) => `${note.actor}: ${note.message}`) || [];
  const closed = event?.noteChanges.closed.map((note) => `${note.actor}: ${note.message}`) || [];
  const sections = state.analysis.sections.slice(0, 5).map((section) => `${section.title}(${section.lines})`);
  const sessionLimit = Math.max(1, Math.min(4, Math.floor(bodyRows / 8)));
  const diffLimit = Math.max(2, Math.min(8, bodyRows - 14));

  const rows = [
    h(
      Text,
      { key: "counts" },
      h(Text, { color: "gray" }, "entries "),
      h(Text, { color: "cyan", bold: true }, String(state.timeline.length)),
      h(Text, { color: "gray" }, " | active "),
      h(Text, { color: stats.activeNotes ? "green" : "gray", bold: true }, String(stats.activeNotes)),
    ),
    h(
      Text,
      { key: "file-counts" },
      h(Text, { color: "gray" }, "actors "),
      h(Text, { color: stats.actors ? "cyan" : "gray", bold: true }, String(stats.actors)),
      h(Text, { color: "gray" }, " | lines "),
      h(Text, { bold: true }, String(stats.lines)),
    ),
    h(
      Text,
      { key: "shape-counts" },
      h(Text, { color: "gray" }, "size "),
      h(Text, { bold: true }, compactBytes(stats.bytes)),
      h(Text, { color: "gray" }, " | sections "),
      h(Text, { bold: true }, String(stats.headings)),
    ),
    h(Text, { key: "spacer-1" }, ""),
    h(Text, { key: "sessions-title", color: "cyan", bold: true }, "Active Sessions"),
    ...ActiveSessions({ notes: state.analysis.activeNotes, width, limit: sessionLimit }),
    h(Text, { key: "spacer-2" }, ""),
    h(Text, { key: "selected-title", color: "cyan", bold: true }, "Selected Entry"),
  ];

  if (!event) {
    rows.push(h(Text, { key: "no-entry", color: "gray" }, "No change selected."));
  } else {
    rows.push(h(Text, { key: "headline", bold: true }, truncate(event.headline, width - 4)));
    rows.push(h(Text, { key: "meta", color: "gray" }, `rev ${event.revision} | ${formatTime(event.at)} | ${plural(event.additions.length, "add")} | ${plural(event.deletions.length, "delete")}`));
    rows.push(h(Text, { key: "selected-sections" }, "sections: ", h(Text, { color: "cyan" }, truncate(joinList(event.changedSections), width - 14))));
    if (event.addedTokens.length) {
      rows.push(h(Text, { key: "refs-add" }, "added refs: ", h(Text, { color: "green" }, truncate(joinList(event.addedTokens), width - 15))));
    }
    if (event.deletedTokens.length) {
      rows.push(h(Text, { key: "refs-del" }, "deleted refs: ", h(Text, { color: "red" }, truncate(joinList(event.deletedTokens), width - 17))));
    }
    if (opened.length) {
      rows.push(h(Text, { key: "opened" }, "opened: ", h(Text, { color: "green" }, truncate(joinList(opened), width - 12))));
    }
    if (closed.length) {
      rows.push(h(Text, { key: "closed" }, "closed: ", h(Text, { color: "red" }, truncate(joinList(closed), width - 12))));
    }
    rows.push(h(Text, { key: "spacer-3" }, ""));
    rows.push(h(Text, { key: "diff-title", color: "cyan", bold: true }, expanded ? "Changed Lines" : "Changed Lines Hidden"));
    rows.push(...DiffRows({ event, expanded, width, limit: diffLimit }));
  }

  rows.push(h(Text, { key: "spacer-4" }, ""));
  rows.push(h(Text, { key: "shape", color: "gray" }, `shape: ${truncate(joinList(sections), width - 8)}`));
  rows.push(h(Text, { key: "keys", color: "gray" }, "keys: arrows scroll | enter details | q quits"));

  return h(Box, { flexDirection: "column" }, ...rows.slice(0, Math.max(1, bodyRows)));
}

function Footer({ error, targetPath, cwd }) {
  if (error) {
    return h(Text, { color: "red" }, `watch error: ${error.message}`);
  }
  return h(Text, { color: "gray" }, `watching ${path.relative(cwd, targetPath) || targetPath}`);
}

function App({ targetPath, maxEvents }) {
  const { exit } = useApp();
  const { columns, rows } = useWindowSize();
  const terminalColumns = columns || 100;
  const terminalRows = rows || 30;
  const stacked = terminalColumns < 76;
  const rightWidth = stacked ? terminalColumns : clamp(Math.floor(terminalColumns * 0.34), 30, 48);
  const leftWidth = stacked ? terminalColumns : Math.max(34, terminalColumns - rightWidth - 1);
  const bodyHeight = Math.max(16, terminalRows - 5);
  const logBodyRows = stacked ? Math.max(8, Math.floor(bodyHeight * 0.48)) : bodyHeight - 3;
  const summaryBodyRows = stacked ? Math.max(10, bodyHeight - logBodyRows - 1) : bodyHeight - 3;
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [expandedIds, setExpandedIds] = useState(() => new Set());
  const [state, setState] = useState(makeInitialState);

  const selectedEvent = state.timeline[selectedIndex] || null;
  const selectedExpanded = selectedEvent ? expandedIds.has(selectedEvent.id) : false;

  useInput((input, key) => {
    if (input === "q" || key.escape || (key.ctrl && input === "c")) {
      exit();
      return;
    }

    if (key.upArrow || key.leftArrow) {
      setSelectedIndex((current) => Math.max(0, current - 1));
    } else if (key.downArrow || key.rightArrow) {
      setSelectedIndex((current) => Math.min(Math.max(0, state.timeline.length - 1), current + 1));
    } else if (key.home) {
      setSelectedIndex(0);
    } else if (key.end) {
      setSelectedIndex(Math.max(0, state.timeline.length - 1));
    } else if (key.return || input === " ") {
      const event = state.timeline[selectedIndex];
      if (!event) return;
      setExpandedIds((current) => {
        const next = new Set(current);
        if (next.has(event.id)) {
          next.delete(event.id);
        } else {
          next.add(event.id);
        }
        return next;
      });
    }
  });

  useEffect(() => {
    let disposed = false;
    let refreshTimer = null;
    let pollTimer = null;
    let watcher = null;

    async function refresh(type = "change") {
      try {
        const next = await readTarget(targetPath);
        if (disposed) return;

        setState((current) => {
          if (type !== "snapshot" && next.text === current.text) {
            return { ...current, mtimeMs: next.mtimeMs, error: null };
          }

          const previousAnalysis = current.analysis;
          const nextAnalysis = analyzeMarkdown(next.text);
          const revision = current.revision + 1;
          const event = buildEvent(type, current.text, next.text, previousAnalysis, nextAnalysis, revision);
          return {
            text: next.text,
            analysis: nextAnalysis,
            timeline: [event, ...current.timeline].slice(0, maxEvents),
            revision,
            updatedAt: new Date().toISOString(),
            mtimeMs: next.mtimeMs,
            error: null,
          };
        });
        setSelectedIndex(0);
      } catch (error) {
        if (!disposed) {
          setState((current) => ({ ...current, error }));
        }
      }
    }

    function scheduleRefresh() {
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => refresh("change"), 90);
    }

    refresh("snapshot");

    try {
      watcher = watch(targetPath, { persistent: true }, scheduleRefresh);
    } catch (error) {
      setState((current) => ({ ...current, error }));
    }

    pollTimer = setInterval(async () => {
      try {
        const fileStat = await stat(targetPath);
        setState((current) => {
          if (fileStat.mtimeMs !== current.mtimeMs) {
            scheduleRefresh();
          }
          return current;
        });
      } catch (error) {
        setState((current) => ({ ...current, error }));
      }
    }, 1400);

    return () => {
      disposed = true;
      clearTimeout(refreshTimer);
      clearInterval(pollTimer);
      watcher?.close();
    };
  }, [targetPath, maxEvents]);

  useEffect(() => {
    setSelectedIndex((current) => Math.min(current, Math.max(0, state.timeline.length - 1)));
  }, [state.timeline.length]);

  const stats = state.analysis.stats;
  const status = state.error ? "error" : "live";
  const headerColor = state.error ? "red" : "green";
  const relativeTarget = path.relative(process.cwd(), targetPath) || targetPath;
  const headerRight = `${status} | rev ${state.revision} | entries ${state.timeline.length} | updated ${formatTime(state.updatedAt)}`;

  return h(
    Box,
    { flexDirection: "column" },
    h(
      Box,
      { justifyContent: "space-between" },
      h(Text, { bold: true, color: "cyan" }, "HeyViewer"),
      h(Text, { color: headerColor }, headerRight),
    ),
    h(Text, { color: "gray" }, `${relativeTarget} | ${stats.activeNotes} active | ${stats.actors} actors | ${stats.lines} lines`),
    h(
      Box,
      { marginTop: 1, flexDirection: stacked ? "column" : "row" },
      h(
        Panel,
        {
          title: "Change Log",
          titleRight: `${state.timeline.length ? selectedIndex + 1 : 0}/${state.timeline.length}`,
          width: leftWidth,
          height: stacked ? logBodyRows + 3 : bodyHeight,
          flexGrow: stacked ? 1 : 2,
          marginRight: stacked ? 0 : 1,
          marginBottom: stacked ? 1 : 0,
        },
        h(ChangeLog, { timeline: state.timeline, selectedIndex, width: leftWidth - 4, bodyRows: logBodyRows }),
      ),
      h(
        Panel,
        {
          title: "Summary",
          titleRight: selectedExpanded ? "expanded" : "fixed",
          width: rightWidth,
          height: stacked ? summaryBodyRows + 3 : bodyHeight,
          flexGrow: 1,
        },
        h(SummaryPane, { state, selectedEvent, expanded: selectedExpanded, width: rightWidth - 4, bodyRows: summaryBodyRows }),
      ),
    ),
    h(Box, { marginTop: 1 }, h(Footer, { error: state.error, targetPath, cwd: process.cwd() })),
  );
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2), packageDir);
  } catch (error) {
    console.error(error.message);
    console.error("");
    console.error(helpText());
    process.exit(1);
  }

  if (options.help) {
    console.log(helpText());
    return;
  }

  if (!existsSync(options.targetPath)) {
    console.error(`Cannot find ${options.targetPath}`);
    process.exit(1);
  }

  if (options.snapshot) {
    const text = await readFile(options.targetPath, "utf8");
    const snapshot = summarizeSnapshot(text);
    console.log(snapshot.headline);
    for (const note of snapshot.analysis.activeNotes) {
      console.log(`- ${note.actor} line ${note.line}: ${note.message}`);
    }
    return;
  }

  render(h(App, { targetPath: options.targetPath, maxEvents: options.maxEvents }));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});

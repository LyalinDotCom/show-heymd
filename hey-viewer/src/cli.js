#!/usr/bin/env node
import { existsSync, watch } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import React, { useEffect, useState } from "react";
import { Box, Text, render, useApp, useInput, useWindowSize } from "ink";
import {
  analyzeMarkdown,
  parseArgs,
  splitLines,
  summarizeSnapshot,
} from "./model.js";

const h = React.createElement;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageDir = path.resolve(__dirname, "..");
const oneHourMs = 60 * 60 * 1000;

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
    "  --snapshot, --once      Print a one-time text summary and exit.",
    "  -h, --help              Show this help.",
    "",
    "Keys:",
    "  Up/Down                 Scroll hey.md one line.",
    "  j/k                     Scroll hey.md one line.",
    "  PageUp/PageDown         Scroll hey.md one page.",
    "  Left/Right or b/f       Scroll hey.md one page.",
    "  Home/End or g/G         Jump to top/bottom.",
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

function formatShortTime(value) {
  if (!value) return "never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function compactBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function truncate(value, width) {
  const text = String(value ?? "");
  if (width <= 1) return "";
  if (text.length <= width) return text;
  return `${text.slice(0, Math.max(1, width - 3))}...`;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

async function readTarget(targetPath) {
  const [text, fileStat] = await Promise.all([readFile(targetPath, "utf8"), stat(targetPath)]);
  return { text, mtimeMs: fileStat.mtimeMs };
}

function makeInitialState() {
  return {
    text: "",
    analysis: analyzeMarkdown(""),
    revision: 0,
    updatedAt: null,
    mtimeMs: 0,
    error: null,
  };
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

function parseNoteTimestamp(timestamp) {
  if (!timestamp) return null;
  const normalized = timestamp
    .replace(/\s+EDT$/i, " -0400")
    .replace(/\s+EST$/i, " -0500")
    .replace(/\s+CDT$/i, " -0500")
    .replace(/\s+CST$/i, " -0600")
    .replace(/\s+MDT$/i, " -0600")
    .replace(/\s+MST$/i, " -0700")
    .replace(/\s+PDT$/i, " -0700")
    .replace(/\s+PST$/i, " -0800")
    .replace(/\s+UTC$/i, " +0000");
  const time = Date.parse(normalized);
  return Number.isNaN(time) ? null : time;
}

function ageLabel(timestamp, now) {
  const time = parseNoteTimestamp(timestamp);
  if (!time) return "unknown age";
  const delta = Math.max(0, now - time);
  if (delta < 60 * 1000) return "now";
  if (delta < oneHourMs) return `${Math.floor(delta / 60000)}m`;
  if (delta < 24 * oneHourMs) return `${Math.floor(delta / oneHourMs)}h`;
  return `${Math.floor(delta / (24 * oneHourMs))}d`;
}

function coordinationSummary(notes, now = Date.now()) {
  const active = [];
  const older = [];
  const activeAgents = new Set();
  const olderAgents = new Set();

  for (const note of notes) {
    const time = parseNoteTimestamp(note.timestamp);
    const isRecent = time !== null && now - time < oneHourMs;
    if (isRecent) {
      active.push(note);
      activeAgents.add(note.actor);
    } else {
      older.push(note);
      olderAgents.add(note.actor);
    }
  }

  return { active, older, activeAgents, olderAgents };
}

function inlineMarkdown(text, color = undefined) {
  const parts = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*)/g;
  let cursor = 0;
  let index = 0;

  for (const match of text.matchAll(pattern)) {
    if (match.index > cursor) {
      parts.push(h(Text, { key: `t-${index}`, color }, text.slice(cursor, match.index)));
      index += 1;
    }

    const token = match[0];
    if (token.startsWith("`")) {
      parts.push(h(Text, { key: `c-${index}`, color: "yellow" }, token));
    } else {
      parts.push(h(Text, { key: `b-${index}`, bold: true, color }, token));
    }
    index += 1;
    cursor = match.index + token.length;
  }

  if (cursor < text.length) {
    parts.push(h(Text, { key: `t-${index}`, color }, text.slice(cursor)));
  }

  return parts.length ? parts : [h(Text, { key: "empty", color }, "")];
}

function MarkdownLine({ line, width }) {
  if (line.length === 0) return h(Text, null, " ");

  const text = truncate(line, width);
  const trimmed = text.trim();
  const heading = text.match(/^(#{1,6})(\s+.*)$/);
  if (heading) {
    return h(
      Text,
      null,
      h(Text, { color: "gray" }, heading[1]),
      h(Text, { color: "cyan", bold: true }, heading[2]),
    );
  }

  let color;
  let bold = false;
  if (/^\s*[-*]\s+/.test(text) || /^\s*\d+\.\s+/.test(text)) {
    color = "green";
  } else if (/^\s*>/.test(text)) {
    color = "yellow";
  } else if (/^\s*(```|---|\*\*\*)/.test(text)) {
    color = "gray";
  } else if (/^No active notes\.?$/i.test(trimmed)) {
    color = "gray";
  }

  return h(
    Text,
    { color, bold },
    ...inlineMarkdown(text, color),
  );
}

function MarkdownViewer({ text, scrollOffset, width, bodyRows }) {
  const lines = splitLines(text);
  if (lines.length === 0) {
    return h(Text, { color: "gray" }, "Waiting for file read.");
  }

  const visible = lines.slice(scrollOffset, scrollOffset + bodyRows);
  return h(
    Box,
    { flexDirection: "column" },
    ...visible.map((line, index) =>
      h(MarkdownLine, {
        key: `${scrollOffset + index}-${line}`,
        line,
        width,
      }),
    ),
  );
}

function AgentList({ title, notes, width, now, keyPrefix }) {
  const rows = [h(Text, { key: `${keyPrefix}-title`, color: "cyan", bold: true }, title)];
  if (notes.length === 0) {
    rows.push(h(Text, { key: `${keyPrefix}-none`, color: "gray" }, "none"));
    return rows;
  }

  for (const note of notes.slice(0, 5)) {
    rows.push(
      h(
        Text,
        { key: `${keyPrefix}-${note.id}` },
        h(Text, { color: "green", bold: true }, note.actor),
        h(Text, { color: "gray" }, ` ${ageLabel(note.timestamp, now)} `),
        truncate(note.message, width - note.actor.length - 8),
      ),
    );
  }
  if (notes.length > 5) rows.push(h(Text, { key: `${keyPrefix}-more`, color: "gray" }, `+${notes.length - 5} more`));
  return rows;
}

function SummaryPane({ analysis, updatedAt, revision, width, bodyRows }) {
  const now = Date.now();
  const summary = coordinationSummary(analysis.activeNotes, now);
  const rows = [
    h(Text, { key: "active" }, "active <1h: ", h(Text, { color: summary.active.length ? "green" : "gray", bold: true }, String(summary.active.length))),
    h(Text, { key: "older" }, "older 1h+: ", h(Text, { color: summary.older.length ? "yellow" : "gray", bold: true }, String(summary.older.length))),
    h(Text, { key: "agents", color: "gray" }, `agents ${summary.activeAgents.size}/${summary.olderAgents.size}`),
    h(Text, { key: "file", color: "gray" }, `${analysis.stats.lines} lines | ${compactBytes(analysis.stats.bytes)}`),
    h(Text, { key: "updated", color: "gray" }, `rev ${revision} | ${formatShortTime(updatedAt)}`),
    h(Text, { key: "spacer-1" }, ""),
    ...AgentList({ title: "Active", notes: summary.active, width, now, keyPrefix: "active" }),
    h(Text, { key: "spacer-2" }, ""),
    ...AgentList({ title: "Older", notes: summary.older, width, now, keyPrefix: "older" }),
  ];

  return h(Box, { flexDirection: "column" }, ...rows.slice(0, bodyRows));
}

function Footer({ error, targetPath, cwd }) {
  if (error) {
    return h(Text, { color: "red" }, `watch error: ${error.message}`);
  }
  return h(Text, { color: "gray" }, `watching ${path.relative(cwd, targetPath) || targetPath}`);
}

function App({ targetPath }) {
  const { exit } = useApp();
  const { columns, rows } = useWindowSize();
  const terminalColumns = columns || 100;
  const terminalRows = rows || 30;
  const stacked = terminalColumns < 76;
  const rightWidth = stacked ? terminalColumns : clamp(Math.floor(terminalColumns * 0.3), 28, 40);
  const leftWidth = stacked ? terminalColumns : Math.max(40, terminalColumns - rightWidth - 1);
  const bodyHeight = Math.max(16, terminalRows - 5);
  const leftBodyRows = stacked ? Math.max(8, Math.floor(bodyHeight * 0.58)) : bodyHeight - 3;
  const rightBodyRows = stacked ? Math.max(8, bodyHeight - leftBodyRows - 1) : bodyHeight - 3;
  const [scrollOffset, setScrollOffset] = useState(0);
  const [state, setState] = useState(makeInitialState);

  useInput((input, key) => {
    if (input === "q" || key.escape || (key.ctrl && input === "c")) {
      exit();
      return;
    }

    const maxOffset = Math.max(0, state.analysis.stats.lines - leftBodyRows);
    if (key.upArrow || input === "k") {
      setScrollOffset((current) => clamp(current - 1, 0, maxOffset));
    } else if (key.downArrow || input === "j") {
      setScrollOffset((current) => clamp(current + 1, 0, maxOffset));
    } else if (key.leftArrow || key.pageUp || input === "b") {
      setScrollOffset((current) => clamp(current - leftBodyRows, 0, maxOffset));
    } else if (key.rightArrow || key.pageDown || input === " " || input === "f") {
      setScrollOffset((current) => clamp(current + leftBodyRows, 0, maxOffset));
    } else if (key.home || input === "g") {
      setScrollOffset(0);
    } else if (key.end || input === "G") {
      setScrollOffset(maxOffset);
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

          return {
            text: next.text,
            analysis: analyzeMarkdown(next.text),
            revision: current.revision + 1,
            updatedAt: new Date().toISOString(),
            mtimeMs: next.mtimeMs,
            error: null,
          };
        });
      } catch (error) {
        if (!disposed) setState((current) => ({ ...current, error }));
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
          if (fileStat.mtimeMs !== current.mtimeMs) scheduleRefresh();
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
  }, [targetPath]);

  useEffect(() => {
    const maxOffset = Math.max(0, state.analysis.stats.lines - leftBodyRows);
    setScrollOffset((current) => clamp(current, 0, maxOffset));
  }, [state.analysis.stats.lines, leftBodyRows]);

  const status = state.error ? "error" : "live";
  const headerColor = state.error ? "red" : "green";
  const relativeTarget = path.relative(process.cwd(), targetPath) || targetPath;
  const maxOffset = Math.max(0, state.analysis.stats.lines - leftBodyRows);
  const position = state.analysis.stats.lines
    ? `${scrollOffset + 1}-${Math.min(state.analysis.stats.lines, scrollOffset + leftBodyRows)}/${state.analysis.stats.lines}`
    : "0/0";

  return h(
    Box,
    { flexDirection: "column" },
    h(
      Box,
      { justifyContent: "space-between" },
      h(Text, { bold: true, color: "cyan" }, "HeyViewer"),
      h(Text, { color: headerColor }, `${status} | ${formatTime(state.updatedAt)}`),
    ),
    h(Text, { color: "gray" }, `${relativeTarget} | scroll ${position} | j/k page: f/b`),
    h(
      Box,
      { marginTop: 1, flexDirection: stacked ? "column" : "row" },
      h(
        Panel,
        {
          title: "hey.md",
          titleRight: maxOffset > 0 ? position : "",
          width: leftWidth,
          height: stacked ? leftBodyRows + 3 : bodyHeight,
          flexGrow: stacked ? 1 : 2,
          marginRight: stacked ? 0 : 1,
          marginBottom: stacked ? 1 : 0,
        },
        h(MarkdownViewer, { text: state.text, scrollOffset, width: leftWidth - 4, bodyRows: leftBodyRows }),
      ),
      h(
        Panel,
        {
          title: "Coordination",
          titleRight: "simple",
          width: rightWidth,
          height: stacked ? rightBodyRows + 3 : bodyHeight,
          flexGrow: 1,
        },
        h(SummaryPane, {
          analysis: state.analysis,
          updatedAt: state.updatedAt,
          revision: state.revision,
          width: rightWidth - 4,
          bodyRows: rightBodyRows,
        }),
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

  render(h(App, { targetPath: options.targetPath }));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});

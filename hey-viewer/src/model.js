import path from "node:path";

export function splitLines(text) {
  return text.length === 0 ? [] : text.split(/\r?\n/);
}

export function hashText(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function extractBacktickTokens(text) {
  const tokens = [];
  for (const match of text.matchAll(/`([^`]+)`/g)) {
    const token = match[1].trim();
    if (token && !tokens.includes(token)) tokens.push(token);
  }
  return tokens;
}

export function parseArgs(argv, cwd) {
  const options = {
    targetPath: path.resolve(cwd, "..", "hey.md"),
    maxEvents: 240,
    snapshot: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--snapshot" || arg === "--once") {
      options.snapshot = true;
    } else if (arg === "--file" || arg === "-f") {
      index += 1;
      if (!argv[index]) throw new Error("--file requires a path");
      options.targetPath = path.resolve(process.cwd(), argv[index]);
    } else if (arg.startsWith("--file=")) {
      options.targetPath = path.resolve(process.cwd(), arg.slice("--file=".length));
    } else if (arg === "--max-events") {
      index += 1;
      options.maxEvents = readPositiveInteger(argv[index], options.maxEvents);
    } else if (arg.startsWith("--max-events=")) {
      options.maxEvents = readPositiveInteger(arg.slice("--max-events=".length), options.maxEvents);
    } else if (!arg.startsWith("-")) {
      options.targetPath = path.resolve(process.cwd(), arg);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

export function readPositiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

export function parseActiveNotes(lines) {
  const startIndex = lines.findIndex((line) => /^##\s+Active Notes\s*$/i.test(line.trim()));
  if (startIndex === -1) return [];

  const block = [];
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    if (/^##\s+/.test(lines[index])) break;
    block.push({ line: index + 1, text: lines[index] });
  }

  const notes = [];
  let current = null;

  const pushCurrent = () => {
    if (!current) return;
    const raw = current.raw.trim();
    if (raw && !/^No active notes\.?$/i.test(raw)) notes.push(parseActiveNote(current));
    current = null;
  };

  for (const entry of block) {
    const bulletMatch = entry.text.match(/^\s*[-*]\s+(.+)$/);
    if (bulletMatch) {
      pushCurrent();
      current = { line: entry.line, raw: bulletMatch[1], detailLines: [] };
      continue;
    }

    if (current && entry.text.trim()) {
      current.detailLines.push(entry.text.trim());
    }
  }

  pushCurrent();
  return notes;
}

export function parseActiveNote(note) {
  const fullText = [note.raw, ...note.detailLines].join("\n");
  const timestampMatch = note.raw.match(
    /^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(?::\d{2})?(?:\s+[A-Z]{2,5})?)\s*[-–—]\s*(.+)$/
  );
  const timestamp = timestampMatch ? timestampMatch[1] : "";
  const rest = timestampMatch ? timestampMatch[2] : note.raw;
  const actorMatch = rest.match(/^([^:]{1,48}):\s*(.*)$/);
  const actor = actorMatch ? actorMatch[1].trim() : "Unknown";
  const message = actorMatch ? actorMatch[2].trim() : rest.trim();

  return {
    id: `${note.line}-${hashText(fullText)}`,
    line: note.line,
    timestamp,
    actor,
    message,
    detail: note.detailLines.join("\n"),
    raw: fullText,
    tokens: extractBacktickTokens(fullText),
  };
}

export function analyzeMarkdown(text) {
  const lines = splitLines(text);
  const headings = [];
  const sections = [];
  let currentSection = {
    title: "Preamble",
    level: 0,
    line: 1,
    lines: 0,
  };

  for (let index = 0; index < lines.length; index += 1) {
    const heading = lines[index].match(/^(#{1,6})\s+(.+?)\s*$/);
    if (heading) {
      if (currentSection.lines > 0 || currentSection.title !== "Preamble") {
        sections.push(currentSection);
      }
      currentSection = {
        title: heading[2],
        level: heading[1].length,
        line: index + 1,
        lines: 1,
      };
      headings.push({
        title: heading[2],
        level: heading[1].length,
        line: index + 1,
      });
      continue;
    }
    currentSection.lines += 1;
  }
  if (lines.length > 0) sections.push(currentSection);

  const activeNotes = parseActiveNotes(lines);
  const actors = new Map();
  for (const note of activeNotes) {
    const current = actors.get(note.actor) || {
      actor: note.actor,
      count: 0,
      latestTimestamp: "",
      latestLine: 0,
      tokens: [],
    };
    current.count += 1;
    current.latestTimestamp = note.timestamp || current.latestTimestamp;
    current.latestLine = Math.max(current.latestLine, note.line);
    for (const token of note.tokens) {
      if (!current.tokens.includes(token)) current.tokens.push(token);
    }
    actors.set(note.actor, current);
  }

  const words = text.trim() ? text.trim().split(/\s+/).length : 0;

  return {
    stats: {
      bytes: Buffer.byteLength(text, "utf8"),
      characters: text.length,
      lines: lines.length,
      words,
      headings: headings.length,
      activeNotes: activeNotes.length,
      actors: actors.size,
    },
    headings,
    sections,
    activeNotes,
    actors: Array.from(actors.values()).sort((a, b) => b.latestLine - a.latestLine),
    tokens: extractBacktickTokens(text),
  };
}

export function sectionAtLine(lines, lineNumber) {
  let section = "Preamble";
  const lineIndex = Math.max(0, Math.min(lines.length - 1, lineNumber - 1));
  for (let index = 0; index <= lineIndex; index += 1) {
    const heading = lines[index]?.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (heading) section = heading[2];
  }
  return section;
}

export function diffByPrefixSuffix(oldLines, newLines) {
  let prefix = 0;
  while (
    prefix < oldLines.length &&
    prefix < newLines.length &&
    oldLines[prefix] === newLines[prefix]
  ) {
    prefix += 1;
  }

  let suffix = 0;
  while (
    suffix < oldLines.length - prefix &&
    suffix < newLines.length - prefix &&
    oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  return {
    additions: newLines.slice(prefix, newLines.length - suffix).map((text, index) => ({
      line: prefix + index + 1,
      text,
    })),
    deletions: oldLines.slice(prefix, oldLines.length - suffix).map((text, index) => ({
      line: prefix + index + 1,
      text,
    })),
    truncated: true,
  };
}

export function diffLines(oldText, newText) {
  const oldLines = splitLines(oldText);
  const newLines = splitLines(newText);

  if (oldLines.length * newLines.length > 900000) {
    return diffByPrefixSuffix(oldLines, newLines);
  }

  const matrix = Array.from({ length: oldLines.length + 1 }, () => new Uint32Array(newLines.length + 1));
  for (let oldIndex = oldLines.length - 1; oldIndex >= 0; oldIndex -= 1) {
    for (let newIndex = newLines.length - 1; newIndex >= 0; newIndex -= 1) {
      matrix[oldIndex][newIndex] =
        oldLines[oldIndex] === newLines[newIndex]
          ? matrix[oldIndex + 1][newIndex + 1] + 1
          : Math.max(matrix[oldIndex + 1][newIndex], matrix[oldIndex][newIndex + 1]);
    }
  }

  const additions = [];
  const deletions = [];
  let oldIndex = 0;
  let newIndex = 0;

  while (oldIndex < oldLines.length && newIndex < newLines.length) {
    if (oldLines[oldIndex] === newLines[newIndex]) {
      oldIndex += 1;
      newIndex += 1;
    } else if (matrix[oldIndex + 1][newIndex] >= matrix[oldIndex][newIndex + 1]) {
      deletions.push({ line: oldIndex + 1, text: oldLines[oldIndex] });
      oldIndex += 1;
    } else {
      additions.push({ line: newIndex + 1, text: newLines[newIndex] });
      newIndex += 1;
    }
  }

  while (oldIndex < oldLines.length) {
    deletions.push({ line: oldIndex + 1, text: oldLines[oldIndex] });
    oldIndex += 1;
  }

  while (newIndex < newLines.length) {
    additions.push({ line: newIndex + 1, text: newLines[newIndex] });
    newIndex += 1;
  }

  return { additions, deletions, truncated: false };
}

export function compareNotes(beforeNotes, afterNotes) {
  const beforeIds = new Set(beforeNotes.map((note) => note.id));
  const afterIds = new Set(afterNotes.map((note) => note.id));

  return {
    opened: afterNotes.filter((note) => !beforeIds.has(note.id)),
    closed: beforeNotes.filter((note) => !afterIds.has(note.id)),
  };
}

export function describeChange(diff, previousAnalysis, nextAnalysis) {
  const noteDelta = nextAnalysis.stats.activeNotes - previousAnalysis.stats.activeNotes;
  const parts = [];
  const noteLabel = (count) => `active ${count === 1 ? "note" : "notes"}`;

  if (diff.additions.length) parts.push(`${diff.additions.length} added`);
  if (diff.deletions.length) parts.push(`${diff.deletions.length} deleted`);
  if (noteDelta > 0) parts.push(`${noteDelta} ${noteLabel(noteDelta)} opened`);
  if (noteDelta < 0) parts.push(`${Math.abs(noteDelta)} ${noteLabel(Math.abs(noteDelta))} closed`);

  return parts.length ? parts.join(" | ") : "File touched with no line-level change";
}

export function buildEvent(type, previousText, nextText, previousAnalysis, nextAnalysis, revision) {
  const oldLines = splitLines(previousText);
  const newLines = splitLines(nextText);
  const diff = type === "snapshot" ? { additions: [], deletions: [], truncated: false } : diffLines(previousText, nextText);
  const sections = new Set();

  for (const addition of diff.additions) sections.add(sectionAtLine(newLines, addition.line));
  for (const deletion of diff.deletions) sections.add(sectionAtLine(oldLines, deletion.line));

  const lineText = [
    ...diff.additions.map((entry) => entry.text),
    ...diff.deletions.map((entry) => entry.text),
  ].join("\n");

  return {
    id: `${revision}-${hashText(`${type}\n${lineText}\n${Date.now()}`)}`,
    type,
    at: new Date().toISOString(),
    revision,
    headline:
      type === "snapshot"
        ? `Loaded ${nextAnalysis.stats.lines} lines with ${nextAnalysis.stats.activeNotes} active notes`
        : describeChange(diff, previousAnalysis, nextAnalysis),
    additions: diff.additions,
    deletions: diff.deletions,
    truncated: diff.truncated,
    changedSections: Array.from(sections),
    noteChanges: compareNotes(previousAnalysis.activeNotes, nextAnalysis.activeNotes),
    addedTokens: extractBacktickTokens(diff.additions.map((entry) => entry.text).join("\n")),
    deletedTokens: extractBacktickTokens(diff.deletions.map((entry) => entry.text).join("\n")),
    touchedTokens: extractBacktickTokens(lineText),
    stats: nextAnalysis.stats,
  };
}

export function summarizeSnapshot(text) {
  const analysis = analyzeMarkdown(text);
  return {
    analysis,
    headline: `hey.md: ${analysis.stats.activeNotes} active notes, ${analysis.stats.actors} actors, ${analysis.stats.lines} lines`,
  };
}

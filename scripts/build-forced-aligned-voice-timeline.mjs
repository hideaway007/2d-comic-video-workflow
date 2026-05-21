#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";

const options = parseArgs(process.argv.slice(2));

if (!options.runFolderArg) {
  console.error(
    "用法：node scripts/build-forced-aligned-voice-timeline.mjs <run-folder> [--project-root <repo-root>] [--audio <master-audio>] [--alignment <alignment-json>] [--duration-ms <ms>]",
  );
  process.exit(2);
}

const projectRoot = path.resolve(options.projectRoot);
const runFolder = path.resolve(projectRoot, options.runFolderArg);
const audioSegmentsPath = path.join(runFolder, "01_script/audio_segments.json");
const audioRoot = path.join(runFolder, "05_video/audio");
const audioPath = resolveRunPath(options.audio ?? "05_video/audio/master.mp3");
const alignmentPath = resolveRunPath(options.alignment ?? "05_video/audio/forced_alignment.json");
const outputPath = resolveRunPath(options.output ?? "05_video/audio/voice_timeline.json");
const reportPath = path.join(audioRoot, "forced_alignment_report.json");

let reportState = {};

try {
  const audioSegments = normalizeSegments(await readJson(audioSegmentsPath));
  reportState = { ...reportState, audioSegments };
  const alignment = await readJson(alignmentPath);
  const charTimeline = buildCharTimeline(alignment);
  reportState = { ...reportState, charTimeline };
  const totalMs = await resolveTotalMs({ audioPath, durationMs: options.durationMs, charTimeline });
  reportState = { ...reportState, totalMs };
  const matched = matchSegmentsToAlignment(audioSegments, charTimeline);
  reportState = { ...reportState, matched };
  const timelineSegments = buildTimelineSegments({ audioSegments, matched, totalMs, audioPath });

  await assertNonEmptyFile(audioPath);
  await writeJson(outputPath, {
    version: 1,
    provider: options.provider,
    alignment_engine: alignment.engine ?? alignment.provider ?? options.alignmentEngine,
    alignment_source: toRunRelative(alignmentPath),
    audio: toRunRelative(audioPath),
    audio_sha256: await hashFile(audioPath),
    totalMs,
    segments: timelineSegments,
    notes: [
      "Generated from one complete narration audio plus forced-alignment timings.",
      "Segment durations include leading, trailing, and inter-beat pauses so the rendered video duration matches the master audio.",
    ],
  });

  await writeReport({
    ok: true,
    audioSegments,
    charTimeline,
    matched,
    totalMs,
    output: outputPath,
  });

  console.log(`forced alignment timeline complete: ${timelineSegments.length} segment(s), ${(totalMs / 1000).toFixed(2)}s`);
  console.log(`timeline=${toProjectRelative(outputPath)}`);
} catch (error) {
  await writeReport({
    ok: false,
    error: error.message,
    ...reportState,
  }).catch(() => {});
  console.error(error.message);
  process.exit(1);
}

function parseArgs(values) {
  const parsed = {
    runFolderArg: null,
    projectRoot: process.cwd(),
    audio: null,
    alignment: null,
    output: null,
    durationMs: null,
    provider: "forced-alignment",
    alignmentEngine: "external",
  };

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--project-root") {
      parsed.projectRoot = values[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (value.startsWith("--project-root=")) {
      parsed.projectRoot = value.slice("--project-root=".length);
      continue;
    }
    if (value === "--audio") {
      parsed.audio = values[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (value.startsWith("--audio=")) {
      parsed.audio = value.slice("--audio=".length);
      continue;
    }
    if (value === "--alignment") {
      parsed.alignment = values[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (value.startsWith("--alignment=")) {
      parsed.alignment = value.slice("--alignment=".length);
      continue;
    }
    if (value === "--output") {
      parsed.output = values[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (value.startsWith("--output=")) {
      parsed.output = value.slice("--output=".length);
      continue;
    }
    if (value === "--duration-ms") {
      parsed.durationMs = Number(values[index + 1]);
      index += 1;
      continue;
    }
    if (value.startsWith("--duration-ms=")) {
      parsed.durationMs = Number(value.slice("--duration-ms=".length));
      continue;
    }
    if (value.startsWith("--provider=")) {
      parsed.provider = value.slice("--provider=".length);
      continue;
    }
    if (value.startsWith("--alignment-engine=")) {
      parsed.alignmentEngine = value.slice("--alignment-engine=".length);
      continue;
    }
    if (!value.startsWith("--") && !parsed.runFolderArg) {
      parsed.runFolderArg = value;
      continue;
    }
    throw new Error(`未知参数：${value}`);
  }

  parsed.projectRoot = parsed.projectRoot || process.cwd();
  return parsed;
}

function resolveRunPath(value) {
  if (path.isAbsolute(value)) {
    return value;
  }
  return path.resolve(runFolder, value);
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeReport({ ok, error = null, audioSegments = [], charTimeline = [], matched = [], totalMs = null, output = null }) {
  const transcript = charTimeline.map((item) => item.char).join("");
  await writeJson(reportPath, {
    version: 1,
    ok,
    error,
    totalMs,
    output: output ? toRunRelative(output) : null,
    alignment_chars: charTimeline.length,
    transcript_preview: transcript.slice(0, 240),
    segments: audioSegments.map((segment, index) => ({
      segment_id: segment.segment_id,
      panel_id: segment.panel_id ?? null,
      text: segment.text,
      normalized_text: normalizeText(segment.text),
      matched: Boolean(matched[index]),
      match: matched[index] ?? null,
    })),
  });
}

function normalizeSegments(value) {
  const segments = Array.isArray(value) ? value : value.segments;
  if (!Array.isArray(segments) || segments.length === 0) {
    throw new Error("audio_segments.json must include a non-empty segments array");
  }
  return segments.map((segment, index) => {
    const text = String(segment.text ?? "").trim();
    if (!text) {
      throw new Error(`audio_segments[${index}] missing text`);
    }
    return {
      ...segment,
      segment_id: segment.segment_id ?? `seg_${String(index + 1).padStart(3, "0")}`,
      text,
    };
  });
}

function buildCharTimeline(alignment) {
  const events = extractAlignmentEvents(alignment);
  const chars = [];
  for (const event of events) {
    const normalized = normalizeText(event.text);
    if (!normalized) {
      continue;
    }
    const startMs = Number(event.startMs);
    const endMs = Number(event.endMs);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
      throw new Error(`alignment event has invalid timing: ${JSON.stringify(event)}`);
    }
    const eventChars = Array.from(normalized);
    const spanMs = endMs - startMs;
    for (let index = 0; index < eventChars.length; index += 1) {
      const charStart = Math.round(startMs + (spanMs * index) / eventChars.length);
      const charEnd = Math.round(startMs + (spanMs * (index + 1)) / eventChars.length);
      chars.push({
        char: eventChars[index],
        startMs: charStart,
        endMs: Math.max(charStart + 1, charEnd),
      });
    }
  }

  if (chars.length === 0) {
    throw new Error("forced alignment JSON did not contain usable timed text");
  }
  chars.sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs);
  return chars;
}

function extractAlignmentEvents(alignment) {
  if (Array.isArray(alignment.words)) {
    return alignment.words.map(wordToEvent);
  }
  if (Array.isArray(alignment.segments)) {
    const wordEvents = alignment.segments.flatMap((segment) =>
      Array.isArray(segment.words)
        ? segment.words.map((word) =>
            wordToEvent({
              ...word,
              start: word.start ?? segment.start,
              end: word.end ?? segment.end,
              startMs: word.startMs ?? word.start_ms ?? segment.startMs ?? segment.start_ms,
              endMs: word.endMs ?? word.end_ms ?? segment.endMs ?? segment.end_ms,
              start_sec: word.start_sec ?? segment.start_sec,
              end_sec: word.end_sec ?? segment.end_sec,
            }),
          )
        : [],
    );
    if (wordEvents.length > 0) {
      return wordEvents;
    }
    return alignment.segments.map((segment) => ({
      text: segment.text ?? segment.word ?? "",
      startMs: readTimeMs(segment, "start"),
      endMs: readTimeMs(segment, "end"),
    }));
  }
  if (Array.isArray(alignment.cues)) {
    return alignment.cues.map((cue) => ({
      text: cue.text ?? "",
      startMs: readTimeMs(cue, "start"),
      endMs: readTimeMs(cue, "end"),
    }));
  }
  throw new Error("forced alignment JSON must include words, segments, or cues");
}

function wordToEvent(word) {
  return {
    text: word.word ?? word.text ?? word.token ?? "",
    startMs: readTimeMs(word, "start"),
    endMs: readTimeMs(word, "end"),
  };
}

function readTimeMs(value, key) {
  if (Number.isFinite(Number(value[`${key}Ms`]))) {
    return Math.round(Number(value[`${key}Ms`]));
  }
  if (Number.isFinite(Number(value[`${key}_ms`]))) {
    return Math.round(Number(value[`${key}_ms`]));
  }
  if (Number.isFinite(Number(value[`${key}_sec`]))) {
    return Math.round(Number(value[`${key}_sec`]) * 1000);
  }
  return autoTimeToMs(value[key]);
}

function matchSegmentsToAlignment(audioSegments, charTimeline) {
  const transcript = charTimeline.map((item) => item.char).join("");
  const matched = [];
  let cursor = 0;
  for (const segment of audioSegments) {
    const needle = normalizeText(segment.text);
    const index = transcript.indexOf(needle, cursor);
    if (index < 0) {
      const context = transcript.slice(Math.max(0, cursor - 40), Math.min(transcript.length, cursor + 160));
      throw new Error(
        `forced alignment text does not contain segment ${segment.segment_id}; normalized=${JSON.stringify(
          needle,
        )}; search_context=${JSON.stringify(context)}`,
      );
    }
    const endIndex = index + Array.from(needle).length - 1;
    matched.push({
      segment_id: segment.segment_id,
      text_start_index: index,
      text_end_index: endIndex,
      raw_start_ms: charTimeline[index].startMs,
      raw_end_ms: charTimeline[endIndex].endMs,
    });
    cursor = endIndex + 1;
  }
  return matched;
}

function buildTimelineSegments({ audioSegments, matched, totalMs, audioPath }) {
  return audioSegments.map((segment, index) => {
    const match = matched[index];
    const nextMatch = matched[index + 1] ?? null;
    const startMs = index === 0 ? 0 : match.raw_start_ms;
    const endMs = nextMatch ? nextMatch.raw_start_ms : totalMs;
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
      throw new Error(`invalid aligned duration for ${segment.segment_id}: start=${startMs}, end=${endMs}`);
    }
    return {
      segment_id: segment.segment_id,
      page_id: segment.page_id ?? null,
      panel_id: segment.panel_id ?? null,
      text: segment.text,
      audio: toRunRelative(audioPath),
      startMs,
      endMs,
      durationMs: endMs - startMs,
      raw_alignment_start_ms: match.raw_start_ms,
      raw_alignment_end_ms: match.raw_end_ms,
    };
  });
}

async function resolveTotalMs({ audioPath, durationMs, charTimeline }) {
  if (Number.isFinite(durationMs) && durationMs > 0) {
    return Math.round(durationMs);
  }
  const probed = await durationMsFromFfprobe(audioPath).catch(() => null);
  if (probed) {
    return probed;
  }
  return Math.max(...charTimeline.map((item) => item.endMs));
}

async function durationMsFromFfprobe(filePath) {
  const { stdout } = await execCapture("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=nw=1:nk=1",
    filePath,
  ]);
  const seconds = Number.parseFloat(stdout.trim());
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error(`无法读取音频时长：${filePath}`);
  }
  return Math.round(seconds * 1000);
}

function execCapture(command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { encoding: "utf8" }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`${command} failed: ${stderr || error.message}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function assertNonEmptyFile(filePath) {
  const fileStat = await stat(filePath);
  if (!fileStat.isFile() || fileStat.size <= 0) {
    throw new Error(`预期非空音频文件：${filePath}`);
  }
}

async function hashFile(filePath) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

function autoTimeToMs(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return Number.NaN;
  }
  return number > 1000 ? Math.round(number) : Math.round(number * 1000);
}

function normalizeText(value) {
  return Array.from(String(value ?? ""))
    .map((char) => char.toLowerCase())
    .filter((char) => /[\p{Script=Han}\p{Letter}\p{Number}]/u.test(char))
    .join("");
}

function toRunRelative(filePath) {
  return normalizePath(path.relative(runFolder, filePath));
}

function toProjectRelative(filePath) {
  return normalizePath(path.relative(projectRoot, filePath));
}

function normalizePath(value) {
  return String(value).replaceAll("\\", "/").replace(/^\.\//, "");
}

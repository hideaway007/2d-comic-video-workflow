#!/usr/bin/env node

import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  finalVideoPath,
  previewVideoPath,
  probeVideo,
  readPlan,
  renderSpec,
  resolveProjectPath,
  runCommand,
} from "./lib/quality.mjs";

const options = parseArgs(process.argv.slice(2));
if (!options.runFolderArg) {
  console.error("Usage: node scripts/compose-preview-video.mjs <run-folder> [--project-root <repo-root>] [--dry-run]");
  process.exit(2);
}

const projectRoot = path.resolve(options.projectRoot);
const runFolder = path.resolve(projectRoot, options.runFolderArg);
const runFolderRel = toProjectRelative(runFolder, projectRoot);
const timelinePath = path.join(runFolder, "05_video/audio/voice_timeline.json");
const defaultAudioPath = path.join(runFolder, "05_video/audio/master.mp3");
const audioPath = path.resolve(projectRoot, options.audio ?? defaultAudioPath);
const plan = await readPlan(projectRoot);
const spec = renderSpec(plan);
const timeline = await readJson(timelinePath);
const segments = normalizeSegments(timeline);
const expectedFinal = options.output
  ? normalizeProjectRelativePath(options.output)
  : finalVideoPath(plan);
const outputPath = resolveProjectPath(projectRoot, expectedFinal);
const previews = plan.shots.map((shot) => ({
  shot,
  relativePath: previewVideoPath(shot, plan),
}));

await validateRunContract({ plan, segments, previews, audioPath, outputPath });
const concatPath = path.join(runFolder, "05_video/previews/concat_list.txt");
const concatBody = previews
  .map(({ relativePath }) => `file '${escapeConcatPath(resolveProjectPath(projectRoot, relativePath))}'`)
  .join("\n");
await mkdir(path.dirname(concatPath), { recursive: true });
await writeFile(concatPath, `${concatBody}\n`, "utf8");

if (!options.dryRun) {
  await composeVideo({ concatPath, audioPath, outputPath });
  await assertFinalStreams({ outputPath, expectedDurationSec: Number(timeline.totalMs) / 1000, spec });
}

console.log(
  JSON.stringify(
    {
      run_folder: runFolderRel,
      preview_count: previews.length,
      voice_segments: segments.length,
      concat: toProjectRelative(concatPath, projectRoot),
      audio: toProjectRelative(audioPath, projectRoot),
      output: toProjectRelative(outputPath, projectRoot),
      mode: options.dryRun ? "dry_run" : "composed_from_remotion_previews",
    },
    null,
    2,
  ),
);

function parseArgs(values) {
  const parsed = {
    runFolderArg: null,
    projectRoot: process.cwd(),
    audio: null,
    output: null,
    dryRun: false,
  };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--dry-run") {
      parsed.dryRun = true;
      continue;
    }
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
    if (value === "--output") {
      parsed.output = values[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (value.startsWith("--output=")) {
      parsed.output = value.slice("--output=".length);
      continue;
    }
    if (!value.startsWith("--") && !parsed.runFolderArg) {
      parsed.runFolderArg = value;
      continue;
    }
    throw new Error(`Unknown argument: ${value}`);
  }
  return parsed;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function normalizeSegments(timeline) {
  if (!Array.isArray(timeline.segments) || timeline.segments.length === 0) {
    throw new Error("voice_timeline.json must include a non-empty segments array");
  }
  return timeline.segments;
}

async function validateRunContract({ plan, segments, previews, audioPath, outputPath }) {
  if (!Array.isArray(plan.shots) || plan.shots.length === 0) {
    throw new Error("motion_plan.json must include a non-empty shots array");
  }
  if (previews.length !== segments.length) {
    throw new Error(`Preview count ${previews.length} does not match voice segment count ${segments.length}`);
  }
  if (!existsSync(audioPath)) {
    throw new Error(`Missing narration audio: ${toProjectRelative(audioPath, projectRoot)}`);
  }
  for (const { relativePath } of previews) {
    const absolutePath = resolveProjectPath(projectRoot, relativePath);
    if (!existsSync(absolutePath)) {
      throw new Error(`Missing preview video: ${relativePath}`);
    }
    const info = await stat(absolutePath);
    if (info.size <= 0) {
      throw new Error(`Empty preview video: ${relativePath}`);
    }
  }
  const outputRel = toProjectRelative(outputPath, projectRoot);
  if (!outputRel.startsWith(`${runFolderRel}/05_video/`)) {
    throw new Error(`Output must stay inside the run 05_video folder: ${outputRel}`);
  }
}

async function composeVideo({ concatPath, audioPath, outputPath }) {
  await mkdir(path.dirname(outputPath), { recursive: true });
  const result = await runCommand("ffmpeg", [
    "-hide_banner",
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    concatPath,
    "-i",
    audioPath,
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-shortest",
    "-movflags",
    "+faststart",
    outputPath,
  ]);
  if (result.error?.code === "ENOENT") {
    throw new Error("ffmpeg is required but was not found on PATH");
  }
  if (result.status !== 0) {
    throw new Error(`ffmpeg failed: ${result.stderr || result.stdout}`.trim());
  }
}

async function assertFinalStreams({ outputPath, expectedDurationSec, spec }) {
  const video = await probeVideo(outputPath);
  if (video.width !== spec.width || video.height !== spec.height) {
    throw new Error(`Final video resolution mismatch: expected ${spec.width}x${spec.height}, got ${video.width}x${video.height}`);
  }
  if (Number.isFinite(expectedDurationSec)) {
    const delta = Math.abs(video.duration - expectedDurationSec);
    if (delta > 1.5) {
      throw new Error(`Final video duration mismatch: expected about ${expectedDurationSec.toFixed(2)}s, got ${video.duration.toFixed(2)}s`);
    }
  }
  const result = await runCommand("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "stream=codec_type,codec_name",
    "-of",
    "json",
    outputPath,
  ]);
  if (result.error?.code === "ENOENT") {
    throw new Error("ffprobe is required but was not found on PATH");
  }
  if (result.status !== 0) {
    throw new Error(`ffprobe failed: ${result.stderr || result.stdout}`.trim());
  }
  const data = JSON.parse(result.stdout);
  const hasH264Video = data.streams?.some((stream) => stream.codec_type === "video" && stream.codec_name === "h264");
  const hasAacAudio = data.streams?.some((stream) => stream.codec_type === "audio" && stream.codec_name === "aac");
  if (!hasH264Video || !hasAacAudio) {
    throw new Error("Final video must contain H.264 video and AAC audio streams");
  }
}

function escapeConcatPath(value) {
  return value.replaceAll("'", "'\\''");
}

function normalizeProjectRelativePath(value) {
  return String(value).replace(/\\/g, "/").replace(/^\.\//, "");
}

function toProjectRelative(filePath, root) {
  return path.relative(root, filePath).split(path.sep).join("/");
}

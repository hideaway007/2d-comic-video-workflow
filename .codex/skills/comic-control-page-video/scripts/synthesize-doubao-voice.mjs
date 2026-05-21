#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";

const DEFAULTS = {
  resourceId: "seed-tts-2.0",
  voice: "zh_male_ruyayichen_uranus_bigtts",
  sampleRate: 24000,
  speechRate: 25,
  pitchRate: 0,
  volumeRatio: 1.2,
  endpoint: "https://openspeech.bytedance.com/api/v3/tts/unidirectional",
  envFile: path.join(process.env.HOME ?? "", ".config", "doubao-tts", "env"),
};

const options = parseArgs(process.argv.slice(2));

if (!options.runFolderArg) {
  console.error(
    "用法：node synthesize-doubao-voice.mjs <run-folder> [--project-root <repo-root>] [--mode whole|segmented] [--dry-run] [--force] [--legacy-crop-review]",
  );
  process.exit(2);
}

const projectRoot = path.resolve(options.projectRoot);
const runFolder = path.resolve(projectRoot, options.runFolderArg);
const segmentsPath = path.join(runFolder, "01_script", "audio_segments.json");
const verticalImageManifestPath = path.join(runFolder, "03_images", "vertical_image_manifest.json");
const imageReviewStatusPath = path.join(runFolder, "03_images", "image_review_status.json");
const panelCropManifestPath = path.join(runFolder, "04_panel_crops", "panel_crop_manifest.json");
const cropReviewStatusPath = path.join(runFolder, "04_panel_crops", "crop_review_status.json");
const audioRoot = path.join(runFolder, "05_video", "audio");
const segmentsRoot = path.join(audioRoot, "segments");
const masterAudioPath = path.join(audioRoot, "master.mp3");
const timelinePath = path.join(audioRoot, "voice_timeline.json");
const previewPath = path.join(audioRoot, "doubao_request_preview.json");
const completeNarrationTextPath = path.join(audioRoot, "complete_narration.txt");

await mkdir(segmentsRoot, { recursive: true });
if (!options.dryRun) {
  await requireApprovedImagesOrLegacyCropReview();
}
const audioSegments = normalizeSegments(await readJson(segmentsPath));
const completeNarrationText = buildWholeNarrationText(audioSegments);
const requestConfig = {
  endpoint: options.endpoint,
  resource_id: options.resourceId,
  voice: options.voice,
  sample_rate: options.sampleRate,
  speech_rate: options.speechRate,
  pitch_rate: options.pitchRate,
  volume_ratio: options.volumeRatio,
};

if (options.dryRun) {
  await writeJson(previewPath, {
    version: 1,
    dry_run: true,
    synthesis_mode: options.mode,
    request_config: requestConfig,
    segment_count: audioSegments.length,
    request_count: options.mode === "whole" ? 1 : audioSegments.length,
    complete_text_chars: Array.from(completeNarrationText).length,
    complete_payload: buildPayload(completeNarrationText, options),
    first_payload: buildPayload(audioSegments[0]?.text ?? "", options),
  });
  console.log(
    `豆包语音 dry-run 通过：mode=${options.mode}，${audioSegments.length} 个 beat，${
      options.mode === "whole" ? "1 次整篇请求" : `${audioSegments.length} 次分段请求`
    }，已写 ${relativeToProject(previewPath)}`,
  );
  process.exit(0);
}

const envValues = await readEnvFile(options.envFile).catch(() => ({}));
const apiKey =
  process.env.DOUBAO_TTS_API_KEY ??
  process.env.VOLCENGINE_TTS_API_KEY ??
  envValues.DOUBAO_TTS_API_KEY ??
  envValues.VOLCENGINE_TTS_API_KEY;

if (!apiKey) {
  console.error("缺少豆包语音 API key：请设置 DOUBAO_TTS_API_KEY 或 VOLCENGINE_TTS_API_KEY，或写入 ~/.config/doubao-tts/env");
  process.exit(1);
}

await requireCommand("ffprobe");
await requireCommand("ffmpeg");

if (options.mode === "whole") {
  await synthesizeWholeNarration({ audioSegments, completeNarrationText, apiKey });
} else {
  await synthesizeSegmentedNarration({ audioSegments, apiKey });
}

async function synthesizeWholeNarration({ audioSegments, completeNarrationText, apiKey }) {
  const previousTimeline = await readJson(timelinePath).catch(() => null);
  await mkdir(audioRoot, { recursive: true });
  await writeFile(completeNarrationTextPath, `${completeNarrationText}\n`, "utf8");

  const canReuseExisting =
    !options.force &&
    previousTimeline?.synthesis_mode === "whole" &&
    previousTimeline?.audio === relativeToRun(masterAudioPath) &&
    (await isNonEmptyFile(masterAudioPath));

  if (canReuseExisting) {
    console.log(`整篇音频 ${relativeToRun(masterAudioPath)} 跳过，文件已存在`);
  } else {
    const startedAt = Date.now();
    const audioBytes = await requestDoubaoAudio(completeNarrationText, apiKey, options);
    await writeFile(masterAudioPath, audioBytes);
    await assertNonEmptyFile(masterAudioPath);
    const seconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
    console.log(`整篇音频 ${relativeToRun(masterAudioPath)} 完成 ${seconds}s`);
  }

  const totalMs = await durationMs(masterAudioPath);
  const weightInfo = buildWholeAudioSegmentWeights(audioSegments, previousTimeline);
  const timelineSegments = distributeWholeAudioTimeline({
    audioSegments,
    weights: weightInfo.weights,
    totalMs,
    audioPath: masterAudioPath,
  });

  await writeJson(timelinePath, {
    version: 1,
    provider: "doubao-volcengine",
    resource_id: options.resourceId,
    voice: options.voice,
    speech_rate: options.speechRate,
    sample_rate: options.sampleRate,
    synthesis_mode: "whole",
    request_count: 1,
    alignment_status: "estimated",
    alignment_strategy: weightInfo.strategy,
    narration_text: relativeToRun(completeNarrationTextPath),
    audio: relativeToRun(masterAudioPath),
    audio_sha256: await hashFile(masterAudioPath),
    totalMs,
    segments: timelineSegments,
    notes: [
      "Generated from one complete Doubao TTS request for continuous narration.",
      "Segment boundaries are estimated so existing one-beat-one-page timing can be rendered before an external forced-alignment JSON is available.",
      "Run npm run align-audio with 05_video/audio/forced_alignment.json to replace these estimated boundaries with aligned timings.",
    ],
  });

  console.log(`豆包整篇语音完成：1 次请求，${audioSegments.length} 个 beat，时长 ${(totalMs / 1000).toFixed(2)}s`);
  console.log(`master=${relativeToProject(masterAudioPath)}`);
  console.log(`timeline=${relativeToProject(timelinePath)}`);
}

async function synthesizeSegmentedNarration({ audioSegments, apiKey }) {
const segmentOutputs = [];
for (let index = 0; index < audioSegments.length; index += 1) {
  const segment = audioSegments[index];
  const relativeAudio = normalizeSegmentAudio(segment, index);
  const outputPath = path.join(audioRoot, relativeAudio);
  await mkdir(path.dirname(outputPath), { recursive: true });

  if (!options.force && (await isNonEmptyFile(outputPath))) {
    console.log(`[${String(index + 1).padStart(3, " ")}/${audioSegments.length}] ${relativeAudio} 跳过，文件已存在`);
  } else {
    const startedAt = Date.now();
    const audioBytes = await requestDoubaoAudio(segment.text, apiKey, options);
    await writeFile(outputPath, audioBytes);
    await assertNonEmptyFile(outputPath);
    const seconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
    console.log(`[${String(index + 1).padStart(3, " ")}/${audioSegments.length}] ${relativeAudio} 完成 ${seconds}s`);
  }

  const segmentDurationMs = await durationMs(outputPath);
  segmentOutputs.push({
    segment_id: segment.segment_id,
    page_id: segment.page_id ?? null,
    panel_id: segment.panel_id ?? null,
    text: segment.text,
    audio: relativeToRun(outputPath),
    durationMs: segmentDurationMs,
    sha256: await hashFile(outputPath),
  });
}

await concatMasterAudio(segmentOutputs.map((segment) => path.join(runFolder, segment.audio)), masterAudioPath);
const timelineSegments = [];
let cursorMs = 0;
for (const segment of segmentOutputs) {
  const startMs = cursorMs;
  const endMs = startMs + segment.durationMs;
  timelineSegments.push({
    ...segment,
    startMs,
    endMs,
  });
  cursorMs = endMs;
}

await writeJson(timelinePath, {
  version: 1,
  provider: "doubao-volcengine",
  resource_id: options.resourceId,
  voice: options.voice,
  speech_rate: options.speechRate,
  sample_rate: options.sampleRate,
  audio: relativeToRun(masterAudioPath),
  totalMs: cursorMs,
  segments: timelineSegments,
});

console.log(`豆包语音完成：${audioSegments.length} 段，时长 ${(cursorMs / 1000).toFixed(2)}s`);
console.log(`master=${relativeToProject(masterAudioPath)}`);
console.log(`timeline=${relativeToProject(timelinePath)}`);
}

function parseArgs(values) {
  const parsed = {
    runFolderArg: null,
    projectRoot: process.cwd(),
    dryRun: false,
    force: false,
    legacyCropReview: false,
    mode: "whole",
    endpoint: DEFAULTS.endpoint,
    envFile: DEFAULTS.envFile,
    resourceId: DEFAULTS.resourceId,
    voice: DEFAULTS.voice,
    sampleRate: DEFAULTS.sampleRate,
    speechRate: DEFAULTS.speechRate,
    pitchRate: DEFAULTS.pitchRate,
    volumeRatio: DEFAULTS.volumeRatio,
  };

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--dry-run") {
      parsed.dryRun = true;
      continue;
    }
    if (value === "--force") {
      parsed.force = true;
      continue;
    }
    if (value === "--legacy-crop-review") {
      parsed.legacyCropReview = true;
      continue;
    }
    if (value === "--mode") {
      parsed.mode = normalizeMode(values[index + 1] ?? "");
      index += 1;
      continue;
    }
    if (value.startsWith("--mode=")) {
      parsed.mode = normalizeMode(value.slice("--mode=".length));
      continue;
    }
    if (value === "--whole") {
      parsed.mode = "whole";
      continue;
    }
    if (value === "--segmented" || value === "--segment") {
      parsed.mode = "segmented";
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
    if (value === "--env-file") {
      parsed.envFile = values[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (value.startsWith("--env-file=")) {
      parsed.envFile = value.slice("--env-file=".length);
      continue;
    }
    if (value.startsWith("--endpoint=")) {
      parsed.endpoint = value.slice("--endpoint=".length);
      continue;
    }
    if (value.startsWith("--resource-id=")) {
      parsed.resourceId = value.slice("--resource-id=".length);
      continue;
    }
    if (value.startsWith("--voice=")) {
      parsed.voice = value.slice("--voice=".length);
      continue;
    }
    if (value.startsWith("--sample-rate=")) {
      parsed.sampleRate = Number(value.slice("--sample-rate=".length));
      continue;
    }
    if (value.startsWith("--speech-rate=")) {
      parsed.speechRate = Number(value.slice("--speech-rate=".length));
      continue;
    }
    if (value.startsWith("--speed=")) {
      parsed.speechRate = Math.round((Number(value.slice("--speed=".length)) - 1) * 100);
      continue;
    }
    if (value.startsWith("--pitch-rate=")) {
      parsed.pitchRate = Number(value.slice("--pitch-rate=".length));
      continue;
    }
    if (value.startsWith("--volume-ratio=")) {
      parsed.volumeRatio = Number(value.slice("--volume-ratio=".length));
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

function normalizeMode(value) {
  const normalized = String(value).trim().toLowerCase();
  if (normalized === "whole" || normalized === "complete" || normalized === "single") {
    return "whole";
  }
  if (normalized === "segmented" || normalized === "segment" || normalized === "segments") {
    return "segmented";
  }
  throw new Error(`未知语音合成模式：${value}`);
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function requireApprovedImagesOrLegacyCropReview() {
  const verticalManifest = await readJson(verticalImageManifestPath).catch(() => null);
  if (verticalManifest) {
    await requireApprovedVerticalImages(verticalManifest);
    return;
  }
  if (!options.legacyCropReview) {
    throw new Error(
      "生成语音前必须先完成 9:16 图片审核：缺少 03_images/vertical_image_manifest.json；如需旧裁切流程，必须显式传 --legacy-crop-review",
    );
  }
  await requireApprovedCropReview();
}

async function requireApprovedVerticalImages(manifest) {
  if (manifest.mode !== "single_page_vertical" && manifest.mode !== "single-page-vertical-test") {
    throw new Error(`生成语音前必须使用 9:16 单页图片 manifest；当前 mode=${JSON.stringify(manifest.mode)}`);
  }
  if (manifest.audit?.passed !== true) {
    throw new Error("生成语音前必须先通过 9:16 图片审计：03_images/vertical_image_manifest.json audit.passed 必须是 true");
  }
  const pages = Array.isArray(manifest.pages) ? manifest.pages : [];
  const generatedPageCount = Number(manifest.generated_page_count ?? pages.length);
  const requestedPageCount = Number(manifest.requested_page_count ?? generatedPageCount);
  if (!Number.isFinite(generatedPageCount) || generatedPageCount <= 0 || pages.length !== generatedPageCount) {
    throw new Error(
      `生成语音前必须有完整 9:16 story pages：generated_page_count=${JSON.stringify(
        manifest.generated_page_count,
      )}, pages.length=${pages.length}`,
    );
  }
  if (
    !Number.isFinite(requestedPageCount) ||
    requestedPageCount <= 0 ||
    requestedPageCount !== generatedPageCount
  ) {
    throw new Error(
      `生成语音前必须生成全部 9:16 story pages：requested_page_count=${JSON.stringify(
        manifest.requested_page_count,
      )}, generated_page_count=${JSON.stringify(manifest.generated_page_count)}`,
    );
  }
  const blockers = [];
  for (const page of pages) {
    await validateVerticalPage(page, blockers);
  }
  if (blockers.length > 0) {
    throw new Error(`生成语音前 9:16 图片 manifest 未通过文件审计：\n- ${blockers.join("\n- ")}`);
  }
  const status = await readJson(imageReviewStatusPath).catch((error) => {
    throw new Error(`生成语音前必须先人工审核 9:16 图片：缺少 03_images/image_review_status.json (${error.message})`);
  });
  if (status.status !== "approved") {
    throw new Error(
      `生成语音前必须先人工审核 9:16 图片并将 image_review_status.status 置为 approved；当前 status=${JSON.stringify(
        status.status,
      )}`,
    );
  }
}

async function validateVerticalPage(page, blockers) {
  const pageId = page?.page_id ?? "unknown";
  if (page?.source !== "image_gen") {
    blockers.push(`${pageId} source 必须是 image_gen，当前为 ${JSON.stringify(page?.source)}`);
  }
  if (typeof page?.file !== "string" || !page.file.trim()) {
    blockers.push(`${pageId} 缺少 file`);
    return;
  }
  let absolutePath;
  try {
    absolutePath = resolveRunRelative(page.file);
  } catch (error) {
    blockers.push(`${pageId} file 路径非法：${error.message}`);
    return;
  }
  const fileStat = await stat(absolutePath).catch((error) => {
    blockers.push(`${pageId} 文件不存在或不可读：${page.file} (${error.message})`);
    return null;
  });
  if (!fileStat) {
    return;
  }
  if (!fileStat.isFile() || fileStat.size <= 0) {
    blockers.push(`${pageId} 文件必须存在且非空：${page.file}`);
    return;
  }
  const dimensions = await pngDimensions(absolutePath).catch((error) => {
    blockers.push(`${pageId} 必须是可读取的 PNG：${page.file} (${error.message})`);
    return null;
  });
  if (!dimensions) {
    return;
  }
  if (Number.isFinite(Number(page.width)) && Number(page.width) !== dimensions.width) {
    blockers.push(`${pageId} manifest width 与实际 PNG 不一致：manifest=${page.width}, actual=${dimensions.width}`);
  }
  if (Number.isFinite(Number(page.height)) && Number(page.height) !== dimensions.height) {
    blockers.push(`${pageId} manifest height 与实际 PNG 不一致：manifest=${page.height}, actual=${dimensions.height}`);
  }
  const aspect = dimensions.width / dimensions.height;
  if (dimensions.width >= dimensions.height || Math.abs(aspect - 9 / 16) > 0.08) {
    blockers.push(`${pageId} 必须是接近 9:16 的竖版 PNG，当前为 ${dimensions.width}x${dimensions.height}`);
  }
}

function resolveRunRelative(relativePath) {
  if (path.isAbsolute(relativePath)) {
    throw new Error("必须使用 run folder 内的相对路径");
  }
  const normalized = path.normalize(relativePath);
  if (normalized.startsWith("..") || normalized === "." || path.isAbsolute(normalized)) {
    throw new Error("路径不能跳出 run folder");
  }
  const absolutePath = path.resolve(runFolder, normalized);
  const relative = path.relative(runFolder, absolutePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("路径不能跳出 run folder");
  }
  return absolutePath;
}

async function pngDimensions(filePath) {
  const buffer = await readFile(filePath);
  if (
    buffer.length < 24 ||
    buffer[0] !== 0x89 ||
    buffer.toString("ascii", 1, 4) !== "PNG" ||
    buffer.readUInt32BE(12) !== 0x49484452
  ) {
    throw new Error("不是 PNG 文件");
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

async function requireApprovedCropReview() {
  const cropManifest = await readJson(panelCropManifestPath).catch((error) => {
    throw new Error(
      `生成语音前必须先完成 9:16 图片审核，或显式 legacy 裁切审核：缺少 03_images/vertical_image_manifest.json，也缺少 04_panel_crops/panel_crop_manifest.json (${error.message})`,
    );
  });
  if (cropManifest.crop_method !== "tools_comic_panel_splitter_v1") {
    throw new Error(
      `生成语音前必须使用 splitter 正式裁切；当前 crop_method=${JSON.stringify(cropManifest.crop_method)}`,
    );
  }
  const status = await readJson(cropReviewStatusPath).catch((error) => {
    throw new Error(`生成语音前必须先人工审核裁切：缺少 04_panel_crops/crop_review_status.json (${error.message})`);
  });
  if (status.status !== "approved") {
    throw new Error(
      `生成语音前必须先人工审核裁切并将 crop_review_status.status 置为 approved；当前 status=${JSON.stringify(
        status.status,
      )}`,
    );
  }
}

async function readEnvFile(filePath) {
  const content = await readFile(filePath, "utf8");
  const values = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      continue;
    }
    const [key, ...rest] = trimmed.replace(/^export\s+/, "").split("=");
    values[key.trim()] = rest.join("=").trim().replace(/^['"]|['"]$/g, "");
  }
  return values;
}

function normalizeSegments(value) {
  const segments = Array.isArray(value) ? value : value.segments;
  if (!Array.isArray(segments) || segments.length === 0) {
    throw new Error("audio_segments.json 必须包含非空 segments 数组");
  }
  return segments.map((segment, index) => {
    const text = String(segment.text ?? "").trim();
    if (!text) {
      throw new Error(`第 ${index + 1} 段缺少 text`);
    }
    return {
      ...segment,
      segment_id: segment.segment_id ?? `seg_${String(index + 1).padStart(3, "0")}`,
      text,
    };
  });
}

function buildWholeNarrationText(segments) {
  return segments.map((segment) => segment.text.trim()).join("");
}

function buildWholeAudioSegmentWeights(audioSegments, previousTimeline) {
  const previousById = new Map(
    Array.isArray(previousTimeline?.segments)
      ? previousTimeline.segments.map((segment) => [segment.segment_id, Number(segment.durationMs)])
      : [],
  );
  const durationWeights = audioSegments.map((segment) => previousById.get(segment.segment_id));
  if (durationWeights.every((value) => Number.isFinite(value) && value > 0)) {
    return {
      strategy: `previous_voice_timeline_durations:${previousTimeline?.synthesis_mode ?? "unknown"}`,
      weights: durationWeights,
    };
  }

  return {
    strategy: "text_display_width",
    weights: audioSegments.map((segment) => Math.max(1, displayWidth(segment.text))),
  };
}

function distributeWholeAudioTimeline({ audioSegments, weights, totalMs, audioPath }) {
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  if (!Number.isFinite(totalWeight) || totalWeight <= 0) {
    throw new Error("无法为整篇音频分配时间轴：segment weights 无效");
  }
  let cursorMs = 0;
  let cumulativeWeight = 0;
  return audioSegments.map((segment, index) => {
    cumulativeWeight += weights[index];
    const remainingSegments = audioSegments.length - index - 1;
    const rawEndMs =
      index === audioSegments.length - 1 ? totalMs : Math.round((totalMs * cumulativeWeight) / totalWeight);
    const maxEndMs = totalMs - remainingSegments;
    const endMs = Math.max(cursorMs + 1, Math.min(rawEndMs, maxEndMs));
    const startMs = cursorMs;
    cursorMs = endMs;
    return {
      segment_id: segment.segment_id,
      visual_beat_id: segment.visual_beat_id ?? null,
      page_id: segment.page_id ?? null,
      panel_id: segment.panel_id ?? null,
      text: segment.text,
      audio: relativeToRun(audioPath),
      startMs,
      endMs,
      durationMs: endMs - startMs,
      alignment_status: "estimated",
      alignment_weight: weights[index],
    };
  });
}

function displayWidth(str) {
  let width = 0;
  for (const ch of String(str ?? "")) {
    if (/\s/.test(ch)) width += 0.5;
    else if (/[^\x00-\xff]/.test(ch)) width += 2;
    else width += 1;
  }
  return width;
}

function normalizeSegmentAudio(segment, index) {
  const fallback = `segments/${segment.segment_id ?? `seg_${String(index + 1).padStart(3, "0")}`}.mp3`;
  return normalizePath(segment.audio || fallback).replace(/^05_video\/audio\//, "");
}

function buildPayload(text, values) {
  return {
    req_params: {
      text,
      speaker: values.voice,
      audio_params: {
        format: "mp3",
        sample_rate: values.sampleRate,
        speech_rate: values.speechRate,
        pitch_rate: values.pitchRate,
        volume_ratio: values.volumeRatio,
      },
    },
  };
}

async function requestDoubaoAudio(text, apiKey, values) {
  const response = await fetch(values.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": apiKey,
      "X-Api-Resource-Id": values.resourceId,
      "X-Api-Request-Id": randomUUID(),
    },
    body: JSON.stringify(buildPayload(text, values)),
  });

  const raw = Buffer.from(await response.arrayBuffer());
  if (!response.ok) {
    throw new Error(`豆包 TTS HTTP ${response.status}: ${raw.subarray(0, 500).toString("utf8")}`);
  }

  const chunks = [];
  for (const line of raw.toString("utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      const event = JSON.parse(trimmed);
      const data = event.data ?? event.payload_msg?.data;
      if (data) {
        chunks.push(Buffer.from(data, "base64"));
      }
    } catch {
      // 非 JSON 行忽略，后面用空 chunks 报错。
    }
  }

  if (chunks.length === 0) {
    throw new Error(`豆包 TTS 响应没有音频 data：${raw.subarray(0, 500).toString("utf8")}`);
  }
  return Buffer.concat(chunks);
}

async function requireCommand(command) {
  try {
    await execCapture(command, ["-version"]);
  } catch {
    throw new Error(`缺少命令：${command}`);
  }
}

async function durationMs(filePath) {
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

async function concatMasterAudio(files, output) {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "comic-doubao-audio-"));
  const concatFile = path.join(tempRoot, "concat.txt");
  try {
    await writeFile(concatFile, files.map((file) => `file '${escapeConcatPath(file)}'`).join("\n") + "\n", "utf8");
    await execCapture("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      concatFile,
      "-c:a",
      "libmp3lame",
      "-q:a",
      "2",
      output,
    ]);
    await assertNonEmptyFile(output);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
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

async function isNonEmptyFile(filePath) {
  try {
    const fileStat = await stat(filePath);
    return fileStat.isFile() && fileStat.size > 0;
  } catch {
    return false;
  }
}

async function assertNonEmptyFile(filePath) {
  const fileStat = await stat(filePath);
  if (!fileStat.isFile() || fileStat.size <= 0) {
    throw new Error(`预期非空文件：${filePath}`);
  }
}

async function hashFile(filePath) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function escapeConcatPath(value) {
  return value.replaceAll("'", "'\\''");
}

function relativeToRun(filePath) {
  return normalizePath(path.relative(runFolder, filePath));
}

function relativeToProject(filePath) {
  return normalizePath(path.relative(projectRoot, filePath));
}

function normalizePath(value) {
  return String(value).replaceAll("\\", "/").replace(/^\.\//, "");
}

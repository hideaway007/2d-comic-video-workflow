#!/usr/bin/env node

import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const options = parseArgs(process.argv.slice(2));

if (!options.runFolderArg) {
  console.error("用法：node scripts/apply-audio-timeline.mjs <run-folder> [--project-root <repo-root>]");
  process.exit(2);
}

const projectRoot = path.resolve(options.projectRoot);
const runFolder = path.resolve(projectRoot, options.runFolderArg);
const planPath = path.join(projectRoot, "project_output/plans/motion_plan.json");
const runtimePlanPath = path.join(projectRoot, "project_output/render/remotion/runtime_plan.json");
const timelinePath = path.join(runFolder, "05_video/audio/voice_timeline.json");
const timestampsPath = path.join(runFolder, "01_script/narration_timestamps.json");
const cropManifestPath = path.join(runFolder, "04_panel_crops", "panel_crop_manifest.json");
const cropReviewStatusPath = path.join(runFolder, "04_panel_crops", "crop_review_status.json");

await requireApprovedCropReviewIfPresent();
let timeline = normalizeTimeline(await readJson(timelinePath));
const plan = await readJson(planPath);
if (!Array.isArray(plan.shots) || plan.shots.length === 0) {
  throw new Error("motion_plan.json must include a non-empty shots array");
}
timeline = await alignTimelinePanelIds({ timeline, plan, runFolder, timelinePath });

const fps = Number(plan.render?.fps ?? plan.fps ?? 24) || 24;
const segmentByPanelId = new Map();
for (const segment of timeline.segments) {
  if (!segment.panel_id) {
    continue;
  }
  if (segmentByPanelId.has(segment.panel_id)) {
    throw new Error(`voice_timeline.json has duplicate panel_id: ${segment.panel_id}`);
  }
  segmentByPanelId.set(segment.panel_id, segment);
}

if (timeline.segments.length !== plan.shots.length) {
  throw new Error(`voice timeline segment count ${timeline.segments.length} does not match shot count ${plan.shots.length}`);
}

const segmentsByShotId = new Map();
const updatedShots = plan.shots.map((shot, index) => {
  const segment = segmentByPanelId.get(shot.panel_id) ?? timeline.segments[index];
  if (!segment) {
    throw new Error(`Missing voice timeline segment for shot ${shot.shot_id}`);
  }
  if (segment.panel_id && shot.panel_id && segment.panel_id !== shot.panel_id) {
    throw new Error(`Timeline panel_id drift for ${shot.shot_id}: expected ${shot.panel_id}, got ${segment.panel_id}`);
  }

  const durationSec = round(segment.durationMs / 1000, 3);
  const durationFrames = Math.max(1, Math.round(durationSec * fps));
  segmentsByShotId.set(shot.shot_id, segment);
  return {
    ...shot,
    duration_sec: durationSec,
    duration_frames: durationFrames,
  };
});

const masterAudioPath = await resolveMasterAudioPath({ timeline, runFolder });
const runFolderRel = toProjectRelative(runFolder, projectRoot);
const masterAudioRel = toProjectRelative(masterAudioPath, projectRoot);
const timelineRel = toProjectRelative(timelinePath, projectRoot);
const videoOutput = {
  root: `${runFolderRel}/05_video`,
  previews_dir: `${runFolderRel}/05_video/previews`,
  final: `${runFolderRel}/05_video/motion_comic_preview.mp4`,
};
const narration = {
  provider: timeline.provider ?? "doubao-volcengine",
  resource_id: timeline.resource_id ?? null,
  voice: timeline.voice ?? null,
  speech_rate: timeline.speech_rate ?? null,
  sample_rate: timeline.sample_rate ?? null,
  source: masterAudioRel,
  timeline: timelineRel,
  duration_ms: timeline.totalMs,
  duration_sec: round(timeline.totalMs / 1000, 3),
  volume: 1,
};

const updatedPlan = {
  ...plan,
  video_output: videoOutput,
  shots: updatedShots,
  audio: {
    ...(plan.audio ?? {}),
    tracks: [
      ...((plan.audio?.tracks ?? []).filter((track) => track?.type !== "narration")),
      { type: "narration", source: masterAudioRel, duration_ms: timeline.totalMs },
    ],
    narration,
  },
};

await writeJson(planPath, updatedPlan);
if (await pathExists(runtimePlanPath)) {
  const runtimePlan = await readJson(runtimePlanPath);
  const durationByShotId = new Map(updatedShots.map((shot) => [shot.shot_id, shot.duration_frames]));
  await writeJson(runtimePlanPath, {
    ...runtimePlan,
    video_output: videoOutput,
    audio: updatedPlan.audio,
    shots: (runtimePlan.shots ?? []).map((shot) => ({
      ...shot,
      duration_frames: durationByShotId.get(shot.shot_id) ?? shot.duration_frames,
    })),
  });
}

await writeJson(timestampsPath, {
  version: 1,
  source: "doubao_actual_audio",
  estimated: false,
  generated_from: timelineRel,
  totalMs: timeline.totalMs,
  segments: updatedShots.map((shot) => {
    const segment = segmentsByShotId.get(shot.shot_id);
    return {
      shot_id: shot.shot_id,
      segment_id: segment.segment_id,
      page_id: segment.page_id ?? null,
      panel_id: shot.panel_id,
      source_panel_id: segment.source_panel_id ?? null,
      startMs: segment.startMs,
      endMs: segment.endMs,
      durationMs: segment.durationMs,
      text: segment.text,
      audio: segment.audio,
    };
  }),
});

console.log(`已按豆包真实音频回写时间轴：${updatedShots.length} 个镜头，${(timeline.totalMs / 1000).toFixed(2)}s`);
console.log(`motion_plan=${toProjectRelative(planPath, projectRoot)}`);
console.log(`narration=${masterAudioRel}`);

function parseArgs(values) {
  const parsed = {
    runFolderArg: null,
    projectRoot: process.cwd(),
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
    if (!value.startsWith("--") && !parsed.runFolderArg) {
      parsed.runFolderArg = value;
      continue;
    }
    throw new Error(`未知参数：${value}`);
  }
  return parsed;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function normalizeTimeline(value) {
  const segments = Array.isArray(value.segments) ? value.segments : [];
  if (segments.length === 0) {
    throw new Error("voice_timeline.json must include a non-empty segments array");
  }

  let cursorMs = 0;
  const normalizedSegments = segments.map((segment, index) => {
    const durationMs = Number(segment.durationMs);
    if (!Number.isFinite(durationMs) || durationMs <= 0) {
      throw new Error(`voice_timeline segment ${index + 1} has invalid durationMs`);
    }
    const startMs = Number.isFinite(Number(segment.startMs)) ? Number(segment.startMs) : cursorMs;
    const endMs = Number.isFinite(Number(segment.endMs)) ? Number(segment.endMs) : startMs + durationMs;
    cursorMs = endMs;
    return {
      ...segment,
      segment_id: segment.segment_id ?? `seg_${String(index + 1).padStart(3, "0")}`,
      text: String(segment.text ?? ""),
      durationMs,
      startMs,
      endMs,
    };
  });

  return {
    ...value,
    totalMs: Number.isFinite(Number(value.totalMs)) ? Number(value.totalMs) : cursorMs,
    segments: normalizedSegments,
  };
}

async function alignTimelinePanelIds({ timeline, plan, runFolder, timelinePath }) {
  if (timeline.segments.length !== plan.shots.length) {
    return timeline;
  }

  const mismatched = timeline.segments.some((segment, index) => {
    const shot = plan.shots[index];
    return segment.panel_id && shot?.panel_id && segment.panel_id !== shot.panel_id;
  });
  if (!mismatched) {
    return timeline;
  }

  const cropManifestPath = path.join(runFolder, "04_panel_crops", "panel_crop_manifest.json");
  if (!(await pathExists(cropManifestPath))) {
    return timeline;
  }

  const cropManifest = await readJson(cropManifestPath);
  const crops = Array.isArray(cropManifest.crops) ? cropManifest.crops : [];
  if (crops.length !== timeline.segments.length) {
    throw new Error(
      `panel_crop_manifest crop count ${crops.length} does not match voice timeline segment count ${timeline.segments.length}`,
    );
  }

  const mappings = [];
  const segments = timeline.segments.map((segment, index) => {
    const crop = crops[index];
    const shot = plan.shots[index];
    if (segment.panel_id && crop.panel_id && segment.panel_id !== crop.panel_id) {
      throw new Error(
        `Timeline crop panel_id drift for segment ${segment.segment_id}: expected ${crop.panel_id}, got ${segment.panel_id}`,
      );
    }
    mappings.push({
      index: index + 1,
      segment_id: segment.segment_id,
      source_panel_id: segment.panel_id ?? crop.panel_id ?? null,
      source_runtime_input: crop.runtime_input ?? null,
      source_panel_crop: crop.file ?? null,
      motion_panel_id: shot.panel_id,
      motion_shot_id: shot.shot_id,
      motion_crop_asset: shot.source_image ?? null,
      audio: segment.audio ?? null,
      startMs: segment.startMs,
      endMs: segment.endMs,
    });
    return {
      ...segment,
      source_panel_id: segment.source_panel_id ?? segment.panel_id ?? crop.panel_id ?? null,
      source_runtime_input: segment.source_runtime_input ?? crop.runtime_input ?? null,
      source_panel_crop: segment.source_panel_crop ?? crop.file ?? null,
      motion_shot_id: shot.shot_id,
      panel_id: shot.panel_id,
    };
  });

  const backupPath = path.join(runFolder, "05_video", "audio", "voice_timeline_control_panel_ids.json");
  if (!(await pathExists(backupPath))) {
    await writeJson(backupPath, timeline);
  }
  const mappingPath = path.join(runFolder, "05_video", "audio", "motion_panel_id_alignment.json");
  await writeJson(mappingPath, {
    version: 1,
    policy:
      "voice_timeline panel_id rewritten from control-page crop IDs to motion_plan panel IDs after npm run build; source_panel_id preserves the original crop panel ID.",
    source_backup: "05_video/audio/voice_timeline_control_panel_ids.json",
    mappings,
  });

  const alignedTimeline = {
    ...timeline,
    segments,
    panel_id_alignment: {
      policy:
        "voice_timeline panel_id rewritten from control-page crop IDs to motion_plan panel IDs after npm run build; source_panel_id preserves the original crop panel ID.",
      source_backup: "05_video/audio/voice_timeline_control_panel_ids.json",
      mapping_file: "05_video/audio/motion_panel_id_alignment.json",
    },
  };
  await writeJson(timelinePath, alignedTimeline);
  return alignedTimeline;
}

async function requireApprovedCropReviewIfPresent() {
  if (!(await pathExists(cropManifestPath))) {
    return;
  }
  const cropManifest = await readJson(cropManifestPath);
  if (cropManifest.crop_method !== "tools_comic_panel_splitter_v1") {
    throw new Error(
      `apply-audio-timeline requires splitter crop_method tools_comic_panel_splitter_v1; got ${JSON.stringify(
        cropManifest.crop_method,
      )}`,
    );
  }
  const status = await readJson(cropReviewStatusPath).catch((error) => {
    throw new Error(`apply-audio-timeline requires approved crop review; missing crop_review_status.json (${error.message})`);
  });
  if (status.status !== "approved") {
    throw new Error(
      `apply-audio-timeline requires approved crop review before video timing; current status=${JSON.stringify(
        status.status,
      )}`,
    );
  }
}

async function resolveMasterAudioPath({ timeline, runFolder }) {
  const candidates = [
    timeline.audio ? path.resolve(runFolder, timeline.audio) : null,
    path.join(runFolder, "05_video/audio/master.mp3"),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return candidate;
    }
  }
  throw new Error(`Missing master narration audio: ${candidates.join(" or ")}`);
}

async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function toProjectRelative(filePath, projectRoot) {
  return path.relative(projectRoot, filePath).split(path.sep).join("/");
}

function round(value, decimals) {
  return Number(value.toFixed(decimals));
}

#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const { runFolderArg, projectRootArg } = parseArgs(process.argv.slice(2));

if (!runFolderArg) {
  console.error("用法：node validate-timeline-beats.mjs <run-folder> [--project-root <repo-root>]");
  process.exit(2);
}

const projectRoot = path.resolve(projectRootArg);
const runFolder = path.resolve(projectRoot, runFolderArg);
const timelinePath = path.join(runFolder, "02_prompts", "timeline_beats.json");
const audioSegmentsPath = path.join(runFolder, "01_script", "audio_segments.json");
const timestampsPath = path.join(runFolder, "01_script", "narration_timestamps.json");
const controlPromptsPath = path.join(runFolder, "02_prompts", "control_page_prompts.json");
const auditPath = path.join(runFolder, "02_prompts", "timeline_beats_audit.json");

const timeline = await readJson(timelinePath);
const audioSegments = await readJson(audioSegmentsPath);
const timestamps = await readJson(timestampsPath);
const controlPrompts = await readJson(controlPromptsPath);
const blockers = [];
const warnings = [];

const beats = Array.isArray(timeline.beats) ? timeline.beats : [];
const audio = Array.isArray(audioSegments.segments) ? audioSegments.segments : [];
const timestampRows = Array.isArray(timestamps.segments) ? timestamps.segments : [];
const pages = Array.isArray(controlPrompts.pages) ? controlPrompts.pages : [];
const promptPanels = pages.flatMap((page) =>
  Array.isArray(page.panels) ? page.panels.map((panel) => ({ ...panel, page_id: page.page_id })) : [],
);

if (beats.length === 0) {
  blockers.push("timeline_beats.json must contain non-empty beats");
}

validateBeatRows(beats, blockers);
validatePageGroups(timeline.page_groups, beats, blockers, warnings);
validateDerivedRows({ beats, audio, timestampRows, promptPanels, blockers });

const audit = {
  version: 1,
  checked_at: new Date().toISOString(),
  run_folder: normalizePath(path.relative(projectRoot, runFolder)),
  beat_count: beats.length,
  audio_segment_count: audio.length,
  timestamp_count: timestampRows.length,
  prompt_panel_count: promptPanels.length,
  blockers,
  warnings,
  passed: blockers.length === 0,
};

await mkdir(path.dirname(auditPath), { recursive: true });
await writeFile(auditPath, `${JSON.stringify(audit, null, 2)}\n`, "utf8");

if (blockers.length > 0) {
  console.error(blockers.join("\n"));
  process.exit(1);
}

console.log(`timeline beat audit passed: ${beats.length} beat(s)`);

function validateBeatRows(rows, blockersValue) {
  const seenBeatIds = new Set();
  const seenPanelIds = new Set();
  const seenAudioIds = new Set();

  rows.forEach((beat, index) => {
    const label = beat.beat_id || `beats[${index}]`;
    for (const field of [
      "beat_id",
      "order",
      "page_id",
      "panel_id",
      "audio_segment_id",
      "text",
      "estimated_start_sec",
      "estimated_end_sec",
      "visual_prompt_brief",
    ]) {
      if (beat[field] === undefined || beat[field] === null || beat[field] === "") {
        blockersValue.push(`${label} missing ${field}`);
      }
    }

    if (beat.order !== index + 1) {
      blockersValue.push(`${label} order must equal ${index + 1}`);
    }
    addUnique(seenBeatIds, beat.beat_id, `${label} duplicate beat_id`, blockersValue);
    addUnique(seenPanelIds, beat.panel_id, `${label} duplicate panel_id`, blockersValue);
    addUnique(seenAudioIds, beat.audio_segment_id, `${label} duplicate audio_segment_id`, blockersValue);

    const charCount = countNonWhitespaceChars(String(beat.text ?? ""));
    const hasException = Boolean(beat.segmentation_exception?.reason?.trim?.());
    if ((charCount < 20 || charCount > 50) && !hasException) {
      blockersValue.push(`${label} text length must be 20-50 non-whitespace chars; got ${charCount}`);
    }

    const start = Number(beat.estimated_start_sec);
    const end = Number(beat.estimated_end_sec);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) {
      blockersValue.push(`${label} estimated_start_sec/end must be finite, non-negative, and increasing`);
    }
  });
}

function validatePageGroups(pageGroups, rows, blockersValue, warningsValue) {
  if (!Array.isArray(pageGroups)) {
    warningsValue.push("timeline_beats.json page_groups missing; prompt panel mapping still checked directly");
    return;
  }
  const expectedBeatIds = rows.map((beat) => beat.beat_id);
  const groupedBeatIds = [];
  for (const group of pageGroups) {
    const beatIds = Array.isArray(group.beat_ids) ? group.beat_ids : [];
    groupedBeatIds.push(...beatIds);
    if (group.panel_count !== beatIds.length) {
      blockersValue.push(`${group.page_id ?? "page_group"} panel_count must equal beat_ids.length`);
    }
    if (beatIds.length < 5 || beatIds.length > 7) {
      blockersValue.push(`${group.page_id ?? "page_group"} must group 5-7 beats; found ${beatIds.length}`);
    }
  }
  compareOrderedIds("page_groups.beat_ids", groupedBeatIds, expectedBeatIds, blockersValue);
}

function validateDerivedRows({ beats: rows, audio, timestampRows, promptPanels, blockers: blockersValue }) {
  if (audio.length !== rows.length) {
    blockersValue.push(`audio_segments length must equal beats length: audio=${audio.length}, beats=${rows.length}`);
  }
  if (timestampRows.length !== rows.length) {
    blockersValue.push(`narration_timestamps length must equal beats length: timestamps=${timestampRows.length}, beats=${rows.length}`);
  }
  if (promptPanels.length !== rows.length) {
    blockersValue.push(`control_page_prompts panel count must equal beats length: panels=${promptPanels.length}, beats=${rows.length}`);
  }

  for (let index = 0; index < rows.length; index += 1) {
    const beat = rows[index];
    const audioRow = audio[index];
    const timestampRow = timestampRows[index];
    const promptPanel = promptPanels[index];
    validateMappedRow(`audio_segments[${index}]`, audioRow, beat, blockersValue);
    validateMappedRow(`narration_timestamps[${index}]`, timestampRow, beat, blockersValue);
    validateMappedRow(`control_page_prompts.panels[${index}]`, promptPanel, beat, blockersValue);
    if (audioRow && audioRow.segment_id !== beat.audio_segment_id) {
      blockersValue.push(`audio_segments[${index}].segment_id must equal ${beat.audio_segment_id}`);
    }
    if (timestampRow && timestampRow.segment_id !== beat.audio_segment_id) {
      blockersValue.push(`narration_timestamps[${index}].segment_id must equal ${beat.audio_segment_id}`);
    }
    if (timestampRow) {
      const start = Number(timestampRow.start_sec);
      const end = Number(timestampRow.end_sec);
      if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) {
        blockersValue.push(`narration_timestamps[${index}] start_sec/end_sec must be finite, non-negative, and increasing`);
      }
      if (index > 0 && Number(timestampRows[index - 1]?.end_sec) > start) {
        blockersValue.push(`narration_timestamps[${index}] overlaps the previous timestamp segment`);
      }
    }
    if (promptPanel && promptPanel.audio_segment_id && promptPanel.audio_segment_id !== beat.audio_segment_id) {
      blockersValue.push(`control_page_prompts.panels[${index}].audio_segment_id must equal ${beat.audio_segment_id}`);
    }
  }
}

function validateMappedRow(label, row, beat, blockersValue) {
  if (!row || !beat) {
    return;
  }
  if (row.visual_beat_id !== beat.beat_id) {
    blockersValue.push(`${label}.visual_beat_id must equal ${beat.beat_id}`);
  }
  if (row.page_id !== beat.page_id) {
    blockersValue.push(`${label}.page_id must equal ${beat.page_id}`);
  }
  if (row.panel_id !== beat.panel_id) {
    blockersValue.push(`${label}.panel_id must equal ${beat.panel_id}`);
  }
  if (row.text !== undefined && row.text !== beat.text) {
    blockersValue.push(`${label}.text must equal ${beat.beat_id} text`);
  }
}

function compareOrderedIds(label, actual, expected, blockersValue) {
  if (actual.length !== expected.length) {
    blockersValue.push(`${label} count must equal beats count: actual=${actual.length}, beats=${expected.length}`);
    return;
  }
  for (let index = 0; index < expected.length; index += 1) {
    if (actual[index] !== expected[index]) {
      blockersValue.push(`${label}[${index}] must equal ${expected[index]}`);
    }
  }
}

function addUnique(seen, value, message, blockersValue) {
  if (!value) {
    return;
  }
  if (seen.has(value)) {
    blockersValue.push(message);
  }
  seen.add(value);
}

function countNonWhitespaceChars(value) {
  return Array.from(value.replace(/\s+/gu, "")).length;
}

function parseArgs(values) {
  let runFolder = null;
  let projectRootValue = process.cwd();
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--project-root") {
      projectRootValue = values[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (value.startsWith("--project-root=")) {
      projectRootValue = value.slice("--project-root=".length);
      continue;
    }
    if (!value.startsWith("--") && !runFolder) {
      runFolder = value;
      continue;
    }
    throw new Error(`未知参数：${value}`);
  }
  return {
    runFolderArg: runFolder,
    projectRootArg: projectRootValue || process.cwd(),
  };
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function normalizePath(value) {
  return value.split(path.sep).join("/");
}

#!/usr/bin/env node

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const { runFolderArg, projectRootArg } = parseArgs(process.argv.slice(2));

if (!runFolderArg) {
  console.error("用法：node validate-vertical-page-prompts.mjs <run-folder> [--project-root <repo-root>]");
  process.exit(2);
}

const projectRoot = path.resolve(projectRootArg);
const runFolder = path.resolve(projectRoot, runFolderArg);
const promptsPath = path.join(runFolder, "02_prompts", "vertical_page_prompts.json");
const directorPath = path.join(runFolder, "02_prompts", "director_visual_plan.json");
const storyboardPath = path.join(runFolder, "02_prompts", "storyboard_sequence_plan.json");
const timelinePath = path.join(runFolder, "02_prompts", "timeline_beats.json");
const narrationPath = path.join(runFolder, "01_script", "narration.md");
const workerBatchesPath = path.join(runFolder, "02_prompts", "worker_batches");
const auditPath = path.join(runFolder, "02_prompts", "vertical_page_prompt_audit.json");

const prompts = await readJson(promptsPath);
const director = await readJson(directorPath);
const storyboard = await readJsonIfExists(storyboardPath);
const timeline = await readJsonIfExists(timelinePath);
const narrationText = await readTextIfExists(narrationPath);
const pages = Array.isArray(prompts.pages) ? prompts.pages : [];
const directives = Array.isArray(director.beat_directives) ? director.beat_directives : [];
const frames = Array.isArray(storyboard?.frames) ? storyboard.frames : [];
const directiveByBeat = new Map(directives.map((directive) => [directive.beat_id, directive]));
const frameByPage = new Map(frames.map((frame) => [frame.page_id, frame]));
const blockers = [];
const warnings = [];
const allowedShotScales = new Set(["wide", "medium_wide", "medium", "over_shoulder", "close_up", "insert", "bird_eye"]);
const spatialShotScales = new Set(["wide", "medium_wide", "medium", "over_shoulder", "bird_eye"]);
const allowedShotRoles = new Set(["establishing", "action", "reaction", "insert", "transition", "payoff"]);

if (prompts.mode !== "single_page_vertical") {
  blockers.push("vertical_page_prompts.json mode must be single_page_vertical");
}
if (pages.length === 0) {
  blockers.push("vertical_page_prompts.json must contain non-empty pages");
}
if (directives.length === 0) {
  blockers.push("director_visual_plan.json must contain non-empty beat_directives");
}
if (!storyboard) {
  blockers.push("storyboard_sequence_plan.json is required");
} else {
  validateStoryboardPlan({ storyboard, pages, blockers });
}

for (const [index, page] of pages.entries()) {
  validatePage({ page, index, directive: directiveByBeat.get(page.beat_id), frame: frameByPage.get(page.page_id), blockers, warnings });
}
validateShotScaleRatio({ pages, blockers, warnings });
validateContinuityCoverage({ pages, blockers, warnings });
validateSequenceShotVariety({ pages, blockers });
await validateWorkerBatches({ workerBatchesPath, pages, storyboard, blockers });
const narrationCoverage = validateNarrationCoverageAndDensity({ narrationText, timeline, pages, blockers, warnings });

const audit = {
  version: 1,
  checked_at: new Date().toISOString(),
  run_folder: normalizePath(path.relative(projectRoot, runFolder)),
  page_count: pages.length,
  storyboard_frame_count: frames.length,
  narration_coverage: narrationCoverage,
  shot_scale_counts: countBy(pages.map((page) => page.prompt_structure?.shot_scale ?? page.director_directive?.shot_scale)),
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

console.log(`vertical page prompt audit passed: ${pages.length} page(s)`);

function validatePage({ page, index, directive, frame, blockers: blockersValue, warnings: warningsValue }) {
  const label = page.page_id || `pages[${index}]`;
  const prompt = String(page.prompt ?? "");
  if (!page.page_id) blockersValue.push(`${label} missing page_id`);
  if (!page.beat_id) blockersValue.push(`${label} missing beat_id`);
  if (!page.audio_segment_id) blockersValue.push(`${label} missing audio_segment_id`);
  if (!page.target_file) blockersValue.push(`${label} missing target_file`);
  if (!prompt.trim()) blockersValue.push(`${label} prompt is required`);
  if (!directive) {
    blockersValue.push(`${label} missing matching director beat directive for ${page.beat_id ?? "(missing beat_id)"}`);
  }
  validatePromptText(label, prompt, blockersValue);
  validatePromptStructure({ label, page, directive, blockers: blockersValue });
  validateStoryboardFrame({ label, page, frame, prompt, blockers: blockersValue });
  validateContinuity(label, page.continuity, blockersValue, warningsValue);
}

function validatePromptText(label, prompt, blockersValue) {
  const banned = [
    { pattern: /上方角色控制区|下方漫画区|control page layout/i, reason: "legacy control-page layout" },
    { pattern: /```|\bJSON\b|manifest|保存到|生成后保存|等待审核/i, reason: "workflow metadata or narration" },
  ];
  for (const item of banned) {
    if (item.pattern.test(prompt)) {
      blockersValue.push(`${label} prompt contains ${item.reason}`);
    }
  }
  const required = [
    { pattern: /9:16|竖版|vertical/i, label: "9:16 vertical single-page requirement" },
    { pattern: /景别|shot scale|wide|medium|over.?shoulder|close.?up|insert|bird.?eye/i, label: "shot scale language" },
    { pattern: /视角|机位|camera angle|low angle|high angle|overhead|俯拍|低机位/i, label: "camera angle language" },
    { pattern: /运镜|camera motion|push-in|locked-off|track|reveal|静帧/i, label: "camera motion intent" },
    { pattern: /前景|中景|背景|foreground|midground|background/i, label: "foreground/midground/background staging" },
  ];
  for (const item of required) {
    if (!item.pattern.test(prompt)) {
      blockersValue.push(`${label} prompt missing ${item.label}`);
    }
  }
}

function validateStoryboardPlan({ storyboard, pages, blockers: blockersValue }) {
  if (storyboard.mode !== "single_page_vertical") {
    blockersValue.push("storyboard_sequence_plan.json mode must be single_page_vertical");
  }
  const sequenceBlocks = Array.isArray(storyboard.sequence_blocks) ? storyboard.sequence_blocks : [];
  if (sequenceBlocks.length === 0) {
    blockersValue.push("storyboard_sequence_plan.json must contain non-empty sequence_blocks");
  }
  const sequenceBlockIds = new Set();
  for (const [index, block] of sequenceBlocks.entries()) {
    const label = block.block_id || `storyboard.sequence_blocks[${index}]`;
    for (const field of ["block_id", "dramatic_function", "location", "entry_state", "exit_state", "camera_pattern"]) {
      if (isBlank(block[field])) {
        blockersValue.push(`${label} ${field} is required`);
      }
    }
    if (!Array.isArray(block.visual_progression) || block.visual_progression.length === 0) {
      blockersValue.push(`${label} visual_progression must be a non-empty array`);
    }
    if (!Array.isArray(block.continuity_rules)) {
      blockersValue.push(`${label} continuity_rules must be an array`);
    }
    if (block.block_id) {
      sequenceBlockIds.add(block.block_id);
    }
  }
  if (!Array.isArray(storyboard.frames)) {
    blockersValue.push("storyboard_sequence_plan.json frames must be an array");
    return;
  }
  if (storyboard.frames.length !== pages.length) {
    blockersValue.push(`storyboard_sequence_plan.json frames length must equal vertical_page_prompts pages length: ${storyboard.frames.length} !== ${pages.length}`);
  }
  for (const [index, frame] of storyboard.frames.entries()) {
    const label = frame.page_id || `storyboard.frames[${index}]`;
    validateRequiredStoryboardFields(label, frame, blockersValue);
    if (isBlank(frame.sequence_block_id)) {
      blockersValue.push(`${label} sequence_block_id is required`);
    } else if (sequenceBlockIds.size > 0 && !sequenceBlockIds.has(frame.sequence_block_id)) {
      blockersValue.push(`${label} sequence_block_id must match storyboard sequence_blocks: ${frame.sequence_block_id}`);
    }
    if (frame.page_id && pages[index]?.page_id && frame.page_id !== pages[index].page_id) {
      blockersValue.push(`${label} must align with vertical page ${pages[index].page_id}`);
    }
    if (frame.beat_id && pages[index]?.beat_id && frame.beat_id !== pages[index].beat_id) {
      blockersValue.push(`${label} beat_id must align with vertical page ${pages[index].beat_id}`);
    }
  }
}

function validatePromptStructure({ label, page, directive, blockers: blockersValue }) {
  const structure = page.prompt_structure;
  if (!structure || typeof structure !== "object" || Array.isArray(structure)) {
    blockersValue.push(`${label} prompt_structure is required`);
    return;
  }
  const requiredFields = [
    "shot_function",
    "shot_scale",
    "camera_angle",
    "camera_motion",
    "foreground",
    "midground",
    "background",
    "character_blocking",
    "prop_blocking",
    "lighting",
    "continuity_anchor",
    "negative_prompt",
  ];
  for (const field of requiredFields) {
    if (isBlank(structure[field])) {
      blockersValue.push(`${label} prompt_structure.${field} is required`);
    }
  }
  if (structure.shot_scale && !allowedShotScales.has(structure.shot_scale)) {
    blockersValue.push(`${label} prompt_structure.shot_scale is invalid: ${structure.shot_scale}`);
  }
  if (directive?.shot_scale && structure.shot_scale && directive.shot_scale !== structure.shot_scale) {
    blockersValue.push(`${label} prompt_structure.shot_scale must match director directive ${directive.shot_scale}`);
  }
}

function validateStoryboardFrame({ label, page, frame, prompt, blockers: blockersValue }) {
  const storyboardFrame = page.storyboard_frame;
  if (!storyboardFrame || typeof storyboardFrame !== "object" || Array.isArray(storyboardFrame)) {
    blockersValue.push(`${label} storyboard_frame is required`);
    return;
  }
  validateRequiredStoryboardFields(`${label} storyboard_frame`, storyboardFrame, blockersValue);
  if (!storyboardFrame.neighbor_context || typeof storyboardFrame.neighbor_context !== "object" || Array.isArray(storyboardFrame.neighbor_context)) {
    blockersValue.push(`${label} storyboard_frame.neighbor_context is required`);
  } else {
    for (const field of ["previous_page", "next_page"]) {
      if (isBlank(storyboardFrame.neighbor_context[field])) {
        blockersValue.push(`${label} storyboard_frame.neighbor_context.${field} is required`);
      }
    }
  }
  if (!frame) {
    blockersValue.push(`${label} missing matching storyboard frame`);
    return;
  }
  for (const field of ["shot_role", "previous_frame_state", "current_visual_action", "state_delta", "next_frame_hook", "camera_change_reason"]) {
    if (!isBlank(storyboardFrame[field]) && !isBlank(frame[field]) && normalizeText(storyboardFrame[field]) !== normalizeText(frame[field])) {
      blockersValue.push(`${label} storyboard_frame.${field} must match storyboard_sequence_plan frame`);
    }
  }
  assertPromptContainsCorePhrase({ label, prompt, field: "current_visual_action", value: storyboardFrame.current_visual_action, blockers: blockersValue });
  assertPromptContainsCorePhrase({ label, prompt, field: "state_delta", value: storyboardFrame.state_delta, blockers: blockersValue });
}

function validateRequiredStoryboardFields(label, value, blockersValue) {
  for (const field of ["shot_role", "previous_frame_state", "current_visual_action", "state_delta", "next_frame_hook", "camera_change_reason"]) {
    if (isBlank(value[field])) {
      blockersValue.push(`${label} ${field} is required`);
    }
  }
  if (value.shot_role && !allowedShotRoles.has(value.shot_role)) {
    blockersValue.push(`${label} shot_role is invalid: ${value.shot_role}`);
  }
  if (!isBlank(value.current_visual_action)) {
    validateDrawableAction(`${label} current_visual_action`, value.current_visual_action, blockersValue);
  }
}

function validateContinuity(label, continuity, blockersValue, warningsValue) {
  if (!continuity || typeof continuity !== "object" || Array.isArray(continuity)) {
    blockersValue.push(`${label} continuity is required`);
    return;
  }
  for (const field of [
    "sequence_block_id",
    "location",
    "screen_direction",
    "character_positions",
    "prop_state",
    "lighting_state",
  ]) {
    if (isBlank(continuity[field])) {
      blockersValue.push(`${label} continuity.${field} is required`);
    }
  }
  if (continuity.screen_direction && !/left|right|front|back|toward|away|左|右|前|后|向|背/i.test(String(continuity.screen_direction))) {
    warningsValue.push(`${label} continuity.screen_direction should name a stable screen direction`);
  }
}

function validateShotScaleRatio({ pages, blockers: blockersValue, warnings: warningsValue }) {
  if (pages.length === 0) return;
  const scales = pages.map((page) => page.prompt_structure?.shot_scale ?? page.director_directive?.shot_scale).filter(Boolean);
  const counts = countBy(scales);
  const closeRatio = (counts.close_up ?? 0) / pages.length;
  const spatialRatio = scales.filter((scale) => spatialShotScales.has(scale)).length / pages.length;
  const insertRatio = (counts.insert ?? 0) / pages.length;
  if (pages.length >= 7 && closeRatio > 0.15) {
    blockersValue.push(`shot scale ratio close_up must be <= 15%; got ${(closeRatio * 100).toFixed(1)}%`);
  }
  if (pages.length >= 7 && spatialRatio < 0.55) {
    blockersValue.push(`shot scale ratio spatial shots must be >= 55%; got ${(spatialRatio * 100).toFixed(1)}%`);
  }
  if (pages.length >= 7 && insertRatio > 0.25) {
    warningsValue.push(`shot scale ratio insert is high: ${(insertRatio * 100).toFixed(1)}%`);
  }
}

function validateContinuityCoverage({ pages, blockers: blockersValue }) {
  const byBlock = new Map();
  for (const page of pages) {
    const blockId = page.continuity?.sequence_block_id;
    if (!blockId) continue;
    const existing = byBlock.get(blockId) ?? { locations: new Set(), lighting: new Set() };
    existing.locations.add(String(page.continuity.location ?? "").trim());
    existing.lighting.add(String(page.continuity.lighting_state ?? "").trim());
    byBlock.set(blockId, existing);
  }
  for (const [blockId, info] of byBlock.entries()) {
    if (info.locations.size > 3) {
      blockersValue.push(`${blockId} continuity has too many locations for one sequence block: ${info.locations.size}`);
    }
    if (info.lighting.size > 4) {
      blockersValue.push(`${blockId} continuity has too many lighting states for one sequence block: ${info.lighting.size}`);
    }
  }
}

function validateSequenceShotVariety({ pages, blockers: blockersValue }) {
  const bySequence = new Map();
  for (const page of pages) {
    const sequenceId = page.continuity?.sequence_block_id;
    if (!sequenceId) continue;
    const entries = bySequence.get(sequenceId) ?? [];
    entries.push(page);
    bySequence.set(sequenceId, entries);
  }
  for (const [sequenceId, sequencePages] of bySequence.entries()) {
    for (let index = 0; index <= sequencePages.length - 3; index += 1) {
      const trio = sequencePages.slice(index, index + 3);
      const keys = trio.map((page) => [
        page.prompt_structure?.shot_scale ?? "",
        page.prompt_structure?.camera_angle ?? "",
        page.prompt_structure?.camera_motion ?? "",
      ].map(normalizeText).join("|"));
      if (keys[0] && keys.every((key) => key === keys[0])) {
        blockersValue.push(`${sequenceId} has 3 consecutive pages with identical shot_scale+camera_angle+camera_motion: ${trio.map((page) => page.page_id).join(", ")}`);
      }
      const cameraKeys = trio.map((page) => [
        page.prompt_structure?.camera_angle ?? "",
        page.prompt_structure?.camera_motion ?? "",
      ].map(normalizeText).join("|"));
      if (cameraKeys[0] && cameraKeys.every((key) => key === cameraKeys[0])) {
        blockersValue.push(`${sequenceId} has 3 consecutive pages with identical camera_angle+camera_motion: ${trio.map((page) => page.page_id).join(", ")}`);
      }
    }
    if (sequencePages.length >= 4) {
      const cameraPairCounts = countBy(sequencePages.map((page) => [
        page.prompt_structure?.camera_angle ?? "",
        page.prompt_structure?.camera_motion ?? "",
      ].map(normalizeText).join("|")));
      const maxCameraPairCount = Math.max(0, ...Object.values(cameraPairCounts));
      const maxCameraPairRatio = maxCameraPairCount / sequencePages.length;
      if (maxCameraPairRatio > 0.6) {
        blockersValue.push(`${sequenceId} reuses one camera_angle+camera_motion pair too often: ${(maxCameraPairRatio * 100).toFixed(1)}%`);
      }
    }
    const actionOwner = new Map();
    for (const page of sequencePages) {
      const action = normalizeText(page.storyboard_frame?.current_visual_action);
      if (!action) continue;
      if (actionOwner.has(action)) {
        blockersValue.push(`${sequenceId} repeats current_visual_action "${page.storyboard_frame.current_visual_action}" on ${actionOwner.get(action)} and ${page.page_id}`);
      } else {
        actionOwner.set(action, page.page_id);
      }
    }
  }
}

function validateNarrationCoverageAndDensity({ narrationText: narrationTextValue, timeline: timelineValue, pages, blockers: blockersValue, warnings: warningsValue }) {
  const audit = {
    checked: Boolean(narrationTextValue || timelineValue),
    max_effective_narration_chars_per_page: 40,
    min_beat_text_coverage_ratio: 0.9,
    narration_char_count: 0,
    beat_text_char_count: 0,
    beat_text_coverage_ratio: null,
    min_page_count_from_narration: null,
    page_count: pages.length,
    coverage_exception: null,
    density_exception: null,
    passed: true,
  };

  if (!narrationTextValue && !timelineValue) {
    return audit;
  }

  if (narrationTextValue && !timelineValue) {
    blockersValue.push("timeline_beats.json is required when narration.md exists");
    audit.passed = false;
    return audit;
  }

  const beats = Array.isArray(timelineValue?.beats) ? timelineValue.beats : [];
  if (timelineValue && beats.length === 0) {
    blockersValue.push("timeline_beats.json must contain non-empty beats when validating vertical prompt density");
    audit.passed = false;
  }
  if (timelineValue && beats.length > 0 && beats.length !== pages.length) {
    blockersValue.push(`timeline_beats.json beats length must equal vertical_page_prompts pages length: ${beats.length} !== ${pages.length}`);
    audit.passed = false;
  }

  if (!narrationTextValue) {
    warningsValue.push("narration.md is missing; skipped narration coverage and page density audit");
    return audit;
  }

  const normalizedNarration = normalizeNarrationForDensity(narrationTextValue);
  const normalizedBeatText = normalizeNarrationForDensity(beats.map((beat) => beat.text).join(""));
  audit.narration_char_count = normalizedNarration.length;
  audit.beat_text_char_count = normalizedBeatText.length;
  audit.beat_text_coverage_ratio = normalizedNarration.length > 0
    ? Number((normalizedBeatText.length / normalizedNarration.length).toFixed(3))
    : null;
  audit.min_page_count_from_narration = normalizedNarration.length > 0
    ? Math.ceil(normalizedNarration.length / audit.max_effective_narration_chars_per_page)
    : null;
  audit.coverage_exception = timelineValue?.segmentation_policy?.coverage_exception ?? null;
  audit.density_exception = timelineValue?.segmentation_policy?.density_exception ?? null;

  if (normalizedNarration.length === 0) {
    warningsValue.push("narration.md has no effective narration text after heading/whitespace cleanup");
    return audit;
  }

  const hasCoverageException = hasExceptionReason(audit.coverage_exception);
  const hasDensityException = hasExceptionReason(audit.density_exception);
  if (audit.beat_text_coverage_ratio < audit.min_beat_text_coverage_ratio && !hasCoverageException) {
    blockersValue.push(
      `timeline beat text coverage too low: beat_text_chars=${audit.beat_text_char_count}, narration_chars=${audit.narration_char_count}, coverage=${audit.beat_text_coverage_ratio}`,
    );
    audit.passed = false;
  }
  if (audit.beat_text_coverage_ratio > 1.2) {
    warningsValue.push(
      `timeline beat text coverage is unusually high: beat_text_chars=${audit.beat_text_char_count}, narration_chars=${audit.narration_char_count}, coverage=${audit.beat_text_coverage_ratio}`,
    );
  }
  if (pages.length < audit.min_page_count_from_narration && !hasDensityException) {
    blockersValue.push(
      `vertical page density too low: narration_chars=${audit.narration_char_count}, pages=${pages.length}, min_pages=${audit.min_page_count_from_narration} at <=${audit.max_effective_narration_chars_per_page} chars/page`,
    );
    audit.passed = false;
  }

  return audit;
}

async function validateWorkerBatches({ workerBatchesPath: batchesPath, pages, storyboard, blockers: blockersValue }) {
  let batchFiles = [];
  try {
    batchFiles = (await readdir(batchesPath))
      .filter((file) => file.endsWith(".json"))
      .sort();
  } catch (error) {
    if (error?.code === "ENOENT") {
      blockersValue.push("worker_batches directory is required");
      return;
    }
    throw error;
  }
  if (batchFiles.length === 0) {
    blockersValue.push("worker_batches must contain at least one JSON batch");
    return;
  }
  for (const file of batchFiles) {
    const batch = await readJson(path.join(batchesPath, file));
    const entries = Array.isArray(batch.pages) ? batch.pages : [];
    const sequenceContext = Array.isArray(batch.sequence_context) ? batch.sequence_context : [];
    if (sequenceContext.length === 0) {
      blockersValue.push(`${file} sequence_context must be a non-empty array`);
    }
    if (entries.length === 0) {
      blockersValue.push(`${file} pages must be a non-empty array`);
      continue;
    }
    const pageById = new Map(pages.map((page) => [page.page_id, page]));
    const contextBySequence = new Map(sequenceContext.map((sequence) => [sequence.sequence_block_id, sequence]));
    const expectedSequenceIds = new Set();
    for (const [index, page] of entries.entries()) {
      const label = `${file} pages[${index}]`;
      const promptPage = pageById.get(page.page_id);
      const sequenceId = promptPage?.continuity?.sequence_block_id ?? promptPage?.storyboard_frame?.sequence_block_id;
      if (sequenceId) {
        expectedSequenceIds.add(sequenceId);
      }
      const neighborContext = page.neighbor_context ?? page.storyboard_frame?.neighbor_context;
      if (!neighborContext || typeof neighborContext !== "object" || Array.isArray(neighborContext)) {
        blockersValue.push(`${label} neighbor_context is required`);
        continue;
      }
      for (const field of ["previous_page", "next_page"]) {
        if (isBlank(neighborContext[field])) {
          blockersValue.push(`${label} neighbor_context.${field} is required`);
        }
      }
      const expectedNeighborContext = promptPage?.storyboard_frame?.neighbor_context;
      if (expectedNeighborContext) {
        for (const field of ["previous_page", "next_page"]) {
          if (normalizeText(neighborContext[field]) !== normalizeText(expectedNeighborContext[field])) {
            blockersValue.push(`${label} neighbor_context.${field} must match vertical_page_prompts storyboard_frame`);
          }
        }
      }
    }
    const storyboardBlocks = new Map((storyboard?.sequence_blocks ?? []).map((block) => [block.block_id, block]));
    for (const sequenceId of expectedSequenceIds) {
      const context = contextBySequence.get(sequenceId);
      if (!context) {
        blockersValue.push(`${file} sequence_context missing ${sequenceId}`);
        continue;
      }
      for (const field of ["entry_state", "exit_state", "camera_pattern"]) {
        if (isBlank(context[field])) {
          blockersValue.push(`${file} sequence_context ${sequenceId} ${field} is required`);
        }
      }
      const storyboardBlock = storyboardBlocks.get(sequenceId);
      for (const field of ["entry_state", "exit_state", "camera_pattern"]) {
        if (storyboardBlock && !isBlank(context[field]) && normalizeText(context[field]) !== normalizeText(storyboardBlock[field])) {
          blockersValue.push(`${file} sequence_context ${sequenceId} ${field} must match storyboard_sequence_plan`);
        }
      }
    }
  }
}

function validateDrawableAction(label, value, blockersValue) {
  const text = String(value ?? "");
  const hasSubject = /人物|主角|差役|舟卒|船老大|主纲吏|仓吏|脚夫|吏人|妻子|母亲|孩子|村民|商贩|缆夫|船队|粮船|纲船|米袋|账册|官粮|林照|沈砚|陆玉娘|[一-龥]{1,8}(?:在|把|向|从|被|拿|递|搬|推|看|盯|站|跪|靠|围|打开|翻|清点|交割)/u.test(text);
  const hasActionVerb = /走|站|看|盯|巡|推|搬|拖|递|拿|举|压|掀|盖|冲|堵|换|指向|转身|停在|挡住|点验|清点|交割|写|翻|塞|赔笑|解释|靠近|围住|撞|裂|进水|发潮|混|藏|完成|推进|落到|压到/u.test(text);
  const hasObjectOrState = /米|粮|船|绳|账|册|仓|河|岸|雨|苫布|裂口|水|闸|堰|桥|汴梁|京师|仓门|朱笔|封记|井|钥匙|箱|鞋|红线|铜钱|族谱|道具|前景|中景|背景|状态|位置|视线|空间|责任|压迫/u.test(text);
  if (!hasSubject || !hasActionVerb || !hasObjectOrState) {
    blockersValue.push(`${label} must be drawable: include a visible subject, action verb, and object or state change`);
  }
  if (/^(责任反转|小风险咬人|终点审判|繁华误读|系统压力|情绪反应|推进怪谈|制造压迫)$/u.test(text.trim())) {
    blockersValue.push(`${label} must not be only an abstract dramatic function`);
  }
}

function countBy(values) {
  const result = {};
  for (const value of values) {
    if (!value) continue;
    result[value] = (result[value] ?? 0) + 1;
  }
  return result;
}

function assertPromptContainsCorePhrase({ label, prompt, field, value, blockers: blockersValue }) {
  const promptText = normalizeText(prompt);
  const phrases = corePhrases(value);
  if (phrases.length === 0) {
    blockersValue.push(`${label} storyboard_frame.${field} must contain a usable phrase`);
    return;
  }
  if (!phrases.some((phrase) => promptText.includes(phrase))) {
    blockersValue.push(`${label} prompt must include storyboard_frame.${field} core phrase`);
  }
}

function corePhrases(value) {
  return String(value ?? "")
    .split(/[，。；、,.!?！？;:\s]+/u)
    .map(normalizeText)
    .filter((phrase) => phrase.length >= 4);
}

function normalizeText(value) {
  return String(value ?? "").toLowerCase().replace(/\s+/g, "").trim();
}

function normalizeNarrationForDensity(value) {
  return String(value ?? "")
    .split(/\r?\n/u)
    .filter((line) => !line.trim().startsWith("#"))
    .join("")
    .replace(/\s+/gu, "")
    .trim();
}

function hasExceptionReason(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return !isBlank(value.reason);
}

function isBlank(value) {
  if (Array.isArray(value)) return value.length === 0;
  if (value && typeof value === "object") return Object.keys(value).length === 0;
  return String(value ?? "").trim() === "";
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

async function readJsonIfExists(filePath) {
  try {
    return await readJson(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function readTextIfExists(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function normalizePath(value) {
  return value.split(path.sep).join("/");
}

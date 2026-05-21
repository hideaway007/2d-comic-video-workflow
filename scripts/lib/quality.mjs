import { existsSync } from "node:fs";
import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

export const projectOutputDir = "project_output";
export const planPath = path.join(projectOutputDir, "plans", "motion_plan.json");

const allowedPrimitives = new Set([
  "hold",
  "camera_push",
  "camera_pan",
  "camera_zoom",
  "shake",
  "focus_reveal",
  "overlay_effect",
  "parallax_hint",
]);
const allowedEasings = new Set(["linear", "ease_in", "ease_out", "ease_in_out"]);
const durationBounds = { min: 1.5, max: 8 };
const narrationDurationBounds = { min: 0.5, max: 35 };
const scaleBounds = { min: 1, max: 1.22 };
const panBounds = { min: -160, max: 160 };
const lowConfidenceThreshold = 0.6;

export function resolveProjectPath(cwd, relativePath) {
  return path.resolve(cwd, relativePath);
}

export async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function fileSize(filePath) {
  const info = await stat(filePath);
  return info.size;
}

export async function ensureDir(dirPath) {
  await mkdir(dirPath, { recursive: true });
}

export async function writeText(filePath, content) {
  await ensureDir(path.dirname(filePath));
  await writeFile(filePath, content.endsWith("\n") ? content : `${content}\n`, "utf8");
}

export async function readPlan(cwd = process.cwd()) {
  const absolutePlanPath = resolveProjectPath(cwd, planPath);
  let raw;
  try {
    raw = await readFile(absolutePlanPath, "utf8");
  } catch (error) {
    throw new Error(`Missing motion plan: ${planPath} (${error.message})`);
  }

  let plan;
  try {
    plan = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid motion plan JSON: ${planPath} (${error.message})`);
  }

  if (!Array.isArray(plan.shots) || plan.shots.length === 0) {
    throw new Error(`Invalid motion plan: ${planPath} must include a non-empty shots array`);
  }

  return plan;
}

export async function readJsonFile(cwd, relativePath, label = relativePath) {
  const absolutePath = resolveProjectPath(cwd, relativePath);
  let raw;
  try {
    raw = await readFile(absolutePath, "utf8");
  } catch (error) {
    throw new Error(`Missing ${label}: ${relativePath} (${error.message})`);
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid ${label} JSON: ${relativePath} (${error.message})`);
  }
}

export async function runStructuredQualityGates({ cwd = process.cwd(), plan }) {
  const result = emptyGateResult();
  const panelPack = await loadPanelPackForQa({ cwd, plan, result });
  const panelById = new Map();
  const pageById = new Map();

  if (panelPack) {
    runPanelPackGate({ cwd, panelPack, result, panelById, pageById });
    runReadingOrderGate({ panelPack, result });
  }

  runSafeFrameGate({ cwd, plan, panelById, result });
  runMotionPrimitiveGate({ plan, result });
  await runRuntimeMetadataGate({ cwd, plan, panelById, result });

  return result;
}

export function severityForShot(shot, gateResult) {
  if (gateResult.criticalIssues.some((issue) => issue.shot_id === shot.shot_id || issue.panel_id === shot.panel_id)) {
    return "critical";
  }
  if (gateResult.warnings.some((issue) => issue.shot_id === shot.shot_id || issue.panel_id === shot.panel_id)) {
    return "warning";
  }
  if (gateResult.manualReviewItems.some((item) => item.shot_id === shot.shot_id || item.panel_id === shot.panel_id)) {
    return "manual_review";
  }
  return "ok";
}

function emptyGateResult() {
  return {
    criticalIssues: [],
    warnings: [],
    manualReviewItems: [],
    correctionSuggestions: [],
  };
}

async function loadPanelPackForQa({ cwd, plan, result }) {
  const panelPackPath = plan.panel_pack;
  if (!panelPackPath) {
    addCritical(result, {
      code: "panel_pack_missing",
      message: "panel_pack is missing from motion plan",
      suggestion: "Regenerate the plan so motion_plan.json includes panel_pack.",
    });
    return null;
  }

  try {
    return await readJsonFile(cwd, panelPackPath, "panel_pack");
  } catch (error) {
    addCritical(result, {
      code: "panel_pack_unreadable",
      message: error.message,
      suggestion: "Regenerate project_output/panels/panel_pack.json or fix invalid JSON.",
    });
    return null;
  }
}

function runPanelPackGate({ cwd, panelPack, result, panelById, pageById }) {
  if (!Array.isArray(panelPack.pages) || panelPack.pages.length === 0) {
    addCritical(result, {
      code: "panel_pack_empty_pages",
      message: "panel_pack pages must be a non-empty array",
      suggestion: "Regenerate panel_pack.json from input/pages.",
    });
  } else {
    for (const page of panelPack.pages) {
      if (!page.page_id) {
        addCritical(result, {
          code: "page_id_missing",
          message: "panel_pack page is missing page_id",
          suggestion: "Regenerate panel_pack.json so each page has a stable page_id.",
        });
        continue;
      }
      pageById.set(page.page_id, page);
    }
  }

  if (!Array.isArray(panelPack.panels) || panelPack.panels.length === 0) {
    addCritical(result, {
      code: "panel_pack_empty_panels",
      message: "panel_pack panels must be a non-empty array",
      suggestion: "Regenerate panel detection output; each page needs at least one panel.",
    });
    return;
  }

  for (const panel of panelPack.panels) {
    const panelId = panel.panel_id ?? "(missing panel_id)";
    if (!panel.panel_id) {
      addCritical(result, {
        code: "panel_id_missing",
        message: "panel_pack panel is missing panel_id",
        suggestion: "Regenerate panel_pack.json so every panel has panel_id.",
      });
      continue;
    }
    if (panelById.has(panel.panel_id)) {
      addCritical(result, {
        code: "duplicate_panel_id",
        panel_id: panel.panel_id,
        message: `Duplicate panel_id: ${panel.panel_id}`,
        suggestion: "Regenerate panel_pack.json or rename duplicate panel_id entries.",
      });
    }
    panelById.set(panel.panel_id, panel);

    const page = pageById.get(panel.page_id);
    if (!page) {
      addCritical(result, {
        code: "unknown_page",
        panel_id: panel.panel_id,
        message: `Panel ${panel.panel_id} references unknown page_id: ${panel.page_id ?? "(missing)"}`,
        suggestion: "Fix panel_pack.manual.json panels[].page_id or regenerate panel_pack.json.",
      });
    } else {
      validateBbox({ panel, page, result });
    }

    if (!panel.crop_asset) {
      addCritical(result, {
        code: "panel_crop_missing",
        panel_id: panel.panel_id,
        message: `Panel ${panel.panel_id} is missing crop_asset`,
        suggestion: "Regenerate panel crops from panel_pack.json.",
      });
    } else {
      const cropPath = resolveProjectPath(cwd, panel.crop_asset);
      if (!pathExistsSync(cropPath)) {
        addCritical(result, {
          code: "panel_crop_unreadable",
          panel_id: panel.panel_id,
          message: `Missing panel crop for ${panel.panel_id}: ${panel.crop_asset}`,
          suggestion: "Regenerate project_output/panels/crops or fix panel_pack.json panels[].crop_asset.",
        });
      }
    }

    validateSafeFrame({
      value: panel.safe_frame,
      result,
      panel_id: panel.panel_id,
      context: `Panel ${panel.panel_id}`,
      suggestion: "Adjust project_output/panels/panel_pack.manual.json panels[].safe_frame.",
    });
    validatePanelReviewFlags({ panel, result });
  }
}

function runReadingOrderGate({ panelPack, result }) {
  const orderToPanels = new Map();
  const numericOrders = [];
  for (const panel of panelPack.panels ?? []) {
    const order = panel.reading_order;
    if (!Number.isFinite(Number(order))) {
      addCritical(result, {
        code: "reading_order_missing",
        panel_id: panel.panel_id,
        message: `Panel ${panel.panel_id ?? "(missing panel_id)"} reading_order is missing or non-numeric`,
        suggestion: `Set ${panel.panel_id ?? "the panel"} reading_order in panel_pack.manual.json panels[].reading_order.`,
      });
      continue;
    }
    const numericOrder = Number(order);
    numericOrders.push(numericOrder);
    const panels = orderToPanels.get(numericOrder) ?? [];
    panels.push(panel.panel_id);
    orderToPanels.set(numericOrder, panels);
  }

  for (const [order, panels] of orderToPanels.entries()) {
    if (panels.length > 1) {
      for (const panelId of panels) {
        addWarning(result, {
          code: "duplicate_reading_order",
          panel_id: panelId,
          message: `Duplicate reading_order ${order} for panel_id ${panelId}`,
          suggestion: `Update panel_pack.manual.json panels[].reading_order for ${panelId} to a unique continuous integer.`,
        });
      }
    }
  }

  const uniqueOrders = [...new Set(numericOrders)].sort((a, b) => a - b);
  for (let index = 0; index < uniqueOrders.length; index += 1) {
    const expected = index + 1;
    if (uniqueOrders[index] !== expected) {
      addWarning(result, {
        code: "non_continuous_reading_order",
        message: `Reading order is not continuous: expected ${expected}, got ${uniqueOrders[index]}`,
        suggestion: "Update panel_pack.manual.json panels[].reading_order so orders are 1..N without gaps.",
      });
      break;
    }
  }
}

function runSafeFrameGate({ plan, panelById, result }) {
  for (const panel of plan.panels ?? []) {
    validateSafeFrame({
      value: panel.safe_frame,
      result,
      panel_id: panel.panel_id,
      context: `Plan panel ${panel.panel_id}`,
      suggestion: "Regenerate motion_plan.json from panel_pack.json or fix panel_pack.manual.json panels[].safe_frame.",
    });
  }

  for (const shot of plan.shots ?? []) {
    const panel = panelById.get(shot.panel_id) ?? (plan.panels ?? []).find((entry) => entry.panel_id === shot.panel_id);
    if (!panel?.safe_frame) {
      addCritical(result, {
        code: "shot_safe_frame_unlinked",
        shot_id: shot.shot_id,
        panel_id: shot.panel_id,
        message: `Shot ${shot.shot_id} cannot link to panel safe_frame for panel_id ${shot.panel_id ?? "(missing)"}`,
        suggestion: "Ensure shot.panel_id exists in panel_pack.json and panel.safe_frame is present.",
      });
    }
  }
}

function runMotionPrimitiveGate({ plan, result }) {
  const hasNarrationTimeline = Boolean(plan.audio?.narration?.timeline || plan.audio?.narration?.source);
  const activeDurationBounds = hasNarrationTimeline ? narrationDurationBounds : durationBounds;
  for (const shot of plan.shots ?? []) {
    if (!allowedPrimitives.has(shot.primitive)) {
      addCritical(result, {
        code: "unsupported_primitive",
        shot_id: shot.shot_id,
        panel_id: shot.panel_id,
        message: `Shot ${shot.shot_id} uses unsupported primitive: ${shot.primitive ?? "(missing)"}`,
        suggestion: "Regenerate analysis_plan.json through the normalizer or change primitive to an allowed enum.",
      });
    }

    validateNumberRange({
      value: shot.duration_sec,
      min: activeDurationBounds.min,
      max: activeDurationBounds.max,
      result,
      code: "duration_out_of_bounds",
      shot_id: shot.shot_id,
      panel_id: shot.panel_id,
      field: "duration_sec",
      suggestion: hasNarrationTimeline
        ? `Regenerate or split narration segments so duration_sec stays within ${activeDurationBounds.min}..${activeDurationBounds.max} seconds.`
        : `Clamp duration_sec to ${durationBounds.min}..${durationBounds.max} seconds through the normalizer.`,
    });

    const camera = shot.camera_motion ?? {};
    for (const field of ["start_scale", "end_scale"]) {
      validateNumberRange({
        value: camera[field],
        min: scaleBounds.min,
        max: scaleBounds.max,
        result,
        code: "scale_out_of_bounds",
        shot_id: shot.shot_id,
        panel_id: shot.panel_id,
        field: `camera_motion.${field}`,
        suggestion: `Clamp camera scale to ${scaleBounds.min}..${scaleBounds.max}.`,
      });
    }
    for (const field of ["start_position", "end_position"]) {
      validatePan({
        value: camera[field],
        result,
        shot_id: shot.shot_id,
        panel_id: shot.panel_id,
        field: `camera_motion.${field}`,
      });
    }
    if (camera.easing && !allowedEasings.has(camera.easing)) {
      addCritical(result, {
        code: "unsupported_easing",
        shot_id: shot.shot_id,
        panel_id: shot.panel_id,
        message: `Shot ${shot.shot_id} camera_motion.easing is unsupported: ${camera.easing}`,
        suggestion: "Use one of linear, ease_in, ease_out, ease_in_out.",
      });
    }

    const flags = new Set(shot.review_flags ?? []);
    for (const flag of ["normalizer_corrected", "unknown_primitive_fallback"]) {
      if (flags.has(flag)) {
        addWarning(result, {
          code: flag,
          shot_id: shot.shot_id,
          panel_id: shot.panel_id,
          message: `Shot ${shot.shot_id} carries review flag: ${flag}`,
          suggestion: "Inspect project_output/plans/normalizer_report.json before approving final output.",
        });
        addManualReview(result, {
          code: flag,
          shot_id: shot.shot_id,
          panel_id: shot.panel_id,
          message: `Manual review required for ${shot.shot_id}: ${flag}`,
          suggestion: "Review primitive, duration, pan, scale and easing against panel readability.",
        });
      }
    }
    if (shot.primitive === "parallax_hint" && shot.defer_layer_refinement) {
      addWarning(result, {
        code: "parallax_deferred_layers",
        shot_id: shot.shot_id,
        panel_id: shot.panel_id,
        message: `Shot ${shot.shot_id} uses parallax_hint while layer refinement is deferred`,
        suggestion: "Review contact sheet and add real foreground/depth layers before final render.",
      });
      addManualReview(result, {
        code: "parallax_deferred_layers",
        shot_id: shot.shot_id,
        panel_id: shot.panel_id,
        message: `Manual layer review required for ${shot.shot_id}`,
        suggestion: "Confirm parallax does not fake depth or hide important dialogue.",
      });
    }
  }
}

async function runRuntimeMetadataGate({ cwd, plan, panelById, result }) {
  const runtimePath = path.join(projectOutputDir, "render", "remotion", "runtime_plan.json");
  let runtimePlan;
  try {
    runtimePlan = await readJsonFile(cwd, runtimePath, "runtime_plan");
  } catch {
    addWarning(result, {
      code: "runtime_plan_missing",
      message: "runtime_plan.json was not found; runtime safe_frame and primitive metadata were not checked",
      suggestion: "Run npm run build before QA so renderer metadata can be inspected.",
    });
    return;
  }

  const runtimeByShot = new Map((runtimePlan.shots ?? []).map((shot) => [shot.shot_id, shot]));
  const planPanelById = new Map((plan.panels ?? []).map((panel) => [panel.panel_id, panel]));
  for (const shot of plan.shots ?? []) {
    const runtimeShot = runtimeByShot.get(shot.shot_id);
    if (!runtimeShot) {
      addCritical(result, {
        code: "runtime_shot_missing",
        shot_id: shot.shot_id,
        panel_id: shot.panel_id,
        message: `runtime_plan.json is missing shot ${shot.shot_id}`,
        suggestion: "Regenerate runtime_plan.json with npm run build.",
      });
      continue;
    }
    if (!runtimeShot.primitive) {
      addCritical(result, {
        code: "runtime_primitive_missing",
        shot_id: shot.shot_id,
        panel_id: shot.panel_id,
        message: `runtime shot ${shot.shot_id} is missing primitive metadata`,
        suggestion: "Regenerate runtime_plan.json so renderer receives primitive metadata.",
      });
    }
    if (runtimeShot.panel_id !== shot.panel_id) {
      addCritical(result, {
        code: "runtime_panel_drift",
        shot_id: shot.shot_id,
        panel_id: shot.panel_id,
        message: `runtime shot ${shot.shot_id} panel drift: expected panel_id ${shot.panel_id ?? "(missing)"}, got ${runtimeShot.panel_id ?? "(missing)"}`,
        suggestion: "Regenerate runtime_plan.json from the current motion_plan.json.",
      });
    }
    if (runtimeShot.primitive !== shot.primitive) {
      addCritical(result, {
        code: "runtime_primitive_drift",
        shot_id: shot.shot_id,
        panel_id: shot.panel_id,
        message: `runtime shot ${shot.shot_id} primitive drift: expected ${shot.primitive ?? "(missing)"}, got ${runtimeShot.primitive ?? "(missing)"}`,
        suggestion: "Regenerate runtime_plan.json from the current motion_plan.json.",
      });
    }
    if (runtimeShot.source_image !== shot.source_image) {
      addCritical(result, {
        code: "runtime_source_image_drift",
        shot_id: shot.shot_id,
        panel_id: shot.panel_id,
        message: `runtime shot ${shot.shot_id} source_image drift: expected ${shot.source_image ?? "(missing)"}, got ${runtimeShot.source_image ?? "(missing)"}`,
        suggestion: "Regenerate runtime_plan.json from the current motion_plan.json.",
      });
    }
    validateSafeFrame({
      value: runtimeShot.safe_frame,
      result,
      shot_id: shot.shot_id,
      panel_id: shot.panel_id,
      context: `Runtime shot ${shot.shot_id}`,
      suggestion: "Regenerate runtime_plan.json so each shot carries safe_frame.",
    });
    const expectedSafeFrame = shot.safe_frame ?? planPanelById.get(shot.panel_id)?.safe_frame ?? panelById.get(shot.panel_id)?.safe_frame;
    if (expectedSafeFrame && stableJson(runtimeShot.safe_frame) !== stableJson(expectedSafeFrame)) {
      addCritical(result, {
        code: "runtime_safe_frame_drift",
        shot_id: shot.shot_id,
        panel_id: shot.panel_id,
        message: `runtime shot ${shot.shot_id} safe_frame drift: expected ${stableJson(expectedSafeFrame)}, got ${stableJson(runtimeShot.safe_frame)}`,
        suggestion: "Regenerate runtime_plan.json from the current motion_plan.json.",
      });
    }
  }
}

function validateBbox({ panel, page, result }) {
  const bbox = panel.bbox_px;
  const fields = ["x", "y", "width", "height"];
  if (!bbox || fields.some((field) => !Number.isFinite(Number(bbox[field])))) {
    addCritical(result, {
      code: "bbox_invalid",
      panel_id: panel.panel_id,
      message: `Panel ${panel.panel_id} bbox_px is missing or non-numeric`,
      suggestion: "Fix project_output/panels/panel_pack.manual.json panels[].bbox_px.",
    });
    return;
  }

  const x = Number(bbox.x);
  const y = Number(bbox.y);
  const width = Number(bbox.width);
  const height = Number(bbox.height);
  if (x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > Number(page.width) || y + height > Number(page.height)) {
    addCritical(result, {
      code: "bbox_out_of_bounds",
      panel_id: panel.panel_id,
      message: `Panel ${panel.panel_id} bbox_px is outside page bounds`,
      suggestion: "Fix panel_pack.manual.json panels[].bbox_px so it fits inside the source page.",
    });
  }
}

function validateSafeFrame({ value, result, panel_id, shot_id, context, suggestion }) {
  if (!value) {
    addCritical(result, {
      code: "safe_frame_missing",
      panel_id,
      shot_id,
      message: `${context} safe_frame is missing`,
      suggestion,
    });
    return;
  }
  const fields = ["x_pct", "y_pct", "width_pct", "height_pct"];
  if (fields.some((field) => !Number.isFinite(Number(value[field])))) {
    addCritical(result, {
      code: "safe_frame_invalid",
      panel_id,
      shot_id,
      message: `${context} safe_frame contains non-numeric fields`,
      suggestion,
    });
    return;
  }

  const x = Number(value.x_pct);
  const y = Number(value.y_pct);
  const width = Number(value.width_pct);
  const height = Number(value.height_pct);
  if (x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 1 || y + height > 1) {
    addCritical(result, {
      code: "safe_frame_out_of_bounds",
      panel_id,
      shot_id,
      message: `${context} safe_frame is outside normalized bounds`,
      suggestion,
    });
    return;
  }

  if (width < 0.2 || height < 0.2) {
    addWarning(result, {
      code: "safe_frame_too_small",
      panel_id,
      shot_id,
      message: `${context} safe_frame is very small`,
      suggestion: "Review and widen panels[].safe_frame if dialogue or character faces may be cropped.",
    });
  }
  if (x < 0.02 || y < 0.02 || x + width > 0.98 || y + height > 0.98) {
    addWarning(result, {
      code: "safe_frame_near_edge",
      panel_id,
      shot_id,
      message: `${context} safe_frame is close to panel edge`,
      suggestion: "Review panel_pack.manual.json panels[].safe_frame for edge-adjacent dialogue or faces.",
    });
  }
}

function validatePanelReviewFlags({ panel, result }) {
  const flags = new Set(panel.review_flags ?? []);
  for (const flag of ["full_page_fallback", "manual_panel_crop_required", "non_png_crop_unsupported"]) {
    if (flags.has(flag)) {
      addWarning(result, {
        code: flag,
        panel_id: panel.panel_id,
        message: `Panel ${panel.panel_id} carries review flag: ${flag}`,
        suggestion: "Use project_output/panels/panel_pack.manual.json to provide bbox_px, reading_order, or safe_frame corrections.",
      });
      addManualReview(result, {
        code: flag,
        panel_id: panel.panel_id,
        message: `Manual panel review required for ${panel.panel_id}: ${flag}`,
        suggestion: "Open the source page/contact sheet and verify the panel crop manually.",
      });
    }
  }
  if (Number.isFinite(Number(panel.confidence)) && Number(panel.confidence) < lowConfidenceThreshold) {
    addWarning(result, {
      code: "low_panel_confidence",
      panel_id: panel.panel_id,
      message: `Panel ${panel.panel_id} has low detection confidence: ${panel.confidence}`,
      suggestion: "Inspect panel crop and adjust panel_pack.manual.json panels[].bbox_px if needed.",
    });
    addManualReview(result, {
      code: "low_panel_confidence",
      panel_id: panel.panel_id,
      message: `Manual confidence review required for ${panel.panel_id}`,
      suggestion: "Confirm crop boundaries and reading order before render approval.",
    });
  }
}

function validateNumberRange({ value, min, max, result, code, shot_id, panel_id, field, suggestion }) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < min || numeric > max) {
    addCritical(result, {
      code,
      shot_id,
      panel_id,
      message: `Shot ${shot_id} ${field} is outside safe bounds ${min}..${max}`,
      suggestion,
    });
  }
}

function validatePan({ value, result, shot_id, panel_id, field }) {
  for (const axis of ["x", "y"]) {
    const numeric = Number(value?.[axis]);
    if (!Number.isFinite(numeric) || numeric < panBounds.min || numeric > panBounds.max) {
      addCritical(result, {
        code: "pan_out_of_bounds",
        shot_id,
        panel_id,
        message: `Shot ${shot_id} ${field}.${axis} is outside safe bounds ${panBounds.min}..${panBounds.max}`,
        suggestion: `Clamp pan values to ${panBounds.min}..${panBounds.max}.`,
      });
    }
  }
}

function addCritical(result, item) {
  addUnique(result.criticalIssues, item);
  addSuggestion(result, item);
}

function addWarning(result, item) {
  addUnique(result.warnings, item);
  addSuggestion(result, item);
}

function addManualReview(result, item) {
  addUnique(result.manualReviewItems, item);
  addSuggestion(result, item);
}

function addSuggestion(result, item) {
  if (item.suggestion) {
    addUnique(result.correctionSuggestions, {
      code: item.code,
      panel_id: item.panel_id,
      shot_id: item.shot_id,
      message: item.suggestion,
    });
  }
}

function addUnique(items, item) {
  if (!items.some((entry) => issueKey(entry) === issueKey(item))) {
    items.push(item);
  }
}

function issueKey(item) {
  return [item.code, item.panel_id, item.shot_id, item.message].filter(Boolean).join("|");
}

function stableJson(value) {
  if (value === undefined) {
    return "undefined";
  }
  return JSON.stringify(sortObjectKeys(value));
}

function sortObjectKeys(value) {
  if (Array.isArray(value)) {
    return value.map(sortObjectKeys);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sortObjectKeys(child)]),
    );
  }
  return value;
}

function pathExistsSync(filePath) {
  return existsSync(filePath);
}

export function renderSpec(plan) {
  return {
    width: Number(plan.render?.width ?? 1920),
    height: Number(plan.render?.height ?? 1080),
    fps: Number(plan.render?.fps ?? 24),
  };
}

export function shotDurationSeconds(shot, fps) {
  if (Number.isFinite(Number(shot.duration_sec))) {
    return Number(shot.duration_sec);
  }
  if (Number.isFinite(Number(shot.duration_frames))) {
    return Number(shot.duration_frames) / fps;
  }
  return 0;
}

export function videoOutputPaths(plan = {}) {
  const configuredRoot = normalizeProjectRelativePath(plan.video_output?.root ?? plan.videoOutput?.root);
  if (configuredRoot) {
    return {
      root: configuredRoot,
      previewsDir: normalizeProjectRelativePath(plan.video_output?.previews_dir ?? plan.videoOutput?.previewsDir)
        ?? path.posix.join(configuredRoot, "previews"),
      final: normalizeProjectRelativePath(plan.video_output?.final ?? plan.videoOutput?.final)
        ?? path.posix.join(configuredRoot, "motion_comic_preview.mp4"),
    };
  }

  const inferredRoot = inferControlPageVideoRoot(plan);
  if (inferredRoot) {
    return {
      root: inferredRoot,
      previewsDir: path.posix.join(inferredRoot, "previews"),
      final: path.posix.join(inferredRoot, "motion_comic_preview.mp4"),
    };
  }

  return {
    root: path.posix.join(projectOutputDir, "output"),
    previewsDir: path.posix.join(projectOutputDir, "output", "previews"),
    final: path.posix.join(projectOutputDir, "output", "final", "motion_comic_preview.mp4"),
  };
}

export function previewVideoPath(shot, plan = {}) {
  return path.posix.join(videoOutputPaths(plan).previewsDir, `${shot.shot_id}.mp4`);
}

export function finalVideoPath(plan = {}) {
  return videoOutputPaths(plan).final;
}

export function videoTargets(plan) {
  const spec = renderSpec(plan);
  const previews = plan.shots.map((shot) => ({
    kind: "preview",
    id: shot.shot_id,
    relativePath: previewVideoPath(shot, plan),
    expectedDuration: shotDurationSeconds(shot, spec.fps),
  }));
  const finalDuration = plan.shots.reduce(
    (total, shot) => total + shotDurationSeconds(shot, spec.fps),
    0,
  );

  return [
    ...previews,
    {
      kind: "final",
      id: "motion_comic_preview",
      relativePath: finalVideoPath(plan),
      expectedDuration: finalDuration,
    },
  ];
}

function inferControlPageVideoRoot(plan = {}) {
  const candidates = [
    plan.audio?.narration?.timeline,
    plan.audio?.narration?.source,
    ...(Array.isArray(plan.audio?.tracks) ? plan.audio.tracks.map((track) => track?.source) : []),
  ];
  for (const candidate of candidates) {
    const normalized = normalizeProjectRelativePath(candidate);
    const match = normalized?.match(/^(project_output\/control-page-runs\/[^/]+\/05_video)(?:\/|$)/);
    if (match) {
      return match[1];
    }
  }
  return null;
}

function normalizeProjectRelativePath(value) {
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }
  return value.trim().replace(/\\/g, "/").replace(/^\.\//, "");
}

export function runCommand(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      resolve({ status: null, stdout, stderr, error });
    });
    child.on("close", (status) => {
      resolve({ status, stdout, stderr, error: null });
    });
  });
}

export async function requireCommand(command, label = command) {
  const result = await runCommand(command, ["-version"]);
  if (result.error?.code === "ENOENT") {
    throw new Error(`${label} is required but was not found on PATH`);
  }
  if (result.status !== 0) {
    throw new Error(`${label} is not usable: ${result.stderr || result.stdout}`.trim());
  }
}

export async function optionalCommand(command) {
  const result = await runCommand(command, ["-version"]);
  return !result.error && result.status === 0;
}

export async function probeVideo(filePath) {
  const result = await runCommand("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height,duration:format=duration",
    "-of",
    "json",
    filePath,
  ]);

  if (result.error?.code === "ENOENT") {
    throw new Error("ffprobe is required but was not found on PATH");
  }
  if (result.status !== 0) {
    throw new Error(`ffprobe failed for ${filePath}: ${result.stderr || result.stdout}`.trim());
  }

  try {
    const data = JSON.parse(result.stdout);
    const stream = data.streams?.[0];
    return {
      width: Number(stream?.width),
      height: Number(stream?.height),
      duration: Number(stream?.duration ?? data.format?.duration),
    };
  } catch (error) {
    throw new Error(`Could not parse ffprobe output for ${filePath}: ${error.message}`);
  }
}

export function videoCheckIssues({ target, actual, expectedWidth, expectedHeight }) {
  const issues = [];
  if (actual.width !== expectedWidth || actual.height !== expectedHeight) {
    issues.push(
      `Resolution mismatch for ${target.relativePath}: expected ${expectedWidth}x${expectedHeight}, got ${actual.width}x${actual.height}`,
    );
  }

  if (Number.isFinite(target.expectedDuration) && target.expectedDuration > 0) {
    const tolerance = Math.max(0.35, target.expectedDuration * 0.1);
    const delta = Math.abs(actual.duration - target.expectedDuration);
    if (!Number.isFinite(actual.duration) || delta > tolerance) {
      issues.push(
        `Duration mismatch for ${target.relativePath}: expected about ${target.expectedDuration.toFixed(
          2,
        )}s, got ${Number.isFinite(actual.duration) ? actual.duration.toFixed(2) : "unknown"}s`,
      );
    }
  }

  return issues;
}

export async function buildContactSheet({ cwd, target, outputDir }) {
  await ensureDir(outputDir);
  const outputPath = path.join(outputDir, `${target.id}.jpg`);
  const inputPath = resolveProjectPath(cwd, target.relativePath);
  const result = await runCommand("ffmpeg", [
    "-y",
    "-i",
    inputPath,
    "-vf",
    "fps=1,scale=320:-1,tile=4x1",
    "-frames:v",
    "1",
    outputPath,
  ]);

  if (result.error?.code === "ENOENT") {
    return { ok: false, outputPath, error: "ffmpeg is required but was not found on PATH" };
  }
  if (result.status !== 0) {
    return {
      ok: false,
      outputPath,
      error: `ffmpeg failed for ${target.relativePath}: ${result.stderr || result.stdout}`.trim(),
    };
  }

  return { ok: true, target, outputPath, error: null };
}

#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const { runFolderArg, projectRootArg } = parseArgs(process.argv.slice(2));

if (!runFolderArg) {
  console.error("用法：node validate-control-page-prompts.mjs <run-folder> [--project-root <repo-root>]");
  process.exit(2);
}

const projectRoot = path.resolve(projectRootArg);
const runFolder = path.resolve(projectRoot, runFolderArg);
const promptsPath = path.join(runFolder, "02_prompts", "control_page_prompts.json");
const auditPath = path.join(runFolder, "02_prompts", "control_page_prompt_audit.json");

const prompts = await readJson(promptsPath);
const pages = Array.isArray(prompts.pages) ? prompts.pages : [];
const blockers = [];
const warnings = [];

if (pages.length === 0) {
  blockers.push("control_page_prompts.json must contain non-empty pages");
}

const characterReferences = new Set();
for (const page of pages) {
  validatePage(page, blockers, warnings);
  if (page.character_board_reference) {
    characterReferences.add(page.character_board_reference);
  }
}

if (characterReferences.size > 1) {
  blockers.push("all pages must use the same character_board_reference");
}

const audit = {
  version: 1,
  checked_at: new Date().toISOString(),
  run_folder: normalizePath(path.relative(projectRoot, runFolder)),
  page_count: pages.length,
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

console.log(`control page prompt audit passed: ${pages.length} page(s)`);

function validatePage(page, blockersValue, warningsValue) {
  const label = page.page_id || "unknown page";
  const prompt = String(page.prompt ?? "");
  if (!page.page_id) {
    blockersValue.push("page entry missing page_id");
  }
  if (!prompt.trim()) {
    blockersValue.push(`${label} prompt is required`);
  }
  if (countNonWhitespaceChars(prompt) < 300) {
    blockersValue.push(`${label} prompt is too short to be a full control-page prompt`);
  }
  validatePromptText(label, prompt, blockersValue);
  validateReferencePlan(label, page, blockersValue);
  validateComicRegion(label, page.comic_region_bbox_pct, blockersValue);
  validatePanels(label, page.panels, blockersValue, warningsValue);
}

function validatePromptText(label, prompt, blockersValue) {
  const checks = [
    { pattern: /```/, reason: "Markdown code fence" },
    { pattern: /\b(JSON|manifest|handoff)\b/i, reason: "manifest or JSON explanation" },
    { pattern: /审核说明|文件路径清单|时间戳|音频段|调度说明|voice_timeline|narration_timestamps/i, reason: "workflow metadata" },
    { pattern: /我将会|请先审核|等待审核|生成后保存到|保存到\s*0?[0-9]_/i, reason: "workflow narration" },
    { pattern: /control_page_prompts\.json|timeline_beats\.json|audio_segments\.json|page_manifest\.json/i, reason: "workflow file reference" },
  ];
  for (const check of checks) {
    if (check.pattern.test(prompt)) {
      blockersValue.push(`${label} prompt contains ${check.reason}`);
    }
  }

  const requiredPatterns = [
    { pattern: /1:2|竖版/, label: "1:2 vertical control-page requirement" },
    { pattern: /上方角色控制区/, label: "top character control area" },
    { pattern: /下方(?:剧情)?漫画区/, label: "lower comic area" },
    { pattern: /严禁左右分栏|不要(?:出现)?左侧角色区|不要左右分栏/, label: "no left-right layout constraint" },
    { pattern: /character_board_master\.png|角色母版/, label: "character board reference" },
    { pattern: /高对比|强对比/, label: "high-contrast panel separators" },
    { pattern: /分隔线|分镜边框|漫画格线|格线|gutter/i, label: "explicit separator or gutter lines" },
    { pattern: /格线宽度|边框宽度|线宽/, label: "explicit border width" },
    { pattern: /干净留白|留白|gutter|空白间距|格子间距/i, label: "clean gutter whitespace" },
  ];
  for (const required of requiredPatterns) {
    if (!required.pattern.test(prompt)) {
      blockersValue.push(`${label} prompt missing ${required.label}`);
    }
  }
}

function validateReferencePlan(label, page, blockersValue) {
  if (!page.character_board_reference) {
    blockersValue.push(`${label} character_board_reference is required`);
  }
  const method = page.reference_enforcement_plan?.method;
  if (!["deterministic_top_board_composite", "image_to_image_reference"].includes(method)) {
    blockersValue.push(`${label} reference_enforcement_plan.method must be deterministic_top_board_composite or image_to_image_reference`);
  }
}

function validateComicRegion(label, bbox, blockersValue) {
  if (!isValidBbox(bbox)) {
    blockersValue.push(`${label} comic_region_bbox_pct must be a valid 0-1 bbox`);
    return;
  }
  if (bbox.y < 0.28 || bbox.y > 0.38 || bbox.height < 0.58 || bbox.height > 0.72) {
    blockersValue.push(`${label} comic_region_bbox_pct must reserve about top 30-35% for the character board`);
  }
}

function validatePanels(label, panels, blockersValue, warningsValue) {
  if (!Array.isArray(panels)) {
    blockersValue.push(`${label} panels must be an array`);
    return;
  }
  if (panels.length < 5 || panels.length > 7) {
    blockersValue.push(`${label} must contain 5-7 lower comic panels; found ${panels.length}`);
  }
  const seenPanelIds = new Set();
  const seenBeatIds = new Set();
  for (const [index, panel] of panels.entries()) {
    const panelLabel = `${label}.panels[${index}]`;
    if (!panel.panel_id) {
      blockersValue.push(`${panelLabel} missing panel_id`);
    } else if (seenPanelIds.has(panel.panel_id)) {
      blockersValue.push(`${panelLabel} duplicate panel_id ${panel.panel_id}`);
    }
    seenPanelIds.add(panel.panel_id);

    if (!panel.visual_beat_id) {
      blockersValue.push(`${panelLabel} missing visual_beat_id`);
    } else if (seenBeatIds.has(panel.visual_beat_id)) {
      blockersValue.push(`${panelLabel} duplicate visual_beat_id ${panel.visual_beat_id}`);
    }
    seenBeatIds.add(panel.visual_beat_id);

    if (!isValidBbox(panel.bbox_pct)) {
      blockersValue.push(`${panelLabel}.bbox_pct must be a valid 0-1 bbox`);
    }
    if (!String(panel.panel_prompt ?? "").trim()) {
      warningsValue.push(`${panelLabel} panel_prompt missing or empty`);
    }
  }
  validatePanelOverlaps(label, panels, blockersValue);
}

function validatePanelOverlaps(label, panels, blockersValue) {
  for (let left = 0; left < panels.length; left += 1) {
    for (let right = left + 1; right < panels.length; right += 1) {
      const a = panels[left].bbox_pct;
      const b = panels[right].bbox_pct;
      if (!isValidBbox(a) || !isValidBbox(b)) {
        continue;
      }
      const overlapArea = intersectionArea(a, b);
      const smallerArea = Math.min(a.width * a.height, b.width * b.height);
      if (overlapArea > smallerArea * 0.05) {
        blockersValue.push(`${label} panel bbox overlap is too large: panels[${left}] and panels[${right}]`);
      }
    }
  }
}

function intersectionArea(a, b) {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  return Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
}

function isValidBbox(bbox) {
  if (!bbox || typeof bbox !== "object") {
    return false;
  }
  const values = [bbox.x, bbox.y, bbox.width, bbox.height].map(Number);
  if (values.some((value) => !Number.isFinite(value))) {
    return false;
  }
  const [x, y, width, height] = values;
  return x >= 0 && y >= 0 && width > 0 && height > 0 && x + width <= 1.001 && y + height <= 1.001;
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

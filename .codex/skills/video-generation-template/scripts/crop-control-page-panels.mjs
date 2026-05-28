#!/usr/bin/env node

import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const supportedImageExts = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const scriptProjectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const { runFolderArg, projectRootArg, noStageRuntime, noAutoTune, maxTuneCandidates, splitterOptions } = parseArgs(process.argv.slice(2));

if (!runFolderArg) {
  console.error(
    "用法：node crop-control-page-panels.mjs <run-folder> [--project-root <repo-root>] [--no-stage-runtime] [splitter options]",
  );
  process.exit(2);
}

const projectRoot = path.resolve(projectRootArg);
const runFolder = path.resolve(projectRoot, runFolderArg);
const pageManifestPath = path.join(runFolder, "02_prompts", "page_manifest.json");
const imageManifestPath = path.join(runFolder, "03_images", "image_manifest.json");
const panelRoot = path.join(runFolder, "04_panel_crops");
const comicRegionsDir = path.join(panelRoot, "comic_regions");
const panelsDir = path.join(panelRoot, "panels");
const filterReviewDir = path.join(panelRoot, "filter_review");
const cropReviewStatusPath = path.join(panelRoot, "crop_review_status.json");
const inputPagesDir = path.join(projectRoot, "input", "pages");
const splitterScript = await findSplitterScript();

const pageManifest = await readJson(pageManifestPath);
const imageManifest = await readJson(imageManifestPath);
const pages = normalizePages(pageManifest);
const images = Array.isArray(imageManifest.images) ? imageManifest.images : [];
const imagesByPage = new Map(images.map((image) => [image.page_id, image]));

await mkdir(comicRegionsDir, { recursive: true });
await mkdir(panelsDir, { recursive: true });
await mkdir(filterReviewDir, { recursive: true });

const pageContexts = [];
const bodyLocatorReports = [];
for (const page of pages) {
  const image = imagesByPage.get(page.page_id);
  if (!image?.file) {
    throw new Error(`缺少生成图片：page_id=${page.page_id}`);
  }
  if (!page.comic_region_bbox_pct) {
    throw new Error(`缺少 comic_region_bbox_pct：page_id=${page.page_id}`);
  }
  if (!Array.isArray(page.panels) || page.panels.length === 0) {
    throw new Error(`缺少 panels：page_id=${page.page_id}`);
  }

  const sourceImage = resolveRunRelative(image.file);
  const dimensions = await imageDimensions(sourceImage, image);
  const manifestComicRegion = bboxPctToPx(page.comic_region_bbox_pct, dimensions.width, dimensions.height);
  const locatorResult = await locateComicRegion({
    page,
    image,
    sourceImage,
    dimensions,
    manifestComicRegion,
    splitterOptions,
  });
  bodyLocatorReports.push(locatorResult.report);
  const comicRegion = locatorResult.comicRegion;
  const comicRegionFile = `04_panel_crops/comic_regions/${page.page_id}_comic_region.png`;
  await ffmpegCrop({
    input: sourceImage,
    output: path.join(runFolder, comicRegionFile),
    bbox: comicRegion,
  });
  pageContexts.push({
    page,
    image,
    sourceImage,
    dimensions,
    comicRegion,
    comicRegionFile,
    bodyLocator: locatorResult.report,
  });
}
await writeBodyLocatorReport(bodyLocatorReports);

const tuneResult = await selectGlobalSplitterOptions({
  pageContexts,
  initialOptions: splitterOptions,
  noAutoTune,
  maxTuneCandidates,
});
await writeAutoTuneReport(tuneResult);
if (!tuneResult.selected) {
  await writeBestFailureDebugOverlays(tuneResult);
  throw new Error(
    `auto-tune failed：没有找到一组全局 splitter 参数能让全部页面数量匹配。见 ${path.relative(
      projectRoot,
      path.join(filterReviewDir, "auto_tune_report.json"),
    )}`,
  );
}

let runtimeIndex = 1;
const crops = [];
const splitterRuns = [];
const runtimeInputPages = [];
const stagedRuntimeWrites = [];

for (const context of pageContexts) {
  const { page, image, dimensions, comicRegion, comicRegionFile } = context;
  const splitterRun = await splitComicRegion({
    context,
    splitterOptions: tuneResult.selected.options,
  });
  splitterRuns.push(splitterRun.summary);

  for (let panelIndex = 0; panelIndex < splitterRun.panels.length; panelIndex += 1) {
    const detectedPanel = splitterRun.panels[panelIndex];
    const sourcePanel = page.panels[panelIndex] ?? {};
    const panelId = sourcePanel.panel_id ?? `${page.page_id}_panel_${String(panelIndex + 1).padStart(3, "0")}`;
    const panelBox = splitterBoxToFullImagePx({
      comicRegion,
      box: detectedPanel.box,
      imageWidth: dimensions.width,
      imageHeight: dimensions.height,
    });
    const panelFile = `04_panel_crops/panels/${panelId}.png`;
    const panelAbs = path.join(runFolder, panelFile);
    await copyFile(detectedPanel.file_abs, panelAbs);
    await assertNonEmptyFile(panelAbs);

    const runtimeInput = `input/pages/page_${String(runtimeIndex).padStart(3, "0")}.png`;
    if (!noStageRuntime) {
      runtimeInputPages.push(runtimeInput);
      stagedRuntimeWrites.push({
        input: panelAbs,
        output: path.join(projectRoot, runtimeInput),
      });
    }

    const panelCropSha256 = await hashFile(panelAbs);
    crops.push({
      panel_id: panelId,
      page_id: page.page_id,
      source_image: normalizePath(image.file),
      comic_region_file: comicRegionFile,
      file: panelFile,
      runtime_input: noStageRuntime ? null : runtimeInput,
      panel_crop_sha256: panelCropSha256,
      runtime_input_source: panelFile,
      runtime_input_sha256: noStageRuntime ? null : panelCropSha256,
      bbox_full_image_pct: bboxPxToPct(panelBox, dimensions.width, dimensions.height),
      bbox_full_image_px: panelBox,
      splitter_panel_id: detectedPanel.id,
      splitter_box_px: detectedPanel.box,
      narration_segment_ids: Array.isArray(sourcePanel.narration_segment_ids) ? sourcePanel.narration_segment_ids : [],
    });
    runtimeIndex += 1;
  }
}

const backupPath = noStageRuntime ? null : await backupAndClearInputPages();
for (const write of stagedRuntimeWrites) {
  await stageRuntimePng(write.input, write.output);
}

const manifest = {
  version: 1,
  source_manifest: "02_prompts/page_manifest.json",
  source_images: "03_images/image_manifest.json",
  generated_at: new Date().toISOString(),
  comic_region_count: pages.length,
  crop_count: crops.length,
  crop_method: "tools_comic_panel_splitter_v1",
  splitter_runs: splitterRuns,
  crops,
  runtime_input_pages: runtimeInputPages,
  runtime_input_policy: {
    input_pages_replaced: !noStageRuntime,
    backup_path: backupPath ? normalizePath(path.relative(projectRoot, backupPath)) : null,
    allowed_fallback_reason:
      "每个 runtime input 都是预裁下方漫画格的 PNG；项目 detector 必须将这些 staged panel images 识别为 pre_cropped_control_page_panel_v1。",
  },
};

const cropManifestPath = path.join(panelRoot, "panel_crop_manifest.json");
await writeFile(cropManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
await writeFile(
  cropReviewStatusPath,
  `${JSON.stringify(
    {
      version: 1,
      status: "pending",
      review_required: true,
      crop_method: manifest.crop_method,
      crop_count: crops.length,
      comic_region_count: pages.length,
      manifest: "04_panel_crops/panel_crop_manifest.json",
      manifest_sha256: await hashFile(cropManifestPath),
      review_targets: {
        panels_dir: "04_panel_crops/panels",
        filter_review_dir: "04_panel_crops/filter_review",
      },
      approved_by: null,
      approved_at: null,
      instructions:
        "人工审核全部 panel crop、splitter overlay 和读序后，才能将 status 改为 approved 并进入语音或视频阶段。",
    },
    null,
    2,
  )}\n`,
  "utf8",
);
console.log(`已裁出 ${pages.length} 个下方漫画正文区、${crops.length} 个漫画格。`);
console.log("裁切审核状态已写入 04_panel_crops/crop_review_status.json：status=pending。");
if (!noStageRuntime) {
  console.log(`已写入 ${runtimeInputPages.length} 张 runtime input 到 input/pages。`);
}

function parseArgs(values) {
  let runFolder = null;
  let projectRootValue = process.cwd();
  let skipRuntime = false;
  let disableAutoTune = false;
  let tuneCandidateLimit = null;
  const parsedSplitterOptions = {
    background: "auto",
    backgroundTolerance: 8,
    separatorRatio: 0.9,
    minGutter: 4,
    minPanelWidth: 32,
    minPanelHeight: 32,
    minPanelArea: 5000,
    padding: 0,
    keepProfileCard: false,
    keepTextStrips: false,
  };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--project-root") {
      projectRootValue = values[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (value === "--no-stage-runtime") {
      skipRuntime = true;
      continue;
    }
    if (value === "--no-auto-tune") {
      disableAutoTune = true;
      continue;
    }
    if (value === "--max-tune-candidates") {
      tuneCandidateLimit = Number(values[index + 1]);
      index += 1;
      continue;
    }
    if (value.startsWith("--max-tune-candidates=")) {
      tuneCandidateLimit = Number(value.slice("--max-tune-candidates=".length));
      continue;
    }
    if (value === "--background") {
      parsedSplitterOptions.background = values[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (value.startsWith("--background=")) {
      parsedSplitterOptions.background = value.slice("--background=".length);
      continue;
    }
    if (value === "--background-tolerance") {
      parsedSplitterOptions.backgroundTolerance = Number(values[index + 1]);
      index += 1;
      continue;
    }
    if (value.startsWith("--background-tolerance=")) {
      parsedSplitterOptions.backgroundTolerance = Number(value.slice("--background-tolerance=".length));
      continue;
    }
    if (value === "--separator-ratio") {
      parsedSplitterOptions.separatorRatio = Number(values[index + 1]);
      index += 1;
      continue;
    }
    if (value.startsWith("--separator-ratio=")) {
      parsedSplitterOptions.separatorRatio = Number(value.slice("--separator-ratio=".length));
      continue;
    }
    if (value === "--min-gutter") {
      parsedSplitterOptions.minGutter = Number(values[index + 1]);
      index += 1;
      continue;
    }
    if (value.startsWith("--min-gutter=")) {
      parsedSplitterOptions.minGutter = Number(value.slice("--min-gutter=".length));
      continue;
    }
    if (value === "--min-panel-width") {
      parsedSplitterOptions.minPanelWidth = Number(values[index + 1]);
      index += 1;
      continue;
    }
    if (value.startsWith("--min-panel-width=")) {
      parsedSplitterOptions.minPanelWidth = Number(value.slice("--min-panel-width=".length));
      continue;
    }
    if (value === "--min-panel-height") {
      parsedSplitterOptions.minPanelHeight = Number(values[index + 1]);
      index += 1;
      continue;
    }
    if (value.startsWith("--min-panel-height=")) {
      parsedSplitterOptions.minPanelHeight = Number(value.slice("--min-panel-height=".length));
      continue;
    }
    if (value === "--min-panel-area") {
      parsedSplitterOptions.minPanelArea = Number(values[index + 1]);
      index += 1;
      continue;
    }
    if (value.startsWith("--min-panel-area=")) {
      parsedSplitterOptions.minPanelArea = Number(value.slice("--min-panel-area=".length));
      continue;
    }
    if (value === "--padding") {
      parsedSplitterOptions.padding = Number(values[index + 1]);
      index += 1;
      continue;
    }
    if (value.startsWith("--padding=")) {
      parsedSplitterOptions.padding = Number(value.slice("--padding=".length));
      continue;
    }
    if (value === "--keep-profile-card") {
      parsedSplitterOptions.keepProfileCard = true;
      continue;
    }
    if (value === "--keep-text-strips") {
      parsedSplitterOptions.keepTextStrips = true;
      continue;
    }
    if (!value.startsWith("--") && !runFolder) {
      runFolder = value;
    }
  }
  return {
    runFolderArg: runFolder,
    projectRootArg: projectRootValue || process.cwd(),
    noStageRuntime: skipRuntime,
    noAutoTune: disableAutoTune,
    maxTuneCandidates: validateMaxTuneCandidates(tuneCandidateLimit),
    splitterOptions: validateSplitterOptions(parsedSplitterOptions),
  };
}

function validateMaxTuneCandidates(value) {
  if (value === null) {
    return null;
  }
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`--max-tune-candidates must be a positive integer: ${value}`);
  }
  return value;
}

function validateSplitterOptions(options) {
  if (!["auto", "light", "dark"].includes(options.background)) {
    throw new Error(`--background must be auto, light, or dark: ${options.background}`);
  }
  const numericChecks = [
    ["backgroundTolerance", options.backgroundTolerance],
    ["separatorRatio", options.separatorRatio],
    ["minGutter", options.minGutter],
    ["minPanelWidth", options.minPanelWidth],
    ["minPanelHeight", options.minPanelHeight],
    ["minPanelArea", options.minPanelArea],
    ["padding", options.padding],
  ];
  for (const [name, value] of numericChecks) {
    if (!Number.isFinite(value)) {
      throw new Error(`Invalid splitter option ${name}: ${value}`);
    }
  }
  return options;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function normalizePages(manifest) {
  if (Array.isArray(manifest)) {
    return manifest;
  }
  if (Array.isArray(manifest.pages)) {
    return manifest.pages;
  }
  throw new Error("page_manifest.json must be an array or contain a pages array");
}

async function findSplitterScript() {
  const candidates = [
    path.join(projectRoot, "tools", "comic_panel_splitter.py"),
    path.join(scriptProjectRoot, "tools", "comic_panel_splitter.py"),
  ];
  for (const candidate of candidates) {
    if (await isNonEmptyFile(candidate)) {
      return candidate;
    }
  }
  throw new Error(`缺少 tools/comic_panel_splitter.py：checked ${candidates.join(", ")}`);
}

async function selectGlobalSplitterOptions({ pageContexts, initialOptions, noAutoTune, maxTuneCandidates }) {
  const candidates = buildSplitterCandidates(initialOptions, { noAutoTune, maxTuneCandidates });
  const results = [];
  for (const candidate of candidates) {
    const result = await evaluateGlobalCandidate(candidate, pageContexts);
    results.push(result);
  }
  const passed = results.filter((result) => result.passed).sort((a, b) => a.total_score - b.total_score);
  if (passed.length > 0) {
    return {
      version: 1,
      mode: noAutoTune ? "single_candidate" : "global_auto_tune",
      selected: passed[0],
      candidates: results,
      evaluated_count: results.length,
      candidate_count: candidates.length,
    };
  }
  return {
    version: 1,
    mode: noAutoTune ? "single_candidate" : "global_auto_tune",
    selected: null,
    best: rankCandidateResults(results)[0] ?? null,
    candidates: results,
    evaluated_count: results.length,
    candidate_count: candidates.length,
  };
}

function buildSplitterCandidates(initialOptions, { noAutoTune, maxTuneCandidates }) {
  const candidates = [
    {
      candidate_id: "candidate_001",
      source: "cli_or_default",
      options: cloneOptions(initialOptions),
    },
  ];
  if (!noAutoTune) {
    const backgrounds = ["auto", "light", "dark"];
    const separatorRatios = [0.9, 0.89];
    const backgroundTolerances = [32, 62, 73];
    const minGutters = [4];
    const minPanelAreas = [5000];
    const paddingValues = [0];
    for (const background of backgrounds) {
      for (const separatorRatio of separatorRatios) {
        for (const backgroundTolerance of backgroundTolerances) {
          for (const minGutter of minGutters) {
            for (const minPanelArea of minPanelAreas) {
              for (const padding of paddingValues) {
                candidates.push({
                  candidate_id: "",
                  source: "auto_tune_grid",
                  options: {
                    ...cloneOptions(initialOptions),
                    background,
                    separatorRatio,
                    backgroundTolerance,
                    minGutter,
                    minPanelArea,
                    padding,
                  },
                });
              }
            }
          }
        }
      }
    }
  }

  const unique = [];
  const seen = new Set();
  for (const candidate of candidates) {
    const key = stableOptionKey(candidate.options);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push({
      ...candidate,
      candidate_id: `candidate_${String(unique.length + 1).padStart(3, "0")}`,
    });
    if (maxTuneCandidates !== null && unique.length >= maxTuneCandidates) {
      break;
    }
  }
  return unique;
}

function cloneOptions(options) {
  return {
    background: options.background,
    backgroundTolerance: options.backgroundTolerance,
    separatorRatio: options.separatorRatio,
    minGutter: options.minGutter,
    minPanelWidth: options.minPanelWidth,
    minPanelHeight: options.minPanelHeight,
    minPanelArea: options.minPanelArea,
    padding: options.padding,
    keepProfileCard: options.keepProfileCard,
    keepTextStrips: options.keepTextStrips,
  };
}

function stableOptionKey(options) {
  return JSON.stringify(cloneOptions(options));
}

async function evaluateGlobalCandidate(candidate, pageContexts) {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "comic-splitter-tune-"));
  const pageResults = [];
  try {
    for (const context of pageContexts) {
      const outputDir = path.join(tempRoot, candidate.candidate_id, context.page.page_id);
      try {
        const splitterRun = await runSplitter({
          context,
          splitterOptions: candidate.options,
          outputDir,
        });
        pageResults.push(evaluateSplitterPanels({ context, splitterRun }));
      } catch (error) {
        pageResults.push({
          page_id: context.page.page_id,
          passed: false,
          expected_count: context.page.panels.length,
          raw_count: 0,
          kept_count: 0,
          score: Number.POSITIVE_INFINITY,
          error: error.message,
        });
      }
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }

  const passCount = pageResults.filter((result) => result.passed).length;
  const failedPages = pageResults.filter((result) => !result.passed);
  const finiteScores = pageResults.map((result) => result.score).filter(Number.isFinite);
  const totalScore = finiteScores.reduce((sum, value) => sum + value, 0) + failedPages.length * 1000;
  return {
    candidate_id: candidate.candidate_id,
    source: candidate.source,
    options: candidate.options,
    passed: failedPages.length === 0,
    pass_count: passCount,
    total_pages: pageResults.length,
    total_score: roundScore(totalScore),
    failed_pages: failedPages.map((result) => ({
      page_id: result.page_id,
      expected_count: result.expected_count,
      raw_count: result.raw_count,
      kept_count: result.kept_count,
      error: result.error ?? null,
    })),
    page_results: pageResults.map((result) => ({
      page_id: result.page_id,
      passed: result.passed,
      expected_count: result.expected_count,
      raw_count: result.raw_count,
      kept_count: result.kept_count,
      score: Number.isFinite(result.score) ? roundScore(result.score) : null,
      removed_count: Array.isArray(result.removed) ? result.removed.length : 0,
      error: result.error ?? null,
    })),
  };
}

function evaluateSplitterPanels({ context, splitterRun }) {
  const rawPanels = splitterRun.rawPanels;
  const splitterManifest = splitterRun.manifest;
  const { kept, removed } = filterFirstResidualCandidate({
    rawPanels,
    expectedCount: context.page.panels.length,
    imageWidth: splitterManifest.image_width,
    imageHeight: splitterManifest.image_height,
  });
  const score = kept.length === context.page.panels.length ? layoutScore(context.page.panels, kept, splitterManifest) : 1000 + Math.abs(kept.length - context.page.panels.length) * 100;
  return {
    page_id: context.page.page_id,
    passed: kept.length === context.page.panels.length,
    expected_count: context.page.panels.length,
    raw_count: rawPanels.length,
    kept_count: kept.length,
    score,
    removed,
  };
}

function layoutScore(expectedPanels, detectedPanels, splitterManifest) {
  let score = 0;
  for (let index = 0; index < expectedPanels.length; index += 1) {
    const expected = expectedPanels[index]?.bbox_pct;
    const detected = detectedPanels[index];
    if (!expected || !detected) {
      score += 100;
      continue;
    }
    const [left, top, right, bottom] = detected.box;
    const actual = {
      x: left / splitterManifest.image_width,
      y: top / splitterManifest.image_height,
      width: (right - left) / splitterManifest.image_width,
      height: (bottom - top) / splitterManifest.image_height,
    };
    score += Math.abs(Number(expected.x) - actual.x);
    score += Math.abs(Number(expected.y) - actual.y);
    score += Math.abs(Number(expected.width) - actual.width);
    score += Math.abs(Number(expected.height) - actual.height);
  }
  return score;
}

function roundScore(value) {
  return Number(value.toFixed(6));
}

function rankCandidateResults(results) {
  return [...results].sort((a, b) => {
    if (b.pass_count !== a.pass_count) {
      return b.pass_count - a.pass_count;
    }
    return a.total_score - b.total_score;
  });
}

async function writeAutoTuneReport(tuneResult) {
  const reportPath = path.join(filterReviewDir, "auto_tune_report.json");
  const ranked = rankCandidateResults(tuneResult.candidates);
  await writeFile(
    reportPath,
    `${JSON.stringify(
      {
        version: 1,
        generated_at: new Date().toISOString(),
        mode: tuneResult.mode,
        candidate_count: tuneResult.candidate_count,
        evaluated_count: tuneResult.evaluated_count,
        selected_candidate_id: tuneResult.selected?.candidate_id ?? null,
        selected_settings: tuneResult.selected?.options ?? null,
        best_candidate_id: ranked[0]?.candidate_id ?? null,
        best_settings: ranked[0]?.options ?? null,
        candidates: tuneResult.candidates,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

async function writeBestFailureDebugOverlays(tuneResult) {
  const best = tuneResult.best ?? rankCandidateResults(tuneResult.candidates)[0];
  if (!best) {
    return;
  }
  const failedPageIds = new Set(best.failed_pages.map((page) => page.page_id));
  const failedContexts = pageContexts.filter((context) => failedPageIds.has(context.page.page_id)).slice(0, 3);
  for (const context of failedContexts) {
    const splitterOutputDir = path.join(filterReviewDir, `${context.page.page_id}_splitter`);
    await rm(splitterOutputDir, { recursive: true, force: true });
    await mkdir(splitterOutputDir, { recursive: true });
    await runSplitter({
      context,
      splitterOptions: best.options,
      outputDir: splitterOutputDir,
      debugOverlay: path.join(runFolder, `04_panel_crops/filter_review/${context.page.page_id}_splitter_overlay.png`),
      debugCandidatesOverlay: path.join(runFolder, `04_panel_crops/filter_review/${context.page.page_id}_splitter_candidates.png`),
    });
  }
}

async function splitComicRegion({ context, splitterOptions }) {
  const { page, comicRegion, dimensions, comicRegionFile } = context;
  const splitterOutputRel = `04_panel_crops/filter_review/${page.page_id}_splitter`;
  const splitterOutputDir = path.join(runFolder, splitterOutputRel);
  const overlayRel = `04_panel_crops/filter_review/${page.page_id}_splitter_overlay.png`;
  const candidatesOverlayRel = `04_panel_crops/filter_review/${page.page_id}_splitter_candidates.png`;
  await rm(splitterOutputDir, { recursive: true, force: true });
  await mkdir(splitterOutputDir, { recursive: true });
  const splitterRun = await runSplitter({
    context,
    splitterOptions,
    outputDir: splitterOutputDir,
    debugOverlay: path.join(runFolder, overlayRel),
    debugCandidatesOverlay: path.join(runFolder, candidatesOverlayRel),
  });
  const splitterManifestRel = `${splitterOutputRel}/manifest.json`;
  const splitterManifest = splitterRun.manifest;
  const rawPanels = splitterRun.rawPanels;
  if (rawPanels.length === 0) {
    throw new Error(`tools/comic_panel_splitter.py 未检测到漫画格：page_id=${page.page_id}`);
  }
  const { kept, removed } = filterFirstResidualCandidate({
    rawPanels,
    expectedCount: page.panels.length,
    imageWidth: splitterManifest.image_width,
    imageHeight: splitterManifest.image_height,
  });
  if (kept.length === 0) {
    throw new Error(`过滤后没有可用漫画格：page_id=${page.page_id}`);
  }
  if (kept.length !== page.panels.length) {
    throw new Error(
      `splitter kept_count mismatch：page_id=${page.page_id}, kept=${kept.length}, expected=${page.panels.length}, raw=${rawPanels.length}`,
    );
  }
  return {
    panels: kept,
    summary: {
      page_id: page.page_id,
      source_comic_region: comicRegionFile,
      splitter_manifest: splitterManifestRel,
      debug_overlay: overlayRel,
      debug_candidates_overlay: candidatesOverlayRel,
      method: "tools/comic_panel_splitter.py",
      settings: splitterManifest.settings ?? null,
      raw_count: rawPanels.length,
      expected_count: page.panels.length,
      kept_count: kept.length,
      removed,
      body_locator: context.bodyLocator ?? null,
      comic_region_bbox_full_image_px: comicRegion,
      comic_region_bbox_full_image_pct: bboxPxToPct(comicRegion, dimensions.width, dimensions.height),
    },
  };
}

async function locateComicRegion({ page, image, sourceImage, dimensions, manifestComicRegion, splitterOptions }) {
  const candidates = buildComicRegionCandidates({
    baseRegion: manifestComicRegion,
    imageHeight: dimensions.height,
  });
  const locatorDirRel = `04_panel_crops/filter_review/body_locator/${page.page_id}`;
  const locatorDir = path.join(runFolder, locatorDirRel);
  await rm(locatorDir, { recursive: true, force: true });
  await mkdir(locatorDir, { recursive: true });

  const results = [];
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const candidateId = `candidate_${String(index + 1).padStart(3, "0")}`;
    const candidateFile = `${locatorDirRel}/${candidateId}_y${candidate.y}.png`;
    const outputDir = path.join(locatorDir, `${candidateId}_splitter`);
    try {
      await ffmpegCrop({
        input: sourceImage,
        output: path.join(runFolder, candidateFile),
        bbox: candidate,
      });
      const candidateContext = {
        page,
        image,
        sourceImage,
        dimensions,
        comicRegion: candidate,
        comicRegionFile: candidateFile,
      };
      const splitterRun = await runSplitter({
        context: candidateContext,
        splitterOptions,
        outputDir,
      });
      const evaluation = evaluateSplitterPanels({ context: candidateContext, splitterRun });
      results.push({
        candidate_id: candidateId,
        bbox_full_image_px: candidate,
        file: candidateFile,
        passed: evaluation.passed,
        expected_count: evaluation.expected_count,
        raw_count: evaluation.raw_count,
        kept_count: evaluation.kept_count,
        score: Number.isFinite(evaluation.score) ? roundScore(evaluation.score) : null,
        removed_count: evaluation.removed.length,
        removed_reasons: evaluation.removed.map((removed) => removed.reason),
        error: null,
      });
    } catch (error) {
      results.push({
        candidate_id: candidateId,
        bbox_full_image_px: candidate,
        file: candidateFile,
        passed: false,
        expected_count: page.panels.length,
        raw_count: 0,
        kept_count: 0,
        score: null,
        removed_count: 0,
        removed_reasons: [],
        error: error.message,
      });
    }
  }

  const base = results[0];
  const passed = results.filter((result) => result.passed);
  let selected = null;
  if (passed.length > 0) {
    selected = [...passed].sort((a, b) => {
      const scoreDelta = (a.score ?? Number.POSITIVE_INFINITY) - (b.score ?? Number.POSITIVE_INFINITY);
      if (Math.abs(scoreDelta) > 0.000001) {
        return scoreDelta;
      }
      return a.bbox_full_image_px.y - b.bbox_full_image_px.y;
    })[0];
  } else {
    selected = base ?? {
      candidate_id: "candidate_001",
      bbox_full_image_px: manifestComicRegion,
      passed: false,
      expected_count: page.panels.length,
      raw_count: 0,
      kept_count: 0,
      score: null,
      removed_count: 0,
      removed_reasons: [],
      error: "no locator candidates were evaluated",
    };
  }

  const report = {
    method: "splitter_count_scan_v1",
    page_id: page.page_id,
    source_image: normalizePath(image.file),
    manifest_y_px: manifestComicRegion.y,
    selected_candidate_id: selected.candidate_id,
    selected_y_px: selected.bbox_full_image_px.y,
    selected_height_px: selected.bbox_full_image_px.height,
    selected_passed: selected.passed,
    candidate_count: results.length,
    candidates: results,
  };
  await writeFile(path.join(locatorDir, "locator_report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return {
    comicRegion: selected.bbox_full_image_px,
    report,
  };
}

function buildComicRegionCandidates({ baseRegion, imageHeight }) {
  const candidates = [];
  const bottom = baseRegion.y + baseRegion.height;
  const step = Math.max(12, Math.round(imageHeight * 0.02));
  const maxShift = Math.round(imageHeight * 0.26);
  const maxY = Math.min(bottom - 64, baseRegion.y + maxShift);
  for (let y = baseRegion.y; y <= maxY; y += step) {
    candidates.push({
      x: baseRegion.x,
      y,
      width: baseRegion.width,
      height: bottom - y,
    });
  }
  if (candidates.at(-1)?.y !== maxY) {
    candidates.push({
      x: baseRegion.x,
      y: maxY,
      width: baseRegion.width,
      height: bottom - maxY,
    });
  }
  return dedupeComicRegionCandidates(candidates);
}

function dedupeComicRegionCandidates(candidates) {
  const seen = new Set();
  const unique = [];
  for (const candidate of candidates) {
    const key = `${candidate.x}:${candidate.y}:${candidate.width}:${candidate.height}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(candidate);
  }
  return unique;
}

async function writeBodyLocatorReport(reports) {
  await writeFile(
    path.join(filterReviewDir, "body_locator_report.json"),
    `${JSON.stringify(
      {
        version: 1,
        generated_at: new Date().toISOString(),
        method: "splitter_count_scan_v1",
        page_count: reports.length,
        pages: reports.map((report) => ({
          page_id: report.page_id,
          selected_candidate_id: report.selected_candidate_id,
          manifest_y_px: report.manifest_y_px,
          selected_y_px: report.selected_y_px,
          selected_passed: report.selected_passed,
          candidate_count: report.candidate_count,
        })),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

async function runSplitter({ context, splitterOptions, outputDir, debugOverlay = null, debugCandidatesOverlay = null }) {
  const args = [
    splitterScript,
    path.join(runFolder, context.comicRegionFile),
    "--output-dir",
    outputDir,
    "--background",
    splitterOptions.background,
    "--background-tolerance",
    String(splitterOptions.backgroundTolerance),
    "--separator-ratio",
    String(splitterOptions.separatorRatio),
    "--min-gutter",
    String(splitterOptions.minGutter),
    "--min-panel-width",
    String(splitterOptions.minPanelWidth),
    "--min-panel-height",
    String(splitterOptions.minPanelHeight),
    "--min-panel-area",
    String(splitterOptions.minPanelArea),
    "--padding",
    String(splitterOptions.padding),
  ];
  if (debugOverlay) {
    args.push("--debug-overlay", debugOverlay);
  }
  if (debugCandidatesOverlay) {
    args.push("--debug-candidates-overlay", debugCandidatesOverlay);
  }
  if (splitterOptions.keepProfileCard) {
    args.push("--keep-profile-card");
  }
  if (splitterOptions.keepTextStrips) {
    args.push("--keep-text-strips");
  }
  await spawnCapture("python3", args);
  const manifest = await readJson(path.join(outputDir, "manifest.json"));
  return {
    manifest,
    rawPanels: normalizeSplitterPanels(manifest, outputDir),
  };
}

function normalizeSplitterPanels(manifest, outputDir) {
  const panels = Array.isArray(manifest.panels) ? manifest.panels : [];
  return panels.map((panel, index) => {
    if (!Array.isArray(panel.box) || panel.box.length !== 4 || !panel.file) {
      throw new Error(`Invalid splitter panel entry at index ${index}`);
    }
    return {
      id: panel.id ?? `panel_${String(index + 1).padStart(3, "0")}`,
      file: panel.file,
      file_abs: path.join(outputDir, panel.file),
      box: panel.box.map((value) => Number(value)),
      width: Number(panel.width ?? Number(panel.box[2]) - Number(panel.box[0])),
      height: Number(panel.height ?? Number(panel.box[3]) - Number(panel.box[1])),
    };
  });
}

function filterFirstResidualCandidate({ rawPanels, expectedCount, imageWidth, imageHeight }) {
  const removed = [];
  if (rawPanels.length === expectedCount + 1 && looksLikeFirstResidualCandidate(rawPanels[0], imageWidth, imageHeight)) {
    const [first, ...rest] = rawPanels;
    removed.push({
      id: first.id,
      box: first.box,
      width: first.width,
      height: first.height,
      reason: "first_residual_candidate",
    });
    return { kept: rest, removed };
  }
  return { kept: rawPanels, removed };
}

function looksLikeFirstResidualCandidate(panel, imageWidth, imageHeight) {
  const [left, top, right, bottom] = panel.box;
  const width = right - left;
  const height = bottom - top;
  return top <= imageHeight * 0.05 && width >= imageWidth * 0.6 && height <= imageHeight * 0.18;
}

function resolveRunRelative(filePath) {
  return path.isAbsolute(filePath) ? filePath : path.join(runFolder, normalizePath(filePath));
}

async function imageDimensions(filePath, manifestImage) {
  if (Number.isFinite(manifestImage.width) && Number.isFinite(manifestImage.height)) {
    return { width: Number(manifestImage.width), height: Number(manifestImage.height) };
  }
  const result = await spawnCapture("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height",
    "-of",
    "json",
    filePath,
  ]);
  const parsed = JSON.parse(result.stdout);
  const stream = parsed.streams?.[0];
  if (!stream?.width || !stream?.height) {
    throw new Error(`无法读取图片尺寸：${filePath}`);
  }
  return { width: Number(stream.width), height: Number(stream.height) };
}

function bboxPctToPx(bboxPct, imageWidth, imageHeight) {
  const x = clampInt(Number(bboxPct.x) * imageWidth, 0, imageWidth - 1);
  const y = clampInt(Number(bboxPct.y) * imageHeight, 0, imageHeight - 1);
  const width = clampInt(Number(bboxPct.width) * imageWidth, 1, imageWidth - x);
  const height = clampInt(Number(bboxPct.height) * imageHeight, 1, imageHeight - y);
  return { x, y, width, height };
}

function splitterBoxToFullImagePx({ comicRegion, box, imageWidth, imageHeight }) {
  const [left, top, right, bottom] = box;
  const x = comicRegion.x + left;
  const y = comicRegion.y + top;
  const width = right - left;
  const height = bottom - top;
  return {
    x: clampInt(x, 0, imageWidth - 1),
    y: clampInt(y, 0, imageHeight - 1),
    width: clampInt(width, 1, imageWidth - clampInt(x, 0, imageWidth - 1)),
    height: clampInt(height, 1, imageHeight - clampInt(y, 0, imageHeight - 1)),
  };
}

function bboxPxToPct(bbox, imageWidth, imageHeight) {
  return {
    x: roundPct(bbox.x / imageWidth),
    y: roundPct(bbox.y / imageHeight),
    width: roundPct(bbox.width / imageWidth),
    height: roundPct(bbox.height / imageHeight),
  };
}

function clampInt(value, min, max) {
  const numeric = Number.isFinite(value) ? Math.round(value) : min;
  return Math.min(Math.max(numeric, min), max);
}

function roundPct(value) {
  return Number(value.toFixed(6));
}

async function ffmpegCrop({ input, output, bbox }) {
  await mkdir(path.dirname(output), { recursive: true });
  await spawnCapture("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    input,
    "-vf",
    `crop=${bbox.width}:${bbox.height}:${bbox.x}:${bbox.y}`,
    "-frames:v",
    "1",
    output,
  ]);
  await assertNonEmptyFile(output);
}

async function stageRuntimePng(input, output) {
  await mkdir(path.dirname(output), { recursive: true });
  await copyFile(input, output);
  await assertNonEmptyFile(output);
}

async function backupAndClearInputPages() {
  await mkdir(inputPagesDir, { recursive: true });
  const existing = await readdir(inputPagesDir, { withFileTypes: true }).catch(() => []);
  const imageFiles = existing.filter(
    (entry) => entry.isFile() && supportedImageExts.has(path.extname(entry.name).toLowerCase()),
  );
  if (imageFiles.length === 0) {
    return null;
  }
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "_");
  const backupDir = path.join(projectRoot, "input", `_backup_before_control_page_run_${stamp}`, "pages");
  await mkdir(backupDir, { recursive: true });
  for (const entry of imageFiles) {
    const source = path.join(inputPagesDir, entry.name);
    await copyFile(source, path.join(backupDir, entry.name));
    await rm(source);
  }
  return backupDir;
}

async function assertNonEmptyFile(filePath) {
  const fileStat = await stat(filePath);
  if (!fileStat.isFile() || fileStat.size <= 0) {
    throw new Error(`预期非空文件：${filePath}`);
  }
}

async function isNonEmptyFile(filePath) {
  const fileStat = await stat(filePath).catch(() => null);
  return Boolean(fileStat?.isFile() && fileStat.size > 0);
}

async function hashFile(filePath) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

function spawnCapture(command, args) {
  return new Promise((resolve, reject) => {
    const child = execFile(command, args, { encoding: "utf8" }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`${command} 执行失败：${stderr || error.message}`));
        return;
      }
      resolve({ stdout, stderr });
    });
    child.stdin?.end();
  });
}

function normalizePath(value) {
  if (typeof value !== "string" || value.trim() === "") {
    return "";
  }
  return value.replaceAll("\\", "/").replace(/^\.\//, "");
}

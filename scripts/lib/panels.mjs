import { createHash } from "node:crypto";
import { copyFile, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PNG } from "pngjs";
import { ensureDir, toPosixPath, writeJson } from "./planning.mjs";

const manualPackRelativePath = "project_output/panels/panel_pack.manual.json";
const defaultSafeFrame = {
  x_pct: 0.08,
  y_pct: 0.08,
  width_pct: 0.84,
  height_pct: 0.84,
};
const profileCardComicSpreadSplitPct = 0.39;

export async function buildPanelPack({ cwd, outputRoot, pages }) {
  const panelsRoot = path.join(outputRoot, "panels");
  const cropsDir = path.join(panelsRoot, "crops");
  await ensureDir(cropsDir);

  const manualOverrides = await readManualOverrides(cwd);
  const preCroppedRuntimeInputs = await readPreCroppedRuntimeInputHashes(cwd);
  const pageEntries = [];
  const panels = [];
  let nextReadingOrder = 1;

  for (const [pageIndex, pagePath] of pages.entries()) {
    const metadata = await readImageMetadata(pagePath);
    const pageId = pageIdFromPath(pagePath, pageIndex);
    const sourceImage = toPosixPath(path.relative(cwd, pagePath));
    pageEntries.push({
      page_id: pageId,
      source_image: sourceImage,
      width: metadata.width,
      height: metadata.height,
      page_index: pageIndex + 1,
    });

    const detections = detectPanelsForPage({
      width: metadata.width,
      height: metadata.height,
      format: metadata.format,
      forceSinglePanel: preCroppedRuntimeInputMatches(
        preCroppedRuntimeInputs,
        sourceImage,
        metadata.sha256,
      ),
    });
    for (const [panelIndex, detection] of detections.entries()) {
      const panelId = `${pageId}_panel_${String(panelIndex + 1).padStart(3, "0")}`;
      const override = manualOverrides.get(panelId);
      const manualBboxUnsupported = Boolean(override?.bbox_px && metadata.format !== "png");
      const bboxPx = clampBbox(
        manualBboxUnsupported ? detection.bbox_px : (override?.bbox_px ?? detection.bbox_px),
        metadata.width,
        metadata.height,
      );
      const cropAsset = toPosixPath(
        path.join("project_output", "panels", "crops", `${panelId}${cropExtension(pagePath)}`),
      );
      const reviewFlags = [...detection.review_flags];
      if (override) {
        reviewFlags.push("manual_override");
      }
      if (manualBboxUnsupported) {
        reviewFlags.push("non_png_crop_unsupported");
      }

      const panel = {
        panel_id: panelId,
        page_id: pageId,
        source_image: sourceImage,
        crop_asset: cropAsset,
        bbox_px: bboxPx,
        bbox_pct: bboxToPct(bboxPx, metadata.width, metadata.height),
        reading_order: Number.isInteger(override?.reading_order)
          ? override.reading_order
          : nextReadingOrder,
        safe_frame: normalizeSafeFrame({ ...defaultSafeFrame, ...(override?.safe_frame ?? {}) }),
        confidence: detection.confidence,
        detection_method: detection.detection_method,
        review_flags: Array.from(new Set(reviewFlags)),
        needs_manual_review: reviewFlags.length > 0,
      };

      await writePanelCrop({ sourcePath: pagePath, cropPath: path.join(cwd, cropAsset), bboxPx });
      panels.push(panel);
      nextReadingOrder += 1;
    }
  }

  panels.sort((a, b) => a.reading_order - b.reading_order || a.panel_id.localeCompare(b.panel_id));

  const panelPack = {
    version: 1,
    generated_at: new Date().toISOString(),
    manual_override_path: manualPackRelativePath,
    source_root: "input/pages",
    output_root: "project_output/panels",
    pages: pageEntries,
    panels,
    review_flags: buildPackReviewFlags(panels),
  };

  await writeJson(path.join(panelsRoot, "panel_pack.json"), panelPack);
  return panelPack;
}

export function selectLegacyShotSourcesFromPanels(panelPack) {
  const panelsByPage = new Map();
  for (const panel of panelPack.panels) {
    const current = panelsByPage.get(panel.page_id);
    if (!current || panel.reading_order < current.reading_order) {
      panelsByPage.set(panel.page_id, panel);
    }
  }

  return panelPack.pages
    .map((page) => panelsByPage.get(page.page_id)?.crop_asset ?? page.source_image)
    .filter(Boolean);
}

async function readManualOverrides(cwd) {
  const manualPath = path.join(cwd, manualPackRelativePath);
  let raw;
  try {
    raw = await readFile(manualPath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return new Map();
    }
    throw error;
  }

  const parsed = JSON.parse(raw);
  const overrides = new Map();
  for (const panel of parsed.panels ?? []) {
    if (panel.panel_id) {
      overrides.set(panel.panel_id, panel);
    }
  }
  return overrides;
}

async function readPreCroppedRuntimeInputHashes(cwd) {
  const runsRoot = path.join(cwd, "project_output", "control-page-runs");
  const runEntries = await readdir(runsRoot, { withFileTypes: true }).catch((error) => {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  });

  const approvedRuntimeInputs = new Map();
  const blockedRuntimeInputs = new Map();
  for (const entry of runEntries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const runDir = path.join(runsRoot, entry.name);
    const manifestPath = path.join(runsRoot, entry.name, "04_panel_crops", "panel_crop_manifest.json");
    let manifest;
    try {
      manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") {
        continue;
      }
      throw new Error(`Invalid control-page panel crop manifest: ${manifestPath}: ${error.message}`);
    }
    const reviewApproved = await isCropReviewApproved(runDir, manifest);
    const target = reviewApproved ? approvedRuntimeInputs : blockedRuntimeInputs;
    for (const crop of manifest.crops ?? []) {
      const normalized = normalizeRuntimeInputPath(cwd, crop.runtime_input);
      const sha256 = normalizeSha256(crop.runtime_input_sha256);
      if (normalized && sha256) {
        const hashes = target.get(normalized) ?? new Set();
        hashes.add(sha256);
        target.set(normalized, hashes);
      }
    }
  }
  return {
    approved: approvedRuntimeInputs,
    blocked: blockedRuntimeInputs,
  };
}

async function isCropReviewApproved(runDir, manifest) {
  if (manifest.crop_method !== "tools_comic_panel_splitter_v1") {
    return false;
  }
  const reviewStatusPath = path.join(runDir, "04_panel_crops", "crop_review_status.json");
  try {
    const reviewStatus = JSON.parse(await readFile(reviewStatusPath, "utf8"));
    return reviewStatus.status === "approved" && reviewStatus.crop_method === "tools_comic_panel_splitter_v1";
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }
    throw new Error(`Invalid control-page crop review status: ${reviewStatusPath}: ${error.message}`);
  }
}

function normalizeRuntimeInputPath(cwd, value) {
  if (typeof value !== "string" || value.trim() === "") {
    return "";
  }
  const resolved = path.isAbsolute(value) ? path.relative(cwd, value) : value;
  return toPosixPath(resolved).replace(/^\.\//, "");
}

function normalizeSha256(value) {
  if (typeof value !== "string") {
    return "";
  }
  const normalized = value.trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(normalized) ? normalized : "";
}

function preCroppedRuntimeInputMatches(runtimeInputs, sourceImage, sha256) {
  if (runtimeInputs.blocked.get(sourceImage)?.has(sha256)) {
    throw new Error(
      `Runtime input ${sourceImage} matches a control-page crop that is not approved. Review 04_panel_crops/crop_review_status.json and set status=approved before npm run build.`,
    );
  }
  return runtimeInputs.approved.get(sourceImage)?.has(sha256) ?? false;
}

function pageIdFromPath(pagePath, pageIndex) {
  const stem = sanitizePathPart(path.basename(pagePath, path.extname(pagePath)));
  const ext = sanitizePathPart(path.extname(pagePath).replace(/^\./, ""));
  const pageNumber = `p${String(pageIndex + 1).padStart(3, "0")}`;
  return [pageNumber, stem || "page", ext || "image"].join("_");
}

function sanitizePathPart(value) {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
}

function cropExtension(pagePath) {
  return path.extname(pagePath).toLowerCase() === ".png" ? ".png" : path.extname(pagePath).toLowerCase();
}

async function readImageMetadata(filePath) {
  const buffer = await readFile(filePath);
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") {
    const png = PNG.sync.read(buffer);
    return { width: png.width, height: png.height, format: "png", sha256 };
  }
  if (ext === ".jpg" || ext === ".jpeg") {
    return { ...readJpegSize(buffer), format: "jpeg", sha256 };
  }
  if (ext === ".webp") {
    return { ...readWebpSize(buffer), format: "webp", sha256 };
  }
  throw new Error(`Unsupported image format for panel detection: ${filePath}`);
}

function detectPanelsForPage({ width, height, format, forceSinglePanel = false }) {
  if (forceSinglePanel) {
    return [
      {
        bbox_px: { x: 0, y: 0, width, height },
        confidence: 0.95,
        detection_method: "pre_cropped_control_page_panel_v1",
        review_flags: [],
      },
    ];
  }

  if (format !== "png") {
    return [
      {
        bbox_px: { x: 0, y: 0, width, height },
        confidence: 0.35,
        detection_method: "full_page_fallback_v1",
        review_flags: ["full_page_fallback", "manual_panel_crop_required"],
      },
    ];
  }

  if (looksLikeProfileCardComicSpread({ width, height })) {
    const splitX = Math.round(width * profileCardComicSpreadSplitPct);
    return [
      {
        bbox_px: clampBbox(
          {
            x: splitX,
            y: 0,
            width: width - splitX,
            height,
          },
          width,
          height,
        ),
        confidence: 0.88,
        detection_method: "profile_card_right_comic_region_v1",
        review_flags: [],
      },
    ];
  }

  if (looksLikeVerticalStoryPage({ width, height })) {
    return [
      {
        bbox_px: { x: 0, y: 0, width, height },
        confidence: 0.93,
        detection_method: "single_page_vertical_story_v1",
        review_flags: [],
      },
    ];
  }

  const boxes = [
    ratioBbox({ x: 72 / 1200, y: 68 / 720, width: 470 / 1200, height: 392 / 720 }, width, height),
    ratioBbox({ x: 586 / 1200, y: 68 / 720, width: 470 / 1200, height: 392 / 720 }, width, height),
    ratioBbox({ x: 72 / 1200, y: 502 / 720, width: 984 / 1200, height: 178 / 720 }, width, height),
  ];

  return boxes.map((bbox) => ({
    bbox_px: clampBbox(bbox, width, height),
    confidence: 0.82,
    detection_method: "deterministic_sample_grid_v1",
    review_flags: [],
  }));
}

function looksLikeProfileCardComicSpread({ width, height }) {
  const aspect = width / height;
  return width >= 1400 && height >= 800 && aspect >= 1.65 && aspect <= 1.9;
}

function looksLikeVerticalStoryPage({ width, height }) {
  const aspect = width / height;
  return height > width && aspect >= 0.5 && aspect <= 0.65;
}

function ratioBbox(ratio, width, height) {
  return {
    x: Math.round(ratio.x * width),
    y: Math.round(ratio.y * height),
    width: Math.round(ratio.width * width),
    height: Math.round(ratio.height * height),
  };
}

function clampBbox(bbox, pageWidth, pageHeight) {
  const x = clampInt(bbox.x, 0, pageWidth - 1);
  const y = clampInt(bbox.y, 0, pageHeight - 1);
  const maxWidth = pageWidth - x;
  const maxHeight = pageHeight - y;
  return {
    x,
    y,
    width: clampInt(bbox.width, 1, maxWidth),
    height: clampInt(bbox.height, 1, maxHeight),
  };
}

function clampInt(value, min, max) {
  const numeric = Number.isFinite(Number(value)) ? Math.round(Number(value)) : min;
  return Math.min(Math.max(numeric, min), max);
}

function bboxToPct(bbox, pageWidth, pageHeight) {
  return {
    x: roundPct(bbox.x / pageWidth),
    y: roundPct(bbox.y / pageHeight),
    width: roundPct(bbox.width / pageWidth),
    height: roundPct(bbox.height / pageHeight),
  };
}

function roundPct(value) {
  return Number(value.toFixed(6));
}

function normalizeSafeFrame(value) {
  const xPct = clampPct(value.x_pct, 0, 0.99);
  const yPct = clampPct(value.y_pct, 0, 0.99);
  return {
    x_pct: xPct,
    y_pct: yPct,
    width_pct: clampPct(value.width_pct, 0.01, 1 - xPct),
    height_pct: clampPct(value.height_pct, 0.01, 1 - yPct),
  };
}

function clampPct(value, min, max) {
  const numeric = Number.isFinite(Number(value)) ? Number(value) : min;
  return Number(Math.min(Math.max(numeric, min), max).toFixed(6));
}

async function writePanelCrop({ sourcePath, cropPath, bboxPx }) {
  await ensureDir(path.dirname(cropPath));
  if (path.extname(sourcePath).toLowerCase() !== ".png") {
    await copyFile(sourcePath, cropPath);
    return;
  }

  const source = PNG.sync.read(await readFile(sourcePath));
  const crop = new PNG({ width: bboxPx.width, height: bboxPx.height });
  for (let y = 0; y < bboxPx.height; y += 1) {
    for (let x = 0; x < bboxPx.width; x += 1) {
      const sourceIdx = (source.width * (bboxPx.y + y) + bboxPx.x + x) << 2;
      const targetIdx = (crop.width * y + x) << 2;
      crop.data[targetIdx] = source.data[sourceIdx];
      crop.data[targetIdx + 1] = source.data[sourceIdx + 1];
      crop.data[targetIdx + 2] = source.data[sourceIdx + 2];
      crop.data[targetIdx + 3] = source.data[sourceIdx + 3];
    }
  }
  await writeFile(cropPath, PNG.sync.write(crop));
}

function readJpegSize(buffer) {
  let offset = 2;
  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);
    if (marker >= 0xc0 && marker <= 0xc3) {
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7),
      };
    }
    offset += 2 + length;
  }
  throw new Error("Unable to read JPEG dimensions");
}

function readWebpSize(buffer) {
  const chunk = buffer.toString("ascii", 12, 16);
  if (chunk === "VP8X") {
    return {
      width: 1 + buffer.readUIntLE(24, 3),
      height: 1 + buffer.readUIntLE(27, 3),
    };
  }
  if (chunk === "VP8 ") {
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff,
    };
  }
  if (chunk === "VP8L") {
    const bits = buffer.readUInt32LE(21);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
    };
  }
  throw new Error("Unable to read WebP dimensions");
}

function buildPackReviewFlags(panels) {
  const flags = new Set();
  for (const panel of panels) {
    for (const flag of panel.review_flags) {
      flags.add(flag);
    }
  }
  return Array.from(flags);
}

#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const supportedImageExts = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const requiredCropMethod = "tools_comic_panel_splitter_v1";

const { runFolderArg, projectRootArg } = parseArgs(process.argv.slice(2));

if (!runFolderArg) {
  console.error("用法：node verify-runtime-inputs.mjs <run-folder> [--project-root <repo-root>]");
  process.exit(2);
}

const projectRoot = path.resolve(projectRootArg);
const runFolder = path.resolve(projectRoot, runFolderArg);
const manifestPath = path.join(runFolder, "04_panel_crops", "panel_crop_manifest.json");
const cropReviewStatusPath = path.join(runFolder, "04_panel_crops", "crop_review_status.json");
const auditPath = path.join(runFolder, "04_panel_crops", "runtime_input_audit.json");
const inputPagesDir = path.join(projectRoot, "input", "pages");

const blockers = [];
const manifest = await readJson(manifestPath);
const cropReviewStatus = await readJson(cropReviewStatusPath).catch((error) => {
  blockers.push(`缺少裁切人工审核状态文件：04_panel_crops/crop_review_status.json (${error.message})`);
  return null;
});
const crops = Array.isArray(manifest.crops) ? manifest.crops : [];
const expectedFiles = normalizeList(
  Array.isArray(manifest.runtime_input_pages)
    ? manifest.runtime_input_pages
    : crops.map((crop) => crop.runtime_input).filter(Boolean),
);
const actualFiles = normalizeList(await listInputPages(inputPagesDir, projectRoot));
const expectedSet = new Set(expectedFiles);
const actualSet = new Set(actualFiles);

if (manifest.crop_method !== requiredCropMethod) {
  blockers.push(
    `panel_crop_manifest.crop_method 必须是 ${requiredCropMethod}，当前为 ${JSON.stringify(manifest.crop_method)}`,
  );
}

if (!Array.isArray(manifest.splitter_runs) || manifest.splitter_runs.length === 0) {
  blockers.push("panel_crop_manifest.splitter_runs 必须包含 tools/comic_panel_splitter.py 的运行记录");
}

for (const [index, run] of (Array.isArray(manifest.splitter_runs) ? manifest.splitter_runs : []).entries()) {
  if (run?.method !== "tools/comic_panel_splitter.py") {
    blockers.push(`splitter_runs[${index}].method 必须是 tools/comic_panel_splitter.py`);
  }
  if (run?.kept_count !== run?.expected_count) {
    blockers.push(`splitter_runs[${index}] kept_count 必须等于 expected_count`);
  }
}

if (cropReviewStatus) {
  if (cropReviewStatus.review_required !== true) {
    blockers.push("crop_review_status.review_required 必须是 true");
  }
  if (!["pending", "approved"].includes(cropReviewStatus.status)) {
    blockers.push('crop_review_status.status 必须是 "pending" 或 "approved"');
  }
  if (cropReviewStatus.crop_method !== requiredCropMethod) {
    blockers.push(`crop_review_status.crop_method 必须是 ${requiredCropMethod}`);
  }
  if (cropReviewStatus.manifest_sha256) {
    const manifestHash = await hashFile(manifestPath).catch((error) => {
      blockers.push(`无法读取 panel_crop_manifest.json hash：${error.message}`);
      return null;
    });
    if (manifestHash && cropReviewStatus.manifest_sha256 !== manifestHash) {
      blockers.push("crop_review_status.manifest_sha256 与当前 panel_crop_manifest.json 不一致");
    }
  } else {
    blockers.push("crop_review_status.manifest_sha256 缺失");
  }
}

for (const expected of expectedSet) {
  if (!actualSet.has(expected)) {
    blockers.push(`缺少 runtime input：${expected}`);
  }
}

for (const actual of actualSet) {
  if (!expectedSet.has(actual)) {
    blockers.push(`input/pages 中存在未声明文件：${actual}`);
  }
}

const files = [];
for (const crop of crops) {
  const runtimeInput = normalizePath(crop.runtime_input);
  const panelCrop = normalizePath(crop.file);
  if (!runtimeInput) {
    blockers.push(`crop 缺少 runtime_input：${crop.panel_id ?? panelCrop ?? "unknown"}`);
    continue;
  }
  if (!expectedSet.has(runtimeInput)) {
    blockers.push(`crop 的 runtime_input 未列入 runtime_input_pages：${runtimeInput}`);
  }
  if (!panelCrop) {
    blockers.push(`runtime input 缺少对应 crop 文件：${runtimeInput}`);
    continue;
  }

  const runtimeAbs = path.join(projectRoot, runtimeInput);
  const cropAbs = path.join(runFolder, panelCrop);
  const runtimeHash = await hashFile(runtimeAbs).catch((error) => {
    blockers.push(`无法读取 runtime input ${runtimeInput}：${error.message}`);
    return null;
  });
  const cropHash = await hashFile(cropAbs).catch((error) => {
    blockers.push(`无法读取 panel crop ${panelCrop}：${error.message}`);
    return null;
  });
  if (crop.panel_crop_sha256 && cropHash && crop.panel_crop_sha256 !== cropHash) {
    blockers.push(`manifest 创建后 panel crop hash 已变化：${panelCrop}`);
  }
  if (crop.runtime_input_sha256 && runtimeHash && crop.runtime_input_sha256 !== runtimeHash) {
    blockers.push(`manifest 创建后 runtime input hash 已变化：${runtimeInput}`);
  }
  const sourceIsLowerComicCrop = Boolean(
    runtimeHash &&
      cropHash &&
      (runtimeHash === cropHash ||
        (crop.panel_crop_sha256 === cropHash &&
          crop.runtime_input_sha256 === runtimeHash &&
          normalizePath(crop.runtime_input_source) === panelCrop)),
  );
  if (!sourceIsLowerComicCrop) {
    blockers.push(`runtime input 与下方漫画格 crop 内容不匹配：${runtimeInput}`);
  }

  files.push({
    runtime_input: runtimeInput,
    panel_crop: panelCrop,
    panel_id: crop.panel_id ?? null,
    panel_crop_sha256: cropHash,
    runtime_input_sha256: runtimeHash,
    source_is_lower_comic_crop: sourceIsLowerComicCrop,
  });
}

const audit = {
  version: 1,
  checked_at: new Date().toISOString(),
  input_pages_dir: "input/pages",
  expected_files: expectedFiles,
  actual_files: actualFiles,
  matched: blockers.length === 0,
  files,
  crop_method: manifest.crop_method ?? null,
  crop_review_status: cropReviewStatus
    ? {
        status: cropReviewStatus.status ?? null,
        review_required: cropReviewStatus.review_required ?? null,
      }
    : null,
  blockers,
};

await writeFile(auditPath, `${JSON.stringify(audit, null, 2)}\n`, "utf8");

if (blockers.length > 0) {
  console.error(`runtime input 审计失败，共 ${blockers.length} 个 blocker。见 ${path.relative(projectRoot, auditPath)}`);
  for (const blocker of blockers) {
    console.error(`- ${blocker}`);
  }
  process.exit(1);
}

console.log(`runtime input 审计通过：${files.length} 个 staged 下方漫画格输入。`);

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
    if (!value.startsWith("--") && !runFolder) {
      runFolder = value;
    }
  }
  return { runFolderArg: runFolder, projectRootArg: projectRootValue || process.cwd() };
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function listInputPages(dir, root) {
  const entries = await readdir(dir, { withFileTypes: true }).catch((error) => {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  });
  return entries
    .filter((entry) => entry.isFile() && supportedImageExts.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => path.relative(root, path.join(dir, entry.name)));
}

function normalizeList(values) {
  return [...new Set(values.map(normalizePath).filter(Boolean))].sort();
}

function normalizePath(value) {
  if (typeof value !== "string" || value.trim() === "") {
    return "";
  }
  return value.replaceAll("\\", "/").replace(/^\.\//, "");
}

async function hashFile(filePath) {
  const fileStat = await stat(filePath);
  if (!fileStat.isFile() || fileStat.size <= 0) {
    throw new Error("不是非空文件");
  }
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

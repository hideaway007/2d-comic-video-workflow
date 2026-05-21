#!/usr/bin/env node

import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const { runFolderArg, projectRootArg } = parseArgs(process.argv.slice(2));

if (!runFolderArg) {
  console.error("用法：node validate-control-page-images.mjs <run-folder> [--project-root <repo-root>]");
  process.exit(2);
}

const projectRoot = path.resolve(projectRootArg);
const runFolder = path.resolve(projectRoot, runFolderArg);
const promptsPath = path.join(runFolder, "02_prompts", "control_page_prompts.json");
const imageManifestPath = path.join(runFolder, "03_images", "image_manifest.json");
const auditPath = path.join(runFolder, "03_images", "control_page_image_audit.json");

const blockers = [];
const warnings = [];
const prompts = await readJson(promptsPath);
const imageManifest = await readOptionalJson(imageManifestPath, {
  missingMessage: "03_images/image_manifest.json is required before Gate Images",
  blockers,
});
const pages = Array.isArray(prompts.pages) ? prompts.pages : [];
const images = Array.isArray(imageManifest.images) ? imageManifest.images : [];

if (pages.length === 0) {
  blockers.push("control_page_prompts.json must contain non-empty pages");
}
if (images.length !== pages.length) {
  blockers.push(`image count mismatch: prompts=${pages.length}, images=${images.length}`);
}

const master = imageManifest.character_board_master ?? {};
if (!master.file) {
  blockers.push("image_manifest.character_board_master.file is required");
} else {
  const masterPath = resolveRunRelative(master.file);
  if (!(await pathExists(masterPath))) {
    blockers.push(`missing character board master: ${master.file}`);
  } else {
    const actualMasterHash = await hashFile(masterPath);
    if (master.sha256 && master.sha256 !== actualMasterHash) {
      blockers.push(`character board master sha256 mismatch: expected ${master.sha256}, got ${actualMasterHash}`);
    }
  }
  validateImageGenEvidence({
    label: "character_board_master",
    item: master,
    blockers,
  });
}

const imageByPageId = new Map(images.map((image) => [image.page_id, image]));
for (const page of pages) {
  if (!page.page_id) {
    blockers.push("page entry missing page_id");
    continue;
  }

  const pagePanels = Array.isArray(page.panels) ? page.panels : [];
  if (pagePanels.length < 5 || pagePanels.length > 7) {
    blockers.push(
      `${page.page_id} must contain 5-7 lower comic panels by default; found ${pagePanels.length}. ` +
        "Do not lock the workflow to a 2x2 four-panel page unless the user explicitly requested four panels.",
    );
  }

  const image = imageByPageId.get(page.page_id);
  if (!image) {
    blockers.push(`missing generated image manifest entry for ${page.page_id}`);
    continue;
  }

  if (!image.file) {
    blockers.push(`image entry missing file for ${page.page_id}`);
  } else if (!(await pathExists(resolveRunRelative(image.file)))) {
    blockers.push(`missing generated image file for ${page.page_id}: ${image.file}`);
  }
}

for (const image of images) {
  validateImageGenEvidence({
    label: image.page_id ?? "unknown page",
    item: image,
    blockers,
  });
}

const referenceEnforcement = imageManifest.reference_enforcement ?? {};
const referenceMethod = referenceEnforcement.method ?? null;
if (!referenceMethod) {
  blockers.push(
    "image_manifest.reference_enforcement.method is required. " +
      "Text-only prompts that say 'reference the same master' are not evidence of character-board enforcement.",
  );
} else if (referenceMethod === "deterministic_top_board_composite") {
  validateDeterministicTopBoard({ referenceEnforcement, images, blockers });
} else if (referenceMethod === "image_to_image_reference") {
  validateImageToImageReference({ referenceEnforcement, images, master, blockers });
} else {
  blockers.push(
    `unsupported reference_enforcement.method=${referenceMethod}; expected deterministic_top_board_composite or image_to_image_reference`,
  );
}

const audit = {
  version: 1,
  checked_at: new Date().toISOString(),
  run_folder: normalizePath(path.relative(projectRoot, runFolder)),
  page_count: pages.length,
  image_count: images.length,
  reference_enforcement: referenceEnforcement,
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

console.log(`control page image audit passed: ${pages.length} page(s), method=${referenceMethod}`);

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

async function readOptionalJson(filePath, { missingMessage, blockers: blockersValue }) {
  try {
    return await readJson(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      blockersValue.push(missingMessage);
      return {};
    }
    throw error;
  }
}

function resolveRunRelative(filePath) {
  return path.isAbsolute(filePath) ? filePath : path.join(runFolder, normalizePath(filePath));
}

async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function hashFile(filePath) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

function normalizePath(value) {
  return value.split(path.sep).join("/");
}

function validateImageGenEvidence({ label, item, blockers }) {
  const source = String(item.generation_source ?? "");
  const localPlaceholderPatterns = [
    /local_html_css/i,
    /deterministic_python_pil/i,
    /placeholder/i,
    /rasterized_placeholder/i,
    /svg/i,
    /canvas/i,
  ];
  if (localPlaceholderPatterns.some((pattern) => pattern.test(source))) {
    blockers.push(`${label} uses local/programmatic placeholder source (${source}), not an image_gen result`);
  }
  if (/panel[_-]?composite|panel[_-]?first/i.test(source)) {
    blockers.push(`${label} uses forbidden panel-first source (${source}); each image must be a complete control page`);
  }

  if (Object.prototype.hasOwnProperty.call(item, "panel_image_sources")) {
    blockers.push(`${label} uses panel_image_sources; panel-first image generation is forbidden`);
  }
  if (String(item.file ?? "").includes("generated_panels/")) {
    blockers.push(`${label} points at generated_panels output; each image entry must be a complete control page`);
  }

  const hasDirectImageGen = /image[_-]?gen/i.test(source);
  if (!hasDirectImageGen) {
    blockers.push(`${label} must record direct image_gen evidence in generation_source`);
  }
}

function validateDeterministicTopBoard({ referenceEnforcement, images, blockers }) {
  if (referenceEnforcement.pixel_identical_top_board !== true) {
    blockers.push(
      "deterministic_top_board_composite requires reference_enforcement.pixel_identical_top_board=true. " +
        "The same master board must be composited into every page instead of being redrawn by the image model.",
    );
  }
  if (!referenceEnforcement.top_board_file) {
    blockers.push("deterministic_top_board_composite requires reference_enforcement.top_board_file");
  }
  if (!referenceEnforcement.top_board_sha256) {
    blockers.push("deterministic_top_board_composite requires reference_enforcement.top_board_sha256");
  }
  for (const image of images) {
    if (image.top_board_sha256 !== referenceEnforcement.top_board_sha256) {
      blockers.push(`${image.page_id} top_board_sha256 must match reference_enforcement.top_board_sha256`);
    }
    if (image.reference_transport?.type === "text_prompt_only") {
      blockers.push(`${image.page_id} uses text_prompt_only reference transport, which is forbidden`);
    }
  }
}

function validateImageToImageReference({ referenceEnforcement, images, master, blockers }) {
  if (referenceEnforcement.supports_image_reference !== true) {
    blockers.push("image_to_image_reference requires reference_enforcement.supports_image_reference=true");
  }
  if (!referenceEnforcement.reference_image_file) {
    blockers.push("image_to_image_reference requires reference_enforcement.reference_image_file");
  }
  if (!referenceEnforcement.reference_image_sha256) {
    blockers.push("image_to_image_reference requires reference_enforcement.reference_image_sha256");
  }
  if (master.sha256 && referenceEnforcement.reference_image_sha256 !== master.sha256) {
    blockers.push("reference_enforcement.reference_image_sha256 must equal character_board_master.sha256");
  }

  for (const image of images) {
    const transport = image.reference_transport ?? {};
    if (transport.type === "text_prompt_only") {
      blockers.push(`${image.page_id} uses text_prompt_only reference transport, which is forbidden`);
    }
    if (transport.supports_image_reference !== true) {
      blockers.push(`${image.page_id} must record reference_transport.supports_image_reference=true`);
    }
    if (image.reference_image_sha256 !== referenceEnforcement.reference_image_sha256) {
      blockers.push(`${image.page_id} reference_image_sha256 must match the character board master`);
    }
  }
}

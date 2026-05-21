import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { PNG } from "pngjs";

const repoRoot = path.resolve(import.meta.dirname, "..");

test("control-page crop uses tools splitter and removes the first residual candidate", () => {
  const workdir = mkdtempSync(path.join(tmpdir(), "control-page-splitter-crop-"));
  const runFolder = path.join(workdir, "project_output/control-page-runs/demo");
  mkdirSync(path.join(runFolder, "02_prompts"), { recursive: true });
  mkdirSync(path.join(runFolder, "03_images"), { recursive: true });

  const imagePath = path.join(runFolder, "03_images/page_001.png");
  writeControlPageWithTopResidual(imagePath);
  writeFileSync(
    path.join(runFolder, "02_prompts/page_manifest.json"),
    `${JSON.stringify(
      {
        version: 1,
        pages: [
          {
            page_id: "page_001",
            comic_region_bbox_pct: { x: 0, y: 0.3, width: 1, height: 0.68 },
            panels: Array.from({ length: 5 }, (_, index) => ({
              panel_id: `page_001_panel_${String(index + 1).padStart(3, "0")}`,
              bbox_pct: { x: 0.02, y: 0.02 + index * 0.18, width: 0.96, height: 0.14 },
              narration_segment_ids: [`seg_${String(index + 1).padStart(3, "0")}`],
            })),
          },
        ],
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    path.join(runFolder, "03_images/image_manifest.json"),
    `${JSON.stringify(
      {
        version: 1,
        images: [
          {
            page_id: "page_001",
            file: "03_images/page_001.png",
            width: 800,
            height: 1200,
          },
        ],
      },
      null,
      2,
    )}\n`,
  );

  const result = spawnSync(
    "node",
    [
      path.join(repoRoot, ".codex/skills/comic-control-page-video/scripts/crop-control-page-panels.mjs"),
      "project_output/control-page-runs/demo",
      "--project-root",
      workdir,
      "--no-stage-runtime",
      "--no-auto-tune",
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);

  const manifestPath = path.join(runFolder, "04_panel_crops/panel_crop_manifest.json");
  assert.ok(existsSync(manifestPath));
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  assert.equal(manifest.crop_count, 5);
  assert.equal(manifest.splitter_runs?.[0]?.raw_count, 6);
  assert.equal(manifest.splitter_runs?.[0]?.removed?.[0]?.reason, "first_residual_candidate");
  assert.equal(manifest.splitter_runs?.[0]?.kept_count, 5);
  assert.ok(
    manifest.crops[0].bbox_full_image_px.y >= 440,
    `first crop should start below the residual strip, got y=${manifest.crops[0].bbox_full_image_px.y}`,
  );
  assert.ok(existsSync(path.join(runFolder, "04_panel_crops/filter_review/page_001_splitter_overlay.png")));
  const reviewStatus = JSON.parse(readFileSync(path.join(runFolder, "04_panel_crops/crop_review_status.json"), "utf8"));
  assert.equal(reviewStatus.status, "pending");
  assert.equal(reviewStatus.review_required, true);
  assert.equal(reviewStatus.crop_method, "tools_comic_panel_splitter_v1");
  for (const crop of manifest.crops) {
    assert.ok(existsSync(path.join(runFolder, crop.file)));
  }
});

test("runtime input verification rejects non-splitter fallback crop manifests", () => {
  const workdir = mkdtempSync(path.join(tmpdir(), "control-page-fallback-crop-"));
  const runFolder = path.join(workdir, "project_output/control-page-runs/demo");
  mkdirSync(path.join(runFolder, "04_panel_crops/panels"), { recursive: true });
  mkdirSync(path.join(workdir, "input/pages"), { recursive: true });

  const imageBytes = tinyPng();
  const imageHash = createHash("sha256").update(imageBytes).digest("hex");
  writeFileSync(path.join(runFolder, "04_panel_crops/panels/page_001_panel_001.png"), imageBytes);
  writeFileSync(path.join(workdir, "input/pages/page_001.png"), imageBytes);

  const manifest = {
    version: 1,
    crop_method: "page_manifest_bbox_crop_v1_after_splitter_under_detected",
    crop_count: 1,
    splitter_runs: [],
    runtime_input_pages: ["input/pages/page_001.png"],
    crops: [
      {
        panel_id: "page_001_panel_001",
        file: "04_panel_crops/panels/page_001_panel_001.png",
        runtime_input: "input/pages/page_001.png",
        panel_crop_sha256: imageHash,
        runtime_input_source: "04_panel_crops/panels/page_001_panel_001.png",
        runtime_input_sha256: imageHash,
      },
    ],
  };
  const manifestPath = path.join(runFolder, "04_panel_crops/panel_crop_manifest.json");
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(
    path.join(runFolder, "04_panel_crops/crop_review_status.json"),
    `${JSON.stringify(
      {
        version: 1,
        status: "pending",
        review_required: true,
        crop_method: manifest.crop_method,
        manifest_sha256: createHash("sha256").update(readFileSync(manifestPath)).digest("hex"),
      },
      null,
      2,
    )}\n`,
  );

  const result = spawnSync(
    "node",
    [
      path.join(repoRoot, ".codex/skills/comic-control-page-video/scripts/verify-runtime-inputs.mjs"),
      "project_output/control-page-runs/demo",
      "--project-root",
      workdir,
    ],
    { encoding: "utf8" },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /crop_method 必须是 tools_comic_panel_splitter_v1/);
});

test("control-page crop auto-tunes light gutter pages when defaults under-detect", () => {
  const workdir = mkdtempSync(path.join(tmpdir(), "control-page-light-gutter-crop-"));
  const runFolder = path.join(workdir, "project_output/control-page-runs/demo");
  mkdirSync(path.join(runFolder, "02_prompts"), { recursive: true });
  mkdirSync(path.join(runFolder, "03_images"), { recursive: true });

  const imagePath = path.join(runFolder, "03_images/page_001.png");
  writeControlPageWithLightGutterGrid(imagePath);
  writeFileSync(
    path.join(runFolder, "02_prompts/page_manifest.json"),
    `${JSON.stringify(
      {
        version: 1,
        pages: [
          {
            page_id: "page_001",
            comic_region_bbox_pct: { x: 0, y: 0.34, width: 1, height: 0.66 },
            panels: Array.from({ length: 4 }, (_, index) => ({
              panel_id: `page_001_panel_${String(index + 1).padStart(3, "0")}`,
              bbox_pct: { x: index % 2 === 0 ? 0 : 0.5, y: index < 2 ? 0 : 0.5, width: 0.5, height: 0.5 },
              narration_segment_ids: [`seg_${String(index + 1).padStart(3, "0")}`],
            })),
          },
        ],
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    path.join(runFolder, "03_images/image_manifest.json"),
    `${JSON.stringify(
      {
        version: 1,
        images: [
          {
            page_id: "page_001",
            file: "03_images/page_001.png",
            width: 816,
            height: 1400,
          },
        ],
      },
      null,
      2,
    )}\n`,
  );

  const result = spawnSync(
    "node",
    [
      path.join(repoRoot, ".codex/skills/comic-control-page-video/scripts/crop-control-page-panels.mjs"),
      "project_output/control-page-runs/demo",
      "--project-root",
      workdir,
      "--no-stage-runtime",
      "--max-tune-candidates",
      "20",
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  const manifest = JSON.parse(readFileSync(path.join(runFolder, "04_panel_crops/panel_crop_manifest.json"), "utf8"));
  assert.equal(manifest.crop_count, 4);
  const report = JSON.parse(readFileSync(path.join(runFolder, "04_panel_crops/filter_review/auto_tune_report.json"), "utf8"));
  assert.ok(report.selected_candidate_id);
  assert.notEqual(report.selected_candidate_id, "candidate_001");
});

test("control-page crop --no-auto-tune fails fast when the unified default splitter under-detects", () => {
  const workdir = mkdtempSync(path.join(tmpdir(), "control-page-light-gutter-no-tune-"));
  const runFolder = path.join(workdir, "project_output/control-page-runs/demo");
  mkdirSync(path.join(runFolder, "02_prompts"), { recursive: true });
  mkdirSync(path.join(runFolder, "03_images"), { recursive: true });

  const imagePath = path.join(runFolder, "03_images/page_001.png");
  writeControlPageWithLightGutterGrid(imagePath);
  writeFileSync(
    path.join(runFolder, "02_prompts/page_manifest.json"),
    `${JSON.stringify(
      {
        version: 1,
        pages: [
          {
            page_id: "page_001",
            comic_region_bbox_pct: { x: 0, y: 0.34, width: 1, height: 0.66 },
            panels: Array.from({ length: 4 }, (_, index) => ({
              panel_id: `page_001_panel_${String(index + 1).padStart(3, "0")}`,
              bbox_pct: { x: index % 2 === 0 ? 0 : 0.5, y: index < 2 ? 0 : 0.5, width: 0.5, height: 0.5 },
              narration_segment_ids: [`seg_${String(index + 1).padStart(3, "0")}`],
            })),
          },
        ],
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    path.join(runFolder, "03_images/image_manifest.json"),
    `${JSON.stringify(
      {
        version: 1,
        images: [
          {
            page_id: "page_001",
            file: "03_images/page_001.png",
            width: 816,
            height: 1400,
          },
        ],
      },
      null,
      2,
    )}\n`,
  );

  const result = spawnSync(
    "node",
    [
      path.join(repoRoot, ".codex/skills/comic-control-page-video/scripts/crop-control-page-panels.mjs"),
      "project_output/control-page-runs/demo",
      "--project-root",
      workdir,
      "--no-stage-runtime",
      "--no-auto-tune",
    ],
    { encoding: "utf8" },
  );
  assert.notEqual(result.status, 0, result.stderr);
  assert.match(result.stderr, /auto-tune failed/);
  assert.ok(existsSync(path.join(runFolder, "04_panel_crops/filter_review/page_001_splitter_overlay.png")));
  assert.ok(!existsSync(path.join(runFolder, "04_panel_crops/panel_crop_manifest.json")));
});

test("control-page crop locates the real comic body below an overlong reference header", () => {
  const workdir = mkdtempSync(path.join(tmpdir(), "control-page-body-locator-"));
  const runFolder = path.join(workdir, "project_output/control-page-runs/demo");
  mkdirSync(path.join(runFolder, "02_prompts"), { recursive: true });
  mkdirSync(path.join(runFolder, "03_images"), { recursive: true });

  const imagePath = path.join(runFolder, "03_images/page_001.png");
  writeControlPageWithDeepReferenceHeader(imagePath);
  writeFileSync(
    path.join(runFolder, "02_prompts/page_manifest.json"),
    `${JSON.stringify(
      {
        version: 1,
        pages: [
          {
            page_id: "page_001",
            comic_region_bbox_pct: { x: 0, y: 0.34, width: 1, height: 0.66 },
            panels: Array.from({ length: 4 }, (_, index) => ({
              panel_id: `page_001_panel_${String(index + 1).padStart(3, "0")}`,
              bbox_pct: { x: index % 2 === 0 ? 0 : 0.5, y: index < 2 ? 0 : 0.5, width: 0.5, height: 0.5 },
              narration_segment_ids: [`seg_${String(index + 1).padStart(3, "0")}`],
            })),
          },
        ],
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    path.join(runFolder, "03_images/image_manifest.json"),
    `${JSON.stringify(
      {
        version: 1,
        images: [
          {
            page_id: "page_001",
            file: "03_images/page_001.png",
            width: 800,
            height: 1200,
          },
        ],
      },
      null,
      2,
    )}\n`,
  );

  const result = spawnSync(
    "node",
    [
      path.join(repoRoot, ".codex/skills/comic-control-page-video/scripts/crop-control-page-panels.mjs"),
      "project_output/control-page-runs/demo",
      "--project-root",
      workdir,
      "--no-stage-runtime",
      "--no-auto-tune",
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);

  const manifest = JSON.parse(readFileSync(path.join(runFolder, "04_panel_crops/panel_crop_manifest.json"), "utf8"));
  assert.equal(manifest.crop_count, 4);
  const run = manifest.splitter_runs?.[0];
  assert.equal(run?.body_locator?.method, "splitter_count_scan_v1");
  assert.ok(
    run.body_locator.selected_y_px > 500,
    `body locator should move below the reference header, got y=${run.body_locator.selected_y_px}`,
  );
  assert.equal(run.raw_count, 4);
});

test("control-page crop writes auto-tune diagnostics without staging when no global parameters pass", () => {
  const workdir = mkdtempSync(path.join(tmpdir(), "control-page-auto-tune-fail-"));
  const runFolder = path.join(workdir, "project_output/control-page-runs/demo");
  mkdirSync(path.join(runFolder, "02_prompts"), { recursive: true });
  mkdirSync(path.join(runFolder, "03_images"), { recursive: true });
  mkdirSync(path.join(workdir, "input/pages"), { recursive: true });

  const existingInput = path.join(workdir, "input/pages/existing.png");
  writeFileSync(existingInput, tinyPng());
  const imagePath = path.join(runFolder, "03_images/page_001.png");
  writeControlPageWithLightGutterGrid(imagePath);
  writeFileSync(
    path.join(runFolder, "02_prompts/page_manifest.json"),
    `${JSON.stringify(
      {
        version: 1,
        pages: [
          {
            page_id: "page_001",
            comic_region_bbox_pct: { x: 0, y: 0.34, width: 1, height: 0.66 },
            panels: Array.from({ length: 9 }, (_, index) => ({
              panel_id: `page_001_panel_${String(index + 1).padStart(3, "0")}`,
              bbox_pct: { x: 0, y: index / 9, width: 1, height: 1 / 9 },
              narration_segment_ids: [`seg_${String(index + 1).padStart(3, "0")}`],
            })),
          },
        ],
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    path.join(runFolder, "03_images/image_manifest.json"),
    `${JSON.stringify(
      {
        version: 1,
        images: [
          {
            page_id: "page_001",
            file: "03_images/page_001.png",
            width: 816,
            height: 1400,
          },
        ],
      },
      null,
      2,
    )}\n`,
  );

  const result = spawnSync(
    "node",
    [
      path.join(repoRoot, ".codex/skills/comic-control-page-video/scripts/crop-control-page-panels.mjs"),
      "project_output/control-page-runs/demo",
      "--project-root",
      workdir,
      "--max-tune-candidates",
      "4",
    ],
    { encoding: "utf8" },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /auto-tune failed/);
  assert.ok(!existsSync(path.join(runFolder, "04_panel_crops/panel_crop_manifest.json")));
  assert.ok(existsSync(existingInput));
  const report = JSON.parse(readFileSync(path.join(runFolder, "04_panel_crops/filter_review/auto_tune_report.json"), "utf8"));
  assert.equal(report.selected_candidate_id, null);
  assert.equal(report.evaluated_count, 4);
});

function writeControlPageWithTopResidual(filePath) {
  const width = 800;
  const height = 1200;
  const png = new PNG({ width, height, colorType: 6 });
  fillRect(png, 0, 0, width, height, [255, 255, 255, 255]);

  fillRect(png, 0, 0, width, 360, [230, 225, 214, 255]);
  fillRect(png, 35, 300, 650, 45, [58, 58, 58, 255]);
  fillRect(png, 0, 360, width, 70, [230, 225, 214, 255]);
  fillRect(png, 25, 375, 700, 30, [48, 48, 48, 255]);

  const panels = [
    { x: 20, y: 460, w: 760, h: 170, tone: [178, 190, 188, 255] },
    { x: 20, y: 660, w: 370, h: 170, tone: [190, 178, 168, 255] },
    { x: 410, y: 660, w: 370, h: 170, tone: [172, 176, 188, 255] },
    { x: 20, y: 860, w: 370, h: 260, tone: [168, 184, 172, 255] },
    { x: 410, y: 860, w: 370, h: 260, tone: [184, 168, 178, 255] },
  ];
  for (const [index, panel] of panels.entries()) {
    fillRect(png, panel.x, panel.y, panel.w, panel.h, [18, 18, 18, 255]);
    fillRect(png, panel.x + 8, panel.y + 8, panel.w - 16, panel.h - 16, panel.tone);
    fillRect(png, panel.x + 28, panel.y + 28, 70 + index * 20, 16, [35, 35, 35, 255]);
    fillRect(png, panel.x + 42, panel.y + 68, 95, 56, [70, 70, 70, 255]);
  }

  writeFileSync(filePath, PNG.sync.write(png));
}

function tinyPng() {
  const png = new PNG({ width: 10, height: 10, colorType: 6 });
  fillRect(png, 0, 0, 10, 10, [120, 120, 120, 255]);
  return PNG.sync.write(png);
}

function writeControlPageWithLightGutterGrid(filePath) {
  const width = 816;
  const height = 1400;
  const topHeight = Math.round(height * 0.34);
  const regionHeight = height - topHeight;
  const png = new PNG({ width, height, colorType: 6 });
  fillRect(png, 0, 0, width, height, [34, 30, 27, 255]);
  fillRect(png, 0, 0, width, topHeight, [225, 218, 204, 255]);

  const gutter = 7;
  const splitX = 404;
  const splitY = 516;
  fillRect(png, splitX, topHeight, gutter, regionHeight, [245, 242, 235, 255]);
  fillRect(png, 0, topHeight + splitY, width, gutter, [245, 242, 235, 255]);
  const panels = [
    { x: 0, y: topHeight, w: splitX, h: splitY, tone: [45, 38, 32, 255] },
    { x: splitX + gutter, y: topHeight, w: width - splitX - gutter, h: splitY, tone: [55, 43, 37, 255] },
    { x: 0, y: topHeight + splitY + gutter, w: splitX, h: regionHeight - splitY - gutter, tone: [62, 48, 42, 255] },
    {
      x: splitX + gutter,
      y: topHeight + splitY + gutter,
      w: width - splitX - gutter,
      h: regionHeight - splitY - gutter,
      tone: [70, 54, 48, 255],
    },
  ];
  for (const [index, panel] of panels.entries()) {
    fillRect(png, panel.x, panel.y, panel.w, panel.h, panel.tone);
    for (let mark = 0; mark < 18; mark += 1) {
      fillRect(
        png,
        panel.x + 24 + mark * 13,
        panel.y + 36 + mark * 11,
        40,
        25,
        [90 + index * 8, 72, 58, 255],
      );
    }
  }

  writeFileSync(filePath, PNG.sync.write(png));
}

function writeControlPageWithDeepReferenceHeader(filePath) {
  const width = 800;
  const height = 1200;
  const png = new PNG({ width, height, colorType: 6 });
  fillRect(png, 0, 0, width, height, [248, 248, 248, 255]);

  fillRect(png, 0, 0, width, 550, [238, 236, 230, 255]);
  fillRect(png, 24, 420, 180, 90, [45, 45, 45, 255]);
  fillRect(png, 232, 410, 130, 105, [55, 55, 55, 255]);
  fillRect(png, 410, 430, 260, 80, [65, 65, 65, 255]);
  fillRect(png, 0, 542, width, 8, [248, 248, 248, 255]);

  const top = 570;
  const gutter = 12;
  const panelW = Math.floor((width - gutter) / 2);
  const panelH = Math.floor((height - top - gutter - 20) / 2);
  const panels = [
    { x: 0, y: top, tone: [52, 43, 38, 255] },
    { x: panelW + gutter, y: top, tone: [66, 50, 44, 255] },
    { x: 0, y: top + panelH + gutter, tone: [58, 48, 42, 255] },
    { x: panelW + gutter, y: top + panelH + gutter, tone: [70, 55, 48, 255] },
  ];
  for (const [index, panel] of panels.entries()) {
    fillRect(png, panel.x, panel.y, panelW, panelH, [15, 15, 15, 255]);
    fillRect(png, panel.x + 8, panel.y + 8, panelW - 16, panelH - 16, panel.tone);
    fillRect(png, panel.x + 40, panel.y + 40, 120 + index * 18, 18, [120, 120, 120, 255]);
    fillRect(png, panel.x + 56, panel.y + 96, 90, 70, [100, 100, 100, 255]);
  }

  writeFileSync(filePath, PNG.sync.write(png));
}

function fillRect(png, x, y, width, height, rgba) {
  const x0 = Math.max(0, x);
  const y0 = Math.max(0, y);
  const x1 = Math.min(png.width, x + width);
  const y1 = Math.min(png.height, y + height);
  for (let py = y0; py < y1; py += 1) {
    for (let px = x0; px < x1; px += 1) {
      const offset = (py * png.width + px) << 2;
      png.data[offset] = rgba[0];
      png.data[offset + 1] = rgba[1];
      png.data[offset + 2] = rgba[2];
      png.data[offset + 3] = rgba[3];
    }
  }
}

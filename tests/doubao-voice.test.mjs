import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { PNG } from "pngjs";

const repoRoot = path.resolve(import.meta.dirname, "..");
const defaultNarrationVoice = "zh_male_ruyayichen_uranus_bigtts";
const defaultSpeechRate = 25;

test("Doubao dry-run uses one complete narration request by default", () => {
  const workdir = mkdtempSync(path.join(tmpdir(), "comic-doubao-dry-run-"));
  const runFolder = path.join(workdir, "project_output/control-page-runs/demo");
  mkdirSync(path.join(runFolder, "01_script"), { recursive: true });
  writeFileSync(
    path.join(runFolder, "01_script/audio_segments.json"),
    `${JSON.stringify(
      {
        version: 1,
        segments: [
          {
            segment_id: "seg_001",
            page_id: "page_001",
            panel_id: "page_001_panel_001",
            text: "假如你重生成了李建成，但三天后，就是玄武门之变。",
            audio: "segments/seg_001.mp3",
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
      path.join(repoRoot, ".codex/skills/comic-control-page-video/scripts/synthesize-doubao-voice.mjs"),
      "project_output/control-page-runs/demo",
      "--project-root",
      workdir,
      "--dry-run",
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);

  const previewPath = path.join(runFolder, "05_video/audio/doubao_request_preview.json");
  assert.ok(existsSync(previewPath));
  const preview = JSON.parse(readFileSync(previewPath, "utf8"));
  assert.equal(preview.synthesis_mode, "whole");
  assert.equal(preview.request_count, 1);
  assert.equal(preview.segment_count, 1);
  assert.equal(preview.request_config.voice, defaultNarrationVoice);
  assert.equal(preview.request_config.speech_rate, defaultSpeechRate);
  assert.equal(preview.complete_payload.req_params.text, "假如你重生成了李建成，但三天后，就是玄武门之变。");
  assert.equal(preview.complete_payload.req_params.speaker, defaultNarrationVoice);
  assert.equal(preview.complete_payload.req_params.audio_params.speech_rate, defaultSpeechRate);
  assert.equal(preview.first_payload.req_params.speaker, defaultNarrationVoice);
  assert.equal(preview.first_payload.req_params.audio_params.speech_rate, defaultSpeechRate);
});

test("Doubao dry-run can explicitly use segmented requests", () => {
  const workdir = mkdtempSync(path.join(tmpdir(), "comic-doubao-segmented-dry-run-"));
  const runFolder = path.join(workdir, "project_output/control-page-runs/demo");
  mkdirSync(path.join(runFolder, "01_script"), { recursive: true });
  writeFileSync(
    path.join(runFolder, "01_script/audio_segments.json"),
    `${JSON.stringify(
      {
        version: 1,
        segments: [
          { segment_id: "seg_001", text: "第一段。" },
          { segment_id: "seg_002", text: "第二段。" },
        ],
      },
      null,
      2,
    )}\n`,
  );

  const result = spawnSync(
    "node",
    [
      path.join(repoRoot, ".codex/skills/comic-control-page-video/scripts/synthesize-doubao-voice.mjs"),
      "project_output/control-page-runs/demo",
      "--project-root",
      workdir,
      "--dry-run",
      "--mode",
      "segmented",
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);

  const preview = JSON.parse(readFileSync(path.join(runFolder, "05_video/audio/doubao_request_preview.json"), "utf8"));
  assert.equal(preview.synthesis_mode, "segmented");
  assert.equal(preview.request_count, 2);
  assert.equal(preview.segment_count, 2);
});

test("Doubao synthesis refuses to run before 9:16 image review approval", () => {
  const workdir = mkdtempSync(path.join(tmpdir(), "comic-doubao-image-review-"));
  const runFolder = path.join(workdir, "project_output/control-page-runs/demo");
  mkdirSync(path.join(runFolder, "01_script"), { recursive: true });
  mkdirSync(path.join(runFolder, "03_images"), { recursive: true });
  writePng(path.join(runFolder, "03_images/story_pages/page_001.png"), 90, 160);
  writeFileSync(
    path.join(runFolder, "01_script/audio_segments.json"),
    `${JSON.stringify({ version: 1, segments: [{ segment_id: "seg_001", text: "图片未审核时不能生成语音。" }] }, null, 2)}\n`,
  );
  writeFileSync(
    path.join(runFolder, "03_images/vertical_image_manifest.json"),
    `${JSON.stringify(
      {
        version: 1,
        mode: "single_page_vertical",
        requested_page_count: 1,
        generated_page_count: 1,
        pages: [
          {
            page_id: "page_001",
            file: "03_images/story_pages/page_001.png",
            width: 90,
            height: 160,
            source: "image_gen",
          },
        ],
        audit: { passed: true },
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    path.join(runFolder, "03_images/image_review_status.json"),
    `${JSON.stringify({ version: 1, status: "pending", stage: "images", review_required: true }, null, 2)}\n`,
  );

  const result = spawnSync(
    "node",
    [
      path.join(repoRoot, ".codex/skills/comic-control-page-video/scripts/synthesize-doubao-voice.mjs"),
      "project_output/control-page-runs/demo",
      "--project-root",
      workdir,
    ],
    { encoding: "utf8" },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /必须先人工审核 9:16 图片/);
});

test("Doubao synthesis passes the 9:16 image gate after approval", () => {
  const workdir = mkdtempSync(path.join(tmpdir(), "comic-doubao-image-approved-"));
  const runFolder = path.join(workdir, "project_output/control-page-runs/demo");
  mkdirSync(path.join(runFolder, "01_script"), { recursive: true });
  mkdirSync(path.join(runFolder, "03_images"), { recursive: true });
  writePng(path.join(runFolder, "03_images/story_pages/page_001.png"), 90, 160);
  writeFileSync(
    path.join(runFolder, "01_script/audio_segments.json"),
    `${JSON.stringify({ version: 1, segments: [{ segment_id: "seg_001", text: "图片审核通过后才会检查语音密钥。" }] }, null, 2)}\n`,
  );
  writeFileSync(
    path.join(runFolder, "03_images/vertical_image_manifest.json"),
    `${JSON.stringify(
      {
        version: 1,
        mode: "single_page_vertical",
        requested_page_count: 1,
        generated_page_count: 1,
        pages: [
          {
            page_id: "page_001",
            file: "03_images/story_pages/page_001.png",
            width: 90,
            height: 160,
            source: "image_gen",
          },
        ],
        audit: { passed: true },
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    path.join(runFolder, "03_images/image_review_status.json"),
    `${JSON.stringify({ version: 1, status: "approved", stage: "images", review_required: true }, null, 2)}\n`,
  );

  const result = spawnSync(
    "node",
    [
      path.join(repoRoot, ".codex/skills/comic-control-page-video/scripts/synthesize-doubao-voice.mjs"),
      "project_output/control-page-runs/demo",
      "--project-root",
      workdir,
    ],
    {
      encoding: "utf8",
      env: { ...process.env, DOUBAO_TTS_API_KEY: "", VOLCENGINE_TTS_API_KEY: "", HOME: workdir },
    },
  );
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.stderr, /必须先人工审核 9:16 图片/);
  assert.match(result.stderr, /缺少豆包语音 API key/);
});

test("Doubao synthesis rejects invalid approved 9:16 image manifests", () => {
  const workdir = mkdtempSync(path.join(tmpdir(), "comic-doubao-image-invalid-"));
  const runFolder = path.join(workdir, "project_output/control-page-runs/demo");
  mkdirSync(path.join(runFolder, "01_script"), { recursive: true });
  mkdirSync(path.join(runFolder, "03_images"), { recursive: true });
  writeFileSync(
    path.join(runFolder, "01_script/audio_segments.json"),
    `${JSON.stringify({ version: 1, segments: [{ segment_id: "seg_001", text: "无效图片不能进入语音阶段。" }] }, null, 2)}\n`,
  );
  writeFileSync(
    path.join(runFolder, "03_images/vertical_image_manifest.json"),
    `${JSON.stringify(
      {
        version: 1,
        mode: "single_page_vertical",
        requested_page_count: 2,
        generated_page_count: 1,
        pages: [{ page_id: "page_001", file: "03_images/story_pages/missing.png", source: "placeholder" }],
        audit: { passed: true },
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    path.join(runFolder, "03_images/image_review_status.json"),
    `${JSON.stringify({ version: 1, status: "approved", stage: "images", review_required: true }, null, 2)}\n`,
  );

  const result = spawnSync(
    "node",
    [
      path.join(repoRoot, ".codex/skills/comic-control-page-video/scripts/synthesize-doubao-voice.mjs"),
      "project_output/control-page-runs/demo",
      "--project-root",
      workdir,
    ],
    { encoding: "utf8" },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /必须生成全部 9:16 story pages/);
  assert.doesNotMatch(result.stderr, /缺少豆包语音 API key/);
});

test("Doubao synthesis audits approved 9:16 image files before TTS", () => {
  const workdir = mkdtempSync(path.join(tmpdir(), "comic-doubao-image-file-audit-"));
  const runFolder = path.join(workdir, "project_output/control-page-runs/demo");
  mkdirSync(path.join(runFolder, "01_script"), { recursive: true });
  mkdirSync(path.join(runFolder, "03_images"), { recursive: true });
  writeFileSync(
    path.join(runFolder, "01_script/audio_segments.json"),
    `${JSON.stringify({ version: 1, segments: [{ segment_id: "seg_001", text: "图片文件证据必须真实有效。" }] }, null, 2)}\n`,
  );
  writeFileSync(
    path.join(runFolder, "03_images/vertical_image_manifest.json"),
    `${JSON.stringify(
      {
        version: 1,
        mode: "single_page_vertical",
        requested_page_count: 1,
        generated_page_count: 1,
        pages: [{ page_id: "page_001", file: "03_images/story_pages/missing.png", source: "placeholder" }],
        audit: { passed: true },
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    path.join(runFolder, "03_images/image_review_status.json"),
    `${JSON.stringify({ version: 1, status: "approved", stage: "images", review_required: true }, null, 2)}\n`,
  );

  const result = spawnSync(
    "node",
    [
      path.join(repoRoot, ".codex/skills/comic-control-page-video/scripts/synthesize-doubao-voice.mjs"),
      "project_output/control-page-runs/demo",
      "--project-root",
      workdir,
    ],
    { encoding: "utf8" },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /9:16 图片 manifest 未通过文件审计/);
  assert.match(result.stderr, /source 必须是 image_gen/);
  assert.match(result.stderr, /文件不存在或不可读/);
  assert.doesNotMatch(result.stderr, /缺少豆包语音 API key/);
});

test("Doubao synthesis does not accept legacy crop review unless explicitly requested", () => {
  const workdir = mkdtempSync(path.join(tmpdir(), "comic-doubao-legacy-explicit-"));
  const runFolder = path.join(workdir, "project_output/control-page-runs/demo");
  mkdirSync(path.join(runFolder, "01_script"), { recursive: true });
  mkdirSync(path.join(runFolder, "04_panel_crops"), { recursive: true });
  writeFileSync(
    path.join(runFolder, "01_script/audio_segments.json"),
    `${JSON.stringify({ version: 1, segments: [{ segment_id: "seg_001", text: "旧裁切路径必须显式开启。" }] }, null, 2)}\n`,
  );
  writeFileSync(
    path.join(runFolder, "04_panel_crops/panel_crop_manifest.json"),
    `${JSON.stringify({ version: 1, crop_method: "tools_comic_panel_splitter_v1", crops: [] }, null, 2)}\n`,
  );
  writeFileSync(
    path.join(runFolder, "04_panel_crops/crop_review_status.json"),
    `${JSON.stringify({ version: 1, status: "approved", crop_method: "tools_comic_panel_splitter_v1" }, null, 2)}\n`,
  );

  const result = spawnSync(
    "node",
    [
      path.join(repoRoot, ".codex/skills/comic-control-page-video/scripts/synthesize-doubao-voice.mjs"),
      "project_output/control-page-runs/demo",
      "--project-root",
      workdir,
    ],
    { encoding: "utf8" },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /必须显式传 --legacy-crop-review/);
});

test("Doubao synthesis refuses to run before legacy crop review approval", () => {
  const workdir = mkdtempSync(path.join(tmpdir(), "comic-doubao-crop-review-"));
  const runFolder = path.join(workdir, "project_output/control-page-runs/demo");
  mkdirSync(path.join(runFolder, "01_script"), { recursive: true });
  mkdirSync(path.join(runFolder, "04_panel_crops"), { recursive: true });
  writeFileSync(
    path.join(runFolder, "01_script/audio_segments.json"),
    `${JSON.stringify({ version: 1, segments: [{ segment_id: "seg_001", text: "裁切未审核时不能生成语音。" }] }, null, 2)}\n`,
  );
  writeFileSync(
    path.join(runFolder, "04_panel_crops/panel_crop_manifest.json"),
    `${JSON.stringify({ version: 1, crop_method: "tools_comic_panel_splitter_v1", crops: [] }, null, 2)}\n`,
  );
  writeFileSync(
    path.join(runFolder, "04_panel_crops/crop_review_status.json"),
    `${JSON.stringify({ version: 1, status: "pending", crop_method: "tools_comic_panel_splitter_v1" }, null, 2)}\n`,
  );

  const result = spawnSync(
    "node",
    [
      path.join(repoRoot, ".codex/skills/comic-control-page-video/scripts/synthesize-doubao-voice.mjs"),
      "project_output/control-page-runs/demo",
      "--project-root",
      workdir,
      "--legacy-crop-review",
    ],
    { encoding: "utf8" },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /必须先人工审核裁切/);
});

test("Doubao script keeps duration probe helper callable after each segment", () => {
  const source = readFileSync(
    path.join(repoRoot, ".codex/skills/comic-control-page-video/scripts/synthesize-doubao-voice.mjs"),
    "utf8",
  );

  assert.doesNotMatch(source, /const\s+durationMs\s*=\s*await\s+durationMs\(/);
  assert.match(source, /const\s+segmentDurationMs\s*=\s*await\s+durationMs\(/);
});

function writePng(filePath, width, height) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const png = new PNG({ width, height });
  png.data.fill(255);
  writeFileSync(filePath, PNG.sync.write(png));
}

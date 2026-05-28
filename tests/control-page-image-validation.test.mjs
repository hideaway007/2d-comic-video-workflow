import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { PNG } from "pngjs";

const repoRoot = path.resolve(import.meta.dirname, "..");
const validator = path.join(
  repoRoot,
  ".codex/skills/video-generation-template/scripts/validate-control-page-images.mjs",
);

test("control-page image validation rejects local PIL placeholder sources", () => {
  const { workdir, runFolder, masterHash } = createValidationFixture();
  writeManifest(runFolder, {
    version: 1,
    character_board_master: {
      file: "03_images/character_board_master.png",
      sha256: masterHash,
      generation_source: "deterministic_python_pil_control_page_renderer_v1",
    },
    reference_enforcement: {
      method: "deterministic_top_board_composite",
      pixel_identical_top_board: true,
      top_board_file: "03_images/character_board_master.png",
      top_board_sha256: masterHash,
    },
    images: [
      {
        page_id: "page_001",
        file: "03_images/page_001.png",
        top_board_sha256: masterHash,
        generation_source: "deterministic_python_pil_control_page_renderer_v1",
        reference_transport: { type: "pixel_composited_top_board" },
      },
    ],
  });

  const result = runValidator(workdir);
  assert.notEqual(result.status, 0, result.stderr);
  assert.match(result.stderr, /local\/programmatic placeholder source/);
});

test("control-page image validation accepts direct image_gen control-page evidence", () => {
  const { workdir, runFolder, masterHash, pageHash } = createValidationFixture();
  writeManifest(runFolder, {
    version: 1,
    character_board_master: {
      file: "03_images/character_board_master.png",
      sha256: masterHash,
      generation_source: "built_in_image_gen_character_board_v1",
      prompt: "character board prompt",
    },
    reference_enforcement: {
      method: "deterministic_top_board_composite",
      pixel_identical_top_board: true,
      top_board_file: "03_images/character_board_master.png",
      top_board_sha256: masterHash,
    },
    images: [
      {
        page_id: "page_001",
        file: "03_images/page_001.png",
        sha256: pageHash,
        top_board_sha256: masterHash,
        generation_source: "built_in_image_gen_control_page_v1",
        prompt: "full 1:2 control page prompt with character board on top and comic page below",
        reference_transport: { type: "pixel_composited_top_board" },
      },
    ],
  });

  const result = runValidator(workdir);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /control page image audit passed/);
});

test("control-page image validation rejects panel-first composite evidence", () => {
  const { workdir, runFolder, masterHash, pageHash } = createValidationFixture();
  writeManifest(runFolder, {
    version: 1,
    character_board_master: {
      file: "03_images/character_board_master.png",
      sha256: masterHash,
      generation_source: "built_in_image_gen_character_board_v1",
      prompt: "character board prompt",
    },
    reference_enforcement: {
      method: "deterministic_top_board_composite",
      pixel_identical_top_board: true,
      top_board_file: "03_images/character_board_master.png",
      top_board_sha256: masterHash,
    },
    images: [
      {
        page_id: "page_001",
        file: "03_images/page_001.png",
        sha256: pageHash,
        top_board_sha256: masterHash,
        generation_source: "built_in_image_gen_panel_composite_v1",
        reference_transport: { type: "pixel_composited_top_board" },
        panel_image_sources: [
          {
            panel_id: "page_001_panel_001",
            file: "03_images/generated_panels/page_001_panel_001.png",
            prompt: "single panel prompt",
            sha256: "a".repeat(64),
            generation_source: "built_in_image_gen_panel_v1",
          },
        ],
      },
    ],
  });

  const result = runValidator(workdir);
  assert.notEqual(result.status, 0, result.stderr);
  assert.match(result.stderr, /panel-first image generation is forbidden/);
});

test("control-page image validation writes audit when image manifest is missing", () => {
  const { workdir, runFolder } = createValidationFixture();

  const result = runValidator(workdir);
  assert.notEqual(result.status, 0, result.stderr);
  assert.match(result.stderr, /image_manifest\.json is required/);

  const audit = JSON.parse(readFileSync(path.join(runFolder, "03_images/control_page_image_audit.json"), "utf8"));
  assert.equal(audit.passed, false);
  assert.match(audit.blockers.join("\n"), /image_manifest\.json is required/);
});

function createValidationFixture() {
  const workdir = mkdtempSync(path.join(tmpdir(), "control-page-image-validation-"));
  const runFolder = path.join(workdir, "project_output/control-page-runs/demo");
  mkdirSync(path.join(runFolder, "02_prompts"), { recursive: true });
  mkdirSync(path.join(runFolder, "03_images"), { recursive: true });
  writePng(path.join(runFolder, "03_images/character_board_master.png"), 800, 300, [220, 214, 200, 255]);
  writePng(path.join(runFolder, "03_images/page_001.png"), 800, 1200, [180, 190, 180, 255]);
  writeFileSync(
    path.join(runFolder, "02_prompts/control_page_prompts.json"),
    `${JSON.stringify(
      {
        version: 1,
        pages: [
          {
            page_id: "page_001",
            panels: Array.from({ length: 5 }, (_, index) => ({
              panel_id: `page_001_panel_${String(index + 1).padStart(3, "0")}`,
            })),
          },
        ],
      },
      null,
      2,
    )}\n`,
  );
  return {
    workdir,
    runFolder,
    masterHash: hashFile(path.join(runFolder, "03_images/character_board_master.png")),
    pageHash: hashFile(path.join(runFolder, "03_images/page_001.png")),
  };
}

function writeManifest(runFolder, manifest) {
  writeFileSync(path.join(runFolder, "03_images/image_manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

function runValidator(workdir) {
  return spawnSync(
    "node",
    [validator, "project_output/control-page-runs/demo", "--project-root", workdir],
    { encoding: "utf8" },
  );
}

function writePng(filePath, width, height, rgba) {
  const png = new PNG({ width, height, colorType: 6 });
  for (let py = 0; py < height; py += 1) {
    for (let px = 0; px < width; px += 1) {
      const offset = (py * width + px) << 2;
      png.data[offset] = rgba[0];
      png.data[offset + 1] = rgba[1];
      png.data[offset + 2] = rgba[2];
      png.data[offset + 3] = rgba[3];
    }
  }
  writeFileSync(filePath, PNG.sync.write(png));
}

function hashFile(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

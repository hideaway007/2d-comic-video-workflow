import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { PNG } from "pngjs";
import {
  createMockAnalysisPlan,
  normalizeAnalysisPlan,
} from "../scripts/lib/ai-planning.mjs";
import {
  finalVideoPath,
  previewVideoPath,
  videoTargets,
} from "../scripts/lib/quality.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");

function run(command, args, cwd, options = {}) {
  return spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, MOTION_COMIC_TEST_ROOT: cwd, ...(options.env ?? {}) },
  });
}

function writePng(filePath, width = 120, height = 80) {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (width * y + x) << 2;
      png.data[idx] = 220;
      png.data[idx + 1] = 228;
      png.data[idx + 2] = 236;
      png.data[idx + 3] = 255;
    }
  }
  writeFileSync(filePath, PNG.sync.write(png));
}

function sha256File(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function writeProfileCardComicSpread(filePath, width = 1672, height = 941) {
  const png = new PNG({ width, height });
  const splitX = Math.round(width * 0.39);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (width * y + x) << 2;
      const isProfileCard = x < splitX;
      png.data[idx] = isProfileCard ? 190 : 20;
      png.data[idx + 1] = isProfileCard ? 32 : 85;
      png.data[idx + 2] = isProfileCard ? 32 : 150;
      png.data[idx + 3] = 255;
    }
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = splitX - 2; x <= splitX + 2; x += 1) {
      const idx = (width * y + x) << 2;
      png.data[idx] = 174;
      png.data[idx + 1] = 128;
      png.data[idx + 2] = 64;
      png.data[idx + 3] = 255;
    }
  }
  writeFileSync(filePath, PNG.sync.write(png));
}

function writeMinimalJpeg(filePath, width = 120, height = 80) {
  writeFileSync(
    filePath,
    Buffer.from([
      0xff,
      0xd8,
      0xff,
      0xc0,
      0x00,
      0x11,
      0x08,
      (height >> 8) & 0xff,
      height & 0xff,
      (width >> 8) & 0xff,
      width & 0xff,
      0x03,
      0x01,
      0x11,
      0x00,
      0x02,
      0x11,
      0x00,
      0x03,
      0x11,
      0x00,
      0xff,
      0xd9,
    ]),
  );
}

function writeMinimalWebp(filePath, width = 120, height = 80) {
  const buffer = Buffer.alloc(30);
  buffer.write("RIFF", 0, "ascii");
  buffer.write("WEBP", 8, "ascii");
  buffer.write("VP8X", 12, "ascii");
  buffer.writeUIntLE(width - 1, 24, 3);
  buffer.writeUIntLE(height - 1, 27, 3);
  writeFileSync(filePath, buffer);
}

function writePanelSplitterArtifactFixture(filePath) {
  const width = 900;
  const height = 620;
  const png = new PNG({ width, height });

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (width * y + x) << 2;
      png.data[idx] = 0;
      png.data[idx + 1] = 0;
      png.data[idx + 2] = 0;
      png.data[idx + 3] = 255;
    }
  }

  const fillRect = ({ x, y, width: rectWidth, height: rectHeight, value }) => {
    for (let yy = y; yy < y + rectHeight; yy += 1) {
      for (let xx = x; xx < x + rectWidth; xx += 1) {
        const idx = (width * yy + xx) << 2;
        png.data[idx] = value;
        png.data[idx + 1] = value;
        png.data[idx + 2] = value;
        png.data[idx + 3] = 255;
      }
    }
  };

  fillRect({ x: 10, y: 10, width: 500, height: 220, value: 86 });
  fillRect({ x: 530, y: 10, width: 250, height: 220, value: 108 });
  fillRect({ x: 10, y: 250, width: 770, height: 290, value: 126 });
  fillRect({ x: 10, y: 560, width: 520, height: 38, value: 158 });
  fillRect({ x: 815, y: 250, width: 54, height: 170, value: 174 });

  writeFileSync(filePath, PNG.sync.write(png));
}

function writePanelSplitterProfileCardFixture(filePath) {
  const width = 1672;
  const height = 941;
  const png = new PNG({ width, height });

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (width * y + x) << 2;
      png.data[idx] = 0;
      png.data[idx + 1] = 0;
      png.data[idx + 2] = 0;
      png.data[idx + 3] = 255;
    }
  }

  const fillRect = ({ x, y, width: rectWidth, height: rectHeight, value }) => {
    for (let yy = y; yy < y + rectHeight; yy += 1) {
      for (let xx = x; xx < x + rectWidth; xx += 1) {
        const idx = (width * yy + xx) << 2;
        png.data[idx] = value;
        png.data[idx + 1] = value;
        png.data[idx + 2] = value;
        png.data[idx + 3] = 255;
      }
    }
  };

  fillRect({ x: 20, y: 20, width: 600, height: 900, value: 72 });
  fillRect({ x: 660, y: 20, width: 480, height: 410, value: 96 });
  fillRect({ x: 1160, y: 20, width: 490, height: 410, value: 118 });
  fillRect({ x: 660, y: 455, width: 990, height: 460, value: 142 });

  writeFileSync(filePath, PNG.sync.write(png));
}

test("build:sample creates a structured motion comic project output", () => {
  const workdir = mkdtempSync(path.join(tmpdir(), "motion-comic-"));
  const result = run("node", [path.join(repoRoot, "scripts/create-sample-input.mjs")], workdir);
  assert.equal(result.status, 0, result.stderr);

  const build = run("node", [path.join(repoRoot, "scripts/generate-project.mjs")], workdir);
  assert.equal(build.status, 0, build.stderr);

  const planPath = path.join(workdir, "project_output/plans/motion_plan.json");
  const analysisPlanPath = path.join(workdir, "project_output/plans/analysis_plan.json");
  const normalizerReportPath = path.join(workdir, "project_output/plans/normalizer_report.json");
  assert.ok(existsSync(analysisPlanPath));
  assert.ok(existsSync(normalizerReportPath));

  const analysisPlan = JSON.parse(readFileSync(analysisPlanPath, "utf8"));
  assert.equal(analysisPlan.version, 1);
  assert.equal(analysisPlan.kind, "analysis_plan");
  assert.equal(analysisPlan.shots.length, 9);
  for (const shot of analysisPlan.shots) {
    assert.ok(shot.panel_id);
    assert.ok(shot.intent);
    assert.ok(shot.tempo);
    assert.equal(typeof shot.duration_seconds, "number");
    assert.ok(Array.isArray(shot.primitive_hints));
    assert.ok(!("source_image" in shot));
    assert.ok(!("camera_motion" in shot));
    assert.ok(!("local_motion" in shot));
  }

  const normalizerReport = JSON.parse(readFileSync(normalizerReportPath, "utf8"));
  assert.equal(normalizerReport.version, 1);
  assert.equal(normalizerReport.summary.errors, 0);
  assert.equal(normalizerReport.summary.output_shots, analysisPlan.shots.length);

  const plan = JSON.parse(readFileSync(planPath, "utf8"));
  assert.equal(plan.version, 2);
  assert.equal(plan.render.width, 1920);
  assert.equal(plan.render.height, 1080);
  assert.equal(plan.panel_pack, "project_output/panels/panel_pack.json");
  assert.ok(Array.isArray(plan.pages));
  assert.ok(Array.isArray(plan.panels));
  assert.ok(plan.pages.length >= 2);
  assert.ok(plan.panels.length > plan.pages.length);
  assert.equal(plan.shots.length, plan.panels.length);
  assert.equal(plan.shots.length, analysisPlan.shots.length);
  assert.ok(plan.audio);
  assert.ok(Array.isArray(plan.review_flags));

  const panelsById = new Map(plan.panels.map((panel) => [panel.panel_id, panel]));
  const shotIds = new Set();

  for (const shot of plan.shots) {
    assert.match(shot.shot_id, /^shot_\d{3}$/);
    assert.ok(!plan.panels.some((panel) => panel.panel_id === shot.shot_id));
    assert.ok(!shotIds.has(shot.shot_id));
    shotIds.add(shot.shot_id);
    assert.ok(panelsById.has(shot.panel_id));
    assert.equal(shot.source_image, panelsById.get(shot.panel_id).crop_asset);
    assert.match(shot.source_image, /^project_output\/panels\/crops\//);
    assert.ok(existsSync(path.join(workdir, shot.source_image)));
    assert.ok(existsSync(path.join(workdir, `project_output/assets/${shot.shot_id}/layer_manifest.json`)));
    assert.ok(shot.camera_motion.type);
    assert.ok(shot.main_subject);
    assert.ok(Array.isArray(shot.layer_plan));
    assert.ok(Array.isArray(shot.local_motion));
    assert.ok(Array.isArray(shot.effects));
    assert.equal(typeof shot.manual_review_required, "boolean");
    assert.ok(shot.review_metadata);
  }

  const runtimePlan = JSON.parse(
    readFileSync(path.join(workdir, "project_output/render/remotion/runtime_plan.json"), "utf8"),
  );
  assert.equal(runtimePlan.version, 2);
  assert.equal(runtimePlan.shots.length, plan.shots.length);
  for (const runtimeShot of runtimePlan.shots) {
    const sourceShot = plan.shots.find((shot) => shot.shot_id === runtimeShot.shot_id);
    assert.ok(sourceShot);
    assert.equal(runtimeShot.panel_id, sourceShot.panel_id);
    assert.equal(runtimeShot.source_image, sourceShot.source_image);
    assert.deepEqual(runtimeShot.safe_frame, panelsById.get(sourceShot.panel_id).safe_frame);
  }
});

test("build defaults to mock planner when no planner provider is configured", () => {
  const workdir = mkdtempSync(path.join(tmpdir(), "motion-comic-default-planner-"));
  assert.equal(run("node", [path.join(repoRoot, "scripts/create-sample-input.mjs")], workdir).status, 0);

  const build = run("node", [path.join(repoRoot, "scripts/generate-project.mjs")], workdir, {
    env: {
      MOTION_COMIC_PLANNER: "",
      MOTION_COMIC_CODEX_BIN: path.join(workdir, "missing-codex-bin"),
    },
  });
  assert.equal(build.status, 0, build.stderr);

  const analysisPlan = JSON.parse(
    readFileSync(path.join(workdir, "project_output/plans/analysis_plan.json"), "utf8"),
  );
  assert.equal(analysisPlan.provider, "mock_deterministic_v1");
});

test("build uses codex_cli planner through a fakeable Codex CLI runner", () => {
  const workdir = mkdtempSync(path.join(tmpdir(), "motion-comic-codex-planner-"));
  assert.equal(run("node", [path.join(repoRoot, "scripts/create-sample-input.mjs")], workdir).status, 0);
  const fakeCodex = writeFakeCodexRunner(workdir, {
    mode: "success",
    fenced: true,
    primitive: "camera_push",
  });

  const build = run("node", [path.join(repoRoot, "scripts/generate-project.mjs")], workdir, {
    env: {
      MOTION_COMIC_PLANNER: "codex_cli",
      MOTION_COMIC_CODEX_BIN: fakeCodex,
      MOTION_COMIC_CODEX_MODEL: "test-model",
    },
  });
  assert.equal(build.status, 0, build.stderr);

  const analysisPlan = JSON.parse(
    readFileSync(path.join(workdir, "project_output/plans/analysis_plan.json"), "utf8"),
  );
  const planningInput = JSON.parse(
    readFileSync(path.join(workdir, "project_output/plans/planning_input.json"), "utf8"),
  );
  const normalizerReport = JSON.parse(
    readFileSync(path.join(workdir, "project_output/plans/normalizer_report.json"), "utf8"),
  );
  const runnerLog = JSON.parse(readFileSync(path.join(workdir, "fake-codex-run.json"), "utf8"));

  assert.equal(analysisPlan.provider, "codex_cli:test-model");
  assert.equal(analysisPlan.kind, "analysis_plan");
  assert.equal(analysisPlan.shots.length, planningInput.panels.length);
  assert.ok(analysisPlan.shots.every((shot) => !("source_image" in shot)));
  assert.ok(runnerLog.args.includes("exec"));
  assert.ok(runnerLog.args.includes("--ephemeral"));
  assert.ok(runnerLog.args.includes("--sandbox"));
  assert.ok(runnerLog.args.includes("read-only"));
  assert.ok(runnerLog.args.includes("--ask-for-approval"));
  assert.ok(runnerLog.args.includes("never"));
  assert.ok(runnerLog.args.includes("--skip-git-repo-check"));
  assert.ok(runnerLog.args.includes("--cd"));
  assert.ok(runnerLog.args.includes(workdir));
  assert.ok(runnerLog.args.includes("--output-last-message"));
  assert.ok(runnerLog.args.includes("--model"));
  assert.ok(runnerLog.args.includes("test-model"));
  assert.equal(runnerLog.imageCount, planningInput.panels.length);
  assert.match(runnerLog.stdin, /Return only JSON/);
  assert.equal(normalizerReport.planner.provider, "codex_cli");
  assert.equal(normalizerReport.planner.fallback, false);
});

test("build falls back to mock planner when codex_cli runner fails", () => {
  const workdir = mkdtempSync(path.join(tmpdir(), "motion-comic-codex-fallback-"));
  assert.equal(run("node", [path.join(repoRoot, "scripts/create-sample-input.mjs")], workdir).status, 0);
  const fakeCodex = writeFakeCodexRunner(workdir, { mode: "fail" });

  const build = run("node", [path.join(repoRoot, "scripts/generate-project.mjs")], workdir, {
    env: {
      MOTION_COMIC_PLANNER: "codex_cli",
      MOTION_COMIC_CODEX_BIN: fakeCodex,
      MOTION_COMIC_CODEX_MODEL: "test-model",
    },
  });
  assert.equal(build.status, 0, build.stderr);

  const analysisPlan = JSON.parse(
    readFileSync(path.join(workdir, "project_output/plans/analysis_plan.json"), "utf8"),
  );
  const normalizerReport = JSON.parse(
    readFileSync(path.join(workdir, "project_output/plans/normalizer_report.json"), "utf8"),
  );
  const audit = readFileSync(path.join(workdir, "project_output/input_audit.md"), "utf8");

  assert.match(analysisPlan.provider, /^mock_deterministic_v1_fallback_from_codex_cli/);
  assert.equal(normalizerReport.planner.fallback, true);
  assert.match(normalizerReport.planner.reason, /fake codex failure/);
  assert.match(audit, /Planner fallback/);
  assert.match(audit, /fake codex failure/);
});

test("build exits in strict mode when codex_cli runner fails", () => {
  const workdir = mkdtempSync(path.join(tmpdir(), "motion-comic-codex-strict-"));
  assert.equal(run("node", [path.join(repoRoot, "scripts/create-sample-input.mjs")], workdir).status, 0);
  const fakeCodex = writeFakeCodexRunner(workdir, { mode: "fail" });

  const build = run("node", [path.join(repoRoot, "scripts/generate-project.mjs")], workdir, {
    env: {
      MOTION_COMIC_PLANNER: "codex_cli",
      MOTION_COMIC_CODEX_BIN: fakeCodex,
      MOTION_COMIC_PLANNER_STRICT: "1",
    },
  });

  assert.notEqual(build.status, 0);
  assert.match(build.stderr, /codex_cli planner failed/i);
  assert.ok(!existsSync(path.join(workdir, "project_output/plans/analysis_plan.json")));
});

test("mock analysis plan normalizes into motion_plan v2 shots", () => {
  const panelPack = {
    version: 1,
    panel_pack_path: "project_output/panels/panel_pack.json",
    pages: [{ page_id: "page_001", source_image: "input/pages/page_001.png", width: 120, height: 80 }],
    panels: [
      {
        panel_id: "panel_a",
        page_id: "page_001",
        crop_asset: "project_output/panels/crops/panel_a.png",
        reading_order: 2,
        safe_frame: { x_pct: 0.1, y_pct: 0.1, width_pct: 0.8, height_pct: 0.8 },
        review_flags: [],
      },
      {
        panel_id: "panel_b",
        page_id: "page_001",
        crop_asset: "project_output/panels/crops/panel_b.png",
        reading_order: 1,
        safe_frame: { x_pct: 0.12, y_pct: 0.12, width_pct: 0.76, height_pct: 0.76 },
        review_flags: ["manual_override"],
      },
    ],
    review_flags: ["manual_override"],
  };

  const analysisPlan = createMockAnalysisPlan(panelPack);
  assert.deepEqual(
    analysisPlan.shots.map((shot) => shot.panel_id),
    ["panel_b", "panel_a"],
  );
  assert.equal(analysisPlan.shots[0].primitive_hints[0].scale, 1.18);
  assert.deepEqual(analysisPlan.shots[0].primitive_hints[0].pan, { x: -112, y: -24 });
  assert.equal(analysisPlan.shots[1].primitive_hints[0].scale, 1.1);
  assert.deepEqual(analysisPlan.shots[1].primitive_hints[0].pan, { x: 128, y: 0 });
  assert.ok(!("source_image" in analysisPlan.shots[0]));
  assert.ok(!("camera_motion" in analysisPlan.shots[0]));

  const { plan, report } = normalizeAnalysisPlan({ panelPack, analysisPlan });
  assert.equal(plan.version, 2);
  assert.equal(plan.panel_pack, "project_output/panels/panel_pack.json");
  assert.equal(plan.shots.length, 2);
  assert.equal(report.summary.errors, 0);

  const panelById = new Map(panelPack.panels.map((panel) => [panel.panel_id, panel]));
  for (const [index, shot] of plan.shots.entries()) {
    assert.equal(shot.shot_id, `shot_${String(index + 1).padStart(3, "0")}`);
    assert.equal(shot.source_image, panelById.get(shot.panel_id).crop_asset);
    assert.ok(shot.duration_sec >= 1.5 && shot.duration_sec <= 8);
    assert.ok(shot.duration_frames > 0);
    assert.ok(shot.camera_motion.type);
    assert.ok(Array.isArray(shot.local_motion));
    assert.ok(Array.isArray(shot.effects));
    assert.ok(Array.isArray(shot.review_flags));
  }
});

test("normalizer falls back unknown primitives to hold and reports the correction", () => {
  const panelPack = singlePanelPack();
  const analysisPlan = {
    version: 1,
    kind: "analysis_plan",
    provider: "test",
    shots: [
      {
        panel_id: "panel_001",
        intent: "bad primitive",
        tempo: "fast",
        duration_seconds: 3,
        primitive_hints: [{ primitive: "warp_face", scale: 1.08, pan: { x: 20, y: 0 }, easing: "ease_in_out" }],
        review_flags: [],
      },
    ],
  };

  const { plan, report } = normalizeAnalysisPlan({ panelPack, analysisPlan });
  assert.equal(report.summary.errors, 0);
  assert.equal(report.summary.corrections, 1);
  assert.match(report.corrections[0].reason, /unknown primitive/);
  assert.equal(plan.shots[0].primitive, "hold");
  assert.equal(plan.shots[0].camera_motion.type, "hold");
  assert.ok(plan.shots[0].review_flags.includes("unknown_primitive_fallback"));
});

test("normalizer clamps unsafe duration, scale, pan, and easing values", () => {
  const panelPack = singlePanelPack();
  const analysisPlan = {
    version: 1,
    kind: "analysis_plan",
    provider: "test",
    shots: [
      {
        panel_id: "panel_001",
        intent: "unsafe values",
        tempo: "slow",
        duration_seconds: 99,
        primitive_hints: [{ primitive: "camera_push", scale: 2.2, pan: { x: 999, y: -999 }, easing: "teleport" }],
        review_flags: [],
      },
    ],
  };

  const { plan, report } = normalizeAnalysisPlan({ panelPack, analysisPlan });
  const shot = plan.shots[0];
  assert.equal(shot.duration_sec, 8);
  assert.equal(shot.camera_motion.end_scale, 1.22);
  assert.deepEqual(shot.camera_motion.end_position, { x: 160, y: -160 });
  assert.equal(shot.camera_motion.easing, "ease_in_out");
  assert.equal(report.summary.corrections, 4);
});

test("known hold primitive corrections do not create unknown primitive fallback flags", () => {
  const panelPack = singlePanelPack();
  const analysisPlan = {
    version: 1,
    kind: "analysis_plan",
    provider: "test",
    shots: [
      {
        panel_id: "panel_001",
        intent: "safe hold with unsafe parameters",
        tempo: "steady",
        duration_seconds: 99,
        primitive_hints: [{ primitive: "hold", scale: 2.2, pan: { x: 999, y: -999 }, easing: "teleport" }],
        review_flags: [],
      },
    ],
  };

  const { plan, report } = normalizeAnalysisPlan({ panelPack, analysisPlan });
  const shot = plan.shots[0];
  assert.equal(shot.primitive, "hold");
  assert.equal(shot.camera_motion.type, "hold");
  assert.ok(shot.review_flags.includes("normalizer_corrected"));
  assert.ok(!shot.review_flags.includes("unknown_primitive_fallback"));
  assert.equal(report.summary.corrections, 4);
  assert.ok(report.corrections.every((correction) => !correction.reason.includes("unknown primitive")));
});

test("normalizer clamps duration and scale below lower bounds", () => {
  const panelPack = singlePanelPack();
  const analysisPlan = {
    version: 1,
    kind: "analysis_plan",
    provider: "test",
    shots: [
      {
        panel_id: "panel_001",
        intent: "lower-bound values",
        tempo: "quick",
        duration_seconds: 0.4,
        primitive_hints: [{ primitive: "camera_push", scale: 0.25, pan: { x: 0, y: 0 }, easing: "linear" }],
        review_flags: [],
      },
    ],
  };

  const { plan, report } = normalizeAnalysisPlan({ panelPack, analysisPlan });
  const shot = plan.shots[0];
  assert.equal(shot.duration_sec, 1.5);
  assert.equal(shot.camera_motion.end_scale, 1);
  assert.ok(shot.review_flags.includes("normalizer_corrected"));
  assert.ok(!shot.review_flags.includes("unknown_primitive_fallback"));
  assert.equal(report.summary.corrections, 2);
});

test("normalizer reports invalid panel ids and omits those analysis shots", () => {
  const panelPack = singlePanelPack();
  const analysisPlan = {
    version: 1,
    kind: "analysis_plan",
    provider: "test",
    shots: [
      {
        panel_id: "missing_panel",
        intent: "invalid panel",
        tempo: "steady",
        duration_seconds: 3,
        primitive_hints: [{ primitive: "hold" }],
        review_flags: [],
      },
    ],
  };

  const { plan, report } = normalizeAnalysisPlan({ panelPack, analysisPlan });
  assert.equal(plan.shots.length, 0);
  assert.equal(report.summary.errors, 1);
  assert.match(report.errors[0].message, /Unknown panel_id/);
});

test("build:sample creates a panel pack with real crops and continuous reading order", () => {
  const workdir = mkdtempSync(path.join(tmpdir(), "motion-comic-panels-"));
  assert.equal(run("node", [path.join(repoRoot, "scripts/create-sample-input.mjs")], workdir).status, 0);
  const build = run("node", [path.join(repoRoot, "scripts/generate-project.mjs")], workdir);
  assert.equal(build.status, 0, build.stderr);

  const panelPackPath = path.join(workdir, "project_output/panels/panel_pack.json");
  assert.ok(existsSync(panelPackPath));
  const panelPack = JSON.parse(readFileSync(panelPackPath, "utf8"));
  assert.equal(panelPack.version, 1);
  assert.ok(panelPack.panels.length >= 3);

  const pageById = new Map(panelPack.pages.map((page) => [page.page_id, page]));
  const readingOrder = panelPack.panels.map((panel) => panel.reading_order).sort((a, b) => a - b);
  assert.deepEqual(
    readingOrder,
    Array.from({ length: panelPack.panels.length }, (_, index) => index + 1),
  );

  for (const panel of panelPack.panels) {
    assert.ok(panel.panel_id);
    assert.ok(pageById.has(panel.page_id));
    assert.ok(existsSync(path.join(workdir, panel.source_image)));
    assert.ok(existsSync(path.join(workdir, panel.crop_asset)));
    assert.equal(typeof panel.confidence, "number");
    assert.ok(panel.detection_method);
    assert.ok(Array.isArray(panel.review_flags));
    assert.equal(typeof panel.needs_manual_review, "boolean");
    assert.ok(panel.safe_frame);

    const page = pageById.get(panel.page_id);
    assert.ok(panel.bbox_px.x >= 0);
    assert.ok(panel.bbox_px.y >= 0);
    assert.ok(panel.bbox_px.width > 0);
    assert.ok(panel.bbox_px.height > 0);
    assert.ok(panel.bbox_px.x + panel.bbox_px.width <= page.width);
    assert.ok(panel.bbox_px.y + panel.bbox_px.height <= page.height);
    assert.ok(panel.bbox_pct.x >= 0 && panel.bbox_pct.x <= 1);
    assert.ok(panel.bbox_pct.y >= 0 && panel.bbox_pct.y <= 1);
    assert.ok(panel.bbox_pct.width > 0 && panel.bbox_pct.width <= 1);
    assert.ok(panel.bbox_pct.height > 0 && panel.bbox_pct.height <= 1);

    const crop = PNG.sync.read(readFileSync(path.join(workdir, panel.crop_asset)));
    assert.equal(crop.width, panel.bbox_px.width);
    assert.equal(crop.height, panel.bbox_px.height);
  }
});

test("profile-card comic spreads keep only the right comic region as the panel crop", () => {
  const workdir = mkdtempSync(path.join(tmpdir(), "motion-comic-profile-card-spread-"));
  const pagesDir = path.join(workdir, "input/pages");
  mkdirSync(pagesDir, { recursive: true });
  writeProfileCardComicSpread(path.join(pagesDir, "liushan_spread.png"));

  const build = run("node", [path.join(repoRoot, "scripts/generate-project.mjs")], workdir);
  assert.equal(build.status, 0, build.stderr);

  const panelPack = JSON.parse(readFileSync(path.join(workdir, "project_output/panels/panel_pack.json"), "utf8"));
  assert.equal(panelPack.panels.length, 1);
  const [panel] = panelPack.panels;
  assert.equal(panel.detection_method, "profile_card_right_comic_region_v1");
  assert.ok(panel.bbox_pct.x >= 0.38);
  assert.ok(panel.bbox_pct.width <= 0.62);
  assert.deepEqual(panel.review_flags, []);

  const crop = PNG.sync.read(readFileSync(path.join(workdir, panel.crop_asset)));
  assert.equal(crop.width, panel.bbox_px.width);
  assert.equal(crop.height, panel.bbox_px.height);
  assert.notEqual(crop.data[0], 190);
});

test("comic panel splitter defaults match screenshot-tuned dark comic settings", () => {
  const result = spawnSync(
    "python3",
    [
      "-c",
      [
        "import json, pathlib, sys",
        `sys.path.insert(0, ${JSON.stringify(path.join(repoRoot, "tools"))})`,
        "import comic_panel_splitter as splitter",
        "args = splitter.build_parser().parse_args(['page.png'])",
        "print(json.dumps({'background': args.background, 'background_tolerance': args.background_tolerance, 'separator_ratio': args.separator_ratio, 'min_panel_area': args.min_panel_area, 'padding': args.padding, 'filter_profile_card': args.filter_profile_card, 'filter_text_strips': args.filter_text_strips}, sort_keys=True))",
      ].join("; "),
    ],
    { encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    background: "auto",
    background_tolerance: 8,
    filter_profile_card: true,
    filter_text_strips: true,
    min_panel_area: 5000,
    padding: 0,
    separator_ratio: 0.9,
  });
});

test("comic panel splitter default post-filter removes text strips and narrow slivers", () => {
  const workdir = mkdtempSync(path.join(tmpdir(), "comic-panel-splitter-artifacts-"));
  const imagePath = path.join(workdir, "artifact_fixture.png");
  const outputDir = path.join(workdir, "panels");
  writePanelSplitterArtifactFixture(imagePath);

  const filtered = spawnSync(
    "python3",
    [path.join(repoRoot, "tools/comic_panel_splitter.py"), imagePath, "--output-dir", outputDir],
    { encoding: "utf8" },
  );

  assert.equal(filtered.status, 0, filtered.stderr);
  const manifest = JSON.parse(readFileSync(path.join(outputDir, "manifest.json"), "utf8"));
  assert.equal(manifest.panels.length, 3);
  assert.equal(manifest.post_filter.raw_count, 5);
  assert.equal(manifest.post_filter.filtered_count, 3);
  assert.deepEqual(
    manifest.post_filter.removed.map((item) => item.reason).sort(),
    ["narrow_text_or_caption_sliver", "text_or_caption_strip"],
  );

  const unfilteredOutputDir = path.join(workdir, "panels-unfiltered");
  const unfiltered = spawnSync(
    "python3",
    [
      path.join(repoRoot, "tools/comic_panel_splitter.py"),
      imagePath,
      "--output-dir",
      unfilteredOutputDir,
      "--keep-text-strips",
    ],
    { encoding: "utf8" },
  );

  assert.equal(unfiltered.status, 0, unfiltered.stderr);
  const unfilteredManifest = JSON.parse(
    readFileSync(path.join(unfilteredOutputDir, "manifest.json"), "utf8"),
  );
  assert.equal(unfilteredManifest.panels.length, 5);
});

test("comic panel splitter default profile filter drops the left reference card", () => {
  const workdir = mkdtempSync(path.join(tmpdir(), "comic-panel-splitter-profile-"));
  const imagePath = path.join(workdir, "profile_fixture.png");
  const outputDir = path.join(workdir, "panels");
  writePanelSplitterProfileCardFixture(imagePath);

  const filtered = spawnSync(
    "python3",
    [path.join(repoRoot, "tools/comic_panel_splitter.py"), imagePath, "--output-dir", outputDir],
    { encoding: "utf8" },
  );

  assert.equal(filtered.status, 0, filtered.stderr);
  const manifest = JSON.parse(readFileSync(path.join(outputDir, "manifest.json"), "utf8"));
  assert.equal(manifest.panels.length, 3);
  assert.equal(manifest.profile_filter.removed_count, 1);
  assert.equal(manifest.profile_filter.kept_right_candidate_count, 3);

  const unfilteredOutputDir = path.join(workdir, "panels-unfiltered");
  const unfiltered = spawnSync(
    "python3",
    [
      path.join(repoRoot, "tools/comic_panel_splitter.py"),
      imagePath,
      "--output-dir",
      unfilteredOutputDir,
      "--keep-profile-card",
    ],
    { encoding: "utf8" },
  );

  assert.equal(unfiltered.status, 0, unfiltered.stderr);
  const unfilteredManifest = JSON.parse(
    readFileSync(path.join(unfilteredOutputDir, "manifest.json"), "utf8"),
  );
  assert.equal(unfilteredManifest.panels.length, 4);
});

test("pre-cropped control-page panel PNG runtime inputs stay one full-page panel", () => {
  const workdir = mkdtempSync(path.join(tmpdir(), "motion-comic-pre-cropped-panel-png-"));
  const pagesDir = path.join(workdir, "input/pages");
  mkdirSync(pagesDir, { recursive: true });
  const inputPage = path.join(pagesDir, "page_001.png");
  writePng(inputPage, 180, 120);

  const manifestDir = path.join(
    workdir,
    "project_output/control-page-runs/demo-run/04_panel_crops",
  );
  mkdirSync(manifestDir, { recursive: true });
  writeFileSync(
    path.join(manifestDir, "panel_crop_manifest.json"),
    `${JSON.stringify(
      {
        version: 1,
        crop_method: "tools_comic_panel_splitter_v1",
        runtime_input_pages: ["input/pages/page_001.png"],
        crops: [
          {
            panel_id: "page_001_panel_001",
            file: "04_panel_crops/panels/page_001_panel_001.png",
            runtime_input: "input/pages/page_001.png",
            runtime_input_sha256: sha256File(inputPage),
          },
        ],
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    path.join(manifestDir, "crop_review_status.json"),
    `${JSON.stringify({ version: 1, status: "approved", crop_method: "tools_comic_panel_splitter_v1" }, null, 2)}\n`,
  );

  const build = run("node", [path.join(repoRoot, "scripts/generate-project.mjs")], workdir);
  assert.equal(build.status, 0, build.stderr);

  const panelPack = JSON.parse(readFileSync(path.join(workdir, "project_output/panels/panel_pack.json"), "utf8"));
  assert.equal(panelPack.panels.length, 1);
  const [panel] = panelPack.panels;
  assert.equal(panel.detection_method, "pre_cropped_control_page_panel_v1");
  assert.deepEqual(panel.bbox_px, { x: 0, y: 0, width: 180, height: 120 });
  assert.deepEqual(panel.bbox_pct, { x: 0, y: 0, width: 1, height: 1 });
  assert.deepEqual(panel.review_flags, []);
  assert.equal(panel.needs_manual_review, false);
});

test("9:16 vertical story page runtime inputs stay one full-page panel", () => {
  const workdir = mkdtempSync(path.join(tmpdir(), "motion-comic-vertical-story-page-"));
  const pagesDir = path.join(workdir, "input/pages");
  mkdirSync(pagesDir, { recursive: true });
  writePng(path.join(pagesDir, "page_001.png"), 90, 160);

  const build = run("node", [path.join(repoRoot, "scripts/generate-project.mjs")], workdir);
  assert.equal(build.status, 0, build.stderr);

  const panelPack = JSON.parse(readFileSync(path.join(workdir, "project_output/panels/panel_pack.json"), "utf8"));
  const plan = JSON.parse(readFileSync(path.join(workdir, "project_output/plans/motion_plan.json"), "utf8"));
  const runtimePlan = JSON.parse(readFileSync(path.join(workdir, "project_output/render/remotion/runtime_plan.json"), "utf8"));
  assert.deepEqual(plan.render, { width: 1080, height: 1920, fps: 24 });
  assert.deepEqual(runtimePlan.render, { width: 1080, height: 1920, fps: 24 });
  assert.equal(panelPack.panels.length, 1);
  const [panel] = panelPack.panels;
  assert.equal(panel.detection_method, "single_page_vertical_story_v1");
  assert.deepEqual(panel.bbox_px, { x: 0, y: 0, width: 90, height: 160 });
  assert.deepEqual(panel.bbox_pct, { x: 0, y: 0, width: 1, height: 1 });
  assert.deepEqual(panel.review_flags, []);
});

test("pre-cropped control-page runtime inputs require crop review approval before build", () => {
  const workdir = mkdtempSync(path.join(tmpdir(), "motion-comic-pending-crop-review-"));
  const pagesDir = path.join(workdir, "input/pages");
  mkdirSync(pagesDir, { recursive: true });
  const inputPage = path.join(pagesDir, "page_001.png");
  writePng(inputPage, 180, 120);

  const manifestDir = path.join(
    workdir,
    "project_output/control-page-runs/demo-run/04_panel_crops",
  );
  mkdirSync(manifestDir, { recursive: true });
  writeFileSync(
    path.join(manifestDir, "panel_crop_manifest.json"),
    `${JSON.stringify(
      {
        version: 1,
        crop_method: "tools_comic_panel_splitter_v1",
        runtime_input_pages: ["input/pages/page_001.png"],
        crops: [
          {
            panel_id: "page_001_panel_001",
            file: "04_panel_crops/panels/page_001_panel_001.png",
            runtime_input: "input/pages/page_001.png",
            runtime_input_sha256: sha256File(inputPage),
          },
        ],
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    path.join(manifestDir, "crop_review_status.json"),
    `${JSON.stringify({ version: 1, status: "pending", crop_method: "tools_comic_panel_splitter_v1" }, null, 2)}\n`,
  );

  const build = run("node", [path.join(repoRoot, "scripts/generate-project.mjs")], workdir);
  assert.notEqual(build.status, 0);
  assert.match(build.stderr, /not approved/);
});

test("stale control-page manifests do not force ordinary PNG pages into one panel", () => {
  const workdir = mkdtempSync(path.join(tmpdir(), "motion-comic-stale-control-page-manifest-"));
  const pagesDir = path.join(workdir, "input/pages");
  mkdirSync(pagesDir, { recursive: true });
  writePng(path.join(pagesDir, "page_001.png"), 180, 120);

  const manifestDir = path.join(
    workdir,
    "project_output/control-page-runs/old-run/04_panel_crops",
  );
  mkdirSync(manifestDir, { recursive: true });
  writeFileSync(
    path.join(manifestDir, "panel_crop_manifest.json"),
    `${JSON.stringify(
      {
        version: 1,
        runtime_input_pages: ["input/pages/page_001.png"],
        crops: [
          {
            panel_id: "old_panel_001",
            file: "04_panel_crops/panels/old_panel_001.png",
            runtime_input: "input/pages/page_001.png",
            runtime_input_sha256: "0".repeat(64),
          },
        ],
      },
      null,
      2,
    )}\n`,
  );

  const build = run("node", [path.join(repoRoot, "scripts/generate-project.mjs")], workdir);
  assert.equal(build.status, 0, build.stderr);

  const panelPack = JSON.parse(readFileSync(path.join(workdir, "project_output/panels/panel_pack.json"), "utf8"));
  assert.equal(panelPack.panels.length, 3);
  assert.ok(panelPack.panels.every((panel) => panel.detection_method === "deterministic_sample_grid_v1"));
});

test("manual panel pack override re-enters build with bbox and safe frame changes", () => {
  const workdir = mkdtempSync(path.join(tmpdir(), "motion-comic-panel-override-"));
  assert.equal(run("node", [path.join(repoRoot, "scripts/create-sample-input.mjs")], workdir).status, 0);
  assert.equal(run("node", [path.join(repoRoot, "scripts/generate-project.mjs")], workdir).status, 0);

  const panelPackPath = path.join(workdir, "project_output/panels/panel_pack.json");
  const panelPack = JSON.parse(readFileSync(panelPackPath, "utf8"));
  const target = panelPack.panels[0];
  const overrideBBox = { x: target.bbox_px.x + 10, y: target.bbox_px.y + 12, width: 180, height: 140 };
  const overrideSafeFrame = { x_pct: 0.2, y_pct: 0.15, width_pct: 0.6, height_pct: 0.7 };
  writeFileSync(
    path.join(workdir, "project_output/panels/panel_pack.manual.json"),
    `${JSON.stringify(
      {
        version: 1,
        panels: [
          {
            panel_id: target.panel_id,
            bbox_px: overrideBBox,
            reading_order: panelPack.panels.length,
            safe_frame: overrideSafeFrame,
          },
        ],
      },
      null,
      2,
    )}\n`,
  );

  const rebuild = run("node", [path.join(repoRoot, "scripts/generate-project.mjs")], workdir);
  assert.equal(rebuild.status, 0, rebuild.stderr);

  const rebuiltPack = JSON.parse(readFileSync(panelPackPath, "utf8"));
  const rebuiltPanel = rebuiltPack.panels.find((panel) => panel.panel_id === target.panel_id);
  assert.deepEqual(rebuiltPanel.bbox_px, overrideBBox);
  assert.equal(rebuiltPanel.reading_order, panelPack.panels.length);
  assert.deepEqual(rebuiltPanel.safe_frame, overrideSafeFrame);
  assert.ok(rebuiltPanel.review_flags.includes("manual_override"));

  const crop = PNG.sync.read(readFileSync(path.join(workdir, rebuiltPanel.crop_asset)));
  assert.equal(crop.width, overrideBBox.width);
  assert.equal(crop.height, overrideBBox.height);
});

test("panel ids remain unique when input pages share a basename across formats", () => {
  const workdir = mkdtempSync(path.join(tmpdir(), "motion-comic-duplicate-basename-"));
  const pagesDir = path.join(workdir, "input/pages");
  mkdirSync(pagesDir, { recursive: true });
  writeMinimalJpeg(path.join(pagesDir, "page_001.jpg"));
  writePng(path.join(pagesDir, "page_001.png"));

  const build = run("node", [path.join(repoRoot, "scripts/generate-project.mjs")], workdir);
  assert.equal(build.status, 0, build.stderr);

  const panelPack = JSON.parse(readFileSync(path.join(workdir, "project_output/panels/panel_pack.json"), "utf8"));
  assert.equal(new Set(panelPack.pages.map((page) => page.page_id)).size, panelPack.pages.length);
  assert.equal(new Set(panelPack.panels.map((panel) => panel.panel_id)).size, panelPack.panels.length);
  assert.ok(panelPack.pages.some((page) => page.page_id === "p001_page_001_jpg"));
  assert.ok(panelPack.pages.some((page) => page.page_id === "p002_page_001_png"));
});

test("manual bbox override is ignored and flagged for non-PNG fallback panels", () => {
  const workdir = mkdtempSync(path.join(tmpdir(), "motion-comic-non-png-override-"));
  const pagesDir = path.join(workdir, "input/pages");
  mkdirSync(pagesDir, { recursive: true });
  writeMinimalJpeg(path.join(pagesDir, "page_001.jpg"), 160, 90);
  writeMinimalWebp(path.join(pagesDir, "page_002.webp"), 200, 120);

  assert.equal(run("node", [path.join(repoRoot, "scripts/generate-project.mjs")], workdir).status, 0);
  let panelPack = JSON.parse(readFileSync(path.join(workdir, "project_output/panels/panel_pack.json"), "utf8"));
  const targets = panelPack.panels;
  writeFileSync(
    path.join(workdir, "project_output/panels/panel_pack.manual.json"),
    `${JSON.stringify(
      {
        version: 1,
        panels: targets.map((target) => ({
          panel_id: target.panel_id,
          bbox_px: { x: 12, y: 10, width: 44, height: 30 },
          safe_frame: { x_pct: 0.1, y_pct: 0.1, width_pct: 0.8, height_pct: 0.8 },
        })),
      },
      null,
      2,
    )}\n`,
  );

  const rebuild = run("node", [path.join(repoRoot, "scripts/generate-project.mjs")], workdir);
  assert.equal(rebuild.status, 0, rebuild.stderr);

  panelPack = JSON.parse(readFileSync(path.join(workdir, "project_output/panels/panel_pack.json"), "utf8"));
  for (const rebuiltPanel of panelPack.panels) {
    const page = panelPack.pages.find((entry) => entry.page_id === rebuiltPanel.page_id);
    assert.deepEqual(rebuiltPanel.bbox_px, { x: 0, y: 0, width: page.width, height: page.height });
    assert.deepEqual(rebuiltPanel.bbox_pct, { x: 0, y: 0, width: 1, height: 1 });
    assert.ok(rebuiltPanel.review_flags.includes("non_png_crop_unsupported"));
  }
});

test("manual safe frame normalization keeps frame extents inside panel bounds", () => {
  const workdir = mkdtempSync(path.join(tmpdir(), "motion-comic-safe-frame-"));
  assert.equal(run("node", [path.join(repoRoot, "scripts/create-sample-input.mjs")], workdir).status, 0);
  assert.equal(run("node", [path.join(repoRoot, "scripts/generate-project.mjs")], workdir).status, 0);

  const panelPackPath = path.join(workdir, "project_output/panels/panel_pack.json");
  const panelPack = JSON.parse(readFileSync(panelPackPath, "utf8"));
  const target = panelPack.panels[0];
  writeFileSync(
    path.join(workdir, "project_output/panels/panel_pack.manual.json"),
    `${JSON.stringify(
      {
        version: 1,
        panels: [
          {
            panel_id: target.panel_id,
            safe_frame: { x_pct: 0.82, y_pct: 0.91, width_pct: 0.6, height_pct: 0.4 },
          },
        ],
      },
      null,
      2,
    )}\n`,
  );

  const rebuild = run("node", [path.join(repoRoot, "scripts/generate-project.mjs")], workdir);
  assert.equal(rebuild.status, 0, rebuild.stderr);

  const rebuiltPack = JSON.parse(readFileSync(panelPackPath, "utf8"));
  const rebuiltPanel = rebuiltPack.panels.find((panel) => panel.panel_id === target.panel_id);
  assert.ok(rebuiltPanel.safe_frame.x_pct + rebuiltPanel.safe_frame.width_pct <= 1);
  assert.ok(rebuiltPanel.safe_frame.y_pct + rebuiltPanel.safe_frame.height_pct <= 1);
  assert.equal(rebuiltPanel.safe_frame.width_pct, 0.18);
  assert.equal(rebuiltPanel.safe_frame.height_pct, 0.09);
});

test("asset verification rejects missing source image references", () => {
  const workdir = mkdtempSync(path.join(tmpdir(), "motion-comic-missing-"));
  assert.equal(run("node", [path.join(repoRoot, "scripts/create-sample-input.mjs")], workdir).status, 0);
  assert.equal(run("node", [path.join(repoRoot, "scripts/generate-project.mjs")], workdir).status, 0);

  const planPath = path.join(workdir, "project_output/plans/motion_plan.json");
  const plan = JSON.parse(readFileSync(planPath, "utf8"));
  plan.shots[0].source_image = "input/pages/does_not_exist.png";
  writeFileSync(planPath, JSON.stringify(plan, null, 2));

  const result = run("node", [path.join(repoRoot, "scripts/verify-assets.mjs")], workdir);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Missing source image/);
});

test("asset verification rejects shots that reference an unknown panel", () => {
  const workdir = mkdtempSync(path.join(tmpdir(), "motion-comic-invalid-panel-"));
  assert.equal(run("node", [path.join(repoRoot, "scripts/create-sample-input.mjs")], workdir).status, 0);
  assert.equal(run("node", [path.join(repoRoot, "scripts/generate-project.mjs")], workdir).status, 0);

  const planPath = path.join(workdir, "project_output/plans/motion_plan.json");
  const plan = JSON.parse(readFileSync(planPath, "utf8"));
  plan.shots[0].panel_id = "missing_panel";
  writeFileSync(planPath, JSON.stringify(plan, null, 2));

  const result = run("node", [path.join(repoRoot, "scripts/verify-assets.mjs")], workdir);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unknown panel_id/);
});

test("asset verification rejects source images that exist but do not match the referenced panel crop", () => {
  const workdir = mkdtempSync(path.join(tmpdir(), "motion-comic-source-mismatch-"));
  assert.equal(run("node", [path.join(repoRoot, "scripts/create-sample-input.mjs")], workdir).status, 0);
  assert.equal(run("node", [path.join(repoRoot, "scripts/generate-project.mjs")], workdir).status, 0);

  const planPath = path.join(workdir, "project_output/plans/motion_plan.json");
  const plan = JSON.parse(readFileSync(planPath, "utf8"));
  plan.shots[0].source_image = plan.panels.find((panel) => panel.panel_id !== plan.shots[0].panel_id).crop_asset;
  writeFileSync(planPath, JSON.stringify(plan, null, 2));

  const result = run("node", [path.join(repoRoot, "scripts/verify-assets.mjs")], workdir);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /source_image must match panel crop/);
});

test("asset verification rejects missing layer files declared in manifest", () => {
  const workdir = mkdtempSync(path.join(tmpdir(), "motion-comic-missing-layer-"));
  assert.equal(run("node", [path.join(repoRoot, "scripts/create-sample-input.mjs")], workdir).status, 0);
  assert.equal(run("node", [path.join(repoRoot, "scripts/generate-project.mjs")], workdir).status, 0);

  unlinkSync(path.join(workdir, "project_output/assets/shot_001/source.png"));

  const result = run("node", [path.join(repoRoot, "scripts/verify-assets.mjs")], workdir);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Missing layer source/);
});

test("qa script writes actionable reports from a built sample", () => {
  const workdir = mkdtempSync(path.join(tmpdir(), "motion-comic-qa-"));
  assert.equal(run("node", [path.join(repoRoot, "scripts/create-sample-input.mjs")], workdir).status, 0);
  assert.equal(run("node", [path.join(repoRoot, "scripts/generate-project.mjs")], workdir).status, 0);

  const result = run("node", [path.join(repoRoot, "scripts/qa.mjs"), "--skip-video"], workdir);
  assert.equal(result.status, 0, result.stderr);
  const qa = readFileSync(path.join(workdir, "project_output/reports/qa_report.md"), "utf8");
  const review = readFileSync(path.join(workdir, "project_output/reports/review_sheet.md"), "utf8");
  assert.match(qa, /critical issues: 0/);
  assert.match(review, /人工复核表/);
  assert.match(review, /当前效果评级/);
  assert.match(review, /推荐修正动作/);
  assert.match(review, /Panel ID/);
  assert.match(review, /Reading Order/);
  assert.match(review, /Primitive/);
  assert.match(review, /Safe Frame/);
  assert.match(review, /QA Severity/);
  assert.match(review, /审查入口/);
});

test("qa panel pack gate fails on invalid panel geometry", () => {
  const workdir = mkdtempSync(path.join(tmpdir(), "motion-comic-qa-pack-fail-"));
  assert.equal(run("node", [path.join(repoRoot, "scripts/create-sample-input.mjs")], workdir).status, 0);
  assert.equal(run("node", [path.join(repoRoot, "scripts/generate-project.mjs")], workdir).status, 0);

  const panelPackPath = path.join(workdir, "project_output/panels/panel_pack.json");
  const panelPack = JSON.parse(readFileSync(panelPackPath, "utf8"));
  panelPack.panels[0].bbox_px.x = panelPack.pages[0].width + 10;
  writeFileSync(panelPackPath, JSON.stringify(panelPack, null, 2));

  const result = run("node", [path.join(repoRoot, "scripts/qa.mjs"), "--skip-video"], workdir);
  assert.notEqual(result.status, 0);
  const failures = readFileSync(path.join(workdir, "project_output/reports/failures.md"), "utf8");
  assert.match(failures, /bbox_px is outside page bounds/);
});

test("qa reading order gate reports duplicate order as warning with manual correction", () => {
  const workdir = mkdtempSync(path.join(tmpdir(), "motion-comic-reading-order-"));
  assert.equal(run("node", [path.join(repoRoot, "scripts/create-sample-input.mjs")], workdir).status, 0);
  assert.equal(run("node", [path.join(repoRoot, "scripts/generate-project.mjs")], workdir).status, 0);

  const panelPackPath = path.join(workdir, "project_output/panels/panel_pack.json");
  const panelPack = JSON.parse(readFileSync(panelPackPath, "utf8"));
  panelPack.panels[1].reading_order = panelPack.panels[0].reading_order;
  writeFileSync(panelPackPath, JSON.stringify(panelPack, null, 2));

  const result = run("node", [path.join(repoRoot, "scripts/qa.mjs"), "--skip-video"], workdir);
  assert.equal(result.status, 0, result.stderr);
  const qa = readFileSync(path.join(workdir, "project_output/reports/qa_report.md"), "utf8");
  assert.match(qa, /Duplicate reading_order/);
  assert.match(qa, /panel_pack\.manual\.json panels\[\]\.reading_order/);
  assert.match(qa, /Correction Suggestions/);
});

test("qa motion primitive gate fails on unsafe primitive parameters", () => {
  const workdir = mkdtempSync(path.join(tmpdir(), "motion-comic-primitive-fail-"));
  assert.equal(run("node", [path.join(repoRoot, "scripts/create-sample-input.mjs")], workdir).status, 0);
  assert.equal(run("node", [path.join(repoRoot, "scripts/generate-project.mjs")], workdir).status, 0);

  const planPath = path.join(workdir, "project_output/plans/motion_plan.json");
  const plan = JSON.parse(readFileSync(planPath, "utf8"));
  plan.shots[0].primitive = "warp_face";
  plan.shots[0].duration_sec = 99;
  plan.shots[0].camera_motion = {
    type: "warp_face",
    start_scale: 0.2,
    end_scale: 2.4,
    start_position: { x: 0, y: 0 },
    end_position: { x: 999, y: -999 },
    easing: "teleport",
  };
  writeFileSync(planPath, JSON.stringify(plan, null, 2));

  const result = run("node", [path.join(repoRoot, "scripts/qa.mjs"), "--skip-video"], workdir);
  assert.notEqual(result.status, 0);
  const failures = readFileSync(path.join(workdir, "project_output/reports/failures.md"), "utf8");
  assert.match(failures, /unsupported primitive/);
  assert.match(failures, /duration_sec is outside safe bounds/);
  assert.match(failures, /camera_motion\.end_scale is outside safe bounds/);
});

test("qa motion primitive gate allows real narration-timed shot durations", () => {
  const workdir = mkdtempSync(path.join(tmpdir(), "motion-comic-audio-duration-"));
  assert.equal(run("node", [path.join(repoRoot, "scripts/create-sample-input.mjs")], workdir).status, 0);
  assert.equal(run("node", [path.join(repoRoot, "scripts/generate-project.mjs")], workdir).status, 0);

  const planPath = path.join(workdir, "project_output/plans/motion_plan.json");
  const plan = JSON.parse(readFileSync(planPath, "utf8"));
  plan.shots[0].duration_sec = 12;
  plan.shots[0].duration_frames = 288;
  plan.audio = {
    tracks: [{ type: "narration", source: "project_output/control-page-runs/demo/05_video/audio/master.mp3" }],
    narration: {
      source: "project_output/control-page-runs/demo/05_video/audio/master.mp3",
      timeline: "project_output/control-page-runs/demo/05_video/audio/voice_timeline.json",
      duration_ms: 12000,
    },
  };
  writeFileSync(planPath, JSON.stringify(plan, null, 2));

  const result = run("node", [path.join(repoRoot, "scripts/qa.mjs"), "--skip-video"], workdir);
  assert.equal(result.status, 0, result.stderr);
  const qa = readFileSync(path.join(workdir, "project_output/reports/qa_report.md"), "utf8");
  assert.match(qa, /critical issues: 0/);
});

test("qa report includes manual review items and correction suggestions", () => {
  const workdir = mkdtempSync(path.join(tmpdir(), "motion-comic-manual-review-"));
  const pagesDir = path.join(workdir, "input/pages");
  mkdirSync(pagesDir, { recursive: true });
  writeMinimalJpeg(path.join(pagesDir, "page_001.jpg"));

  assert.equal(run("node", [path.join(repoRoot, "scripts/generate-project.mjs")], workdir).status, 0);

  const result = run("node", [path.join(repoRoot, "scripts/qa.mjs"), "--skip-video"], workdir);
  assert.equal(result.status, 0, result.stderr);
  const qa = readFileSync(path.join(workdir, "project_output/reports/qa_report.md"), "utf8");
  assert.match(qa, /Manual Review Items/);
  assert.match(qa, /manual_panel_crop_required/);
  assert.match(qa, /project_output\/panels\/panel_pack\.manual\.json/);
});

test("asset verification rejects panel_pack drift from motion plan panels", () => {
  const workdir = mkdtempSync(path.join(tmpdir(), "motion-comic-pack-drift-"));
  assert.equal(run("node", [path.join(repoRoot, "scripts/create-sample-input.mjs")], workdir).status, 0);
  assert.equal(run("node", [path.join(repoRoot, "scripts/generate-project.mjs")], workdir).status, 0);

  const panelPackPath = path.join(workdir, "project_output/panels/panel_pack.json");
  const panelPack = JSON.parse(readFileSync(panelPackPath, "utf8"));
  panelPack.panels.pop();
  writeFileSync(panelPackPath, JSON.stringify(panelPack, null, 2));

  const result = run("node", [path.join(repoRoot, "scripts/verify-assets.mjs")], workdir);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /panel_pack drift/);
});

test("asset verification rejects same-id panel_pack content drift", () => {
  const workdir = mkdtempSync(path.join(tmpdir(), "motion-comic-pack-content-drift-"));
  assert.equal(run("node", [path.join(repoRoot, "scripts/create-sample-input.mjs")], workdir).status, 0);
  assert.equal(run("node", [path.join(repoRoot, "scripts/generate-project.mjs")], workdir).status, 0);

  const panelPackPath = path.join(workdir, "project_output/panels/panel_pack.json");
  const panelPack = JSON.parse(readFileSync(panelPackPath, "utf8"));
  panelPack.panels[0].crop_asset = panelPack.panels[1].crop_asset;
  panelPack.panels[0].bbox_px = { ...panelPack.panels[0].bbox_px, x: panelPack.panels[0].bbox_px.x + 1 };
  writeFileSync(panelPackPath, JSON.stringify(panelPack, null, 2));

  const result = run("node", [path.join(repoRoot, "scripts/verify-assets.mjs")], workdir);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /panel_pack drift/);
});

test("qa runtime metadata gate fails on primitive drift", () => {
  const workdir = mkdtempSync(path.join(tmpdir(), "motion-comic-runtime-primitive-drift-"));
  assert.equal(run("node", [path.join(repoRoot, "scripts/create-sample-input.mjs")], workdir).status, 0);
  assert.equal(run("node", [path.join(repoRoot, "scripts/generate-project.mjs")], workdir).status, 0);

  const runtimePlanPath = path.join(workdir, "project_output/render/remotion/runtime_plan.json");
  const runtimePlan = JSON.parse(readFileSync(runtimePlanPath, "utf8"));
  runtimePlan.shots[0].primitive = runtimePlan.shots[0].primitive === "hold" ? "camera_push" : "hold";
  writeFileSync(runtimePlanPath, JSON.stringify(runtimePlan, null, 2));

  const result = run("node", [path.join(repoRoot, "scripts/qa.mjs"), "--skip-video"], workdir);
  assert.notEqual(result.status, 0);
  const failures = readFileSync(path.join(workdir, "project_output/reports/failures.md"), "utf8");
  assert.match(failures, /runtime.*primitive.*drift/i);
});

test("qa runtime metadata gate fails on source image drift", () => {
  const workdir = mkdtempSync(path.join(tmpdir(), "motion-comic-runtime-source-drift-"));
  assert.equal(run("node", [path.join(repoRoot, "scripts/create-sample-input.mjs")], workdir).status, 0);
  assert.equal(run("node", [path.join(repoRoot, "scripts/generate-project.mjs")], workdir).status, 0);

  const plan = JSON.parse(readFileSync(path.join(workdir, "project_output/plans/motion_plan.json"), "utf8"));
  const runtimePlanPath = path.join(workdir, "project_output/render/remotion/runtime_plan.json");
  const runtimePlan = JSON.parse(readFileSync(runtimePlanPath, "utf8"));
  runtimePlan.shots[0].source_image = plan.panels.find((panel) => panel.panel_id !== runtimePlan.shots[0].panel_id).crop_asset;
  writeFileSync(runtimePlanPath, JSON.stringify(runtimePlan, null, 2));

  const result = run("node", [path.join(repoRoot, "scripts/qa.mjs"), "--skip-video"], workdir);
  assert.notEqual(result.status, 0);
  const failures = readFileSync(path.join(workdir, "project_output/reports/failures.md"), "utf8");
  assert.match(failures, /runtime.*source_image.*drift/i);
});

test("Remotion project includes runtime plan and renderer entrypoints", () => {
  assert.ok(existsSync(path.join(repoRoot, "render/remotion/src/Root.tsx")));
  assert.ok(existsSync(path.join(repoRoot, "render/remotion/src/MotionComic.tsx")));
  assert.ok(existsSync(path.join(repoRoot, "render/remotion/package.json")));
});

test("Remotion renderer keeps composition props lightweight", () => {
  const rootSource = readFileSync(path.join(repoRoot, "render/remotion/src/Root.tsx"), "utf8");
  const motionComicSource = readFileSync(path.join(repoRoot, "render/remotion/src/MotionComic.tsx"), "utf8");
  const previewSource = readFileSync(path.join(repoRoot, "render/remotion/scripts/render-preview.mjs"), "utf8");

  assert.doesNotMatch(rootSource, /defaultProps=\{\{\s*plan\b/);
  assert.doesNotMatch(rootSource, /defaultProps=\{\{[^}]*\bplan\b/);
  assert.match(rootSource, /defaultProps=\{\{\s*shotId:\s*shot\.shot_id\s*\}\}/);
  assert.match(motionComicSource, /\bstaticFile\(/);
  assert.match(motionComicSource, /\bAudio\b/);
  assert.match(motionComicSource, /narrationAudioSource/);
  assert.match(previewSource, /resolved_audio/);
  assert.match(previewSource, /publicDir:\s*publicRoot/);
  assert.match(previewSource, /videoOutputPaths\(plan\)/);
  assert.doesNotMatch(previewSource, /project_output\/output\/previews/);
  assert.doesNotMatch(previewSource, /project_output\/output\/final/);
  assert.doesNotMatch(previewSource, /toString\(["']base64["']\)/);
  assert.doesNotMatch(previewSource, /data:\$\{[^}]+};base64,/);
  assert.doesNotMatch(previewSource, /\bimageDataUrl\b/);
});

test("audio timeline applier updates motion and runtime durations", () => {
  const workdir = mkdtempSync(path.join(tmpdir(), "motion-comic-audio-timeline-"));
  const runFolder = path.join(workdir, "project_output/control-page-runs/test-run");
  mkdirSync(path.join(workdir, "project_output/plans"), { recursive: true });
  mkdirSync(path.join(workdir, "project_output/render/remotion"), { recursive: true });
  mkdirSync(path.join(runFolder, "05_video/audio"), { recursive: true });

  writeFileSync(path.join(runFolder, "05_video/audio/master.mp3"), "fake-audio");
  writeFileSync(
    path.join(runFolder, "05_video/audio/voice_timeline.json"),
    JSON.stringify(
      {
        version: 1,
        provider: "doubao-volcengine",
        resource_id: "seed-tts-2.0",
        voice: "voice-test",
        speech_rate: 20,
        sample_rate: 24000,
        audio: "05_video/audio/master.mp3",
        totalMs: 3000,
        segments: [
          { segment_id: "seg_001", panel_id: "panel_a", text: "一", audio: "05_video/audio/segments/seg_001.mp3", durationMs: 1250, startMs: 0, endMs: 1250 },
          { segment_id: "seg_002", panel_id: "panel_b", text: "二", audio: "05_video/audio/segments/seg_002.mp3", durationMs: 1750, startMs: 1250, endMs: 3000 },
        ],
      },
      null,
      2,
    ),
  );

  const plan = {
    version: 2,
    render: { width: 1920, height: 1080, fps: 24 },
    audio: { tracks: [], narration: null },
    shots: [
      { shot_id: "shot_001", panel_id: "panel_a", duration_sec: 4, duration_frames: 96 },
      { shot_id: "shot_002", panel_id: "panel_b", duration_sec: 4, duration_frames: 96 },
    ],
  };
  writeFileSync(path.join(workdir, "project_output/plans/motion_plan.json"), JSON.stringify(plan, null, 2));
  writeFileSync(
    path.join(workdir, "project_output/render/remotion/runtime_plan.json"),
    JSON.stringify({ version: 2, shots: plan.shots }, null, 2),
  );

  const result = run("node", [path.join(repoRoot, "scripts/apply-audio-timeline.mjs"), runFolder, "--project-root", workdir], workdir);
  assert.equal(result.status, 0, result.stderr);

  const updatedPlan = JSON.parse(readFileSync(path.join(workdir, "project_output/plans/motion_plan.json"), "utf8"));
  assert.deepEqual(updatedPlan.shots.map((shot) => shot.duration_frames), [30, 42]);
  assert.deepEqual(updatedPlan.shots.map((shot) => shot.duration_sec), [1.25, 1.75]);
  assert.equal(updatedPlan.audio.narration.source, "project_output/control-page-runs/test-run/05_video/audio/master.mp3");
  assert.equal(updatedPlan.audio.narration.timeline, "project_output/control-page-runs/test-run/05_video/audio/voice_timeline.json");
  assert.deepEqual(updatedPlan.video_output, {
    root: "project_output/control-page-runs/test-run/05_video",
    previews_dir: "project_output/control-page-runs/test-run/05_video/previews",
    final: "project_output/control-page-runs/test-run/05_video/motion_comic_preview.mp4",
  });
  assert.equal(previewVideoPath(updatedPlan.shots[0], updatedPlan), "project_output/control-page-runs/test-run/05_video/previews/shot_001.mp4");
  assert.equal(finalVideoPath(updatedPlan), "project_output/control-page-runs/test-run/05_video/motion_comic_preview.mp4");
  assert.deepEqual(videoTargets(updatedPlan).map((target) => target.relativePath), [
    "project_output/control-page-runs/test-run/05_video/previews/shot_001.mp4",
    "project_output/control-page-runs/test-run/05_video/previews/shot_002.mp4",
    "project_output/control-page-runs/test-run/05_video/motion_comic_preview.mp4",
  ]);

  const updatedRuntime = JSON.parse(
    readFileSync(path.join(workdir, "project_output/render/remotion/runtime_plan.json"), "utf8"),
  );
  assert.deepEqual(updatedRuntime.shots.map((shot) => shot.duration_frames), [30, 42]);
  assert.equal(updatedRuntime.audio.narration.source, updatedPlan.audio.narration.source);
  assert.deepEqual(updatedRuntime.video_output, updatedPlan.video_output);
  assert.ok(existsSync(path.join(runFolder, "01_script/narration_timestamps.json")));
});

test("audio timeline applier maps control-page crop panel ids to motion panel ids", () => {
  const workdir = mkdtempSync(path.join(tmpdir(), "motion-comic-audio-control-page-map-"));
  const runFolder = path.join(workdir, "project_output/control-page-runs/test-run");
  mkdirSync(path.join(workdir, "project_output/plans"), { recursive: true });
  mkdirSync(path.join(workdir, "project_output/render/remotion"), { recursive: true });
  mkdirSync(path.join(runFolder, "04_panel_crops"), { recursive: true });
  mkdirSync(path.join(runFolder, "05_video/audio"), { recursive: true });

  writeFileSync(path.join(runFolder, "05_video/audio/master.mp3"), "fake-audio");
  writeFileSync(
    path.join(runFolder, "04_panel_crops/panel_crop_manifest.json"),
    JSON.stringify(
      {
        version: 1,
        crop_method: "tools_comic_panel_splitter_v1",
        crop_count: 2,
        crops: [
          {
            panel_id: "page_001_panel_001",
            runtime_input: "input/pages/page_001.png",
            file: "04_panel_crops/panels/page_001_panel_001.png",
          },
          {
            panel_id: "page_001_panel_002",
            runtime_input: "input/pages/page_002.png",
            file: "04_panel_crops/panels/page_001_panel_002.png",
          },
        ],
      },
      null,
      2,
    ),
  );
  writeFileSync(
    path.join(runFolder, "04_panel_crops/crop_review_status.json"),
    JSON.stringify({ version: 1, status: "approved", crop_method: "tools_comic_panel_splitter_v1" }, null, 2),
  );
  writeFileSync(
    path.join(runFolder, "05_video/audio/voice_timeline.json"),
    JSON.stringify(
      {
        version: 1,
        provider: "doubao-volcengine",
        audio: "05_video/audio/master.mp3",
        totalMs: 3000,
        segments: [
          { segment_id: "seg_001", panel_id: "page_001_panel_001", text: "一", audio: "05_video/audio/segments/seg_001.mp3", durationMs: 1250, startMs: 0, endMs: 1250 },
          { segment_id: "seg_002", panel_id: "page_001_panel_002", text: "二", audio: "05_video/audio/segments/seg_002.mp3", durationMs: 1750, startMs: 1250, endMs: 3000 },
        ],
      },
      null,
      2,
    ),
  );

  const plan = {
    version: 2,
    render: { width: 1920, height: 1080, fps: 24 },
    audio: { tracks: [], narration: null },
    shots: [
      { shot_id: "shot_001", panel_id: "p001_page_001_png_panel_001", source_image: "project_output/panels/crops/p001_page_001_png_panel_001.png", duration_sec: 4, duration_frames: 96 },
      { shot_id: "shot_002", panel_id: "p002_page_002_png_panel_001", source_image: "project_output/panels/crops/p002_page_002_png_panel_001.png", duration_sec: 4, duration_frames: 96 },
    ],
  };
  writeFileSync(path.join(workdir, "project_output/plans/motion_plan.json"), JSON.stringify(plan, null, 2));
  writeFileSync(
    path.join(workdir, "project_output/render/remotion/runtime_plan.json"),
    JSON.stringify({ version: 2, shots: plan.shots }, null, 2),
  );

  const result = run("node", [path.join(repoRoot, "scripts/apply-audio-timeline.mjs"), runFolder, "--project-root", workdir], workdir);
  assert.equal(result.status, 0, result.stderr);

  const alignedTimeline = JSON.parse(readFileSync(path.join(runFolder, "05_video/audio/voice_timeline.json"), "utf8"));
  assert.deepEqual(alignedTimeline.segments.map((segment) => segment.panel_id), [
    "p001_page_001_png_panel_001",
    "p002_page_002_png_panel_001",
  ]);
  assert.deepEqual(alignedTimeline.segments.map((segment) => segment.source_panel_id), [
    "page_001_panel_001",
    "page_001_panel_002",
  ]);
  assert.ok(existsSync(path.join(runFolder, "05_video/audio/voice_timeline_control_panel_ids.json")));
  const mapping = JSON.parse(readFileSync(path.join(runFolder, "05_video/audio/motion_panel_id_alignment.json"), "utf8"));
  assert.deepEqual(mapping.mappings.map((item) => item.motion_shot_id), ["shot_001", "shot_002"]);
  const timestamps = JSON.parse(readFileSync(path.join(runFolder, "01_script/narration_timestamps.json"), "utf8"));
  assert.equal(timestamps.segments[0].source_panel_id, "page_001_panel_001");
  assert.equal(timestamps.segments[0].panel_id, "p001_page_001_png_panel_001");
});

test("preview composer dry-run validates shot previews against voice timeline", () => {
  const workdir = mkdtempSync(path.join(tmpdir(), "motion-comic-preview-compose-"));
  const runFolder = path.join(workdir, "project_output/control-page-runs/test-run");
  mkdirSync(path.join(workdir, "project_output/plans"), { recursive: true });
  mkdirSync(path.join(runFolder, "05_video/audio"), { recursive: true });
  mkdirSync(path.join(runFolder, "05_video/previews"), { recursive: true });

  const plan = {
    version: 2,
    render: { width: 1920, height: 1080, fps: 24 },
    video_output: {
      root: "project_output/control-page-runs/test-run/05_video",
      previews_dir: "project_output/control-page-runs/test-run/05_video/previews",
      final: "project_output/control-page-runs/test-run/05_video/motion_comic_preview.mp4",
    },
    shots: [
      { shot_id: "shot_001", panel_id: "page_001_panel_001", duration_sec: 1, duration_frames: 24 },
      { shot_id: "shot_002", panel_id: "page_002_panel_001", duration_sec: 1, duration_frames: 24 },
    ],
  };
  writeFileSync(path.join(workdir, "project_output/plans/motion_plan.json"), `${JSON.stringify(plan, null, 2)}\n`);
  writeFileSync(path.join(runFolder, "05_video/audio/master.mp3"), "fake-audio");
  writeFileSync(
    path.join(runFolder, "05_video/audio/voice_timeline.json"),
    `${JSON.stringify(
      {
        version: 1,
        totalMs: 2000,
        segments: [
          { segment_id: "seg_001", durationMs: 1000, text: "第一段" },
          { segment_id: "seg_002", durationMs: 1000, text: "第二段" },
        ],
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(path.join(runFolder, "05_video/previews/shot_001.mp4"), "fake-video-1");
  writeFileSync(path.join(runFolder, "05_video/previews/shot_002.mp4"), "fake-video-2");

  const result = run(
    "node",
    [path.join(repoRoot, "scripts/compose-preview-video.mjs"), "project_output/control-page-runs/test-run", "--project-root", workdir, "--dry-run"],
    workdir,
  );
  assert.equal(result.status, 0, result.stderr);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.preview_count, 2);
  assert.equal(summary.voice_segments, 2);
  assert.equal(summary.output, "project_output/control-page-runs/test-run/05_video/motion_comic_preview.mp4");
  assert.ok(existsSync(path.join(runFolder, "05_video/previews/concat_list.txt")));
});

test("Remotion renderer consumes safe frames and avoids default cover cropping", () => {
  const source = readFileSync(path.join(repoRoot, "render/remotion/src/MotionComic.tsx"), "utf8");
  assert.match(source, /safe_frame\?:/);
  assert.match(source, /safeFrameForShot/);
  assert.doesNotMatch(source, /objectFit:\s*["']cover["']/);

  for (const primitive of [
    "hold",
    "camera_push",
    "camera_pan",
    "camera_zoom",
    "shake",
    "focus_reveal",
    "overlay_effect",
    "parallax_hint",
  ]) {
    assert.match(source, new RegExp(`case "${primitive}"|=== "${primitive}"`));
  }
});

function singlePanelPack() {
  return {
    version: 1,
    panel_pack_path: "project_output/panels/panel_pack.json",
    pages: [{ page_id: "page_001", source_image: "input/pages/page_001.png", width: 120, height: 80 }],
    panels: [
      {
        panel_id: "panel_001",
        page_id: "page_001",
        crop_asset: "project_output/panels/crops/panel_001.png",
        reading_order: 1,
        safe_frame: { x_pct: 0.1, y_pct: 0.1, width_pct: 0.8, height_pct: 0.8 },
        review_flags: [],
      },
    ],
    review_flags: [],
  };
}

function writeFakeCodexRunner(workdir, options = {}) {
  const runnerPath = path.join(workdir, "fake-codex.mjs");
  const mode = options.mode ?? "success";
  const fenced = Boolean(options.fenced);
  const primitive = options.primitive ?? "hold";
  writeFileSync(
    runnerPath,
    `#!/usr/bin/env node
import { writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const stdin = await new Promise((resolve) => {
  let text = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    text += chunk;
  });
  process.stdin.on("end", () => resolve(text));
});
const outputIndex = args.indexOf("--output-last-message");
const outputPath = outputIndex >= 0 ? args[outputIndex + 1] : null;
const imageCount = args.filter((arg) => arg === "--image" || arg === "-i").length;
writeFileSync(
  ${JSON.stringify(path.join(workdir, "fake-codex-run.json"))},
  JSON.stringify({ args, stdin, imageCount }, null, 2),
);

if (${JSON.stringify(mode)} === "fail") {
  console.error("fake codex failure");
  process.exit(42);
}

const panelIds = Array.from(
  new Set([...stdin.matchAll(/"panel_id"\\s*:\\s*"([^"]+)"/g)].map((match) => match[1]).filter((panelId) => panelId !== "string")),
);
const plan = {
  version: 1,
  kind: "analysis_plan",
  provider: "codex_cli:test-model",
  planning_input: "project_output/plans/planning_input.json",
  shots: panelIds.map((panelId, index) => ({
    panel_id: panelId,
    intent: "fake codex intent " + (index + 1),
    tempo: "steady",
    duration_seconds: 3,
    primitive_hints: [{ primitive: ${JSON.stringify(primitive)}, scale: 1.04, pan: { x: 12, y: 0 }, easing: "ease_in_out" }],
    review_flags: [],
    source_image: "must-not-survive.png"
  })),
};
const json = JSON.stringify(plan, null, 2);
if (outputPath) {
  writeFileSync(outputPath, ${fenced ? "`\\`\\`\\`json\\n${json}\\n\\`\\`\\`\\n`" : "json"});
} else {
  console.log(json);
}
`,
    { mode: 0o755 },
  );
  return runnerPath;
}

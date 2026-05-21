import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "..");
const alignScript = path.join(repoRoot, "scripts/build-forced-aligned-voice-timeline.mjs");

function run(command, args, cwd) {
  return spawnSync(command, args, {
    cwd,
    encoding: "utf8",
  });
}

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

test("forced alignment builds a standard voice_timeline from one complete narration audio", () => {
  const workdir = mkdtempSync(path.join(tmpdir(), "motion-comic-forced-align-"));
  const runFolder = path.join(workdir, "project_output/control-page-runs/test-run");
  mkdirSync(path.join(runFolder, "01_script"), { recursive: true });
  mkdirSync(path.join(runFolder, "05_video/audio"), { recursive: true });
  writeFileSync(path.join(runFolder, "05_video/audio/master.mp3"), "fake complete narration audio");

  writeJson(path.join(runFolder, "01_script/audio_segments.json"), {
    version: 1,
    segments: [
      {
        segment_id: "seg_001",
        page_id: "page_001",
        panel_id: "page_001_panel_001",
        text: "林照回到槐湾，是为二叔收箱。",
      },
      {
        segment_id: "seg_002",
        page_id: "page_001",
        panel_id: "page_001_panel_002",
        text: "老人临死前反复说：别揭井皮。",
      },
    ],
  });
  writeJson(path.join(runFolder, "05_video/audio/forced_alignment.json"), {
    engine: "test-aligner",
    segments: [
      { start: 0.5, end: 2.0, text: "林照回到槐湾，是为二叔收箱。" },
      { start: 2.5, end: 5.5, text: "老人临死前反复说：别揭井皮。" },
    ],
  });

  const result = run(
    "node",
    [alignScript, runFolder, "--project-root", workdir, "--duration-ms", "7000"],
    workdir,
  );
  assert.equal(result.status, 0, result.stderr);

  const timeline = JSON.parse(readFileSync(path.join(runFolder, "05_video/audio/voice_timeline.json"), "utf8"));
  assert.equal(timeline.provider, "forced-alignment");
  assert.equal(timeline.alignment_engine, "test-aligner");
  assert.equal(timeline.audio, "05_video/audio/master.mp3");
  assert.equal(timeline.totalMs, 7000);
  assert.deepEqual(
    timeline.segments.map((segment) => ({
      segment_id: segment.segment_id,
      startMs: segment.startMs,
      endMs: segment.endMs,
      durationMs: segment.durationMs,
      rawStart: segment.raw_alignment_start_ms,
      rawEnd: segment.raw_alignment_end_ms,
    })),
    [
      { segment_id: "seg_001", startMs: 0, endMs: 2500, durationMs: 2500, rawStart: 500, rawEnd: 2000 },
      { segment_id: "seg_002", startMs: 2500, endMs: 7000, durationMs: 4500, rawStart: 2500, rawEnd: 5500 },
    ],
  );

  const report = JSON.parse(readFileSync(path.join(runFolder, "05_video/audio/forced_alignment_report.json"), "utf8"));
  assert.equal(report.ok, true);
  assert.deepEqual(report.segments.map((segment) => segment.matched), [true, true]);
});

test("forced alignment fails with diagnostics when a beat cannot be matched", () => {
  const workdir = mkdtempSync(path.join(tmpdir(), "motion-comic-forced-align-fail-"));
  const runFolder = path.join(workdir, "project_output/control-page-runs/test-run");
  mkdirSync(path.join(runFolder, "01_script"), { recursive: true });
  mkdirSync(path.join(runFolder, "05_video/audio"), { recursive: true });
  writeFileSync(path.join(runFolder, "05_video/audio/master.mp3"), "fake complete narration audio");

  writeJson(path.join(runFolder, "01_script/audio_segments.json"), {
    segments: [{ segment_id: "seg_001", panel_id: "page_001_panel_001", text: "别揭井皮。" }],
  });
  writeJson(path.join(runFolder, "05_video/audio/forced_alignment.json"), {
    segments: [{ start: 0, end: 1, text: "完全不同的文本" }],
  });

  const result = run(
    "node",
    [alignScript, runFolder, "--project-root", workdir, "--duration-ms", "1000"],
    workdir,
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /does not contain segment seg_001/);
  assert.equal(existsSync(path.join(runFolder, "05_video/audio/voice_timeline.json")), false);

  const report = JSON.parse(readFileSync(path.join(runFolder, "05_video/audio/forced_alignment_report.json"), "utf8"));
  assert.equal(report.ok, false);
  assert.match(report.error, /does not contain segment seg_001/);
});

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "..");

test("upstream planner owns Phase 0 planning resources", () => {
  const plannerRoot = path.join(repoRoot, ".codex/skills/video-upstream-planner");
  assert.ok(existsSync(path.join(plannerRoot, "SKILL.md")));
  assert.ok(existsSync(path.join(plannerRoot, "scripts/validate-upstream-planning.mjs")));
  assert.ok(existsSync(path.join(plannerRoot, "references/vimax-upstream-planning.md")));
  assert.ok(existsSync(path.join(plannerRoot, "references/handoff-contracts.md")));
});

test("video skill consumes upstream plans without owning the full Phase 0 workflow", () => {
  const videoSkill = readFileSync(path.join(repoRoot, ".codex/skills/video-generation-template/SKILL.md"), "utf8");
  assert.match(videoSkill, /\$video-upstream-planner/);
  assert.doesNotMatch(videoSkill, /## Phase 0 - ViMax-style 前期策划包/);
});

test("generic video skills do not depend on removed theme packs", () => {
  const plannerSkill = readFileSync(path.join(repoRoot, ".codex/skills/video-upstream-planner/SKILL.md"), "utf8");
  const videoSkill = readFileSync(path.join(repoRoot, ".codex/skills/video-generation-template/SKILL.md"), "utf8");
  const combined = `${plannerSkill}\n${videoSkill}`;

  assert.doesNotMatch(
    combined,
    new RegExp([
      ["histo", "ry"].join(""),
      ["chinese", "cthulhu"].join("-"),
      ["topic", "pack"].join(" "),
      ["topic", "pack"].join("_"),
    ].join("|")),
  );
  assert.doesNotMatch(combined, new RegExp(["\\u4e2d\\u5f0f", "\\u514b\\u82cf\\u9c81", "\\u6c5f\\u6e56", "\\u91ce\\u53f2"].join("|")));
});

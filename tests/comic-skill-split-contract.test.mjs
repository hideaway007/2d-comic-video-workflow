import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "..");

test("upstream planner owns Phase 0 planning resources", () => {
  const plannerRoot = path.join(repoRoot, ".codex/skills/comic-upstream-planner");
  assert.ok(existsSync(path.join(plannerRoot, "SKILL.md")));
  assert.ok(existsSync(path.join(plannerRoot, "scripts/validate-upstream-planning.mjs")));
  assert.ok(existsSync(path.join(plannerRoot, "references/vimax-upstream-planning.md")));
  assert.ok(existsSync(path.join(plannerRoot, "references/handoff-contracts.md")));
});

test("video skill consumes upstream plans without owning the full Phase 0 workflow", () => {
  const videoSkill = readFileSync(path.join(repoRoot, ".codex/skills/comic-control-page-video/SKILL.md"), "utf8");
  assert.match(videoSkill, /\$comic-upstream-planner/);
  assert.doesNotMatch(videoSkill, /## Phase 0 - ViMax-style 前期策划包/);
});

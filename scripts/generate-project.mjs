#!/usr/bin/env node

import { writeFile } from "node:fs/promises";
import path from "node:path";
import {
  ensureDir,
  inferRenderSpec,
  listInputPages,
  toPosixPath,
  writeJson,
  writeLayerAsset,
} from "./lib/planning.mjs";
import { buildPlanningInput, createMockAnalysisPlan, normalizeAnalysisPlan } from "./lib/ai-planning.mjs";
import { createCodexCliAnalysisPlan } from "./lib/codex-planner.mjs";
import { buildPanelPack } from "./lib/panels.mjs";

const cwd = process.env.MOTION_COMIC_TEST_ROOT || process.cwd();
const outputRoot = path.join(cwd, "project_output");
const plansDir = path.join(outputRoot, "plans");
const runtimeDir = path.join(outputRoot, "render", "remotion");

let pages;
try {
  pages = await listInputPages(cwd);
} catch (error) {
  console.error(`Unable to read input/pages: ${error.message}`);
  process.exit(1);
}

if (pages.length === 0) {
  console.error("No supported image pages found in input/pages. Expected png, jpg, jpeg, or webp.");
  process.exit(1);
}

await ensureDir(plansDir);
await ensureDir(runtimeDir);

const panelPack = await buildPanelPack({ cwd, outputRoot, pages });
const activeRenderSpec = inferRenderSpec(panelPack);
const planningInput = buildPlanningInput(panelPack);
await writeJson(path.join(plansDir, "planning_input.json"), planningInput);

let plannerResult;
try {
  plannerResult = await createAnalysisPlan({ cwd, panelPack });
} catch (error) {
  console.error(`codex_cli planner failed: ${error.message}`);
  process.exit(1);
}

const analysisPlan = plannerResult.analysisPlan;
await writeJson(path.join(plansDir, "analysis_plan.json"), analysisPlan);

const { plan, report: normalizerReport } = normalizeAnalysisPlan({
  panelPack,
  analysisPlan,
  render: activeRenderSpec,
});
normalizerReport.planner = plannerResult.report;
await writeJson(path.join(plansDir, "normalizer_report.json"), normalizerReport);

if (normalizerReport.errors.length > 0) {
  console.error(`Normalizer reported ${normalizerReport.errors.length} error(s).`);
  process.exit(1);
}

for (const shot of plan.shots) {
  await writeLayerAsset({ cwd, outputRoot, shot });
}

await writeJson(path.join(plansDir, "motion_plan.json"), plan);
const panelsById = new Map(plan.panels.map((panel) => [panel.panel_id, panel]));
await writeJson(path.join(runtimeDir, "runtime_plan.json"), {
  version: 2,
  render: activeRenderSpec,
  plan_path: "project_output/plans/motion_plan.json",
  assets_root: "project_output/assets",
  shots: plan.shots.map((shot) => ({
    shot_id: shot.shot_id,
    panel_id: shot.panel_id,
    source_image: shot.source_image,
    safe_frame: panelsById.get(shot.panel_id)?.safe_frame,
    layer_manifest: `project_output/assets/${shot.shot_id}/layer_manifest.json`,
    primitive: shot.primitive,
    duration_frames: shot.duration_frames,
    camera_motion: shot.camera_motion,
    local_motion: shot.local_motion,
    effects: shot.effects,
    defer_layer_refinement: shot.defer_layer_refinement,
  })),
});

await writeFile(path.join(outputRoot, "input_audit.md"), buildAuditMarkdown(pages, plan.shots, panelPack, plannerResult.report), "utf8");
await writeFile(path.join(plansDir, "shot_list.md"), buildShotListMarkdown(plan.shots), "utf8");

console.log(`Generated project_output with ${panelPack.panels.length} panels and ${plan.shots.length} normalized shots.`);

async function createAnalysisPlan({ cwd, panelPack }) {
  const provider = (process.env.MOTION_COMIC_PLANNER || "mock").trim() || "mock";
  if (provider === "mock") {
    return {
      analysisPlan: createMockAnalysisPlan(panelPack),
      report: {
        provider: "mock",
        requested_provider: provider,
        model: null,
        fallback: false,
        reason: null,
      },
    };
  }

  if (provider !== "codex_cli") {
    throw new Error(`Unsupported planner provider: ${provider}`);
  }

  const model = process.env.MOTION_COMIC_CODEX_MODEL || "gpt-5.5";
  try {
    return {
      analysisPlan: await createCodexCliAnalysisPlan({ cwd, panelPack, model }),
      report: {
        provider: "codex_cli",
        requested_provider: provider,
        model,
        fallback: false,
        reason: null,
      },
    };
  } catch (error) {
    const reason = error.message;
    if (process.env.MOTION_COMIC_PLANNER_STRICT === "1") {
      throw error;
    }
    return {
      analysisPlan: createMockAnalysisPlan(panelPack, {
        provider: `mock_deterministic_v1_fallback_from_codex_cli: ${reason}`,
      }),
      report: {
        provider: "codex_cli",
        requested_provider: provider,
        model,
        fallback: true,
        reason,
      },
    };
  }
}

function buildAuditMarkdown(pages, shots, panelPack, plannerReport) {
  const lines = [
    "# 输入审计",
    "",
    `- 工作目录: ${cwd}`,
    `- 输入页面数: ${pages.length}`,
    `- 输出 panel 数: ${panelPack.panels.length}`,
    `- 输出镜头数: ${shots.length}`,
    `- panel pack: \`project_output/panels/panel_pack.json\``,
    `- planner provider: ${plannerReport.provider}${plannerReport.model ? ` (${plannerReport.model})` : ""}`,
    `- planner fallback: ${plannerReport.fallback ? "yes" : "no"}`,
    "",
    "| page | panels | shot_ids | status |",
    "| --- | ---: | --- | --- |",
  ];

  for (const [index, page] of pages.entries()) {
    const pageId = panelPack.pages[index].page_id;
    const pagePanels = panelPack.panels.filter((panel) => panel.page_id === pageId);
    const shotIds = shots
      .filter((shot) => pagePanels.some((panel) => panel.panel_id === shot.panel_id))
      .map((shot) => shot.shot_id)
      .join(", ");
    lines.push(
      `| ${toPosixPath(path.relative(cwd, page))} | ${pagePanels.length} | ${shotIds} | accepted |`,
    );
  }

  lines.push(
    "",
    "Panel 策略: T101 使用 deterministic sample grid 生成 `panel_pack` 与真实 PNG crop；如存在 `project_output/panels/panel_pack.manual.json`，PNG panel 会读取人工 bbox、reading_order、safe_frame 覆盖后重新裁切，非 PNG fallback 只支持整页 panel 并会忽略人工 bbox。",
    "",
    "AI 编排策略: 默认使用 mock deterministic planner；设置 `MOTION_COMIC_PLANNER=codex_cli` 时通过本机 Codex CLI 只读调用生成 `analysis_plan.json`，再由 normalizer 写出可执行 `motion_plan.json v2` 和 `normalizer_report.json`。",
    "",
    "分层策略: 自动分层暂未执行，v2 shot pipeline 继续写入 `defer_layer_refinement: true`，并以每个 panel crop 作为兼容源图。",
    "",
  );
  if (plannerReport.fallback) {
    lines.push(`Planner fallback: ${plannerReport.reason}`, "");
  }
  return lines.join("\n");
}

function buildShotListMarkdown(shots) {
  const lines = [
    "# Shot List",
    "",
    "| shot_id | panel_id | source_image | duration_frames | camera_motion | local_motion |",
    "| --- | --- | --- | ---: | --- | --- |",
  ];

  for (const shot of shots) {
    lines.push(
      `| ${shot.shot_id} | ${shot.panel_id} | ${shot.source_image} | ${shot.duration_frames} | ${shot.camera_motion.type} | ${shot.local_motion.map((motion) => motion.type).join(", ")} |`,
    );
  }

  lines.push("");
  return lines.join("\n");
}

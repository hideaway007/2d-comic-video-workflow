import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "..");
const upstreamValidator = path.join(
  repoRoot,
  ".codex/skills/video-upstream-planner/scripts/validate-upstream-planning.mjs",
);

test("upstream planning validation accepts a complete generic video planning pack", () => {
  const { workdir } = createUpstreamPlanningFixture();

  const result = runValidator(workdir);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /upstream planning audit passed/);
});

test("upstream planning validation rejects a missing entity registry", () => {
  const { workdir, runFolder } = createUpstreamPlanningFixture();
  rmSync(path.join(runFolder, "00_brief/entity_registry.json"));

  const result = runValidator(workdir);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /entity_registry\.json is required/);
  assert.ok(readJson(path.join(runFolder, "00_brief/upstream_planning_audit.json")).blockers.length > 0);
});

test("upstream planning validation rejects entity scene references not present in event_scene_map", () => {
  const { workdir } = createUpstreamPlanningFixture({
    mutateEntities(registry) {
      registry.entities[0].active_scenes.push("scene_missing");
    },
  });

  const result = runValidator(workdir);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unknown active_scenes reference scene_missing/);
});

test("upstream planning validation rejects scene settings missing from setting registry", () => {
  const { workdir } = createUpstreamPlanningFixture({
    mutateSettings(registry) {
      registry.settings = registry.settings.filter((item) => item.setting_id !== "set_cafe_door");
    },
  });

  const result = runValidator(workdir);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unknown setting_id set_cafe_door/);
});

function createUpstreamPlanningFixture({
  mutateStrategy,
  mutateEvents,
  mutateEntities,
  mutateSettings,
  mutateAssets,
  mutateReferences,
} = {}) {
  const workdir = mkdtempSync(path.join(tmpdir(), "upstream-planning-validation-"));
  const runFolder = path.join(workdir, "project_output/control-page-runs/demo");
  const briefDir = path.join(runFolder, "00_brief");
  mkdirSync(briefDir, { recursive: true });

  const videoStrategy = {
    version: 1,
    input_mode: "idea",
    mode: "short_vertical_video",
    title: "夜班咖啡馆",
    target_output: "narration_to_9_16_video",
    audience: "对城市夜班和孤独感有共鸣的年轻观众",
    platform: "short_video",
    narrative_strategy: {
      logline: "一个夜班咖啡师通过一杯没人认领的咖啡，发现城市里每个人都在等待被看见。",
      core_conflict: "主角想尽快结束夜班，但顾客留下的线索不断把他拉回人与人的连接。",
      audience_hook: "凌晨两点，咖啡馆里出现了一杯已经付款却没人来取的咖啡。",
      ending_pressure: "主角必须决定是丢掉这杯咖啡，还是替陌生人完成一次迟到的告别。",
    },
    route_decision: {
      content_profile: "fiction_story",
      reason: "通用虚构短片，不依赖题材专用包。",
    },
  };
  mutateStrategy?.(videoStrategy);

  const eventSceneMap = {
    version: 1,
    source: "00_brief/video_strategy.json",
    events: [
      {
        event_id: "event_01",
        order: 1,
        dramatic_goal: "夜班日常被一杯无人领取的咖啡打破。",
        process_chain: [
          "主角准备打烊。",
          "订单屏弹出已付款饮品。",
          "杯身写着陌生留言。",
        ],
        scene_ids: ["scene_001", "scene_002"],
      },
      {
        event_id: "event_02",
        order: 2,
        dramatic_goal: "主角决定替陌生人完成一次迟到的告别。",
        process_chain: [
          "他走向玻璃门。",
          "外卖骑手递来一张旧照片。",
          "杯子被放到街角长椅上。",
        ],
        scene_ids: ["scene_003"],
      },
    ],
    scenes: [
      {
        scene_id: "scene_001",
        event_id: "event_01",
        order: 1,
        setting_id: "set_cafe_counter",
        dramatic_function: "建立主角状态和空间秩序。",
        scene_summary: "主角站在吧台内，清点最后一排杯子。",
        visible_entity_ids: ["ent_barista"],
        key_asset_ids: ["asset_order_screen", "asset_takeaway_cup"],
      },
      {
        scene_id: "scene_002",
        event_id: "event_01",
        order: 2,
        setting_id: "set_cafe_counter",
        dramatic_function: "关键资产进入故事中心。",
        scene_summary: "无人领取的外带杯被推到吧台灯下，杯套留言露出。",
        visible_entity_ids: ["ent_barista", "ent_delivery_rider"],
        key_asset_ids: ["asset_takeaway_cup", "asset_old_photo"],
      },
      {
        scene_id: "scene_003",
        event_id: "event_02",
        order: 3,
        setting_id: "set_cafe_door",
        dramatic_function: "主角从旁观者变成行动者。",
        scene_summary: "咖啡杯被放在街角长椅上，玻璃门反射出清晨第一束光。",
        visible_entity_ids: ["ent_barista"],
        key_asset_ids: ["asset_takeaway_cup", "asset_old_photo"],
      },
    ],
  };
  mutateEvents?.(eventSceneMap);

  const entityRegistry = {
    version: 1,
    source: "00_brief/event_scene_map.json",
    entities: [
      {
        entity_id: "ent_barista",
        name: "夜班咖啡师",
        role: "主角 / 叙事视角",
        stable_features: "二十多岁，黑色围裙，眼神疲惫但动作熟练。",
        dynamic_features_by_scene: {
          scene_001: "袖口卷起，正在擦拭咖啡机。",
          scene_002: "手里拿着无人领取的外带杯。",
          scene_003: "站在玻璃门外，围裙被晨风吹起。",
        },
        active_scenes: ["scene_001", "scene_002", "scene_003"],
        continuity_notes: "状态从机械疲惫转为主动关心。",
      },
      {
        entity_id: "ent_delivery_rider",
        name: "夜班骑手",
        role: "线索递送者",
        stable_features: "荧光外套，头盔上有雨点，动作急促。",
        dynamic_features_by_scene: {
          scene_002: "把旧照片压在外带杯旁边。",
        },
        active_scenes: ["scene_002"],
        continuity_notes: "只短暂出现，但带来故事转折。",
      },
    ],
  };
  mutateEntities?.(entityRegistry);

  const settingRegistry = {
    version: 1,
    source: "00_brief/event_scene_map.json",
    settings: [
      {
        setting_id: "set_cafe_counter",
        name: "深夜咖啡馆吧台",
        spatial_description: "吧台横贯画面中景，玻璃门在右后方，街灯从窗外投进冷色光。",
        lighting_arc: "室内暖光逐渐被窗外冷蓝色夜光压住。",
        continuity_anchors: ["吧台", "订单屏", "玻璃门", "窗外街灯"],
      },
      {
        setting_id: "set_cafe_door",
        name: "咖啡馆玻璃门外",
        spatial_description: "玻璃门占画面左侧，街角长椅在右前景，店内吧台作为背景反光。",
        lighting_arc: "夜色过渡到清晨低饱和暖光。",
        continuity_anchors: ["玻璃门", "街角长椅", "店内吧台反光"],
      },
    ],
  };
  mutateSettings?.(settingRegistry);

  const assetRegistry = {
    version: 1,
    source: "00_brief/event_scene_map.json",
    assets: [
      {
        asset_id: "asset_order_screen",
        name: "订单屏",
        first_scene_id: "scene_001",
        visual_signature: "小型发光屏幕，未完成订单被蓝色高亮。",
        state_by_scene: { scene_001: "弹出已付款饮品", scene_002: "高亮订单保持不消失" },
      },
      {
        asset_id: "asset_takeaway_cup",
        name: "无人领取的外带杯",
        first_scene_id: "scene_001",
        visual_signature: "白色纸杯，杯套上有手写蓝色名字和一行小字。",
        state_by_scene: {
          scene_001: "放在吧台边缘，无人认领",
          scene_002: "被主角拿起，杯套留言露出",
          scene_003: "被放到街角长椅上",
        },
      },
      {
        asset_id: "asset_old_photo",
        name: "旧照片",
        first_scene_id: "scene_002",
        visual_signature: "边角泛黄的小照片，背面写着同一个名字。",
        state_by_scene: { scene_002: "被骑手压在杯旁", scene_003: "插在杯套下方" },
      },
    ],
  };
  mutateAssets?.(assetRegistry);

  const referenceSelectionPlan = {
    version: 1,
    source: "00_brief/video_strategy.json",
    reference_slots: [
      {
        reference_id: "entity_asset_reference",
        purpose: "主要实体、状态变化和关键资产。",
        source_ids: ["ent_barista", "ent_delivery_rider", "asset_takeaway_cup", "asset_old_photo"],
        selection_rule: "实体和资产同图，但不得拼贴进 story page。",
      },
      {
        reference_id: "setting_plan_reference",
        purpose: "吧台、玻璃门、街角长椅的位置关系和人物动线。",
        source_ids: ["set_cafe_counter", "set_cafe_door"],
        selection_rule: "用总平面和动线约束后续所有 worker。",
      },
      {
        reference_id: "shot_style_reference",
        purpose: "灯光、材质、镜头距离和构图密度。",
        source_ids: ["scene_001", "scene_002", "scene_003"],
        selection_rule: "优先空间镜头，不提前把结尾情绪讲满。",
      },
    ],
    max_runtime_reference_images_per_page: 8,
  };
  mutateReferences?.(referenceSelectionPlan);

  writeJson(path.join(briefDir, "video_strategy.json"), videoStrategy);
  writeJson(path.join(briefDir, "event_scene_map.json"), eventSceneMap);
  writeJson(path.join(briefDir, "entity_registry.json"), entityRegistry);
  writeJson(path.join(briefDir, "setting_registry.json"), settingRegistry);
  writeJson(path.join(briefDir, "asset_registry.json"), assetRegistry);
  writeJson(path.join(briefDir, "reference_selection_plan.json"), referenceSelectionPlan);
  writeFileSync(
    path.join(briefDir, "adaptation_plan.md"),
    "# 改编策略\n\n保留咖啡杯、订单屏、旧照片和玻璃门作为连续视觉锚点。\n",
    "utf8",
  );

  return { workdir, runFolder };
}

function runValidator(workdir) {
  return spawnSync(
    "node",
    [upstreamValidator, "project_output/control-page-runs/demo", "--project-root", workdir],
    { encoding: "utf8" },
  );
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "..");
const upstreamValidator = path.join(
  repoRoot,
  ".codex/skills/comic-upstream-planner/scripts/validate-upstream-planning.mjs",
);

test("upstream planning validation accepts a complete planning pack", () => {
  const { workdir } = createUpstreamPlanningFixture();

  const result = runValidator(workdir);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /upstream planning audit passed/);
});

test("upstream planning validation rejects a missing character registry", () => {
  const { workdir, runFolder } = createUpstreamPlanningFixture();
  rmSync(path.join(runFolder, "00_brief/character_registry.json"));

  const result = runValidator(workdir);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /character_registry\.json is required/);
  assert.ok(readJson(path.join(runFolder, "00_brief/upstream_planning_audit.json")).blockers.length > 0);
});

test("upstream planning validation rejects character scene references not present in event_scene_map", () => {
  const { workdir } = createUpstreamPlanningFixture({
    mutateCharacters(registry) {
      registry.characters[0].active_scenes.push("scene_missing");
    },
  });

  const result = runValidator(workdir);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unknown active_scenes reference scene_missing/);
});

test("upstream planning validation rejects scene locations missing from environment registry", () => {
  const { workdir } = createUpstreamPlanningFixture({
    mutateEnvironments(registry) {
      registry.environments = registry.environments.filter((item) => item.location_id !== "loc_well");
    },
  });

  const result = runValidator(workdir);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unknown location_id loc_well/);
});

function createUpstreamPlanningFixture({
  mutateStrategy,
  mutateEvents,
  mutateCharacters,
  mutateEnvironments,
  mutateProps,
  mutateReferences,
} = {}) {
  const workdir = mkdtempSync(path.join(tmpdir(), "upstream-planning-validation-"));
  const runFolder = path.join(workdir, "project_output/control-page-runs/demo");
  const briefDir = path.join(runFolder, "00_brief");
  mkdirSync(briefDir, { recursive: true });

  const storyStrategy = {
    version: 1,
    input_mode: "idea",
    mode: "chinese_cthulhu_weird_tale",
    title: "井皮",
    target_output: "narration_to_9_16_comic_video",
    narrative_strategy: {
      logline: "林照回槐湾收铜皮箱，却发现老井在替村里人换皮。",
      core_conflict: "主角想带走遗物，宗族要让他替井下之物续约。",
      audience_hook: "井不是取水用的，是给下面那东西换皮用的。",
      ending_pressure: "林照必须在烧掉族谱和打开铜箱之间选一个。",
    },
    route_decision: {
      topic_pack: "chinese-cthulhu",
      reason: "原创乡土怪谈，不写真实历史事实底座。",
    },
  };
  mutateStrategy?.(storyStrategy);

  const eventSceneMap = {
    version: 1,
    source: "00_brief/story_strategy.json",
    events: [
      {
        event_id: "event_01",
        order: 1,
        dramatic_goal: "主角进入槐湾并接触铜皮箱。",
        process_chain: [
          "林照回到祖屋门前。",
          "族长交出冰冷铜钥匙。",
          "铜皮箱在祠堂供桌下发出刮擦声。",
        ],
        scene_ids: ["scene_001", "scene_002"],
      },
      {
        event_id: "event_02",
        order: 2,
        dramatic_goal: "老井显露换皮仪式。",
        process_chain: [
          "老井石板偏开。",
          "红线铜钱被井下力量绷紧。",
          "族谱渗出林照的名字。",
        ],
        scene_ids: ["scene_003"],
      },
    ],
    scenes: [
      {
        scene_id: "scene_001",
        event_id: "event_01",
        order: 1,
        location_id: "loc_ancestral_house",
        dramatic_function: "日常入口被第一处错位打破。",
        scene_summary: "林照站在祖屋门槛外，看见盐霜覆盖门槛。",
        visible_character_ids: ["char_linzhao", "char_clan_elder"],
        key_prop_ids: ["prop_key"],
      },
      {
        scene_id: "scene_002",
        event_id: "event_01",
        order: 2,
        location_id: "loc_shrine",
        dramatic_function: "关键道具进入故事中心。",
        scene_summary: "铜皮箱在祠堂供桌下弹开一条缝。",
        visible_character_ids: ["char_linzhao"],
        key_prop_ids: ["prop_box", "prop_genealogy"],
      },
      {
        scene_id: "scene_003",
        event_id: "event_02",
        order: 3,
        location_id: "loc_well",
        dramatic_function: "怪异规则第一次被看见。",
        scene_summary: "老井旁红线铜钱绷紧，井水反出冷青光。",
        visible_character_ids: ["char_linzhao", "char_clan_elder"],
        key_prop_ids: ["prop_red_thread", "prop_well"],
      },
    ],
  };
  mutateEvents?.(eventSceneMap);

  const characterRegistry = {
    version: 1,
    source: "00_brief/event_scene_map.json",
    characters: [
      {
        character_id: "char_linzhao",
        name: "林照",
        role: "主角",
        static_features: "二十多岁，瘦削，眉骨清楚，眼下有长期失眠的青影。",
        dynamic_features_by_scene: {
          scene_001: "灰色夹克，手里提着旧帆布包。",
          scene_002: "夹克袖口沾盐霜，握着铜钥匙。",
          scene_003: "衣摆被井边潮气打湿，手腕缠着红线。",
        },
        active_scenes: ["scene_001", "scene_002", "scene_003"],
        continuity_notes: "始终从怀疑转向被迫参与，不突然变成主动猎奇。",
      },
      {
        character_id: "char_clan_elder",
        name: "族长",
        role: "压力来源",
        static_features: "六十多岁，背微驼，白眉稀疏，嘴角常年下垂。",
        dynamic_features_by_scene: {
          scene_001: "深蓝旧棉袄，袖中藏着铜钥匙。",
          scene_003: "棉袄下摆沾井泥，手指压住族谱边角。",
        },
        active_scenes: ["scene_001", "scene_003"],
        continuity_notes: "每次出现都带来规矩和禁忌。",
      },
    ],
  };
  mutateCharacters?.(characterRegistry);

  const environmentRegistry = {
    version: 1,
    source: "00_brief/event_scene_map.json",
    environments: [
      {
        location_id: "loc_ancestral_house",
        name: "槐湾祖屋门前",
        spatial_description: "门槛在画面中线，祠堂门廊在右后方，老井在远景偏右。",
        lighting_arc: "阴天灰雾，门槛盐霜反出白光。",
        continuity_anchors: ["门槛", "祠堂门廊", "远景老井"],
      },
      {
        location_id: "loc_shrine",
        name: "陆家祠堂",
        spatial_description: "供桌居中，铜皮箱在桌下，族谱压在供桌左侧。",
        lighting_arc: "油灯暗红，桌下有冷青反光。",
        continuity_anchors: ["供桌", "铜皮箱", "族谱"],
      },
      {
        location_id: "loc_well",
        name: "村口老井",
        spatial_description: "井口占前景右下，红线从鞋尖连向井沿，祠堂在背景。",
        lighting_arc: "井底冷青光压过天光。",
        continuity_anchors: ["井口", "红线", "祠堂背景"],
      },
    ],
  };
  mutateEnvironments?.(environmentRegistry);

  const propRegistry = {
    version: 1,
    source: "00_brief/event_scene_map.json",
    props: [
      {
        prop_id: "prop_key",
        name: "铜钥匙",
        first_scene_id: "scene_001",
        visual_signature: "发黑铜色，钥匙齿缝有盐霜。",
        state_by_scene: { scene_001: "由族长递给林照", scene_002: "插在铜皮箱锁孔旁" },
      },
      {
        prop_id: "prop_box",
        name: "铜皮箱",
        first_scene_id: "scene_002",
        visual_signature: "铜皮发黑，边角有细密抓痕。",
        state_by_scene: { scene_002: "供桌下弹开一条缝" },
      },
      {
        prop_id: "prop_genealogy",
        name: "族谱",
        first_scene_id: "scene_002",
        visual_signature: "线装旧册，纸背渗出新墨。",
        state_by_scene: { scene_002: "压在供桌左侧", scene_003: "渗出林照名字" },
      },
      {
        prop_id: "prop_red_thread",
        name: "红线铜钱",
        first_scene_id: "scene_003",
        visual_signature: "红线潮湿，铜钱边缘泛绿。",
        state_by_scene: { scene_003: "被井下力量绷紧" },
      },
      {
        prop_id: "prop_well",
        name: "老井",
        first_scene_id: "scene_003",
        visual_signature: "井沿盐霜和黑水并存，井底冷青光。",
        state_by_scene: { scene_003: "石板偏开一角" },
      },
    ],
  };
  mutateProps?.(propRegistry);

  const referenceSelectionPlan = {
    version: 1,
    source: "00_brief/story_strategy.json",
    reference_slots: [
      {
        reference_id: "character_prop_reference",
        purpose: "主要人物三视图、状态变化和关键道具。",
        source_ids: ["char_linzhao", "char_clan_elder", "prop_key", "prop_box", "prop_genealogy"],
        selection_rule: "人物和道具同图，但不得拼贴进 story page。",
      },
      {
        reference_id: "location_plan_reference",
        purpose: "祖屋、祠堂、老井的位置关系和人物动线。",
        source_ids: ["loc_ancestral_house", "loc_shrine", "loc_well"],
        selection_rule: "用总平面和动线约束后续所有 worker。",
      },
      {
        reference_id: "shot_style_reference",
        purpose: "灯光、材质、镜头距离和构图密度。",
        source_ids: ["scene_001", "scene_002", "scene_003"],
        selection_rule: "优先空间镜头，不提前暴露最终怪异。",
      },
    ],
    max_runtime_reference_images_per_page: 8,
  };
  mutateReferences?.(referenceSelectionPlan);

  writeJson(path.join(briefDir, "story_strategy.json"), storyStrategy);
  writeJson(path.join(briefDir, "event_scene_map.json"), eventSceneMap);
  writeJson(path.join(briefDir, "character_registry.json"), characterRegistry);
  writeJson(path.join(briefDir, "environment_registry.json"), environmentRegistry);
  writeJson(path.join(briefDir, "prop_registry.json"), propRegistry);
  writeJson(path.join(briefDir, "reference_selection_plan.json"), referenceSelectionPlan);
  writeFileSync(
    path.join(briefDir, "adaptation_plan.md"),
    "# 改编策略\n\n保留井、铜皮箱、族谱和红线铜钱作为连续视觉锚点。\n",
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

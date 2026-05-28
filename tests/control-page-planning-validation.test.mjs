import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "..");
const timelineValidator = path.join(
  repoRoot,
  ".codex/skills/video-generation-template/scripts/validate-timeline-beats.mjs",
);
const promptValidator = path.join(
  repoRoot,
  ".codex/skills/video-generation-template/scripts/validate-control-page-prompts.mjs",
);
const verticalPromptValidator = path.join(
  repoRoot,
  ".codex/skills/video-generation-template/scripts/validate-vertical-page-prompts.mjs",
);

test("timeline validation accepts one-to-one beat, audio, timestamp, and prompt panel mapping", () => {
  const { workdir } = createPlanningFixture();

  const result = runValidator(timelineValidator, workdir);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /timeline beat audit passed/);
});

test("timeline validation rejects beat text outside 20-50 chars without an exception reason", () => {
  const { workdir, runFolder } = createPlanningFixture({
    mutateTimeline(timeline) {
      timeline.beats[0].text = "井口忽然响了一声。";
    },
  });
  syncDerivedText(runFolder, "井口忽然响了一声。");

  const result = runValidator(timelineValidator, workdir);
  assert.notEqual(result.status, 0, result.stderr);
  assert.match(result.stderr, /beat_001 text length must be 20-50/);
});

test("timeline validation rejects mapping drift across derived files", () => {
  const { workdir, runFolder } = createPlanningFixture();
  const audioSegmentsPath = path.join(runFolder, "01_script/audio_segments.json");
  const audioSegments = readJson(audioSegmentsPath);
  audioSegments.segments[1].visual_beat_id = "beat_999";
  writeJson(audioSegmentsPath, audioSegments);

  const result = runValidator(timelineValidator, workdir);
  assert.notEqual(result.status, 0, result.stderr);
  assert.match(result.stderr, /audio_segments\[1\]\.visual_beat_id must equal beat_002/);
});

test("control page prompt validation accepts clean full control-page prompts", () => {
  const { workdir } = createPlanningFixture();

  const result = runValidator(promptValidator, workdir);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /control page prompt audit passed/);
});

test("control page prompt validation rejects workflow narration inside image prompts", () => {
  const { workdir, runFolder } = createPlanningFixture({
    mutatePrompts(prompts) {
      prompts.pages[0].prompt += "\n我将会生成后保存到 03_images/page_001.png，并等待审核。";
    },
  });

  const result = runValidator(promptValidator, workdir);
  assert.notEqual(result.status, 0, result.stderr);
  assert.match(result.stderr, /workflow narration/);
});

test("control page prompt validation rejects prompts missing splitter-friendly gutter constraints", () => {
  const { workdir } = createPlanningFixture({
    mutatePrompts(prompts) {
      prompts.pages[0].prompt = prompts.pages[0].prompt
        .replace(/高对比/g, "清晰")
        .replace(/格线宽度约下方漫画区短边的 1% 到 2%，/g, "")
        .replace(/留白/g, "间隔")
        .replace(/gutter/g, "间隔区");
    },
  });

  const result = runValidator(promptValidator, workdir);
  assert.notEqual(result.status, 0, result.stderr);
  assert.match(result.stderr, /high-contrast panel separators/);
  assert.match(result.stderr, /explicit border width/);
  assert.match(result.stderr, /clean gutter whitespace/);
});

test("vertical page prompt validation accepts structured shot language and continuity", () => {
  const { workdir } = createVerticalPlanningFixture();

  const result = runValidator(verticalPromptValidator, workdir);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /vertical page prompt audit passed/);
});

test("vertical page prompt validation rejects narration under-coverage and sparse page density", () => {
  const { workdir, runFolder } = createVerticalPlanningFixture();
  mkdirSync(path.join(runFolder, "01_script"), { recursive: true });
  const longNarration = Array(20)
    .fill("许澈在深夜公寓看着手机屏幕，蓝色情绪收据把他不愿面对的难过照亮。")
    .join("");
  writeFileSync(path.join(runFolder, "01_script/narration.md"), `# 测试口播\n\n${longNarration}\n`, "utf8");
  writeJson(path.join(runFolder, "02_prompts/timeline_beats.json"), {
    version: 1,
    source: "01_script/narration.md",
    mode: "short_vertical_video",
    segmentation_policy: {
      unit: "visual_beat",
      target_chars: "20-50 Chinese chars, hard constraint",
      hard_rule: "one beat maps to one 9:16 story page, one audio segment, and one timestamp row",
    },
    beats: Array.from({ length: 8 }, (_, index) => {
      const order = index + 1;
      const id = String(order).padStart(3, "0");
      return {
        beat_id: `beat_${id}`,
        order,
        page_id: `page_${id}`,
        audio_segment_id: `seg_${id}`,
        text: `许澈看向第 ${order} 张情绪收据。`,
        estimated_start_sec: index * 4,
        estimated_end_sec: index * 4 + 4,
        scene_function: "情绪推进",
        visual_prompt_brief: `第 ${order} 张情绪收据让房间变暗`,
        key_entities: ["ent_xuche"],
        key_assets: ["asset_emotion_receipt"],
        segmentation_exception: null,
      };
    }),
  });

  const result = runValidator(verticalPromptValidator, workdir);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /timeline beat text coverage too low/);
  assert.match(result.stderr, /vertical page density too low/);
  const audit = readJson(path.join(runFolder, "02_prompts/vertical_page_prompt_audit.json"));
  assert.equal(audit.passed, false);
  assert.ok(audit.narration_coverage.beat_text_coverage_ratio < 0.9);
  assert.ok(audit.narration_coverage.min_page_count_from_narration > audit.page_count);
});

test("vertical page prompt validation rejects missing prompt structure", () => {
  const { workdir, runFolder } = createVerticalPlanningFixture({
    mutatePrompts(prompts) {
      delete prompts.pages[0].prompt_structure;
    },
  });

  const result = runValidator(verticalPromptValidator, workdir);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /page_001 prompt_structure is required/);
  assert.ok(readJson(path.join(runFolder, "02_prompts/vertical_page_prompt_audit.json")).blockers.length > 0);
});

test("vertical page prompt validation rejects close-up heavy shot plans", () => {
  const { workdir } = createVerticalPlanningFixture({
    mutatePrompts(prompts) {
      for (const page of prompts.pages) {
        page.prompt_structure.shot_scale = "close_up";
        page.director_directive.shot_scale = "close_up";
        page.prompt = page.prompt.replace(/景别 medium_wide/g, "景别 close_up");
      }
    },
    mutateDirector(director) {
      for (const directive of director.beat_directives) {
        directive.shot_scale = "close_up";
      }
    },
  });

  const result = runValidator(verticalPromptValidator, workdir);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /close_up must be <= 15%/);
  assert.match(result.stderr, /spatial shots must be >= 55%/);
});

test("vertical page prompt validation rejects missing storyboard sequence plan", () => {
  const { workdir, runFolder } = createVerticalPlanningFixture({ writeStoryboard: false });

  const result = runValidator(verticalPromptValidator, workdir);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /storyboard_sequence_plan\.json is required/);
  assert.ok(readJson(path.join(runFolder, "02_prompts/vertical_page_prompt_audit.json")).blockers.length > 0);
});

test("vertical page prompt validation rejects missing storyboard frame fields", () => {
  const { workdir } = createVerticalPlanningFixture({
    mutatePrompts(prompts) {
      delete prompts.pages[0].storyboard_frame.current_visual_action;
    },
  });

  const result = runValidator(verticalPromptValidator, workdir);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /page_001 storyboard_frame current_visual_action is required/);
});

test("vertical page prompt validation rejects three repeated camera setups in one sequence", () => {
  const { workdir } = createVerticalPlanningFixture({
    mutatePrompts(prompts) {
      for (const page of prompts.pages.slice(0, 3)) {
        page.prompt_structure.shot_scale = "medium_wide";
        page.prompt_structure.camera_angle = "same eye-level angle";
        page.prompt_structure.camera_motion = "same locked-off hold";
      }
    },
  });

  const result = runValidator(verticalPromptValidator, workdir);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /3 consecutive pages with identical shot_scale\+camera_angle\+camera_motion/);
});

test("vertical page prompt validation rejects overused camera pairs in one sequence", () => {
  const { workdir } = createVerticalPlanningFixture({
    mutatePrompts(prompts) {
      for (const page of prompts.pages.slice(0, 6)) {
        page.prompt_structure.camera_angle = "same eye-level angle";
        page.prompt_structure.camera_motion = "same locked-off hold";
      }
    },
  });

  const result = runValidator(verticalPromptValidator, workdir);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /reuses one camera_angle\+camera_motion pair too often/);
});

test("vertical page prompt validation rejects repeated current visual action in one sequence", () => {
  const { workdir } = createVerticalPlanningFixture({
    mutatePrompts(prompts) {
      const repeatedAction = prompts.pages[0].storyboard_frame.current_visual_action;
      prompts.pages[1].storyboard_frame.current_visual_action = repeatedAction;
      prompts.pages[1].prompt = prompts.pages[1].prompt.replace(/第 2 页动作：[^。\n]+。/, `第 2 页动作：${repeatedAction}。`);
    },
    mutateStoryboard(storyboard) {
      storyboard.frames[1].current_visual_action = storyboard.frames[0].current_visual_action;
    },
  });

  const result = runValidator(verticalPromptValidator, workdir);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /repeats current_visual_action/);
});

test("vertical page prompt validation rejects abstract non-drawable current visual action", () => {
  const { workdir } = createVerticalPlanningFixture({
    mutatePrompts(prompts) {
      prompts.pages[0].storyboard_frame.current_visual_action = "责任反转";
      prompts.pages[0].prompt = prompts.pages[0].prompt.replace(/第 1 页动作：[^。\n]+。/, "第 1 页动作：责任反转。");
    },
    mutateStoryboard(storyboard) {
      storyboard.frames[0].current_visual_action = "责任反转";
    },
  });

  const result = runValidator(verticalPromptValidator, workdir);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /current_visual_action must be drawable/);
});

test("vertical page prompt validation rejects prompts missing storyboard action and state delta phrases", () => {
  const { workdir } = createVerticalPlanningFixture({
    mutatePrompts(prompts) {
      prompts.pages[0].prompt = prompts.pages[0].prompt
        .replace(/第 1 页动作：[^。\n]+。\n/, "")
        .replace(/状态变化：[^。\n]+。\n/, "");
    },
  });

  const result = runValidator(verticalPromptValidator, workdir);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /prompt must include storyboard_frame\.current_visual_action core phrase/);
  assert.match(result.stderr, /prompt must include storyboard_frame\.state_delta core phrase/);
});

test("vertical page prompt validation rejects worker batches missing neighbor context", () => {
  const { workdir } = createVerticalPlanningFixture({
    mutateWorkerBatches(workerBatches) {
      delete workerBatches[0].pages[0].neighbor_context;
    },
  });

  const result = runValidator(verticalPromptValidator, workdir);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /vertical_batch_worker_01\.json pages\[0\] neighbor_context is required/);
});

test("vertical page prompt validation rejects incomplete sequence blocks", () => {
  const { workdir } = createVerticalPlanningFixture({
    mutateStoryboard(storyboard) {
      delete storyboard.sequence_blocks[0].entry_state;
    },
  });

  const result = runValidator(verticalPromptValidator, workdir);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /seq_01 entry_state is required/);
});

test("vertical page prompt validation rejects worker batches missing sequence context", () => {
  const { workdir } = createVerticalPlanningFixture({
    mutateWorkerBatches(workerBatches) {
      delete workerBatches[0].sequence_context;
    },
  });

  const result = runValidator(verticalPromptValidator, workdir);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /vertical_batch_worker_01\.json sequence_context must be a non-empty array/);
});

function createPlanningFixture({ mutateTimeline, mutatePrompts } = {}) {
  const workdir = mkdtempSync(path.join(tmpdir(), "control-page-planning-validation-"));
  const runFolder = path.join(workdir, "project_output/control-page-runs/demo");
  mkdirSync(path.join(runFolder, "01_script"), { recursive: true });
  mkdirSync(path.join(runFolder, "02_prompts"), { recursive: true });

  const beatTexts = [
    "林照回到槐湾祖屋门前，门槛盐霜在雾里泛白。",
    "族长递来一串冰冷铜钥匙，只说箱子还在祠堂。",
    "供桌下铜皮箱突然弹开，灰白井皮在暗处发温。",
    "老井石板偏开一角，红线和铜钱同时在风里绷响。",
    "族谱自己翻页不止，林照的名字从纸背慢慢渗出来。",
  ];

  const timeline = {
    version: 1,
    source: "01_script/narration.md",
    mode: "chinese_cthulhu_weird_tale",
    beats: beatTexts.map((text, index) => {
      const order = index + 1;
      const id = String(order).padStart(3, "0");
      return {
        beat_id: `beat_${id}`,
        order,
        page_id: "page_001",
        panel_id: `page_001_panel_${id}`,
        audio_segment_id: `seg_${id}`,
        text,
        estimated_start_sec: index * 5,
        estimated_end_sec: index * 5 + 5,
        scene_function: "推进怪谈",
        visual_prompt_brief: `第 ${order} 格画面种子`,
        segmentation_exception: null,
      };
    }),
    page_groups: [
      {
        page_id: "page_001",
        beat_ids: ["beat_001", "beat_002", "beat_003", "beat_004", "beat_005"],
        panel_count: 5,
        reason: "同一场景内连续推进。",
      },
    ],
  };
  mutateTimeline?.(timeline);

  const audioSegments = {
    version: 1,
    source: "02_prompts/timeline_beats.json",
    segments: timeline.beats.map((beat) => ({
      segment_id: beat.audio_segment_id,
      visual_beat_id: beat.beat_id,
      page_id: beat.page_id,
      panel_id: beat.panel_id,
      text: beat.text,
      audio: `segments/${beat.audio_segment_id}.mp3`,
    })),
  };

  const timestamps = {
    version: 1,
    source: "02_prompts/timeline_beats.json",
    timebase: "seconds",
    timing_basis: "estimated_before_audio",
    segments: timeline.beats.map((beat) => ({
      segment_id: beat.audio_segment_id,
      visual_beat_id: beat.beat_id,
      page_id: beat.page_id,
      panel_id: beat.panel_id,
      start_sec: beat.estimated_start_sec,
      end_sec: beat.estimated_end_sec,
      text: beat.text,
    })),
  };

  const prompts = {
    version: 1,
    project: {
      project_name: "夜班咖啡馆",
      genre: "通用竖屏短片",
      visual_style: "干净电影感竖屏插画",
      world_setting: "深夜咖啡馆、玻璃门与街角长椅",
    },
    pages: [
      {
        page_id: "page_001",
        page_index: 1,
        page_title: "井皮初醒",
        character_board_reference: "03_images/character_board_master.png",
        reference_enforcement_plan: {
          method: "deterministic_top_board_composite",
          reason: "上方角色控制区复用同一张角色母版。",
        },
        comic_region_bbox_pct: { x: 0, y: 0.34, width: 1, height: 0.66 },
        prompt: cleanPrompt(),
        panels: timeline.beats.map((beat, index) => ({
          panel_id: beat.panel_id,
          visual_beat_id: beat.beat_id,
          audio_segment_id: beat.audio_segment_id,
          text: beat.text,
          bbox_pct: panelBbox(index),
          panel_prompt: `漫画格 ${index + 1}：${beat.visual_prompt_brief}`,
        })),
      },
    ],
  };
  mutatePrompts?.(prompts);

  writeJson(path.join(runFolder, "02_prompts/timeline_beats.json"), timeline);
  writeJson(path.join(runFolder, "01_script/audio_segments.json"), audioSegments);
  writeJson(path.join(runFolder, "01_script/narration_timestamps.json"), timestamps);
  writeJson(path.join(runFolder, "02_prompts/control_page_prompts.json"), prompts);
  return { workdir, runFolder };
}

function createVerticalPlanningFixture({ mutatePrompts, mutateDirector, mutateStoryboard, mutateWorkerBatches, writeStoryboard = true } = {}) {
  const workdir = mkdtempSync(path.join(tmpdir(), "vertical-page-planning-validation-"));
  const runFolder = path.join(workdir, "project_output/control-page-runs/demo");
  mkdirSync(path.join(runFolder, "02_prompts"), { recursive: true });
  mkdirSync(path.join(runFolder, "02_prompts/worker_batches"), { recursive: true });

  const scales = ["wide", "medium_wide", "medium", "over_shoulder", "bird_eye", "medium_wide", "insert", "medium"];
  const angles = [
    "high oblique angle",
    "over-shoulder angle from the groom side",
    "low angle through the red shoe foreground",
    "top-down well-mouth angle",
    "side track angle along the courtyard wall",
    "deep perspective from the ancestral hall door",
    "tight insert angle on the red thread",
    "high oblique angle from behind the villagers",
  ];
  const motions = [
    "locked-off establishing reveal",
    "slow push-in intent toward the well",
    "foreground-to-background reveal",
    "top-down reveal intent",
    "lateral track intent",
    "depth pull intent through the doorway",
    "held insert with tension on the thread",
    "locked-off payoff frame with crowd pressure",
  ];
  const actions = scales.map((_, index) => `第 ${index + 1} 页动作：人物沿井口方向完成第 ${index + 1} 次可见推进`);
  const stateDeltas = scales.map((_, index) => `状态变化：井口压迫比上一页增强第 ${index + 1} 层`);
  const director = {
    version: 1,
    mode: "single_page_vertical",
    beat_directives: scales.map((shotScale, index) => {
      const order = index + 1;
      const id = String(order).padStart(3, "0");
      return {
        beat_id: `beat_${id}`,
        shot_scale: shotScale,
        camera_angle: angles[index],
        camera_motion: motions[index],
        lighting: "阴天冷灰和井底冷青光保持连续",
        composition: "前景井栏，中景人物，背景祠堂形成纵深",
        character_blocking: "沈砚在左侧门槛，陆玉娘在中景，村民压在背景",
        prop_blocking: "红绣鞋在前景井栏旁，红线指向井口",
        environment_focus: "陆家宅院到村口老井的空间关系",
        avoid: [],
      };
    }),
  };
  mutateDirector?.(director);

  const storyboard = {
    version: 1,
    mode: "single_page_vertical",
    source: "02_prompts/timeline_beats.json",
    director_plan: "02_prompts/director_visual_plan.json",
    sequence_blocks: [
      {
        block_id: "seq_01",
        dramatic_function: "婚礼被老井吞没",
        location: "陆家宅院到村口老井",
        entry_state: "村民围观婚礼但危险尚未显形",
        exit_state: "井口成为所有人物视线与动作的终点",
        visual_progression: ["wide 建立空间", "medium_wide 推近人物", "insert 给关键道具"],
        camera_pattern: "持续变化景别，不连续重复同一机位超过 2 次",
        continuity_rules: [],
      },
    ],
    frames: scales.map((_, index) => {
      const order = index + 1;
      const id = String(order).padStart(3, "0");
      return {
        page_id: `page_${id}`,
        beat_id: `beat_${id}`,
        sequence_block_id: "seq_01",
        shot_role: order === 1 ? "establishing" : order === 7 ? "insert" : "action",
        previous_frame_state: order === 1 ? "opening_state：陆家宅院和老井关系第一次建立" : `上一页结束时人物停在第 ${order - 1} 个压迫位置`,
        current_visual_action: actions[index],
        state_delta: stateDeltas[index],
        next_frame_hook: `下一页承接第 ${order} 页留下的井口视线钩子`,
        camera_change_reason: `第 ${order} 页用不同镜头避免连续分镜雷同`,
        must_show: ["老井", "红绣鞋"],
        must_not_repeat: ["上一页相同构图"],
        continuity_summary_for_worker: `page_${id} 摘要：人物和井口关系推进到第 ${order} 层`,
      };
    }),
  };
  mutateStoryboard?.(storyboard);

  const prompts = {
    version: 1,
    mode: "single_page_vertical",
    aspect_ratio: "9:16",
    source: "02_prompts/timeline_beats.json",
    director_plan: "02_prompts/director_visual_plan.json",
    pages: scales.map((shotScale, index) => {
      const order = index + 1;
      const id = String(order).padStart(3, "0");
      const directive = director.beat_directives[index];
      return {
        page_id: `page_${id}`,
        beat_id: `beat_${id}`,
        audio_segment_id: `seg_${id}`,
        source_text: "陆家新娘站在村口老井边，红绣鞋和井水把婚礼变成阴亲。",
        target_file: `03_images/story_pages/page_${id}.png`,
        director_directive: directive,
        storyboard_frame: {
          shot_role: storyboard.frames[index].shot_role,
          previous_frame_state: storyboard.frames[index].previous_frame_state,
          current_visual_action: storyboard.frames[index].current_visual_action,
          state_delta: storyboard.frames[index].state_delta,
          next_frame_hook: storyboard.frames[index].next_frame_hook,
          camera_change_reason: storyboard.frames[index].camera_change_reason,
          must_show: storyboard.frames[index].must_show,
          must_not_repeat: storyboard.frames[index].must_not_repeat,
          neighbor_context: {
            previous_page: index === 0 ? "opening_state：无上一页，保持开场空间关系" : storyboard.frames[index - 1].continuity_summary_for_worker,
            next_page: index === scales.length - 1 ? "closing_state：无下一页，收束井口压迫" : storyboard.frames[index + 1].continuity_summary_for_worker,
          },
        },
        prompt_structure: {
          shot_function: order === 7 ? "关键道具插入" : "建立空间并制造村民压迫",
          shot_scale: shotScale,
          camera_angle: directive.camera_angle,
          camera_motion: directive.camera_motion,
          foreground: "前景是湿冷井栏和红绣鞋，形成遮挡与危险入口",
          midground: "中景是陆玉娘与沈砚的站位和视线关系",
          background: "背景是压近的陆家村民和祠堂门廊",
          character_blocking: "沈砚在左侧门槛，陆玉娘在中景偏右，村民从背景压近",
          prop_blocking: "红绣鞋在井栏旁，红线从鞋尖连向井口",
          lighting: "阴天冷灰和井底冷青光保持连续",
          continuity_anchor: "井始终在画面右下或前景，人物由左向右靠近井口",
          negative_prompt: "不要控制页，不要漫画格，不要对白气泡，不要字幕，不要UI",
        },
        continuity: {
          sequence_block_id: "seq_01",
          location: "陆家宅院到村口老井",
          screen_direction: "人物从画面左侧向右侧井口移动",
          character_positions: "沈砚在左侧，陆玉娘在中景偏右，村民在背景半圆围住",
          prop_state: "红绣鞋湿透，红线贴着井栏，井水保持黑冷",
          lighting_state: "阴天冷灰加井底冷青光",
        },
        prompt: [
          "9:16 vertical single story page, 完整剧情瞬间，不是控制页，不是漫画格。",
          `${storyboard.frames[index].shot_role} shot。第 ${order} 页动作：${storyboard.frames[index].current_visual_action}。`,
          `状态变化：${storyboard.frames[index].state_delta}。`,
          `镜头改变理由：${storyboard.frames[index].camera_change_reason}。`,
          `镜头语言：景别 ${shotScale}，视角 ${directive.camera_angle}，静帧运镜 ${directive.camera_motion}。`,
          "前景 foreground 是湿冷井栏和红绣鞋，中景 midground 是陆玉娘和沈砚的视线，背景 background 是村民和祠堂门廊。",
          "人物站位清楚，道具位置清楚，光线为室内暖光和窗外冷蓝街灯，先镜头调度后统一视觉风格。",
        ].join("\n"),
      };
    }),
  };
  mutatePrompts?.(prompts);

  const workerBatches = [
    {
      version: 1,
      worker_id: "worker_01",
      sequence_context: [
        {
          sequence_block_id: "seq_01",
          entry_state: storyboard.sequence_blocks[0].entry_state,
          exit_state: storyboard.sequence_blocks[0].exit_state,
          camera_pattern: storyboard.sequence_blocks[0].camera_pattern,
        },
      ],
      pages: prompts.pages.slice(0, 4).map((page) => ({
        page_id: page.page_id,
        prompt: page.prompt,
        neighbor_context: page.storyboard_frame.neighbor_context,
      })),
    },
    {
      version: 1,
      worker_id: "worker_02",
      sequence_context: [
        {
          sequence_block_id: "seq_01",
          entry_state: storyboard.sequence_blocks[0].entry_state,
          exit_state: storyboard.sequence_blocks[0].exit_state,
          camera_pattern: storyboard.sequence_blocks[0].camera_pattern,
        },
      ],
      pages: prompts.pages.slice(4).map((page) => ({
        page_id: page.page_id,
        prompt: page.prompt,
        neighbor_context: page.storyboard_frame.neighbor_context,
      })),
    },
  ];
  mutateWorkerBatches?.(workerBatches);

  writeJson(path.join(runFolder, "02_prompts/director_visual_plan.json"), director);
  if (writeStoryboard) {
    writeJson(path.join(runFolder, "02_prompts/storyboard_sequence_plan.json"), storyboard);
  }
  writeJson(path.join(runFolder, "02_prompts/vertical_page_prompts.json"), prompts);
  workerBatches.forEach((batch, index) => {
    writeJson(path.join(runFolder, `02_prompts/worker_batches/vertical_batch_worker_${String(index + 1).padStart(2, "0")}.json`), batch);
  });
  return { workdir, runFolder };
}

function cleanPrompt() {
  return [
    "请生成第 1 张独立 1:2 竖版漫画控制页。",
    "必须参考随 prompt 一起提供的 character_board_master.png，保持同一张脸、发型、年龄感、体型和服装系统。",
    "严禁左右分栏，必须是上下结构：上方角色控制区，下方剧情漫画区。",
    "上方角色控制区占整张图高度约三分之一，下方剧情漫画区占约三分之二，中间有高对比、连续、干净的横向分隔线。",
    "下方剧情漫画区是黑框分隔的正式漫画分镜页，包含 5 个漫画格，使用大格、中格、小格混排。",
    "下方漫画格必须有高对比黑色实线格线，格线宽度约下方漫画区短边的 1% 到 2%，每格完整闭合边框。",
    "格子之间保留 2% 到 3% 干净留白 / gutter，人物、触手、雾气、文字和背景纹理不得穿越 gutter。",
    "画面保持干净、克制、可裁切、可读，减少伪细节、过度锐化和随机噪点。",
    "每格表现人物与场景关系：林照回村、族长递钥匙、铜皮箱弹开、老井红线绷响、族谱渗出名字。",
    "负面限制：不要单张插画，不要长卷，不要九宫格，不要现代 UI，不要水印，不要血条，不要欧美哥特城堡。",
  ].join("\n");
}

function panelBbox(index) {
  return [
    { x: 0.02, y: 0.02, width: 0.96, height: 0.24 },
    { x: 0.02, y: 0.29, width: 0.46, height: 0.3 },
    { x: 0.52, y: 0.29, width: 0.46, height: 0.3 },
    { x: 0.02, y: 0.64, width: 0.46, height: 0.32 },
    { x: 0.52, y: 0.64, width: 0.46, height: 0.32 },
  ][index];
}

function syncDerivedText(runFolder, text) {
  for (const relativePath of [
    "01_script/audio_segments.json",
    "01_script/narration_timestamps.json",
    "02_prompts/control_page_prompts.json",
  ]) {
    const filePath = path.join(runFolder, relativePath);
    const json = readJson(filePath);
    if (relativePath.endsWith("control_page_prompts.json")) {
      json.pages[0].panels[0].text = text;
    } else {
      json.segments[0].text = text;
    }
    writeJson(filePath, json);
  }
}

function runValidator(validator, workdir) {
  return spawnSync(
    "node",
    [validator, "project_output/control-page-runs/demo", "--project-root", workdir],
    { encoding: "utf8" },
  );
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

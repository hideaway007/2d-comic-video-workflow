# 9:16 单页流程交接契约

这些 JSON 是主 session 与 subagent 之间的交接边界。后续阶段必须只依赖这些文件
继续执行，不要依赖聊天上下文。

旧版 `control_page_prompts.json`、`page_manifest.json`、`panel_crop_manifest.json`
和 splitter 裁切契约不再属于默认流程。新流程默认是一 beat 对应一张 9:16
`story_page`。

## Upstream planning pack dependency

前期策划包由 `$comic-upstream-planner` 生成并验证。默认输入位置：

```text
00_brief/story_strategy.json
00_brief/event_scene_map.json
00_brief/character_registry.json
00_brief/environment_registry.json
00_brief/prop_registry.json
00_brief/reference_selection_plan.json
00_brief/adaptation_plan.md
00_brief/upstream_planning_audit.json
```

规则：

- `00_brief/upstream_planning_audit.json.passed` 必须为 `true`，除非用户明确提供完整可用口播并要求跳过前期策划。
- `$comic-control-page-video` 只消费这些文件，不维护 Phase 0 schema。详细 schema 见 `$comic-upstream-planner` 的 `references/handoff-contracts.md`。
- 如果前期策划包缺失或未通过，先切回 `$comic-upstream-planner` 修 `00_brief`，不要在视频 skill 内重新规划故事。

## story_package.json

```json
{
  "version": 1,
  "mode": "chinese_cthulhu_weird_tale",
  "title": "井皮",
  "first_sentence": "林照回槐湾，是为了替死去的二叔收一只铜皮箱。",
  "opening_pattern": "日常入口 + 第一处错位 + 一句禁忌",
  "one_line_hook": "井不是取水用的，是给下面那东西换皮用的。",
  "target_duration_minutes": "6-9",
  "target_word_count": "2200-3200",
  "narration_path": "01_script/narration.md",
  "review_packet_path": "01_script/human_review_packet.md",
  "fiction_boundary_path": "01_script/fiction_boundary.md",
  "upstream_plan_path": "00_brief/story_strategy.json",
  "event_scene_map_path": "00_brief/event_scene_map.json",
  "character_registry_path": "00_brief/character_registry.json",
  "style_reference_manifest_path": "00_brief/style_reference_manifest.json",
  "image_keywords": ["古井", "祠堂", "族谱", "黑水", "盐霜", "无眼神像"]
}
```

规则：

- `mode=jianghu_yeshi_rebirth_narration` 时必须有 `historical_fact_base_path`。
- `mode=chinese_cthulhu_weird_tale` 时必须有 `fiction_boundary_path`，不得写真实
  历史事实底座。
- 默认必须记录 `upstream_plan_path`、`event_scene_map_path` 和
  `character_registry_path`，除非用户明确跳过 Phase 0 并写明原因。
- 审核前不要生成 `timeline_beats.json`、`director_visual_plan.json`、
  `audio_segments.json`、`narration_timestamps.json` 或 `vertical_page_prompts.json`。

## review_status.json

```json
{
  "version": 1,
  "status": "pending_human_review",
  "stage": "narration",
  "approved_at": null,
  "review_notes": []
}
```

允许状态：

- `pending_human_review`
- `revision_requested`
- `approved`

只有用户明确说“通过”“可以继续”“按这个来”等同义表达后，主控才可把
`status` 改为 `approved`。

## timeline_beats.json

```json
{
  "version": 1,
  "source": "01_script/narration.md",
  "mode": "chinese_cthulhu_weird_tale",
  "segmentation_policy": {
    "unit": "visual_beat",
    "target_chars": "20-50 Chinese chars, hard constraint",
    "target_duration_sec": "4-8 estimated before TTS",
    "hard_rule": "one beat maps to one 9:16 story page, one audio segment, and one timestamp row"
  },
  "beats": [
    {
      "beat_id": "beat_001",
      "order": 1,
      "page_id": "page_001",
      "audio_segment_id": "seg_001",
      "text": "口播文本",
      "estimated_start_sec": 0.0,
      "estimated_end_sec": 5.8,
      "scene_function": "建立场景",
      "visual_prompt_brief": "虚构村口夜路，油灯照出湿纸般的雾，远处祠堂门缝渗出黑水。",
      "key_characters": ["主角"],
      "key_props": ["油灯", "祠堂", "黑水"],
      "source_char_range": {
        "start": 0,
        "end": 34
      },
      "segmentation_exception": null
    }
  ]
}
```

规则：

- `beats[*].beat_id`、`page_id`、`audio_segment_id` 必须唯一且稳定。
- 默认一 beat 对应一张 9:16 story page、一个 TTS audio segment 和一个 timestamp row。
- `beats[*].text` 必须落在 20-50 个中文字符内；如有例外，必须写
  `segmentation_exception.reason`。
- 不得为了减少图片、TTS 段数或 worker 批次而合并 beat 或放宽字数。
- `visual_prompt_brief` 是图像 prompt 的语义种子，后续图片 prompt 只能扩写它，
  不能改变剧情含义。

## director_visual_plan.json

由 `references/director-visual-planning.md` 生成，是全部图片 prompt 的上游控制文件。

```json
{
  "version": 1,
  "mode": "single_page_vertical",
  "director_intent": "用场景空间和人物动线制造压迫，少特写，多环境调度。",
  "visual_continuity_bible": {
    "palette_arc": ["blue-gray fog", "salt white", "cinnabar red accents"],
    "lighting_arc": ["overcast dawn", "oil lamp cyan", "well cold light"],
    "camera_language": ["wide", "medium-wide", "over-shoulder", "bird-eye"],
    "shot_scale_ratio": {
      "wide_or_establishing": "40-55%",
      "medium_or_over_shoulder": "35-50%",
      "close_up": "0-10%, only for key reveal"
    },
    "texture_rules": ["restrained grime", "readable silhouettes"],
    "negative_prompts": ["no speech bubble", "no panel border", "no reference board pasted into page"]
  },
  "space_bible": {
    "master_site_plan": "总平面关系",
    "key_sets": [],
    "movement_routes": [],
    "prop_positions": []
  },
  "sequence_blocks": [],
  "beat_directives": [
    {
      "beat_id": "beat_001",
      "shot_scale": "wide",
      "camera_angle": "high oblique",
      "camera_motion": "locked-off establishing reveal",
      "lighting": "low overcast fog",
      "composition": "主角小，环境压迫大",
      "character_blocking": "主角站在门槛外，看向院内",
      "prop_blocking": "铜箱在前景地面，井在远景",
      "environment_focus": "祖屋、祠堂、井的空间关系",
      "avoid": ["face close-up", "panel layout"]
    }
  ],
  "worker_prompt_rules": {
    "must_include": [],
    "must_not_include": [],
    "reference_policy": "same reference boards and same space bible for all workers",
    "batch_consistency_notes": []
  }
}
```

规则：

- `beat_directives[*].beat_id` 必须覆盖所有需要生成图片的 beat。
- 后续 `vertical_page_prompts.json.pages[*].prompt` 必须吸收对应 beat directive。
- 不得让 worker 自行决定全片景别比例、灯光递进、场景连续性或人物动线。

## storyboard_sequence_plan.json

由 `timeline_beats.json` 和 `director_visual_plan.json` 生成，必须位于
`director_visual_plan.json` 之后、`vertical_page_prompts.json` 之前。它是连续分镜
权威，后续单页 prompt 必须从 `frames[*]` 派生。

```json
{
  "version": 1,
  "mode": "single_page_vertical",
  "source": "02_prompts/timeline_beats.json",
  "director_plan": "02_prompts/director_visual_plan.json",
  "sequence_blocks": [
    {
      "block_id": "seq_01",
      "beat_range": ["beat_001", "beat_006"],
      "dramatic_function": "繁华误读被打碎",
      "location": "汴河繁华想象与船边现实",
      "entry_state": "观众以为漕运是热闹风景",
      "exit_state": "主角意识到自己被官粮和账册压住",
      "visual_progression": [
        "wide 建立热闹",
        "medium_wide 把米袋压到前景",
        "over_shoulder 让差役看见账册",
        "insert 给官物封记或朱笔"
      ],
      "camera_pattern": "wide -> medium_wide -> over_shoulder -> insert，不连续重复同一机位超过 2 次",
      "continuity_rules": []
    }
  ],
  "frames": [
    {
      "page_id": "page_001",
      "beat_id": "beat_001",
      "sequence_block_id": "seq_01",
      "shot_role": "establishing",
      "previous_frame_state": "opening_state",
      "current_visual_action": "船队靠近码头，官粮袋被抬上岸",
      "state_delta": "从远处风景转为官粮压力进入前景",
      "next_frame_hook": "账册和差役视线将接管画面",
      "camera_change_reason": "开场需要先建立空间，再为下一页的压迫中景留出变化",
      "must_show": ["码头", "官粮袋", "船队"],
      "must_not_repeat": ["face close-up"],
      "continuity_summary_for_worker": "page_001 建立码头与官粮袋位置，下一页承接账册和差役。"
    }
  ]
}
```

规则：

- `frames.length` 必须等于 `timeline_beats.json.beats.length`。
- `frames[*].page_id` / `beat_id` 必须与对应 beat 一一对齐。
- `shot_role` 只能取：`establishing`、`action`、`reaction`、`insert`、
  `transition`、`payoff`。
- 每个 frame 必须有非空 `previous_frame_state`、`current_visual_action`、
  `state_delta`、`next_frame_hook` 和 `camera_change_reason`。
- 同一 sequence 内不得连续 3 页复用同一 `shot_scale + camera_angle + camera_motion`；
  不得重复同一个 `current_visual_action`。
- `continuity_summary_for_worker` 必须是短上下文，不替代完整 prompt。

## audio_segments.json

```json
{
  "version": 1,
  "source": "02_prompts/timeline_beats.json",
  "segments": [
    {
      "segment_id": "seg_001",
      "visual_beat_id": "beat_001",
      "page_id": "page_001",
      "text": "口播文本",
      "audio": "segments/seg_001.mp3"
    }
  ]
}
```

规则：

- `text` 是交给豆包 TTS 的原文，不要塞分镜说明或导演提示。
- `audio` 是相对 `05_video/audio/` 的输出路径。
- 每段必须映射到 `visual_beat_id` 和 `page_id`。
- 默认一 beat 一段。若豆包长度限制要求拆多音频文件，拆分段必须保留同一个
  `visual_beat_id`，并在 `split_reason` 说明。

## narration_timestamps.json

```json
{
  "version": 1,
  "source": "02_prompts/timeline_beats.json",
  "timebase": "seconds",
  "timing_basis": "estimated_before_audio",
  "segments": [
    {
      "segment_id": "seg_001",
      "visual_beat_id": "beat_001",
      "page_id": "page_001",
      "start_sec": 0,
      "end_sec": 5.8,
      "text": "口播文本"
    }
  ]
}
```

真实音频生成后，以 `05_video/audio/voice_timeline.json` 为准。

## reference_board_prompts.json

```json
{
  "version": 1,
  "source": "02_prompts/director_visual_plan.json",
  "references": [
    {
      "reference_id": "character_prop_reference",
      "target_file": "03_images/references/character_prop_reference.png",
      "prompt": "人物、表情、关键道具和状态变化参考图 prompt"
    },
    {
      "reference_id": "location_plan_reference",
      "target_file": "03_images/references/location_plan_reference.png",
      "prompt": "场地总平面、房屋关系、人物动线图 prompt"
    },
    {
      "reference_id": "shot_style_reference",
      "target_file": "03_images/references/shot_style_reference.png",
      "prompt": "灯光、色彩、构图和视觉密度参考图 prompt"
    }
  ]
}
```

## vertical_page_prompts.json

```json
{
  "version": 1,
  "mode": "single_page_vertical",
  "aspect_ratio": "9:16",
  "source": "02_prompts/timeline_beats.json",
  "director_plan": "02_prompts/director_visual_plan.json",
  "storyboard_plan": "02_prompts/storyboard_sequence_plan.json",
  "reference_manifest": "03_images/references/reference_manifest.json",
  "pages": [
    {
      "page_id": "page_001",
      "beat_id": "beat_001",
      "audio_segment_id": "seg_001",
      "source_text": "口播文本",
      "target_file": "03_images/story_pages/page_001.png",
      "director_directive": {
        "shot_scale": "wide",
        "camera_angle": "high oblique",
        "camera_motion": "locked-off establishing reveal",
        "lighting": "low overcast fog",
        "composition": "主角小，环境压迫大",
        "character_blocking": "主角站在门槛外",
        "prop_blocking": "铜箱在前景地面",
        "environment_focus": "祖屋、祠堂、井的空间关系"
      },
      "prompt_structure": {
        "shot_function": "建立空间 / 制造压迫 / 揭示异兆 / 关键道具插入 / 情绪反应",
        "shot_scale": "wide",
        "camera_angle": "high oblique",
        "camera_motion": "locked-off establishing reveal",
        "foreground": "前景主体与遮挡关系",
        "midground": "人物动作和视线关系",
        "background": "场景纵深和环境信息",
        "character_blocking": "人物站位与动作",
        "prop_blocking": "关键道具位置和状态",
        "lighting": "本 beat 灯光",
        "continuity_anchor": "承接上一张和下一张的空间 / 方向 / 道具状态锚点",
        "negative_prompt": "禁止项"
      },
      "continuity": {
        "sequence_block_id": "seq_01",
        "location": "陆家宅院 / 村口老井 / 祠堂",
        "screen_direction": "人物从画面左侧进入，井始终在画面右下或前景",
        "character_positions": "沈砚、陆玉娘、村民、阿喜的相对位置",
        "prop_state": "红绣鞋、井水、红线、族谱等道具状态",
        "lighting_state": "阴天冷灰 / 油灯暗红 / 井底冷青光"
      },
      "storyboard_frame": {
        "shot_role": "establishing",
        "previous_frame_state": "opening_state",
        "current_visual_action": "主角站在门槛外，看见铜箱和井的位置关系",
        "state_delta": "从空场景进入人物与道具关系",
        "next_frame_hook": "下一页承接主角视线落到铜箱封记",
        "camera_change_reason": "用高位广角先建立祖屋、祠堂、井的空间轴线",
        "must_show": ["主角", "铜箱", "井", "祠堂门槛"],
        "must_not_repeat": ["face close-up", "flat frontal portrait"],
        "neighbor_context": {
          "previous_page": "opening_state：无上一页，承接 sequence entry_state。",
          "next_page": "page_002 转向铜箱封记和主角视线。"
        }
      },
      "prompt": "可直接投喂 image_gen 的完整 9:16 单页 prompt"
    }
  ],
  "batches": [
    {
      "worker_id": "vertical_batch_worker_01",
      "assigned_pages": ["page_001", "page_002", "page_003", "page_004", "page_005"],
      "prompt_file": "02_prompts/worker_batches/vertical_batch_worker_01.json",
      "output_manifest": "03_images/worker_manifests/vertical_batch_worker_01.json"
    }
  ]
}
```

规则：

- `pages.length` 必须等于 `timeline_beats.json.beats.length`。
- 每个 `pages[*].storyboard_frame` 必须从 `storyboard_sequence_plan.json.frames[*]`
  派生，并按 `page_id` / `beat_id` 对齐。
- 每个 prompt 必须是一张完整 9:16 竖版剧情图，不是控制页，不是漫画格。
- prompt 必须包含导演指令、reference pack、场景空间、人物动线、灯光和禁止项。
- prompt 必须先表达分镜任务：`shot_role`、`current_visual_action`、`state_delta`、
  景别 / 机位 / 运镜和 `camera_change_reason`；再写前景 / 中景 / 背景、人物站位、
  道具状态和灯光；最后才引用口播原文。不得让口播句子替代画面动作。
- prompt 必须先写镜头语言，再写美术风格；`prompt_structure` 和 `continuity`
  是必填结构化字段。
- `storyboard_frame.neighbor_context.previous_page` 和 `next_page` 必须携带前后页
  continuity 摘要；第一页 / 最后一页也要写 `opening_state` / `closing_state`，
  不使用空值。
- 镜头比例 gate：空间镜头默认不少于 55%，`close_up` 默认不超过 15%，`insert`
  只能用于关键道具、声音来源或恐怖信息揭示。
- 禁止出现 panel layout、speech bubble、caption、reference board pasted into image。
- 每个 worker batch 最多 5 张图；单批最多 6 个 worker。

## worker_batches/vertical_batch_worker_##.json

每个 worker batch 是 image worker 的唯一任务输入之一。worker 只能写自己的 story
pages 和 worker manifest，不得重写上游规划文件。

```json
{
  "version": 1,
  "worker_id": "vertical_batch_worker_01",
  "source": "02_prompts/vertical_page_prompts.json",
  "storyboard_plan": "02_prompts/storyboard_sequence_plan.json",
  "assigned_pages": ["page_001", "page_002", "page_003", "page_004", "page_005"],
  "sequence_context": [
    {
      "sequence_block_id": "seq_01",
      "entry_state": "观众以为漕运是热闹风景",
      "exit_state": "主角意识到自己被官粮和账册压住",
      "camera_pattern": "wide -> medium_wide -> over_shoulder -> insert，不连续复用同一机位"
    }
  ],
  "pages": [
    {
      "page_id": "page_001",
      "beat_id": "beat_001",
      "target_file": "03_images/story_pages/page_001.png",
      "prompt": "完整 9:16 单页 prompt",
      "neighbor_context": {
        "previous_page": "opening_state：无上一页，承接 sequence entry_state。",
        "next_page": "page_002 转向铜箱封记和主角视线。"
      }
    }
  ],
  "output_manifest": "03_images/worker_manifests/vertical_batch_worker_01.json"
}
```

规则：

- `pages[*].neighbor_context` 必须来自对应 `vertical_page_prompts.json.pages[*].storyboard_frame.neighbor_context`。
- worker 必须看到自己负责页的完整 prompt，以及每页前一页和后一页的
  `continuity_summary_for_worker`。
- `sequence_context` 必须覆盖本 batch 涉及的 sequence，并包含每个 sequence 的
  `entry_state` / `exit_state` / `camera_pattern`。
- batch 内最多 5 页；单批最多 6 个 worker。

## reference_manifest.json

```json
{
  "version": 1,
  "reference_transport": {
    "supports_image_reference": true,
    "notes": "reference boards were attached to workers"
  },
  "references": [
    {
      "reference_id": "character_prop_reference",
      "file": "03_images/references/character_prop_reference.png",
      "sha256": "required",
      "generation_source": "image_gen",
      "purpose": "characters and key props"
    }
  ]
}
```

## vertical_image_manifest.json

```json
{
  "version": 1,
  "mode": "single_page_vertical",
  "requested_page_count": 30,
  "generated_page_count": 30,
  "worker_count": 6,
  "pages_per_worker": 5,
  "image_source_policy": "image_gen via subagent workers; no PIL/SVG/canvas/HTML/CSS/placeholder content generation",
  "crop_policy": "skip panel crop in the default 9:16 workflow",
  "dimensions_summary": {
    "target_semantics": "9:16 vertical",
    "unique_sizes": ["941x1672"]
  },
  "worker_manifests": [],
  "pages": [
    {
      "page_id": "page_001",
      "file": "03_images/story_pages/page_001.png",
      "width": 941,
      "height": 1672,
      "sha256": "required",
      "source": "image_gen"
    }
  ],
  "audit": {
    "passed": true,
    "notes": []
  }
}
```

规则：

- `generated_page_count` 必须等于 `requested_page_count`。
- 每个 page 文件必须存在、非空、竖版。
- `source` 必须证明来自 `image_gen`。
- `audit.passed !== true` 时不得进入 TTS 或视频。

## image_review_status.json

图片阶段的人工审核状态文件。生成 `vertical_image_manifest.json` 和 contact sheet 后，
主控必须先写 `pending`；只有用户明确通过图片后，才可改成 `approved`。

```json
{
  "version": 1,
  "status": "pending",
  "stage": "images",
  "review_required": true,
  "approved_at": null,
  "review_notes": []
}
```

允许状态：

- `pending`
- `revision_requested`
- `approved`

规则：

- `status !== "approved"` 时不得进入 TTS、build 或 render。
- 不允许由 subagent 或脚本自动批准图片；必须来自用户明确人工确认。
- 图片重生成后必须把状态重置为 `pending`。

## voice_timeline.json

默认由 `scripts/synthesize-doubao-voice.mjs --mode whole` 根据整篇豆包音频真实
总时长写出，并保留一 beat 一段的估算边界；如果已有 forced alignment JSON，
则由 `scripts/build-forced-aligned-voice-timeline.mjs` 根据完整音频和对齐结果
写出精确边界。只有整篇请求失败或用户明确要求时，才使用 `--mode segmented`。

```json
{
  "version": 1,
  "provider": "doubao-volcengine",
  "resource_id": "seed-tts-2.0",
  "voice": "zh_male_ruyayichen_uranus_bigtts",
  "speech_rate": 25,
  "synthesis_mode": "whole",
  "alignment_status": "estimated",
  "alignment_strategy": "previous_voice_timeline_durations:segmented",
  "audio": "05_video/audio/master.mp3",
  "totalMs": 12800,
  "segments": [
    {
      "segment_id": "seg_001",
      "page_id": "page_001",
      "text": "口播文本",
      "audio": "05_video/audio/master.mp3",
      "startMs": 0,
      "endMs": 4200,
      "durationMs": 4200
    }
  ]
}
```

规则：

- `totalMs` 必须来自真实 `master.mp3` 或分段音频时长求和。
- `segments[*].durationMs` 必须大于 0。
- `segments.length` 必须等于 `vertical_image_manifest.generated_page_count`。
- `synthesis_mode=whole` 且没有 forced alignment 时，必须显式写
  `alignment_status=estimated` 和 `alignment_strategy`，不得伪装成精确对齐。
- 如果用户要求 forced alignment 精确对齐但对齐失败，必须保留
  `05_video/audio/forced_alignment_report.json` 诊断，并停止进入渲染和字幕阶段。

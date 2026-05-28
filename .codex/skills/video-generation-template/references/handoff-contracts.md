# 9:16 单页流程交接契约

这些 JSON 是主 session 与 subagent 之间的交接边界。后续阶段必须只依赖这些文件
继续执行，不要依赖聊天上下文。

旧版 `control_page_prompts.json`、`page_manifest.json`、`panel_crop_manifest.json`
和 splitter 裁切契约不再属于默认流程。新流程默认是一 beat 对应一张 9:16
`story_page`。

## Upstream planning pack dependency

前期策划包由 `$video-upstream-planner` 生成并验证。默认输入位置：

```text
00_brief/video_strategy.json
00_brief/event_scene_map.json
00_brief/entity_registry.json
00_brief/setting_registry.json
00_brief/asset_registry.json
00_brief/reference_selection_plan.json
00_brief/adaptation_plan.md
00_brief/upstream_planning_audit.json
```

规则：

- `00_brief/upstream_planning_audit.json.passed` 必须为 `true`，除非用户明确提供完整可用口播并要求跳过前期策划。
- `$video-generation-template` 只消费这些文件，不维护 Phase 0 schema。详细 schema 见 `$video-upstream-planner` 的 `references/handoff-contracts.md`。
- 如果前期策划包缺失或未通过，先切回 `$video-upstream-planner` 修 `00_brief`，不要在视频 skill 内重新规划内容。

## video_package.json

```json
{
  "version": 1,
  "mode": "short_vertical_video",
  "content_profile": "fiction_story",
  "title": "夜班咖啡馆",
  "first_sentence": "凌晨两点，咖啡馆的订单屏突然亮起一杯已经付款的拿铁。",
  "opening_pattern": "日常秩序 + 第一处异常 + 一句悬念",
  "one_line_hook": "这杯咖啡没人来取，却像是在等主角替它完成一件事。",
  "target_duration_minutes": "3-6",
  "target_word_count": "900-1800",
  "narration_path": "01_script/narration.md",
  "review_packet_path": "01_script/human_review_packet.md",
  "content_boundary_path": "01_script/content_boundary.md",
  "video_strategy_path": "00_brief/video_strategy.json",
  "event_scene_map_path": "00_brief/event_scene_map.json",
  "entity_registry_path": "00_brief/entity_registry.json",
  "setting_registry_path": "00_brief/setting_registry.json",
  "asset_registry_path": "00_brief/asset_registry.json",
  "reference_selection_plan_path": "00_brief/reference_selection_plan.json",
  "image_keywords": ["深夜咖啡馆", "订单屏", "外带杯", "玻璃门", "街灯"]
}
```

规则：

- 默认必须记录 `video_strategy_path`、`event_scene_map_path` 和各 registry path，除非用户明确跳过 Phase 0 并写明原因。
- 事实 / 资料型视频写 `source_boundary_path`；虚构型视频写 `fiction_boundary_path`；两者都不适用时写 `content_boundary_path`。
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
  "mode": "short_vertical_video",
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
      "visual_prompt_brief": "深夜咖啡馆吧台，订单屏发出冷蓝光，一只无人领取的白色纸杯停在灯下。",
      "key_entities": ["ent_barista"],
      "key_assets": ["asset_order_screen", "asset_takeaway_cup"],
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
  "director_intent": "用空间、动线和光线递进制造清晰叙事，少特写，多环境调度。",
  "visual_continuity_bible": {
    "palette_arc": ["warm interior light", "cool street blue", "soft dawn"],
    "lighting_arc": ["late-night practical light", "street reflection", "early morning low sun"],
    "camera_language": ["wide", "medium-wide", "over-shoulder", "bird-eye"],
    "shot_scale_ratio": {
      "wide_or_establishing": "40-55%",
      "medium_or_over_shoulder": "35-50%",
      "close_up": "0-10%, only for key reveal"
    },
    "texture_rules": ["readable silhouettes", "clean object detail"],
    "negative_prompts": ["no speech bubble", "no panel border", "no reference board pasted into page"]
  },
  "space_bible": {
    "master_site_plan": "总平面关系",
    "key_sets": [],
    "movement_routes": [],
    "asset_positions": []
  },
  "sequence_blocks": [],
  "beat_directives": [
    {
      "beat_id": "beat_001",
      "shot_scale": "wide",
      "camera_angle": "high oblique",
      "camera_motion": "locked-off establishing reveal",
      "lighting": "warm practical light with cool window spill",
      "composition": "主角小，吧台和订单屏控制画面秩序",
      "entity_blocking": "主角站在吧台内，看向订单屏",
      "asset_blocking": "外带杯在前景吧台边缘，订单屏在中景发光",
      "setting_focus": "吧台、玻璃门、窗外街灯的空间关系",
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
- 不得让 worker 自行决定全片景别比例、灯光递进、场景连续性或 entity 动线。

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
      "dramatic_function": "夜班秩序被无人订单打破",
      "location": "深夜咖啡馆吧台",
      "entry_state": "主角只想结束夜班",
      "exit_state": "主角意识到外带杯是一次请求",
      "visual_progression": [
        "wide 建立吧台",
        "medium_wide 把订单屏压到中景",
        "over_shoulder 让杯套留言进入视线",
        "insert 给杯套手写字"
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
      "current_visual_action": "主角清点杯子时，订单屏在空店里突然亮起",
      "state_delta": "从打烊秩序转为异常出现",
      "next_frame_hook": "外带杯上的名字将接管画面",
      "camera_change_reason": "开场需要先建立空间，再为下一页的物件中景留出变化",
      "must_show": ["吧台", "订单屏", "外带杯"],
      "must_not_repeat": ["face close-up"],
      "continuity_summary_for_worker": "page_001 建立吧台、订单屏和外带杯位置，下一页承接杯套留言。"
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
- 同一 sequence 内不得连续 3 页复用同一 `shot_scale + camera_angle + camera_motion`。
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
      "voice_style": "clear narration",
      "estimated_duration_sec": 5.8
    }
  ]
}
```

规则：

- `segments.length` 必须等于 `timeline_beats.json.beats.length`。
- `segments[*].text` 必须与对应 beat 文本一致，除非写明文本清洗原因。

## vertical_page_prompts.json

```json
{
  "version": 1,
  "source": "02_prompts/storyboard_sequence_plan.json",
  "pages": [
    {
      "page_id": "page_001",
      "beat_id": "beat_001",
      "prompt": "可直接投喂 image_gen 的完整画面指令",
      "prompt_structure": {
        "shot_function": "establishing",
        "shot_scale": "wide",
        "camera_angle": "high oblique",
        "camera_motion": "locked-off establishing reveal",
        "foreground": "吧台边缘的一只白色外带杯",
        "midground": "主角在吧台内抬头看向订单屏",
        "background": "玻璃门与窗外冷蓝街灯",
        "entity_blocking": "主角站在画面左中景",
        "asset_blocking": "外带杯在前景，订单屏在中景发光",
        "lighting": "室内暖光与窗外冷光形成对比",
        "continuity_anchor": "吧台、订单屏、玻璃门、外带杯",
        "negative_prompt": "no speech bubble, no panel border, no pasted reference board"
      },
      "continuity": {
        "sequence_block_id": "seq_01",
        "setting": "深夜咖啡馆吧台",
        "screen_direction": "主角从左看向右后方订单屏",
        "entity_positions": "ent_barista left midground",
        "asset_state": "asset_takeaway_cup unopened on counter",
        "lighting_state": "warm interior light plus cool window spill"
      },
      "storyboard_frame": {},
      "neighbor_context": {
        "previous": null,
        "next": "下一页靠近杯套留言"
      }
    }
  ]
}
```

规则：

- `pages.length` 必须等于 beat 数。
- `prompt` 只写画面生成指令，不写解释、Markdown 或 JSON 代码围栏。
- 每页必须包含 `prompt_structure`、`continuity`、`storyboard_frame` 和
  `neighbor_context`。

## worker_batches/vertical_batch_worker_##.json

```json
{
  "version": 1,
  "worker_id": "vertical_batch_worker_01",
  "reference_pack": "03_images/references/reference_manifest.json",
  "reference_transport": {
    "supports_image_reference": false,
    "textualized_reference_policy": "所有参考图内容已转写进每页 prompt"
  },
  "pages": ["page_001", "page_002", "page_003"],
  "output_dir": "03_images/story_pages",
  "manifest_path": "03_images/worker_manifests/vertical_batch_worker_01.json"
}
```

规则：

- 单个 worker batch 最多 5 页。
- worker 只写自己的图片和 manifest。
- worker manifest 必须记录每页输出路径、生成方式、失败原因和是否可重跑。

---
name: video-generation-template
description: 当用户已有通过 video-upstream-planner 验证的 00_brief 前期策划包，或明确提供完整可用口播，并希望生成 9:16 竖屏图像叙事视频、语音、字幕对齐和 2.5D 视频时使用；若只有标题、资料、小说、剧本或粗 brief，先用 video-upstream-planner。
---

# 9:16 竖屏视频生成模板

把已通过前期策划包的主题，或用户明确提供的完整可用口播，做成可审核、可交接、
可验证的 9:16 竖屏视频流水线。产出物包括口播 / 视频包、beat-first 时间轴、
导演视觉统筹、参考图包、9:16 单页剧情图、豆包语音、2.5D 视频和烧录字幕版视频。

默认只在 Phase 1A 口播稿后保留人工审核停顿。用户通过口播后，后续图片、音频、
视频和字幕阶段用机器 gate、QA、`ffprobe` 和项目验证命令继续推进；除非用户明确
要求再次人工审核，不得把图片或后期阶段卡在人工确认。

本 skill 是通用视频生产入口。前期策划由 `$video-upstream-planner` 负责；如果
没有通过验证的 `00_brief/upstream_planning_audit.json`，先切到
`$video-upstream-planner`。本 skill 只消费策划包，不维护 Phase 0 schema，也不
在视频阶段重写世界观、结构、事件、实体、场景或关键资产。

旧的 1:2 控制页、上方设定区 + 下方分格、splitter 裁切、`04_panel_crops` 和
`input/pages` 预裁单格流程不再是默认路径。除非用户明确要求“回到旧版控制页
裁切流程”，不得启用旧逻辑。

## 适用场景

- 短视频讲解、知识解释、课程片段。
- 小说 / 剧本 / 原创故事改编成图像叙事视频。
- 产品 demo、品牌故事、功能介绍或宣传短片。
- 纪录短片、人物 / 事件材料整理、资料型视频。
- 用户已经给出通过 `$video-upstream-planner` 验证的 `00_brief` 前期策划包。
- 用户明确提供完整可用口播，并要求跳过前期策划直接进入视频生产。

本 skill 不用于只做单张图、普通网页视频或纯文字润色。

## 工作流总览

```text
Preflight  前期策划包检查
   0.1  检查 00_brief/upstream_planning_audit.json.passed
   0.2  缺失或失败时，先使用 $video-upstream-planner
   ▼
Phase 1A  口播稿与审核包
   1.1  读取 00_brief 前期策划包
   1.2  一次产出 narration.md + video_package.json + 审核包
   ▼
[Checkpoint Narration]     ← 必须停。用户明确通过后才能进入 1B
   ▼
Phase 1B  Beat-First + 导演统筹
   1.3  narration.md → timeline_beats.json
   1.4  director_visual_plan：全片场景 / 分镜 / 运镜 / 灯光 / 动线
   1.5  storyboard_sequence_plan：连续分镜账本
   1.6  从 beat 表派生 audio_segments / timestamps，从 storyboard frame 派生 vertical page prompts
   ▼
[Gate Plan]                ← timeline + director + prompt JSON 自检
   ▼
Phase 2   参考图包与 9:16 单页剧情图
   2.1  主 session 用 image_gen 生成 reference boards
   2.2  image workers 分批生成 9:16 story pages，每个 worker 最多 5 张
   ▼
[Gate Images]              ← contact sheet + manifest + machine audit；默认不停人工审核
   ▼
Phase 3   语音、视频与字幕
   3.1  整篇 TTS + 真实音频 forced alignment
   3.2  stage story_pages as runtime images
   3.3  build / apply-audio-timeline / render / qa / verify / ffprobe
   3.4  burn-subtitles，字幕按真实 cue 时间戳并保留停顿 + ffprobe
```

工作目录约定（每次执行创建独立 run folder）：

```text
project_output/control-page-runs/<YYYYMMDD-HHMMSS-slug>/
  00_brief/
    video_strategy.json
    event_scene_map.json
    entity_registry.json
    setting_registry.json
    asset_registry.json
    reference_selection_plan.json
    adaptation_plan.md
    upstream_planning_audit.json
  01_script/
  02_prompts/
    director_visual_plan.md
    director_visual_plan.json
    storyboard_sequence_plan.json
    vertical_page_prompts.json
    worker_batches/
  03_images/
    references/
      entity_asset_reference.png
      setting_plan_reference.png
      shot_style_reference.png
      reference_manifest.json
    story_pages/
      page_001.png
      page_002.png
    worker_manifests/
    vertical_image_manifest.json
    image_review_status.json
    contact_sheet_vertical_pages.jpg
  05_video/
    audio/
    subtitles/
  handoff.md
```

不要把用户资料、生成图、音频或视频产物写进 skill 目录。

## 硬性原则

### 前期策划是外部依赖

除非用户已经提供完整可用口播并明确要求跳过，默认必须先用
`$video-upstream-planner` 生成并验证 `00_brief` 前期策划包。

Phase 1A 必须从 `00_brief/video_strategy.json`、`event_scene_map.json`、
`entity_registry.json`、`setting_registry.json`、`asset_registry.json` 和
`reference_selection_plan.json` 写观众可听的口播稿，不得绕过策划包重新编一版无关内容。

### Beat-first 是唯一节奏权威

审核通过后必须先从口播稿生成 `02_prompts/timeline_beats.json`。它是口播文本、
图片 prompt、音频段和时间戳的一一对应源头。不得先生成图片、再生成音频、
最后硬凑时间戳。

每个 beat 默认映射为：

- 一个 `audio_segments.json` 段落
- 一个 `narration_timestamps.json` 草稿时间段
- 一张 9:16 runtime story page
- 一个 `vertical_page_prompts.json.pages[*]`

分段必须按“一个可视化瞬间 / 一个视觉动作”切分。20-50 个中文字符是强约束，
不是软参考。不得为了减少图片、TTS 段数、worker 批次或渲染工作量而放宽。

`timeline_beats.json.beats[*].text` 必须覆盖完整口播主体，而不是摘要版提纲。
默认最低覆盖率为 90%；story page 密度默认按每页不超过 40 个有效口播字符计算。
低于 90% 覆盖率时，必须写
`timeline_beats.json.segmentation_policy.coverage_exception.reason`；低于
`ceil(narration_effective_chars / 40)` 页时，必须写
`timeline_beats.json.segmentation_policy.density_exception.reason`。没有可审查例外时
gate 必须失败。

### 导演统筹先于图片 prompt

生成任何单页图片 prompt 或分派 image worker 之前，必须先完成：

```text
02_prompts/director_visual_plan.md
02_prompts/director_visual_plan.json
```

导演方案必须使用 `references/director-visual-planning.md`，从整体控制全片：

- 场景总平面、空间连续性、前中后景关系
- entity 动线、站位、视线和动作方向
- 分镜景别比例，默认少大头特写，多远景 / 中远景 / 过肩 / 鸟瞰 / 纵深构图
- 运镜意图，写入静帧构图中的 push-in、track、locked-off、top-down reveal 等策略
- 灯光递进、色彩弧线、材质控制和信息揭示顺序
- 每个 beat 的 `shot_scale`、`camera_angle`、`camera_motion`、`lighting`、
  `composition`、`entity_blocking`、`asset_blocking` 和 `setting_focus`

不得让各个 subagent 自行决定全片视角比例、灯光递进、场景连续性或 entity 动线。

### 参考图包是图片阶段前置物

主 session 必须在分派剧情图片 worker 前，用 `image_gen` 生成或锁定完整参考图包：

```text
03_images/references/entity_asset_reference.png
03_images/references/setting_plan_reference.png
03_images/references/shot_style_reference.png
03_images/references/reference_manifest.json
```

参考图包至少包含：

- 主要 entity 的稳定形象、状态变化和识别锚点。
- 关键 asset：产品、道具、界面、文件、图表、品牌视觉或环境物。
- setting：场地、总平面关系、镜头轴线和相对位置。
- 动线图：主要 entity 和关键 asset 在关键场景中的移动 / 状态变化路径。
- 灯光 / 色彩 / 材质参考：用于全片统一视觉语言。

如果当前工具不能把本地参考图传给 worker，必须在 worker prompt 和 manifest 中
明确写 `reference_transport.supports_image_reference=false`，并把参考图内容
转译为详细文字约束。不得谎称图片已作为模型 reference 使用。

### 图片生成默认是 9:16 单页

- 每个 beat 直接生成一张完整 9:16 竖版剧情图，默认尺寸语义为 `1080x1920`。
- 不生成上方设定区，不做上下排版，不画分格，不把参考图合并进页面。
- 单页图必须是完整场面图：优先空间、entity 动线、asset 位置、灯光和叙事信息。
- 禁止 panel-first。禁止先生成局部 panel 再合成页面。
- 禁止用本地 PIL、HTML/CSS rasterizer、SVG、canvas、占位图或纯程序化插画替代
  `image_gen` 画面内容。它们只能用于 contact sheet、尺寸检测、标注或后处理。

### subagent 分批规则

- `worker_count = min(6, ceil(page_count / 5))`，单批最多 6 个 worker。
- 每个 worker invocation 最多负责 5 张图。
- 一批最多 30 张图；超过 30 张必须分批。
- 每个 worker 接收同一个 reference pack、自己的 worker batch JSON 和输出路径。
- worker 只写自己的 `03_images/story_pages/page_###.png` 和
  `03_images/worker_manifests/vertical_batch_worker_##.json`。
- worker 不得重写 `timeline_beats.json`、`director_visual_plan.json`、
  `vertical_page_prompts.json`、剧本或其他 worker 的图片。
- worker 断流或 manifest 不完整时，保留已有图片，只重跑缺失页。

## 各阶段文件读取指南

| 阶段 | 必读 | 按需查 |
|---|---|---|
| Preflight 前期策划包检查 | `00_brief/upstream_planning_audit.json`；缺失或失败时使用 `$video-upstream-planner` | 用户明确要求跳过前期策划的原因 |
| Phase 1A 口播稿与审核包 | `00_brief/video_strategy.json`、`event_scene_map.json`、各 registry | 用户原始 brief / 剧本 / 资料 / 风格约束 |
| Phase 1B Beat-First + 导演统筹 | `01_script/narration.md`、`references/director-visual-planning.md`、`references/handoff-contracts.md` | 用户参考图、品牌或风格限制 |
| Phase 2 图片阶段 | `timeline_beats.json`、`director_visual_plan.json`、`vertical_page_prompts.json` | reference pack、用户补充图 |
| Phase 3 音频与视频 | `references/doubao-voice-api.md`、`audio_segments.json`、`timeline_beats.json`、`vertical_image_manifest.json` | `voice_timeline.json` / QA 输出 |

## Phase 1A - 口播稿与审核包

先只生成可审核视频包，不得提前生成图片 prompt、时间戳、音频或视频。

任务：

1. 读取并遵守 `00_brief` 前期策划包，不得绕过已锁定的事件、场景、entity 和 asset。
2. 根据 `video_strategy.route_decision.content_profile` 判断写法：故事、讲解、产品、纪录、广告或自定义。
3. 直接生成完整中文口播稿；事实型内容要保留来源与不确定性边界，虚构型内容要保留虚构边界。
4. 写 `video_package.json`、口播正文和审核包。
5. 事实 / 资料型视频写 `source_boundary.md`；虚构型视频写 `fiction_boundary.md`；两者都不适用时写 `content_boundary.md`。
6. 生成后先按策划包自检，再交给用户审核。

审核前必需文件：

```text
01_script/narration.md
01_script/video_package.json
01_script/source_boundary.md 或 01_script/fiction_boundary.md 或 01_script/content_boundary.md
01_script/human_review_packet.md
01_script/review_status.json
```

`review_status.json` 初始必须是：

```json
{
  "version": 1,
  "status": "pending_human_review",
  "stage": "narration",
  "approved_at": null,
  "review_notes": []
}
```

## Checkpoint Narration - 人工审核门

Phase 1A 完成后必须停住。只有用户明确通过后，才能把
`review_status.json.status` 改为 `approved` 并进入 Phase 1B。

## Phase 1B - Beat-First + 导演统筹

审核通过后，先生成统一 beat 表，再生成导演统筹视觉方案，再生成连续分镜账本；
音频和时间戳从 beat 表派生，9:16 图片 prompt 从 storyboard frame 派生。

必需顺序：

1. 读取已审核的 `01_script/narration.md`。
2. 生成 `02_prompts/timeline_beats.json`。每个 beat 必须包含 `beat_id`、
   `order`、`text`、`estimated_start_sec`、`estimated_end_sec`、`page_id`、
   `audio_segment_id`、`visual_prompt_brief`、`scene_function`、`key_entities`
   和 `key_assets`。
   `beats[*].text` 必须从 `narration.md` 顺序切分或近似完整摘取，不能只写摘要。
3. 从 `timeline_beats.json` 派生 `01_script/audio_segments.json` 和
   `01_script/narration_timestamps.json`。真实语音生成前只能标注为
   `estimated_before_audio`。
4. 使用 `references/director-visual-planning.md` 生成
   `02_prompts/director_visual_plan.md` 和 `02_prompts/director_visual_plan.json`。
5. 从 `timeline_beats.json` 和 `director_visual_plan.json` 生成
   `02_prompts/storyboard_sequence_plan.json`。
6. 派生 `reference_board_prompts.*`、`vertical_page_prompts.*` 和
   `worker_batches/vertical_batch_worker_##.json`。

规则：

- `timeline_beats.json` 是唯一节奏权威；后续文件不得自造不同顺序或不同分段。
- `timeline_beats.json.beats[*].text` 合计必须覆盖 `narration.md` 主体口播，
  默认覆盖率不得低于 90%。
- `storyboard_sequence_plan.json` 是连续分镜权威；`vertical_page_prompts.json`
  必须从对应 storyboard frame 派生，不得只把口播句子包装成单张插画。
- 图片数量由 beat 数决定；一 beat 对应一张 9:16 story page。
- 默认最低 story page 数为 `ceil(narration_effective_chars / 40)`；页数不足只能在
  `segmentation_policy.density_exception.reason` 中写明可审查原因，不能静默压缩。
- prompt 必须吸收 beat、director directive、storyboard frame、reference pack 和用户风格约束。
- prompt 必须写清景别、视角、运镜意图、灯光、构图、entity 站位、asset 位置、
  setting 信息和禁止项。
- prompt 只包含可直接投喂 image_gen 的画面生成指令，不混入解释、审核说明、
  JSON、Markdown 代码围栏、文件清单或时间轴备注。

推荐执行：

```bash
npm run validate:vertical-prompts -- project_output/control-page-runs/<run>
```

通过时必须确认 `02_prompts/vertical_page_prompt_audit.json` 中：

- `passed === true`
- `narration_coverage.beat_text_coverage_ratio >= 0.9`
- `page_count >= narration_coverage.min_page_count_from_narration`

## Phase 2 - 参考图包与 9:16 单页剧情图

图片阶段不能重写剧本、beat 表或导演方案。主 session 先用 `image_gen` 生成
参考图包，再把 9:16 单页剧情图任务分派给 subagent image workers。

主 session 负责生成：

```text
03_images/references/entity_asset_reference.png
03_images/references/setting_plan_reference.png
03_images/references/shot_style_reference.png
03_images/references/reference_manifest.json
```

进入视频前必须确认：

- `story_pages` 数量等于 beat 数。
- 每张图为竖版 PNG，宽高比接近 9:16。
- 每张图来自 `image_gen` 证据，不能是占位图、程序图或 panel 合成图。
- reference board 没有被拼贴进 story page。
- `03_images/contact_sheet_vertical_pages.jpg` 已生成。
- `vertical_image_manifest.audit.passed === true`。
- `image_review_status.status` 默认由机器 gate 通过后写为 `approved`，并在
  `review_notes` 记录 `auto-approved by machine gate` 或等价说明。

## Phase 3 - 语音、视频与字幕

豆包默认参数以 `references/doubao-voice-api.md` 为准：默认音色为儒雅逸辰 2.0，
speaker / voice key 为 `zh_male_ruyayichen_uranus_bigtts`，默认约 1.25x 语速，
对应 `speech_rate=25`。只有用户明确指定其他音色或语速时才覆盖。

执行：

```bash
node .codex/skills/video-generation-template/scripts/synthesize-doubao-voice.mjs project_output/control-page-runs/<run> --project-root . --mode whole
npm run build
node scripts/apply-audio-timeline.mjs project_output/control-page-runs/<run> --project-root .
npm run render:preview
npm run compose:preview -- project_output/control-page-runs/<run>   # 仅当 render:preview 已产出完整 shot previews 但 full composition 卡住 / 失败时使用
npm run burn-subtitles -- project_output/control-page-runs/<run>
npm run qa
npm run verify
```

如果已有外部 forced alignment 输出，先把它写到
`05_video/audio/forced_alignment.json`，再运行：

```bash
npm run align-audio -- project_output/control-page-runs/<run>
```

最终交付前不得只依赖估算时间轴。真实音频生成后，必须收齐：

- `05_video/audio/voice_timeline.json`：`segments` 和 `cues` 都必须来自真实
  `master.mp3` 时长；最终字幕优先使用 forced alignment / ASR word timings。
- `05_video/motion_comic_preview.mp4`：当前项目保留这个兼容文件名，但内容必须是本轮 9:16 视频。
- `05_video/subtitles/subtitle-layer-segmented-white.ffconcat`：必须把 cue 之间的无字
  停顿和尾部空白写成透明 `subtitle_blank.png` duration。

字幕默认必须生成，除非用户明确说不要字幕。字幕源用当前 run 的
`05_video/audio/voice_timeline.json`，样式为白色大字、无背景框、深色描边和阴影。
字幕字号固定，默认 `66px`；字幕位置锚点在画面高度 `0.75`。

## 最终验证

- `npm run verify` 必须通过，preview 数量必须等于 story page 数。
- 用 `ffprobe` 确认 final MP4 同时有 H.264 video stream 和 AAC audio stream。
- 用 `ffprobe` 确认字幕版 MP4 同时有 H.264 video stream 和 AAC audio stream。
- 用 `ffprobe` 确认 final MP4 和字幕版 MP4 都是 9:16 竖屏；默认应为
  `1080x1920`。如果输出是 `1920x1080`，必须视为失败并重渲。
- 如果本轮使用真实豆包语音，必须以 `voice_timeline.json` 的真实时长回写 motion plan。
- 字幕 ffconcat duration 总和必须等于 `voice_timeline.json.totalMs`，且包含必要的透明空帧 gap。
- 如果项目代码或测试被改动，另跑 `npm test`。

## 失败收口

- prompt gate 失败：停在 Phase 1B，只修 `timeline_beats.json`、
  `director_visual_plan.json`、`audio_segments.json`、`narration_timestamps.json`
  或 `vertical_page_prompts.json`。
- `image_gen` 或 subagent 不可用：停在 Phase 2，报告缺失能力、待生成页面范围、
  已有参考图包 / prompt 路径；不得退回主控串行生成大量剧情图片，也不得改用
  本地 PIL、HTML、SVG、canvas 或占位图。
- reference image 无法实际传递：写入 manifest，并把参考图转成文字约束；不得
  谎称图片已作为模型 reference。
- image worker 断流或 manifest 不完整：保留已有页面和 worker manifest，只重跑缺失页。
- 豆包 key 缺失或 TTS 请求失败：停在 Phase 3，报告密钥来源、失败段和可重跑命令；
  不得用估算时长冒充真实语音。
- `npm run verify`、QA 或 `ffprobe` 失败：不交付 final，列出失败命令、输出路径和下一步。

## 最终检查清单

最终回复前检查：

- `video_package.json`、`review_status.json`、`timeline_beats.json`、
  `audio_segments.json`、`narration_timestamps.json`、`director_visual_plan.json`、
  `storyboard_sequence_plan.json`、`reference_board_prompts.json`、`vertical_page_prompts.json`、
  `reference_manifest.json`、`vertical_image_manifest.json`、`image_review_status.json`、
  `voice_timeline.json` 都是合法 JSON。
- `00_brief/video_strategy.json`、`event_scene_map.json`、`entity_registry.json`、
  `setting_registry.json`、`asset_registry.json`、`reference_selection_plan.json`
  都是合法 JSON，且 `upstream_planning_audit.json.passed === true`。
- `review_status.json.status` 已由用户审核后变成 `approved`。
- `timeline_beats.json.beats[*]` 与 `audio_segments.json.segments[*]`、
  `narration_timestamps.json.segments[*]`、`vertical_page_prompts.json.pages[*]`
  一一对应。
- `vertical_page_prompt_audit.json.passed === true`，且 narration coverage 与 page
  density gate 均通过。
- reference boards 已生成并写入 `03_images/references/reference_manifest.json`。
- `story_pages` 文件数等于 beat 数，尺寸为竖版，且 manifest 审核通过。
- `voice_timeline.json.totalMs` 大于 0，且 `master.mp3` 是非空文件。
- 字幕事件和字幕 ffconcat 已生成，duration 总和等于 `voice_timeline.json.totalMs`。
- final video 和 subtitled video 都存在且非空，并且 `ffprobe` 能看到 video + audio 两条流。

## 相关资源

| 文件 | 何时读 | 内容 |
|---|---|---|
| `$video-upstream-planner` | Preflight 缺少通过验证的 `00_brief` 时使用 | 生成 video_strategy、event_scene_map、registry、reference_selection_plan 和 adaptation_plan |
| `references/director-visual-planning.md` | Phase 1B 图片 prompt 前必读 | 导演统筹 prompt；先规划分镜、运镜、灯光、场景连续性和 entity 动线 |
| `references/handoff-contracts.md` | Phase 1B 必读 | 9:16 单页流程 JSON 交接契约 |
| `references/doubao-voice-api.md` | Phase 3 必读 | 豆包语音 API 参数和本机参考来源 |
| `scripts/synthesize-doubao-voice.mjs` | Phase 3 | 豆包整篇优先语音与 master 音轨生成脚本 |

旧版控制页 prompt 模板已从 skill 资源中移除。`crop-control-page-panels.mjs`、
`verify-runtime-inputs.mjs` 和 splitter 工具只作为 legacy 控制页回归工具保留；
默认不要读取或执行。

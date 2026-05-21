---
name: comic-control-page-video
description: 当用户给出标题、题材约束、要求文档或完整剧本，并希望在 2d漫画 项目中生成江湖野史式中国历史口播，或中式克苏鲁原创怪谈、古神/触手怪物视觉，并继续人工审核、导演统筹、9:16 单页竖图、豆包语音和 2.5D 漫画视频时使用。
---

# 9:16 单页漫画视频工作流

把一个题材 brief 或完整剧本，做成可审核、可交接、可验证的 9:16 单页竖图
漫画视频流水线。产出物 = 口播 / 故事包 + beat-first 时间轴 + 专业导演视觉统筹
+ 参考图包 + 9:16 单页剧情图 + 豆包语音 + Remotion 2.5D 视频 + 烧录字幕版视频。

本 Skill 是当前项目的本地工作流入口。主控只保留路由、阶段 gate、交接契约
和验证命令；题材写作与视觉细则必须进入对应 topic pack，不要把历史与中式
克苏鲁规范混写在主页面。

旧的 1:2 控制页、上方角色设定区 + 下方漫画格、splitter 裁切、`04_panel_crops`
和 `input/pages` 预裁单格流程不再是默认路径。除非用户明确要求“回到旧版控制页
裁切流程”，不得启用旧逻辑。

## 适用场景

- 中国历史、古代身份、江湖野史、沉浸式历史、假如重生。
- “在古代某身份到底多爽 / 多惨 / 能不能翻身”类口播视频。
- 中式克苏鲁、乡土克苏鲁、民俗恐怖、不可名状怪谈、古神、触手、邪神 boss。
- 原创恐怖小说 / 怪谈，需要继续变成 9:16 单页漫画图和视频。
- 用户已经给出标题、题材约束、完整剧本，或要求直接产出文档 / 剧本 / 视频流程。

本 Skill 不用于只做单张图、普通网页视频或纯文字润色。

---

## 工作流总览

```text
Phase 1A  口播稿与审核包
   1.1  题材路由：history 或 chinese-cthulhu topic pack
   1.2  一次产出 narration.md + story_package.json + 审核包
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
   2.2  6 个 image workers 分批生成 9:16 story pages，每个 worker 最多 5 张
   ▼
[Checkpoint Images]        ← contact sheet + manifest，停下给用户看图
   ▼
Phase 3   豆包语音与视频
   3.1  分段 TTS 或完整音频 forced alignment
   3.2  stage story_pages as runtime images
   3.3  build / apply-audio-timeline / render / qa / verify / ffprobe
   3.4  burn-subtitles + ffprobe
```

工作目录约定（每次执行创建独立 run folder）：

```text
project_output/control-page-runs/<YYYYMMDD-HHMMSS-slug>/
  00_brief/
  01_script/
  02_prompts/
    director_visual_plan.md
    director_visual_plan.json
    storyboard_sequence_plan.json
    vertical_page_prompts.json
    worker_batches/
  03_images/
    references/
      character_prop_reference.png
      location_plan_reference.png
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

不要把用户剧本、生成图、音频或视频产物写进 skill 目录。

---

## 硬性原则

### Beat-first 是唯一节奏权威

审核通过后必须先从口播稿生成 `02_prompts/timeline_beats.json`。它是口播文本、
图片 prompt、音频段和时间戳的一一对应源头。不得先生成图片、再生成音频、
最后硬凑时间戳。

每个 beat 默认映射为：

- 一个 `audio_segments.json` 段落
- 一个 `narration_timestamps.json` 草稿时间段
- 一张 9:16 runtime story page
- 一个 `vertical_page_prompts.json.pages[*]`

分段必须按“一个可画瞬间 / 一个视觉动作”切分。20-50 个中文字符是强约束，
不是软参考。不得为了减少图片、TTS 段数、worker 批次或渲染工作量而放宽。

### 导演统筹先于图片 prompt

生成任何单页图片 prompt 或分派 image worker 之前，必须先完成：

```text
02_prompts/director_visual_plan.md
02_prompts/director_visual_plan.json
```

导演方案必须使用 `references/director-visual-planning.md`，从整体控制全片：

- 场景总平面、房屋平面关系、空间连续性
- 人物动线、站位、视线和动作方向
- 分镜景别比例，默认少大头特写，多远景 / 中远景 / 过肩 / 鸟瞰 / 纵深构图
- 运镜意图，写入静帧构图中的 push-in、track、locked-off、top-down reveal 等策略
- 灯光递进、色彩弧线、材质控制和恐怖信息揭示顺序
- 每个 beat 的 `shot_scale`、`camera_angle`、`camera_motion`、`lighting`、
  `composition`、`character_blocking`、`prop_blocking` 和 `environment_focus`

不得让各个 subagent 自行决定全片视角比例、灯光递进、场景连续性或人物动线。

### 参考图包是图片阶段前置物

主 session 必须在分派剧情图片 worker 前，用 `image_gen` 生成或锁定完整参考图包：

```text
03_images/references/character_prop_reference.png
03_images/references/location_plan_reference.png
03_images/references/shot_style_reference.png
03_images/references/reference_manifest.json
```

参考图包至少包含：

- 主要人物三视图、表情、污染 / 状态变化。
- 关键道具：箱、钥匙、族谱、油灯、刀、红线铜钱、神像、手机等。
- 场景场地：村口、河湾、祖屋、祠堂、老井、小庙、城市管道等。
- 总平面图、房屋平面关系、场景之间的相对位置。
- 人物动线图：主角、配角、怪异力量在关键场景中的移动路径。
- 灯光 / 色彩 / 材质参考：天光、雾、油灯、井中冷光、朱砂红、盐霜、黑水。

如果当前工具不能把本地参考图传给 worker，必须在 worker prompt 和 manifest 中
明确写 `reference_transport.supports_image_reference=false`，并把参考图内容
转译为详细文字约束。不得谎称图片已作为模型 reference 使用。

### 图片生成默认是 9:16 单页

- 每个 beat 直接生成一张完整 9:16 竖版剧情图，默认尺寸语义为 `1080x1920`。
- 不生成上方角色设定区，不做上下排版，不画漫画格，不把参考图合并进页面。
- 单页图必须是完整场面图：优先空间、人物动线、道具位置、灯光和叙事信息。
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

### 旧流程禁用

默认流程不得使用：

- `control_page_prompts.json`
- `page_manifest.json` 作为裁切权威
- 1:2 控制页
- 上方角色参考区 + 下方漫画格
- `crop-control-page-panels.mjs`
- `tools/comic_panel_splitter.py`
- `04_panel_crops/`
- `panel_crop_manifest.json`
- `crop_review_status.json`
- `input/pages` 中的预裁单格 panel
- bbox fallback 或手写裁切 manifest

这些只属于旧版 legacy 控制页流程。除非用户明确要求 legacy，不得在新流程中读取
或生成它们。语音脚本也不得自动接受旧裁切产物；只有显式传
`--legacy-crop-review` 时才允许走旧裁切审核 fallback。

---

## 各阶段文件读取指南

| 阶段 | 必读 | 按需查 |
|---|---|---|
| Phase 1A 口播稿与审核包 | 对应 topic pack：`references/history/INDEX.md` 或 `references/chinese-cthulhu/INDEX.md` | 用户原始 brief / 剧本 / 题材约束 |
| Phase 1B Beat-First + 导演统筹 | `01_script/narration.md` + `references/director-visual-planning.md` + `references/handoff-contracts.md` | topic pack 的自检规则 |
| Phase 2 图片阶段 | `02_prompts/timeline_beats.json` + `02_prompts/director_visual_plan.json` + `02_prompts/vertical_page_prompts.json` | topic pack 图像风格、用户参考图 |
| Phase 3 音频与视频 | `references/doubao-voice-api.md` + `01_script/audio_segments.json` + `02_prompts/timeline_beats.json` + `03_images/vertical_image_manifest.json` | `voice_timeline.json` / Remotion QA 输出 |
| 字幕后期 | `05_video/audio/voice_timeline.json` + `external/web-video-presentation/references/RECORDING.md` 字幕规则 | `scripts/burn-subtitles.mjs` 输出 |

---

## Phase 1A - 口播稿与审核包

先只生成可审核故事包，不得提前生成图片 prompt、时间戳、音频或视频。

### 任务

1. 按题材路由读取对应 topic pack。
2. 直接生成完整中文稿件。历史模式交付江湖野史口播稿；中式克苏鲁模式交付
   原创怪谈 / 可转口播稿。
3. 写 `story_package.json`、口播正文和审核包。
4. 历史模式必须写 `historical_fact_base.md`。
5. 中式克苏鲁模式必须写 `fiction_boundary.md`，且不写真实历史事实底座。
6. 生成后先按 topic pack 的自检规则修一遍，再交给用户审核。

### 审核前必需文件

```text
01_script/narration.md
01_script/story_package.json
01_script/historical_fact_base.md 或 01_script/fiction_boundary.md
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

---

## Checkpoint Narration - 人工审核门

Phase 1A 完成后必须停住。只有用户明确通过后，才能把
`review_status.json.status` 改为 `approved` 并进入 Phase 1B。

---

## Phase 1B - Beat-First + 导演统筹

审核通过后，先生成统一 beat 表，再生成导演统筹视觉方案，再生成连续分镜账本；
音频和时间戳从 beat 表派生，9:16 图片 prompt 从 storyboard frame 派生。

### 任务顺序

1. 读取已审核的 `01_script/narration.md`。
2. 生成 `02_prompts/timeline_beats.json`。每个 beat 必须包含 `beat_id`、
   `order`、`text`、`estimated_start_sec`、`estimated_end_sec`、`page_id`、
   `audio_segment_id`、`visual_prompt_brief`、`scene_function`、`key_characters`
   和 `key_props`。
3. 从 `timeline_beats.json` 派生 `01_script/audio_segments.json`。每个 beat 仍
   保留一个音频段记录，用来承接图片、字幕和时间轴；默认 TTS 不再逐段请求，
   而是把这些文本按顺序合成为一条完整口播。
4. 从 `timeline_beats.json` 派生 `01_script/narration_timestamps.json`。真实
   语音生成前只能标注为 `estimated_before_audio`。
5. 使用 `references/director-visual-planning.md` 生成
   `02_prompts/director_visual_plan.md` 和 `02_prompts/director_visual_plan.json`。
6. 从 `timeline_beats.json` 和 `director_visual_plan.json` 生成
   `02_prompts/storyboard_sequence_plan.json`，作为连续剧情、镜头变化、状态递进
   和 worker 上下文的权威。
7. 从 `timeline_beats.json`、`director_visual_plan.json` 和
   `storyboard_sequence_plan.json` 派生：

```text
02_prompts/reference_board_prompts.md
02_prompts/reference_board_prompts.json
02_prompts/vertical_page_prompts.md
02_prompts/vertical_page_prompts.json
02_prompts/worker_batches/vertical_batch_worker_##.json
```

### 规则

- `timeline_beats.json` 是唯一节奏权威；后续文件不得自造不同顺序或不同分段。
- `storyboard_sequence_plan.json` 是连续分镜权威；`vertical_page_prompts.json`
  必须从对应 storyboard frame 派生，不得只把口播句子包装成单张插画。
- 图片数量由 beat 数决定；一 beat 对应一张 9:16 story page。
- 不存在“省图版本”：不得为了降低图片量、TTS 段数或 worker 批次而合并 beat。
- `vertical_page_prompts.json.pages[*].prompt` 必须同时吸收：
  - beat 原文和 `visual_prompt_brief`
  - `director_visual_plan.json.beat_directives[*]`
  - `storyboard_sequence_plan.json.frames[*]`
  - reference pack 内容
  - topic pack 图像风格
- prompt 必须先表达本页的分镜任务：`shot_role`、`current_visual_action`、
  `state_delta` 和 `camera_change_reason`；最后才引用口播原文。口播句子不得替代
  画面动作。
- prompt 必须写清景别、视角、运镜意图、灯光、构图、人物站位、道具位置、
  环境信息和禁止项。
- prompt 必须先按镜头语言组织，再写美术风格。每页必须包含结构化字段
  `prompt_structure`：`shot_function`、`shot_scale`、`camera_angle`、
  `camera_motion`、`foreground`、`midground`、`background`、
  `character_blocking`、`prop_blocking`、`lighting`、`continuity_anchor`、
  `negative_prompt`。
- 每页必须包含 `continuity`：`sequence_block_id`、`location`、
  `screen_direction`、`character_positions`、`prop_state`、`lighting_state`。
  这些字段用于约束场景轴线、人物动线、道具状态和光线弧线。
- 每页必须包含 `storyboard_frame`，并带前后页 `neighbor_context`。worker batch
  也必须携带每页前一页和后一页的 continuity 摘要。
- prompt 只包含可直接投喂 image_gen 的画面生成指令，不混入解释、审核说明、
  JSON、Markdown 代码围栏、文件清单或时间轴备注。

### 审核后必需文件

```text
02_prompts/timeline_beats.json
01_script/audio_segments.json
01_script/narration_timestamps.json
02_prompts/director_visual_plan.md
02_prompts/director_visual_plan.json
02_prompts/storyboard_sequence_plan.json
02_prompts/reference_board_prompts.md
02_prompts/reference_board_prompts.json
02_prompts/vertical_page_prompts.md
02_prompts/vertical_page_prompts.json
02_prompts/worker_batches/vertical_batch_worker_##.json
```

JSON 契约见 `references/handoff-contracts.md`。

---

## Gate Plan - 规划验证

进入图片阶段前必须检查：

- `timeline_beats.json.beats.length === audio_segments.json.segments.length`
- `timeline_beats.json.beats.length === narration_timestamps.json.segments.length`
- `timeline_beats.json.beats.length === storyboard_sequence_plan.json.frames.length`
- `timeline_beats.json.beats.length === vertical_page_prompts.json.pages.length`
- `director_visual_plan.json.beat_directives` 覆盖所有需要生成图片的 beat。
- `storyboard_sequence_plan.json.frames[*]` 与 `vertical_page_prompts.json.pages[*].storyboard_frame`
  按 `page_id` / `beat_id` 对齐。
- 每个 `vertical_page_prompts.json.pages[*]` 都引用对应 beat 和 director directive。
- 每个 `vertical_page_prompts.json.pages[*]` 都必须有 `prompt_structure` 和
  `continuity` / `storyboard_frame`；不得只写一段自由 prompt。
- 同一 sequence 内不得连续 3 页复用同一 `shot_scale + camera_angle + camera_motion`。
- 镜头比例必须通过 gate：空间镜头（`wide`、`medium_wide`、`medium`、
  `over_shoulder`、`bird_eye`）合计默认不少于 55%；`close_up` 默认不超过 15%；
  `insert` 只能服务关键道具、声音来源或恐怖揭示。
- worker batch 总页数等于 `vertical_page_prompts.json.pages.length`，且每个 worker
  最多 5 张图，并包含 `neighbor_context`。

推荐执行：

```bash
npm run validate:vertical-prompts -- project_output/control-page-runs/<run>
```

如果项目旧 validator 仍只识别 control page prompt，不得为了通过旧 gate 把
9:16 prompt 包装成控制页 prompt；应写新的 audit 或人工报告。

---

## Phase 2 - 参考图包与 9:16 单页剧情图

图片阶段不能重写剧本、beat 表或导演方案。主 session 先用 `image_gen` 生成
参考图包，再把 9:16 单页剧情图任务分派给 subagent image workers。

### 2.1 参考图包

主 session 负责生成：

```text
03_images/references/character_prop_reference.png
03_images/references/location_plan_reference.png
03_images/references/shot_style_reference.png
03_images/references/reference_manifest.json
```

要求：

- `character_prop_reference.png`：人物、表情、关键道具和状态变化。
- `location_plan_reference.png`：场景场地、总平面图、房屋平面关系、井 / 祠堂 /
  河湾 / 小庙 / 城市管道的位置关系。
- `shot_style_reference.png`：灯光、色彩、材质、镜头距离、构图示例和视觉密度。
- `reference_manifest.json`：记录 prompt、文件、sha256、用途、是否实际传给 worker。

### 2.2 worker 生成

- 剧情图片必须由 subagent image workers 调用 `image_gen` 生成。
- 输出为 `03_images/story_pages/page_###.png`。
- 每个 worker 最多 5 张图；单批最多 6 个 worker / 30 张图。
- worker manifest 写入 `03_images/worker_manifests/vertical_batch_worker_##.json`。
- 主 session 统一收集 worker manifest，写：

```text
03_images/vertical_image_manifest.json
03_images/image_review_status.json
03_images/contact_sheet_vertical_pages.jpg
```

### 图片验收

进入视频前必须确认：

- `story_pages` 数量等于 beat 数。
- 每张图为竖版 PNG，宽高比接近 9:16。
- 每张图来自 `image_gen` 证据，不能是占位图、程序图或 panel 合成图。
- reference board 没有被拼贴进 story page。
- contact sheet 已生成并交给用户查看。
- `vertical_image_manifest.audit.passed === true`。
- `image_review_status.status` 初始必须为 `pending`，只有用户明确通过图片后才能改为
  `approved`。

---

## Checkpoint Images - 图片人工确认

图片阶段完成后必须停住，给用户看：

- `03_images/contact_sheet_vertical_pages.jpg`
- `03_images/story_pages/`
- `03_images/vertical_image_manifest.json`
- `03_images/image_review_status.json`
- 参考图包路径和是否实际传给 worker

只有用户明确通过图片，才可把 `03_images/image_review_status.json.status` 改成
`approved` 并进入音频和视频阶段。语音脚本必须把未审核或未通过图片当成 blocker。

---

## Phase 3 - 豆包语音与视频

豆包默认参数以 `references/doubao-voice-api.md` 为准：默认音色为儒雅逸辰 2.0，
speaker / voice key 为 `zh_male_ruyayichen_uranus_bigtts`，默认约 1.25x 语速，
对应 `speech_rate=25`。只有用户明确指定其他音色或语速时才覆盖。

### 执行

```bash
node .codex/skills/comic-control-page-video/scripts/synthesize-doubao-voice.mjs project_output/control-page-runs/<run> --project-root . --mode whole
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

### runtime image staging

视频构建前，必须把 `03_images/story_pages/page_###.png` 作为 runtime images。
如果当前项目构建脚本仍读取 `input/pages`，可以原子同步 story pages 到
`input/pages`，但必须写清：

```text
03_images/runtime_story_pages_manifest.json
```

规则：

- runtime input 来自整张 9:16 story page，不来自裁切 panel。
- `voice_timeline.json.segments.length === story_pages.length`。
- runtime render spec 必须是 9:16 竖屏：`1080x1920` 或等价 9:16 竖版尺寸。
  不得把 9:16 story pages 渲染进 `1920x1080` 横屏画布。
- 不需要 `crop_review_status.json` 或 `panel_crop_manifest.json`。
- 不得把旧控制页、角色设定图或 reference board 放进 runtime input。

### 长片合成兜底

`npm run render:preview` 是默认 Remotion 渲染入口。如果它已经完整产出
`05_video/previews/shot_###.mp4`，但 full composition 在长片阶段卡住或失败，可以改用：

```bash
npm run compose:preview -- project_output/control-page-runs/<run>
```

使用条件：

- `preview` 数量必须等于 `motion_plan.json.shots.length`。
- `preview` 数量必须等于 `voice_timeline.json.segments.length`。
- `master.mp3` 必须来自真实豆包整篇音频、明确要求的分段豆包音频，或用户提供的
  forced alignment 音频；不得用占位音频。
- 输出仍必须是 `05_video/motion_comic_preview.mp4`，并继续执行
  `burn-subtitles`、`qa`、`verify` 和两个 MP4 的 `ffprobe`。

这不是跳过 Remotion；只能复用 Remotion 已经渲染成功的逐镜头视频段，把卡住的
full composition 替换为受验证的 `ffmpeg concat + master.mp3` 合成。

### 音频规则

- TTS 输入来自 `audio_segments.json`，其顺序来自 `timeline_beats.json`。
- `voice_timeline.json` 必须由真实音频时长计算。
- 默认使用 `--mode whole`：整篇口播只调用一次豆包 TTS，直接生成
  `05_video/audio/master.mp3`，保证声音连贯。
- `audio_segments.json` 仍必须保留一 beat 一段，因为图片、镜头和字幕需要稳定
  对齐单位。整篇音频生成后，`synthesize-doubao-voice.mjs` 会先用上一版
  `voice_timeline.json` 的真实分段时长作为权重估算 beat 边界；没有旧时间轴时，
  才退回文本宽度权重。
- 如果已有外部 forced alignment JSON，必须运行 `npm run align-audio`，用真实
  对齐结果替换估算边界。
- 只有用户明确要求分段音频、豆包整篇请求失败且确认降级，或当前接口存在文本
  长度限制时，才允许传 `--mode segmented`。

### 字幕规则

默认必须生成字幕版视频，除非用户明确说不要字幕。字幕参考
`external/web-video-presentation` 的后期规则：
字幕源用当前 run 的 `05_video/audio/voice_timeline.json`，一条口播 cue 按中文
标点、顿号 / 逗号和 cue 时长拆成多条短字幕事件；样式为白色大字、无背景框、
深色描边和阴影，默认 `66px` 字号、底部 `36px` 边距。

### 最终视频验证

- `npm run verify` 必须通过，preview 数量必须等于 story page 数。
- 用 `ffprobe` 确认 final MP4 同时有 H.264 video stream 和 AAC audio stream。
- 用 `ffprobe` 确认字幕版 MP4 同时有 H.264 video stream 和 AAC audio stream。
- 用 `ffprobe` 确认 final MP4 和字幕版 MP4 都是 9:16 竖屏；默认应为
  `1080x1920`。如果输出是 `1920x1080`，必须视为失败并重渲。
- 如果本轮使用真实豆包语音，必须以 `voice_timeline.json` 的真实时长回写 motion
  plan，不得继续使用估算时长。
- 如果项目代码或测试被改动，另跑 `npm test`。

---

## 失败收口

- prompt gate 失败：停在 Phase 1B，只修 `timeline_beats.json`、
  `director_visual_plan.json`、`audio_segments.json`、`narration_timestamps.json`
  或 `vertical_page_prompts.json`。
- `image_gen` 或 subagent 不可用：停在 Phase 2，报告缺失能力、待生成页面范围、
  已有参考图包 / prompt 路径；不得退回主控串行生成大量剧情图片，也不得改用
  本地 PIL、HTML、SVG、canvas 或占位图。
- reference image 无法实际传递：写入 manifest，并把参考图转成文字约束；不得
  谎称图片已作为模型 reference。
- image worker 断流或 manifest 不完整：保留已有页面和 worker manifest，只重跑
  缺失页。
- 图片审核未通过：停在 Checkpoint Images，不进入 TTS、build 或 render。
- 豆包 key 缺失或 TTS 请求失败：停在 Phase 3，报告密钥来源、失败段和可重跑
  命令；不得用估算时长冒充真实语音。
- `npm run verify`、QA 或 `ffprobe` 失败：不交付 final，列出失败命令、输出路径
  和下一步。

---

## 最终检查清单

最终回复前检查：

- `story_package.json`、`review_status.json`、`timeline_beats.json`、
  `audio_segments.json`、`narration_timestamps.json`、`director_visual_plan.json`、
  `storyboard_sequence_plan.json`、`reference_board_prompts.json`、`vertical_page_prompts.json`、
  `reference_manifest.json`、`vertical_image_manifest.json`、`image_review_status.json`、
  `voice_timeline.json` 都是合法 JSON。
- 历史模式必须有 `historical_fact_base.md`；中式克苏鲁模式必须有
  `fiction_boundary.md`。
- `review_status.json.status` 已由用户审核后变成 `approved`。
- `timeline_beats.json.beats[*]` 与 `audio_segments.json.segments[*]`、
  `narration_timestamps.json.segments[*]`、`vertical_page_prompts.json.pages[*]`
  一一对应。
- `director_visual_plan.json.beat_directives[*]` 覆盖所有需要生成图片的 beat。
- reference boards 已生成并写入 `03_images/references/reference_manifest.json`。
- `story_pages` 文件数等于 beat 数，尺寸为竖版，且 manifest 审核通过。
- `image_review_status.json.status === "approved"`。
- `voice_timeline.json.totalMs` 大于 0，且 `master.mp3` 是非空文件。
- final video 和 subtitled video 都存在且非空，并且 `ffprobe` 能看到 video + audio
  两条流。

---

## 相关资源

按“何时读”标注，避免一次性全读：

| 文件 | 何时读 | 内容 |
|---|---|---|
| `references/history/INDEX.md` | Phase 1A 历史模式必读 | 中国历史 / 江湖野史 topic pack 索引 |
| `references/chinese-cthulhu/INDEX.md` | Phase 1A 中式克苏鲁模式必读 | 中式克苏鲁 / 古神触手怪谈 topic pack 索引 |
| `references/director-visual-planning.md` | Phase 1B 图片 prompt 前必读 | 专业导演统筹 prompt；先规划分镜、运镜、灯光、场景连续性和人物动线 |
| `references/handoff-contracts.md` | Phase 1B 必读 | 新 9:16 单页流程 JSON 交接契约 |
| `references/doubao-voice-api.md` | Phase 3 必读 | 豆包语音 API 参数和本机参考来源 |
| `scripts/synthesize-doubao-voice.mjs` | Phase 3 | 豆包整篇优先语音与 master 音轨生成脚本 |
| `scripts/build-forced-aligned-voice-timeline.mjs` | Phase 3 可选 | 一次性完整口播音频 + forced alignment 生成标准 `voice_timeline.json` |

旧版控制页 prompt 模板已从 skill 资源中移除。`crop-control-page-panels.mjs`、
`verify-runtime-inputs.mjs` 和 splitter 工具只作为 legacy 控制页回归工具保留；
默认不要读取或执行。

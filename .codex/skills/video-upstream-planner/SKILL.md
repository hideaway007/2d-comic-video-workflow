---
name: video-upstream-planner
description: 当用户给出视频项目的标题、主题约束、小说、文章、产品资料、剧本或粗 brief，并需要先做通用前期策划包、事件场景拆解、entity/setting/asset registry、reference selection 或 adaptation plan，而不是立即生成口播、图片、语音或视频时使用。
---

# 视频前期策划工作流

把 idea / source / script / brief 先整理成可验证的 `00_brief` 前期策划包，
再交给 `$video-generation-template` 进入口播、图片、语音和视频生产。

本 skill 只负责上游策划，不生成最终口播、图片 prompt、音频、视频或字幕。

## 适用场景

- 用户只有标题、主题方向、小说、文章、产品资料、完整剧本或粗 brief，需要先做视频策划。
- 需要把长文本拆成事件、场景、实体、场地、关键资产和参考图选择策略。
- 需要在生成口播前锁定叙事结构、空间关系、人物 / 物件连续性和改编取舍。
- 需要给 `$video-generation-template` 准备稳定的 `00_brief` 输入。

不用于只做单张图、直接做视频后期、语音合成或字幕修复。

## 工作流

```text
Input: idea / source / script / brief
   ▼
读取 references/vimax-upstream-planning.md
   ▼
写 00_brief 前期策划包
   ▼
npm run validate:upstream-plan
   ▼
通过后交给 $video-generation-template
```

## 必需产物

在每个 run folder 下写入：

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

详细 schema 见 `references/handoff-contracts.md`。

## 执行规则

1. 判断输入模式：
   - `idea`：扩写为视频策略、核心冲突 / 核心论点、观众钩子和结尾压力。
   - `source`：提取主线信息、可视化场景、实体状态变化和视觉锚点。
   - `script`：沿用已有场次、台词功能和信息顺序，抽出场景、实体、资产和空间关系。
   - `brief`：保留用户约束，补齐缺失的策划字段。
2. 判断 `content_profile`，只作为通用内容轮廓，不读取题材专用包：
   - `fiction_story`
   - `educational_explainer`
   - `product_demo`
   - `documentary_short`
   - `social_ad`
   - `custom`
3. 使用稳定 ID：`event_01`、`scene_001`、`ent_*`、`set_*`、`asset_*`。
4. 区分 `event` 和 `scene`：
   - `event` 是因果、信息推进或说服目标单位。
   - `scene` 是同一时间、地点和可视化空间单位。
5. entity、setting 和 asset registry 必须能互相交叉引用，不依赖聊天上下文。
6. `reference_selection_plan.json` 只决定参考图用途和来源，不直接画最终页。
7. `adaptation_plan.md` 用中文说明保留内容、删除 / 合并内容、事实或版权边界、平台风险和下游口播策略。

## Gate

写完策划包后必须运行：

```bash
npm run validate:upstream-plan -- project_output/control-page-runs/<run>
```

通过条件：

- 所有必需文件存在。
- JSON 格式合法。
- event、scene、entity、setting、asset、reference source ID 可以互相引用。
- `00_brief/upstream_planning_audit.json.passed === true`。

未通过时，只修 `00_brief` 文件，不进入口播、图片或视频阶段。

## 交接

通过后，把 run folder 交给 `$video-generation-template`。下游 skill 从
`00_brief/video_strategy.json`、`event_scene_map.json` 和各 registry 读取视频图纸，
再生成观众可听的口播稿和后续视频产物。

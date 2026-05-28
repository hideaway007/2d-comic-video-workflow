# ViMax-style 前期策划层

本参考用于 Phase 0，把 idea / source / script / brief 先整理成可验证的策划包。
它吸收 ViMax 的上游思路：先做视频策略、事件拆解、实体合并、场景连续性和
reference selection，再进入口播、分镜、图片和视频。不要把 `HKUDS/ViMax`
作为本地运行依赖。

## 输入路由

- `idea`：从一句话或标题扩成 `video_strategy.json`，再拆成事件和场景。重点是
  核心冲突 / 核心论点、观众钩子、结尾压力和内容边界。
- `source`：从小说、文章、产品资料、访谈稿或研究材料中提取主线信息、可视化场景、
  entity 状态变化、关键 asset 和视觉锚点。保留来源证据备注，但不要把原文流水账
  直接塞进口播。
- `script`：沿用已有场次、台词功能和信息顺序，抽出场景、entity、asset、空间关系
  和镜头压力；不重写核心剧情。
- `brief`：保留用户明确约束，补齐缺失的策略、场景、registry 和参考图计划。

## 输出包

Phase 0 必须写入 `00_brief/`：

```text
video_strategy.json
event_scene_map.json
entity_registry.json
setting_registry.json
asset_registry.json
reference_selection_plan.json
adaptation_plan.md
```

写完后运行：

```bash
npm run validate:upstream-plan -- project_output/control-page-runs/<run>
```

验证通过会生成 `00_brief/upstream_planning_audit.json`。

## 拆解规则

- `event` 是因果、信息推进或说服目标单位，必须能解释“发生了什么变化”。
- `scene` 是同一时间、地点和可视化空间单位，必须能落成后续 9:16 单页画面。
- 一个 `event` 可以包含多个 `scene`；每个 `scene` 必须归属一个 `event`。
- 稳定 ID 使用 `event_01`、`scene_001`、`ent_*`、`set_*`、`asset_*`。
- 不要在 Phase 0 生成图片 prompt、音频、视频、时间戳或 Remotion 文件。

## Registry 规则

`entity_registry.json`：

- `stable_features` 写不会频繁变化的外貌、身份、产品外观、品牌识别点或概念载体。
- `dynamic_features_by_scene` 写临时姿态、状态变化、手持物、界面状态或视觉强调。
- `active_scenes` 必须只引用 `event_scene_map.json.scenes[*].scene_id`。

`setting_registry.json`：

- 每个 `setting_id` 都要有空间描述、光线弧线和连续性锚点。
- 空间描述要能约束后续总平面、人物站位和前中后景，不只写气氛词。

`asset_registry.json`：

- 每个关键 asset 要有 `visual_signature`、`first_scene_id` 和 `state_by_scene`。
- asset 状态必须服务叙事或信息推进，例如“被递出”“界面点亮”“包装打开”“图表变红”。

## Reference Selection

`reference_selection_plan.json` 负责提前决定哪些参考图值得做，不负责直接画最终页。

- 每个 `reference_slots[*]` 必须说明 `purpose`、`source_ids` 和 `selection_rule`。
- `source_ids` 只能引用已存在的 event、scene、entity、setting 或 asset ID。
- 每页运行时参考图上限为 8 张，默认优先选择：
  - 当前场景中实际出现的 entity 和关键 asset。
  - 当前 setting 的空间 / 总平面 / 动线参考。
  - 最近相邻页面的连续性参考。
  - 与当前构图和景别最接近的 style reference。
- 如果当前工具不能把本地图片作为 image reference 传给 worker，必须把参考图内容
  转成文字约束，并在 manifest 中写明 `supports_image_reference=false`。

## Candidate Image Audit

ViMax 里有候选图选择的思想，但本 skill 暂不把它升级为默认自动重抽图机制。
可作为后续增强：

- 每页生成多个候选图时，先按 entity 外观、setting 连续性、asset 状态、构图是否承接前后页打分。
- 只把胜出候选写入 `03_images/story_pages/page_###.png`。
- 评分记录写进 worker manifest，不能只在聊天里说明。
- 当前默认流程仍是单页图生成 + machine gate；不要为了候选图审美选择阻塞整条视频链。

## Adaptation Plan

`adaptation_plan.md` 用中文写，至少包含：

- 输入模式和内容轮廓。
- 保留内容：必须进入口播和画面的事件、entity、asset、setting。
- 删除 / 合并内容：为什么不进入本轮视频。
- 边界风险：事实、版权、平台、品牌、安全或节奏风险。
- 下游口播策略：Phase 1A 如何从策划包生成观众可听的稿件。

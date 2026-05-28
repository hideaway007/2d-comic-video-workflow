# 前期策划交接契约

这些文件由 `$video-upstream-planner` 写入 `00_brief/`，并由
`$video-generation-template` 消费。后续阶段不得依赖聊天上下文补齐这些信息。

## video_strategy.json

```json
{
  "version": 1,
  "input_mode": "idea",
  "mode": "short_vertical_video",
  "title": "夜班咖啡馆",
  "target_output": "narration_to_9_16_video",
  "audience": "对城市夜班和孤独感有共鸣的年轻观众",
  "platform": "short_video",
  "narrative_strategy": {
    "logline": "一个夜班咖啡师通过一杯没人认领的咖啡，发现城市里每个人都在等待被看见。",
    "core_conflict": "主角想尽快结束夜班，但顾客留下的线索不断把他拉回人与人的连接。",
    "audience_hook": "凌晨两点，咖啡馆里出现了一杯已经付款却没人来取的咖啡。",
    "ending_pressure": "主角必须决定是丢掉这杯咖啡，还是替陌生人完成一次迟到的告别。"
  },
  "route_decision": {
    "content_profile": "fiction_story",
    "reason": "通用虚构短片，不依赖题材专用包。"
  }
}
```

规则：

- `input_mode` 只能是 `idea`、`source`、`script` 或 `brief`。
- `content_profile` 只能是 `fiction_story`、`educational_explainer`、
  `product_demo`、`documentary_short`、`social_ad` 或 `custom`。
- `narrative_strategy` 写视频策略，不写分镜 prompt。

## event_scene_map.json

```json
{
  "version": 1,
  "source": "00_brief/video_strategy.json",
  "events": [
    {
      "event_id": "event_01",
      "order": 1,
      "dramatic_goal": "夜班日常被一杯无人领取的咖啡打破。",
      "process_chain": ["主角准备打烊", "订单屏弹出已付款饮品", "杯身写着陌生留言"],
      "scene_ids": ["scene_001", "scene_002"]
    }
  ],
  "scenes": [
    {
      "scene_id": "scene_001",
      "event_id": "event_01",
      "order": 1,
      "setting_id": "set_cafe_counter",
      "dramatic_function": "建立主角状态和空间秩序。",
      "scene_summary": "主角站在吧台内，清点最后一排杯子。",
      "visible_entity_ids": ["ent_barista"],
      "key_asset_ids": ["asset_order_screen", "asset_takeaway_cup"]
    }
  ]
}
```

规则：

- `event` 是因果、信息推进或说服目标单位；`scene` 是同一时间、地点和可视化空间单位。
- `events[*].scene_ids` 必须都存在于 `scenes[*].scene_id`。
- `scenes[*].event_id`、`setting_id`、`visible_entity_ids` 和 `key_asset_ids`
  必须能在对应 registry 中找到。

## entity_registry.json

```json
{
  "version": 1,
  "source": "00_brief/event_scene_map.json",
  "entities": [
    {
      "entity_id": "ent_barista",
      "name": "夜班咖啡师",
      "role": "主角 / 叙事视角",
      "stable_features": "二十多岁，黑色围裙，眼神疲惫但动作熟练。",
      "dynamic_features_by_scene": {
        "scene_001": "袖口卷起，正在擦拭咖啡机。",
        "scene_002": "手里拿着无人领取的外带杯。"
      },
      "active_scenes": ["scene_001", "scene_002"],
      "continuity_notes": "状态从机械疲惫转为主动关心。"
    }
  ]
}
```

规则：

- `active_scenes` 和 `dynamic_features_by_scene` 的 scene ID 必须存在。
- `stable_features` 写稳定识别点；临时姿态、衣物变化、手持物写进按场景字段。
- entity 可以是人物、品牌主体、产品主体、抽象概念的可视化承载物或纪录片对象。

## setting_registry.json

```json
{
  "version": 1,
  "source": "00_brief/event_scene_map.json",
  "settings": [
    {
      "setting_id": "set_cafe_counter",
      "name": "深夜咖啡馆吧台",
      "spatial_description": "吧台横贯画面中景，玻璃门在右后方，街灯从窗外投进冷色光。",
      "lighting_arc": "室内暖光逐渐被窗外冷蓝色夜光压住。",
      "continuity_anchors": ["吧台", "订单屏", "玻璃门", "窗外街灯"]
    }
  ]
}
```

规则：

- 每个 `setting_id` 都要有空间描述、光线弧线和连续性锚点。
- 空间描述要能约束后续总平面、人物站位和前中后景，不只写气氛词。

## asset_registry.json

```json
{
  "version": 1,
  "source": "00_brief/event_scene_map.json",
  "assets": [
    {
      "asset_id": "asset_takeaway_cup",
      "name": "无人领取的外带杯",
      "first_scene_id": "scene_001",
      "visual_signature": "白色纸杯，杯套上有手写蓝色名字和一行小字。",
      "state_by_scene": {
        "scene_001": "放在吧台边缘，无人认领",
        "scene_002": "被主角拿起，杯套留言露出"
      }
    }
  ]
}
```

规则：

- `first_scene_id` 和 `state_by_scene` 的 scene ID 必须存在。
- `visual_signature` 必须是可视识别点，不写抽象象征。
- asset 可以是道具、产品、图表、文件、界面、关键环境物或品牌视觉元素。

## reference_selection_plan.json

```json
{
  "version": 1,
  "source": "00_brief/video_strategy.json",
  "reference_slots": [
    {
      "reference_id": "entity_asset_reference",
      "purpose": "主要实体、状态变化和关键资产。",
      "source_ids": ["ent_barista", "asset_takeaway_cup"],
      "selection_rule": "实体和资产同图，但不得拼贴进最终 story page。"
    }
  ],
  "max_runtime_reference_images_per_page": 8
}
```

规则：

- `source_ids` 只能引用存在的 event、scene、entity、setting 或 asset ID。
- `max_runtime_reference_images_per_page` 不得超过 8。

## adaptation_plan.md

用中文写，至少包含：

- 输入模式和内容轮廓。
- 保留内容：必须进入口播和画面的事件、实体、资产、场景。
- 删除 / 合并内容：为什么不进入本轮视频。
- 边界风险：事实、版权、平台、品牌、安全或节奏风险。
- 下游口播策略：`$video-generation-template` 如何从策划包生成观众可听的稿件。

## upstream_planning_audit.json

由 `scripts/validate-upstream-planning.mjs` 生成。

```json
{
  "version": 1,
  "checked_at": "2026-05-28T00:00:00.000Z",
  "run_folder": "project_output/control-page-runs/demo",
  "input_mode": "idea",
  "mode": "short_vertical_video",
  "content_profile": "fiction_story",
  "event_count": 2,
  "scene_count": 3,
  "entity_count": 2,
  "setting_count": 2,
  "asset_count": 3,
  "reference_slot_count": 3,
  "blockers": [],
  "warnings": [],
  "passed": true
}
```

规则：

- `passed` 必须为 `true` 才能交给 `$video-generation-template`。
- 有 `blockers` 时只修 `00_brief` 文件，不进入口播、图片或视频阶段。

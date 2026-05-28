# 前期策划交接契约

这些文件由 `$comic-upstream-planner` 写入 `00_brief/`，并由
`$comic-control-page-video` 消费。后续阶段不得依赖聊天上下文补齐这些信息。

## story_strategy.json

```json
{
  "version": 1,
  "input_mode": "idea",
  "mode": "chinese_cthulhu_weird_tale",
  "title": "井皮",
  "target_output": "narration_to_9_16_comic_video",
  "narrative_strategy": {
    "logline": "林照回槐湾收铜皮箱，却发现老井在替村里人换皮。",
    "core_conflict": "主角想带走遗物，宗族要让他替井下之物续约。",
    "audience_hook": "井不是取水用的，是给下面那东西换皮用的。",
    "ending_pressure": "林照必须在烧掉族谱和打开铜箱之间选一个。"
  },
  "route_decision": {
    "topic_pack": "chinese-cthulhu",
    "reason": "原创乡土怪谈，不写真实历史事实底座。"
  }
}
```

规则：

- `input_mode` 只能是 `idea`、`novel`、`script` 或 `brief`。
- `mode` 必须与后续 topic pack 一致。
- `narrative_strategy` 写故事策略，不写分镜 prompt。

## event_scene_map.json

```json
{
  "version": 1,
  "source": "00_brief/story_strategy.json",
  "events": [
    {
      "event_id": "event_01",
      "order": 1,
      "dramatic_goal": "主角进入槐湾并接触铜皮箱。",
      "process_chain": ["林照回到祖屋门前", "族长交出铜钥匙"],
      "scene_ids": ["scene_001", "scene_002"]
    }
  ],
  "scenes": [
    {
      "scene_id": "scene_001",
      "event_id": "event_01",
      "order": 1,
      "location_id": "loc_ancestral_house",
      "dramatic_function": "日常入口被第一处错位打破。",
      "scene_summary": "林照站在祖屋门槛外，看见盐霜覆盖门槛。",
      "visible_character_ids": ["char_linzhao", "char_clan_elder"],
      "key_prop_ids": ["prop_key"]
    }
  ]
}
```

规则：

- `event` 是因果和戏剧目标单位；`scene` 是同一时间、地点和可画空间单位。
- `events[*].scene_ids` 必须都存在于 `scenes[*].scene_id`。
- `scenes[*].event_id`、`location_id`、`visible_character_ids` 和 `key_prop_ids`
  必须能在对应 registry 中找到。

## character_registry.json

```json
{
  "version": 1,
  "source": "00_brief/event_scene_map.json",
  "characters": [
    {
      "character_id": "char_linzhao",
      "name": "林照",
      "role": "主角",
      "static_features": "二十多岁，瘦削，眉骨清楚，眼下有长期失眠的青影。",
      "dynamic_features_by_scene": {
        "scene_001": "灰色夹克，手里提着旧帆布包。"
      },
      "active_scenes": ["scene_001", "scene_002"],
      "continuity_notes": "始终从怀疑转向被迫参与，不突然变成主动猎奇。"
    }
  ]
}
```

规则：

- `active_scenes` 和 `dynamic_features_by_scene` 的 scene ID 必须存在。
- `static_features` 写稳定外观；动态污染、衣物、手持物写进按场景字段。

## environment_registry.json

```json
{
  "version": 1,
  "source": "00_brief/event_scene_map.json",
  "environments": [
    {
      "location_id": "loc_ancestral_house",
      "name": "槐湾祖屋门前",
      "spatial_description": "门槛在画面中线，祠堂门廊在右后方，老井在远景偏右。",
      "lighting_arc": "阴天灰雾，门槛盐霜反出白光。",
      "continuity_anchors": ["门槛", "祠堂门廊", "远景老井"]
    }
  ]
}
```

## prop_registry.json

```json
{
  "version": 1,
  "source": "00_brief/event_scene_map.json",
  "props": [
    {
      "prop_id": "prop_key",
      "name": "铜钥匙",
      "first_scene_id": "scene_001",
      "visual_signature": "发黑铜色，钥匙齿缝有盐霜。",
      "state_by_scene": {
        "scene_001": "由族长递给林照",
        "scene_002": "插在铜皮箱锁孔旁"
      }
    }
  ]
}
```

规则：

- `first_scene_id` 和 `state_by_scene` 的 scene ID 必须存在。
- `visual_signature` 必须是可画识别点，不写抽象象征。

## reference_selection_plan.json

```json
{
  "version": 1,
  "source": "00_brief/story_strategy.json",
  "reference_slots": [
    {
      "reference_id": "character_prop_reference",
      "purpose": "主要人物三视图、状态变化和关键道具。",
      "source_ids": ["char_linzhao", "prop_key"],
      "selection_rule": "人物和道具同图，但不得拼贴进 story page。"
    }
  ],
  "max_runtime_reference_images_per_page": 8
}
```

规则：

- `source_ids` 只能引用存在的 event、scene、character、location 或 prop ID。
- `max_runtime_reference_images_per_page` 不得超过 8。

## adaptation_plan.md

用中文写，至少包含：

- 输入模式和题材模式。
- 保留内容：必须进入口播和画面的事件、人物、道具、场景。
- 删除 / 合并内容：为什么不进入本轮视频。
- 改编风险：历史事实边界、原创虚构边界、平台风险或节奏风险。
- 下游口播策略：`$comic-control-page-video` 如何从策划包生成观众可听的稿件。

## upstream_planning_audit.json

由 `scripts/validate-upstream-planning.mjs` 生成。

```json
{
  "version": 1,
  "checked_at": "2026-05-28T00:00:00.000Z",
  "run_folder": "project_output/control-page-runs/demo",
  "input_mode": "idea",
  "mode": "chinese_cthulhu_weird_tale",
  "event_count": 2,
  "scene_count": 3,
  "character_count": 2,
  "environment_count": 3,
  "prop_count": 5,
  "reference_slot_count": 3,
  "blockers": [],
  "warnings": [],
  "passed": true
}
```

规则：

- `passed` 必须为 `true` 才能交给 `$comic-control-page-video`。
- 有 `blockers` 时只修 `00_brief` 文件，不进入口播、图片或视频阶段。

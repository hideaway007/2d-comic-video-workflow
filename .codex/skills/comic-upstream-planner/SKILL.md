---
name: comic-upstream-planner
description: 当用户给出漫画或视频项目的标题、题材约束、小说、剧本或 brief，并需要先做前期策划包、事件场景拆解、角色环境道具 registry、reference selection 或 adaptation plan，而不是立即生成口播、图片、语音或视频时使用。
---

# 漫画视频前期策划工作流

把 idea / novel / script / brief 先整理成可验证的 `00_brief` 前期策划包，
再交给 `$comic-control-page-video` 进入口播、图片、语音和视频生产。

本 skill 只负责上游策划，不生成最终口播、图片 prompt、音频、视频或字幕。

## 适用场景

- 用户只有标题、题材方向、小说、完整剧本或粗 brief，需要先做漫画视频策划。
- 需要把长文本拆成事件、场景、人物、环境、道具和参考图选择策略。
- 需要在生成口播前锁定角色连续性、空间关系、道具状态和改编取舍。
- 需要给 `$comic-control-page-video` 准备稳定的 `00_brief` 输入。

不用于只做单张图、直接做视频后期、语音合成或字幕修复。

## 工作流

```text
Input: idea / novel / script / brief
   ▼
读取 references/vimax-upstream-planning.md
   ▼
写 00_brief 前期策划包
   ▼
npm run validate:upstream-plan
   ▼
通过后交给 $comic-control-page-video
```

## 必需产物

在每个 run folder 下写入：

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

详细 schema 见 `references/handoff-contracts.md`。

## 执行规则

1. 判断输入模式：
   - `idea`：扩写为故事策略、核心冲突、观众钩子和事件链。
   - `novel`：提取主线事件、可画场景、人物状态变化和视觉锚点。
   - `script`：沿用已有场次和台词功能，抽出场景、人物、道具和空间关系。
   - `brief`：保留用户约束，补齐缺失的策划字段。
2. 按题材路由读取对应 topic pack：
   - 历史 / 江湖野史：`.codex/skills/comic-control-page-video/references/history/INDEX.md`
   - 中式克苏鲁 / 原创怪谈：`.codex/skills/comic-control-page-video/references/chinese-cthulhu/INDEX.md`
3. 使用稳定 ID：`event_01`、`scene_001`、`char_*`、`loc_*`、`prop_*`。
4. 区分 `event` 和 `scene`：
   - `event` 是因果和戏剧目标单位。
   - `scene` 是同一时间、地点和可画空间单位。
5. 角色、环境和道具 registry 必须能互相交叉引用，不依赖聊天上下文。
6. `reference_selection_plan.json` 只决定参考图用途和来源，不直接画最终页。
7. `adaptation_plan.md` 用中文说明保留内容、删除 / 合并内容、风险和下游口播策略。

## Gate

写完策划包后必须运行：

```bash
npm run validate:upstream-plan -- project_output/control-page-runs/<run>
```

通过条件：

- 所有必需文件存在。
- JSON 格式合法。
- event、scene、character、location、prop、reference source ID 可以互相引用。
- `00_brief/upstream_planning_audit.json.passed === true`。

未通过时，只修 `00_brief` 文件，不进入口播、图片或视频阶段。

## 交接

通过后，把 run folder 交给 `$comic-control-page-video`。下游 skill 从
`00_brief/story_strategy.json`、`event_scene_map.json` 和各 registry 读取故事图纸，
再生成观众可听的口播稿和后续视频产物。

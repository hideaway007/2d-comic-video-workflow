# 中国历史 / 江湖野史 Topic Pack

当用户要求中国历史、古代身份、江湖野史、沉浸式历史、假如重生、古代某身份到底多爽 / 多惨 / 能不能成时，读取本 topic pack。不要同时加载中式克苏鲁 topic pack，除非用户明确要混合题材。

## 必读文件

- `jianghu-yeshi-narration-style.md`：默认口播主规范。
- `legacy-chinese-history-storytelling-prd-v0-3.md`：旧版“假如重生”长稿兼容参考，只在用户明确要求旧模板、8-10 分钟或历史选择题结构时读取。

共享文件仍从上级目录读取：

- `../director-visual-planning.md`
- `../handoff-contracts.md`
- `../doubao-voice-api.md`

## 写作边界

- 默认第二人称“你”，写沉浸式命运现场，不写知识讲座。
- 开头必须是强钩子，可用“在古代……到底有多爽/多惨/能不能成”或“假如你重生成了……”。
- 必须有历史事实底座：真实人物、时代背景、制度和关键事件要尽量准确。
- 可以虚构现场动作、心理、对话和小人物细节，但必须写入 `01_script/historical_fact_base.md` 说明事实与演绎边界。
- 不要写成列表式策略复盘、选择题、年表、地图推演或朝代百科。
- 不要使用“系统、属性、角色卡、通关、本局”等游戏化词汇。

## 默认产出

阶段 1A 必须产出：

```text
01_script/narration.md
01_script/story_package.json
01_script/historical_fact_base.md
01_script/human_review_packet.md
01_script/review_status.json
```

`story_package.json.mode` 默认使用 `jianghu_yeshi_rebirth_narration`。

## 转入图片阶段

历史模式也必须遵守主 skill 的 beat-first 流程：

1. 用户审核口播稿通过。
2. 从 `narration.md` 生成 `02_prompts/timeline_beats.json`。
3. 先生成 `02_prompts/director_visual_plan.json`，由导演方案统一控制场景、
   分镜、运镜、灯光、景别比例和人物动线。
4. 从 beat 表和导演方案派生音频段、时间戳、参考图 prompt 和 9:16 单页图
   prompt。
5. 页面图默认是一 beat 一张 9:16 竖版 story page，不走 1:2 控制页、漫画格
   或 splitter 裁切。

历史视觉可以使用古代生活空间、官署、市井、驿站、府门、米铺、城门、文书、器物和衣冠，但不要把图片 prompt 改成中式克苏鲁、怪物或不可名状恐怖，除非用户明确要求混合题材。

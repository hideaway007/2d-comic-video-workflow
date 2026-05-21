# 中式克苏鲁 / 古神触手怪谈 Topic Pack

当用户要求中式克苏鲁、乡土克苏鲁、民俗恐怖、不可名状怪谈、古神、触手、邪神 boss、原创恐怖小说，或明确说“不写历史”时，读取本 topic pack。不要同时加载历史 topic pack，除非用户明确要混合题材。

## 必读文件

- `story-style.md`：原创怪谈小说 / 口播规范。
- `image-style.md`：中式克苏鲁 9:16 单页剧情图、古神触手视觉和参考图规则。

共享文件仍从上级目录读取：

- `../director-visual-planning.md`
- `../handoff-contracts.md`
- `../doubao-voice-api.md`

## 写作边界

- 这是原创虚构怪谈，不写真实历史讲解、真实朝代事件、名人轶事或历史事实底座。
- 可以使用虚构村镇、祠堂、古井、族谱、旧历、家族禁忌、地方志残页、庙会、祖坟、河湾、盐霜、黑水和仪式。
- 可以写游戏怪物、触手、古神、邪神 boss，但恐怖必须绑定中式民俗空间、材质、仪式和认知污染，不要变成西式章鱼海怪、网游 UI 或纯战力设定。
- 需要写 `01_script/fiction_boundary.md`，说明村名、民俗、禁忌、仪式和怪异均为虚构或混合化设定。

## 参考图位置

默认参考图目录：

```text
local-reference-images/chinese-cthulhu
```

repo 相对路径：

```text
中式克苏鲁参考图片/
```

主控需要在 `00_brief/style_reference_manifest.json` 记录参考图路径、sha256、用途和是否实际传给图像工具。如果 `image_gen` 或当前工具不能接收本地 reference image，就把参考图转译为文字风格约束，并写明 `reference_transport.supports_image_reference=false`，不得谎称图片已作为模型 reference 使用。

## 默认产出

阶段 1A 必须产出：

```text
01_script/narration.md
01_script/story_package.json
01_script/fiction_boundary.md
01_script/human_review_packet.md
01_script/review_status.json
00_brief/style_reference_manifest.json
```

`story_package.json.mode` 必须使用 `chinese_cthulhu_weird_tale`。

## 转入图片阶段

中式克苏鲁模式必须遵守主 skill 的 beat-first 流程：

1. 用户审核口播稿通过。
2. 从 `narration.md` 生成 `02_prompts/timeline_beats.json`。
3. 先生成 `02_prompts/director_visual_plan.json`，由导演方案统一控制场景、
   分镜、运镜、灯光、景别比例、怪异揭示顺序和人物动线。
4. 每个 beat 生成一个可画瞬间、一张 9:16 runtime story page、一个音频段和
   一个时间戳行。
5. 参考图包先于页面图生成；多个 image worker 必须共享同一套
   `03_images/references/*`，其中必须包含人物 / 道具、场景总平面和人物动线。

默认视觉密度按叙事节奏自适应，但每个 visual beat 的口播 `text` 必须满足 20-50 个中文字符强约束。强动作、怪物显形、认知污染转折可以拆得更短；少于 20 字的短句必须和前后相邻句合并，除非这是用户明确要求单独成页的标题、沉默、拟声或关键台词。不得为了减少图片、TTS 段数或渲染工作量而放宽字数。

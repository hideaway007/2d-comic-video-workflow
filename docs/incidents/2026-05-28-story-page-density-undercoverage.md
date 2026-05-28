# 2026-05-28 story page density undercoverage

## Symptom

`project_output/control-page-runs/20260528-163051-rented-grief-proxy` 的口播已经进入
Phase 1B，但只生成了 26 张 `story_pages` 对应规划页。对 1659 个有效口播字符来说，
这个页数明显偏少，无法支撑连续 9:16 图像叙事视频。

## Impact

- 图片数量不足，视频会变成少量插画反复覆盖较长口播。
- `timeline_beats.json`、`audio_segments.json`、`narration_timestamps.json` 和
  `vertical_page_prompts.json` 虽然结构一一对齐，但没有覆盖完整口播。
- 旧 gate 会给出“通过”结论，导致错误被推进到图片生成阶段。

## Root Cause

这不是用户题材或 story page 规则的问题，而是生成与验证链条的问题：

- Phase 1B 生成了压缩版 beat list，而不是按完整 `01_script/narration.md` 做可视化瞬间拆分。
- `timeline_beats.json.beats[*].text` 合计只覆盖约 512 个字符，而口播有效字符约 1659 个，
  覆盖率约 31%。
- 旧 `validate:vertical-prompts` 主要检查 prompt 结构、storyboard 对齐、镜头多样性和
  worker batch 上下文，没有检查口播覆盖率、最低页数密度或业务量级。

## Missing Gate

缺少两个机器可验证约束：

1. `timeline_beats.json.beats[*].text` 合计必须覆盖 `01_script/narration.md` 的主体口播；
   默认最低覆盖率为 90%。
2. story page 数量不能低于口播有效字符数推导出的最低密度；默认按每页最多 40 个有效口播字符计算。

## Rule Changes

- 全局规则已写入 `/Users/d2/.codex/AGENTS.md`：
  反复性问题必须先 root cause，再改 durable rule / skill gate，再修当前项目产物。
- 项目规则已写入 `AGENTS.md`：
  生成式 workflow 不能只验证 schema 和字段对齐，还必须验证 coverage、density、magnitude
  和业务成功标准。

## Project Fix

- 给 `.codex/skills/video-generation-template/scripts/validate-vertical-page-prompts.mjs`
  增加 narration coverage 和 page density audit。
- 给 `tests/control-page-planning-validation.test.mjs` 增加 undercoverage regression test。
- 更新 `.codex/skills/video-generation-template/SKILL.md` 与
  `.codex/skills/video-generation-template/references/handoff-contracts.md`，把覆盖率和密度
  写成 Phase 1B 硬约束。
- 重新生成当前 run 的 Phase 1B 规划文件，使 beat/page 数量回到可覆盖口播的范围。

## Prevention Checks

以后同类项目至少运行：

```bash
npm run validate:vertical-prompts -- project_output/control-page-runs/<run>
node --test tests/control-page-planning-validation.test.mjs
```

通过条件不只是 JSON 文件存在或一一对齐，还包括：

- `vertical_page_prompt_audit.json.passed === true`
- `vertical_page_prompt_audit.narration_coverage.beat_text_coverage_ratio >= 0.9`
- `vertical_page_prompt_audit.narration_coverage.page_count >= min_page_count_from_narration`

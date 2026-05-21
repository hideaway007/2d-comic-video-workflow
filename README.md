# 2D Comic Video Workflow

Local-first tooling for turning static comic pages, narration beats, and storyboard prompts into reviewable 2.5D motion-comic video assets.

This repository is not a one-click AI video black box. It keeps the production chain inspectable:

```text
comic pages / storyboard beats
  -> panel or vertical-page planning
  -> structured motion plan
  -> deterministic normalization
  -> Remotion preview rendering
  -> FFmpeg and QA verification
```

## What It Does

- Detects and crops comic panels, then builds a stable `panel_pack.json`.
- Supports 9:16 single-page story frames for short-form comic videos.
- Validates narration beats, director visual plans, storyboard continuity, image prompts, and runtime inputs.
- Converts AI-friendly planning output into deterministic `motion_plan.json` data.
- Renders conservative 2.5D motion previews with Remotion.
- Produces QA reports, review sheets, and FFprobe-backed video checks.
- Includes a Codex skill under `.codex/skills/comic-control-page-video` for narration-first comic video production.

## Current Boundaries

- Runs locally. No hosted SaaS or deployed backend is claimed.
- Keeps generated media out of git by default.
- Does not include private API keys, personal run history, or generated video/image outputs.
- TTS integration expects user-provided provider credentials through environment variables.
- AI planning is optional; the deterministic mock planner keeps the sample workflow runnable without external model access.

## Requirements

- Node.js 24 or compatible
- npm
- FFmpeg and FFprobe

Check:

```bash
node --version
npm --version
ffmpeg -version
ffprobe -version
```

## Install

```bash
npm install
npm --prefix render/remotion install
```

## Quick Start

Generate sample inputs and project artifacts:

```bash
npm run build:sample
```

Run tests:

```bash
npm test
```

Render previews after building sample output:

```bash
npm run render:preview
```

Run QA and verification:

```bash
npm run qa
npm run verify
```

## Input Layout

Put real comic pages here:

```text
input/pages/
  page_001.png
  page_002.png
```

Supported image formats are `png`, `jpg`, `jpeg`, and `webp`. Local outputs are written to `project_output/`.

## Output Layout

```text
project_output/
  panels/
    panel_pack.json
    crops/
  plans/
    analysis_plan.json
    normalizer_report.json
    motion_plan.json
  assets/
  render/
    remotion/
  reports/
    qa_report.md
    review_sheet.md
```

For 9:16 comic-video runs, the skill workflow uses:

```text
project_output/control-page-runs/<run-id>/
  01_script/
  02_prompts/
  03_images/
  05_video/
```

## Main Scripts

- `npm run build`: build panel packs, planning input, analysis plan, normalized motion plan, and runtime assets.
- `npm run build:sample`: create deterministic sample pages and build the sample workflow.
- `npm run render:preview`: render Remotion previews.
- `npm run qa`: write QA reports and review sheets.
- `npm run verify`: verify assets, videos, and QA gates.
- `npm run validate:vertical-prompts -- <run-folder>`: validate 9:16 storyboard/image prompt contracts.

## Codex Skill

The project-local skill is:

```text
.codex/skills/comic-control-page-video/
```

It defines a narration-first workflow for Chinese-history explainer videos and Chinese folk-horror / Cthulhu-style comic videos:

1. Write narration and review package.
2. Build beat-first timeline.
3. Create director visual plan.
4. Create storyboard continuity plan.
5. Generate 9:16 vertical page prompts and image worker batches.
6. Gate image review before TTS and video rendering.

## Optional TTS

The TTS script reads provider credentials from environment variables or a local env file. Do not commit credentials.

```bash
export DOUBAO_TTS_API_KEY=...
# or
export VOLCENGINE_TTS_API_KEY=...
```

Dry-run mode can validate request construction without calling the provider.

## Repository Hygiene

Ignored by default:

- `node_modules/`
- `input/`
- `project_output/`
- generated audio/video/image outputs
- local editor files

This public package was exported as a clean snapshot without the source repository history.

## License

MIT

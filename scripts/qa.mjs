#!/usr/bin/env node
import path from "node:path";
import {
  buildContactSheet,
  fileSize,
  optionalCommand,
  pathExists,
  probeVideo,
  readPlan,
  renderSpec,
  resolveProjectPath,
  runStructuredQualityGates,
  severityForShot,
  finalVideoPath,
  previewVideoPath,
  videoCheckIssues,
  videoTargets,
  writeText,
} from "./lib/quality.mjs";

function hasFlag(name) {
  return process.argv.slice(2).includes(name);
}

function markdownList(items) {
  if (items.length === 0) {
    return "- 无";
  }
  return items.map((item) => `- ${formatIssue(item)}`).join("\n");
}

function formatIssue(item) {
  if (typeof item === "string") {
    return item;
  }
  const refs = [
    item.panel_id ? `panel_id=${item.panel_id}` : null,
    item.shot_id ? `shot_id=${item.shot_id}` : null,
    item.code ? `code=${item.code}` : null,
  ].filter(Boolean);
  const suffix = refs.length > 0 ? ` (${refs.join(", ")})` : "";
  return `${item.message}${suffix}`;
}

async function checkVideoTarget(cwd, spec, target) {
  const absolutePath = resolveProjectPath(cwd, target.relativePath);
  const issues = [];

  if (!(await pathExists(absolutePath))) {
    return { target, ok: false, issues: [`Missing video: ${target.relativePath}`] };
  }

  const size = await fileSize(absolutePath);
  if (size <= 0) {
    return { target, ok: false, issues: [`Empty video file: ${target.relativePath}`] };
  }

  const actual = await probeVideo(absolutePath);
  issues.push(
    ...videoCheckIssues({
      target,
      actual,
      expectedWidth: spec.width,
      expectedHeight: spec.height,
    }),
  );

  return { target, ok: issues.length === 0, issues, actual };
}

function buildQaReport({
  plan,
  spec,
  criticalIssues,
  warnings,
  manualReviewItems,
  correctionSuggestions,
  videoChecks,
  contactSheets,
  skipVideo,
}) {
  const lines = [
    "# QA 报告",
    "",
    `critical issues: ${criticalIssues.length}`,
    `warnings: ${warnings.length}`,
    `manual review items: ${manualReviewItems.length}`,
    "",
    "## 基础信息",
    "",
    `- shots: ${plan.shots.length}`,
    `- resolution: ${spec.width}x${spec.height}`,
    `- fps: ${spec.fps}`,
    `- video checks: ${skipVideo ? "skipped" : "enabled"}`,
    "",
    "## Critical Issues",
    "",
    markdownList(criticalIssues),
    "",
    "## Warnings",
    "",
    markdownList(warnings),
    "",
    "## Manual Review Items",
    "",
    markdownList(manualReviewItems),
    "",
    "## Correction Suggestions",
    "",
    markdownList(correctionSuggestions),
    "",
    "## Video Checks",
    "",
  ];

  if (skipVideo) {
    lines.push("- skipped by --skip-video");
  } else {
    for (const check of videoChecks) {
      lines.push(`- ${check.target.relativePath}: ${check.ok ? "ok" : "needs attention"}`);
    }
  }

  lines.push("", "## Contact Sheets", "");
  if (skipVideo) {
    lines.push("- skipped by --skip-video");
  } else if (contactSheets.length === 0) {
    lines.push("- 无");
  } else {
    for (const sheet of contactSheets) {
      lines.push(`- ${path.relative("project_output/reports", sheet.outputPath)}`);
    }
  }

  return lines.join("\n");
}

function safeFrameText(value) {
  if (!value) {
    return "missing";
  }
  return `x=${value.x_pct}, y=${value.y_pct}, w=${value.width_pct}, h=${value.height_pct}`;
}

function buildReviewSheet({ plan, gateResult, contactSheets, skipVideo }) {
  const panelsById = new Map((plan.panels ?? []).map((panel) => [panel.panel_id, panel]));
  const contactSheetById = new Map(contactSheets.map((sheet) => [sheet.target.id, sheet.outputPath]));
  const lines = [
    "# 人工复核表",
    "",
    "| Shot | Panel ID | Reading Order | Primitive | Safe Frame | QA Severity | 源图 | 视频 | 审查入口/contact sheet path | 当前效果评级 | 主要问题 | 人工修正建议 | 可进最终合成 | 需要人工修图 |",
    "| --- | --- | ---: | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ];

  for (const shot of plan.shots) {
    const panel = panelsById.get(shot.panel_id);
    const videoCell = skipVideo ? "skipped" : previewVideoPath(shot, plan);
    const contactSheet = skipVideo
      ? "run npm run qa with video enabled"
      : (contactSheetById.get(shot.shot_id) ?? "missing contact sheet");
    const contactSheetCell = skipVideo || contactSheet === "missing contact sheet"
      ? contactSheet
      : path.relative("project_output/reports", contactSheet);
    const review = shot.review_metadata ?? {};
    const mainIssues = Array.isArray(review.main_issues) ? review.main_issues.join("; ") : "待人工复核";
    const relevantSuggestions = gateResult.correctionSuggestions
      .filter((item) => item.shot_id === shot.shot_id || item.panel_id === shot.panel_id)
      .map(formatIssue);
    const recommendedFix = relevantSuggestions.length > 0
      ? relevantSuggestions.join("; ")
      : (review.recommended_fix ?? "检查主体出画、对白框遮挡、运动强度和版权备注。");
    const canEnterFinal = review.can_enter_final === false ? "否" : "可预览，待人工确认";
    const manualRetouch = review.manual_retouch_required ? "是" : "否";
    lines.push(
      `| ${shot.shot_id} | ${shot.panel_id ?? "missing"} | ${panel?.reading_order ?? "missing"} | ${shot.primitive ?? "missing"} | ${safeFrameText(panel?.safe_frame)} | ${severityForShot(shot, gateResult)} | ${shot.source_image} | ${videoCell} | ${contactSheetCell} | ${review.suggested_rating ?? "review_required"} | ${mainIssues} | ${recommendedFix} | ${canEnterFinal} | ${manualRetouch} |`,
    );
  }

  lines.push("", "| Final | 视频 | 当前效果评级 | 主要问题 | 推荐修正动作 | 可发布 |", "| --- | --- | --- | --- | --- | --- |");
  lines.push(
    `| motion_comic_preview | ${skipVideo ? "skipped" : finalVideoPath(plan)} | review_required | 需要逐镜头人工确认 | 确认授权、角色脸、对白框遮挡和运动强度 | 否，待人工确认 |`,
  );
  return lines.join("\n");
}

async function main() {
  const cwd = process.cwd();
  const skipVideo = hasFlag("--skip-video");
  const plan = await readPlan(cwd);
  const spec = renderSpec(plan);
  const reportsDir = resolveProjectPath(cwd, path.join("project_output", "reports"));
  const contactSheetDir = path.join(reportsDir, "frame_contact_sheets");
  const gateResult = await runStructuredQualityGates({ cwd, plan });
  const criticalIssues = [...gateResult.criticalIssues];
  const warnings = [...gateResult.warnings];
  const manualReviewItems = [...gateResult.manualReviewItems];
  const correctionSuggestions = [...gateResult.correctionSuggestions];
  const videoChecks = [];
  const contactSheets = [];

  if (!skipVideo) {
    for (const target of videoTargets(plan)) {
      try {
        const check = await checkVideoTarget(cwd, spec, target);
        videoChecks.push(check);
        criticalIssues.push(...check.issues);
      } catch (error) {
        criticalIssues.push(error.message);
        videoChecks.push({ target, ok: false, issues: [error.message] });
      }
    }

    if (await optionalCommand("ffmpeg")) {
      for (const target of videoTargets(plan)) {
        const absolutePath = resolveProjectPath(cwd, target.relativePath);
        if (!(await pathExists(absolutePath))) {
          continue;
        }
        const sheet = await buildContactSheet({ cwd, target, outputDir: contactSheetDir });
        if (sheet.ok) {
          contactSheets.push(sheet);
        } else {
          warnings.push(sheet.error);
        }
      }
    } else {
      warnings.push("ffmpeg not found; frame contact sheets were skipped");
    }
  } else {
    warnings.push("video verification skipped by --skip-video");
  }

  await writeText(
    path.join(reportsDir, "qa_report.md"),
    buildQaReport({
      plan,
      spec,
      criticalIssues,
      warnings,
      manualReviewItems,
      correctionSuggestions,
      videoChecks,
      contactSheets,
      skipVideo,
    }),
  );
  await writeText(
    path.join(reportsDir, "review_sheet.md"),
    buildReviewSheet({ plan, gateResult, contactSheets, skipVideo }),
  );

  if (criticalIssues.length > 0) {
    await writeText(
      path.join(reportsDir, "failures.md"),
      ["# Failures", "", ...criticalIssues.map((issue) => `- ${formatIssue(issue)}`)].join("\n"),
    );
    console.error(`QA failed with ${criticalIssues.length} critical issue(s).`);
    process.exitCode = 1;
    return;
  }

  console.log(`QA reports written to ${path.relative(cwd, reportsDir)}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

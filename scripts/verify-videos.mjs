#!/usr/bin/env node
import {
  fileSize,
  pathExists,
  probeVideo,
  readPlan,
  renderSpec,
  requireCommand,
  resolveProjectPath,
  videoCheckIssues,
  videoTargets,
} from "./lib/quality.mjs";

async function main() {
  const cwd = process.cwd();
  const plan = await readPlan(cwd);
  const spec = renderSpec(plan);
  const issues = [];

  try {
    await requireCommand("ffprobe");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
    return;
  }

  for (const target of videoTargets(plan)) {
    const absolutePath = resolveProjectPath(cwd, target.relativePath);
    if (!(await pathExists(absolutePath))) {
      issues.push(`Missing video: ${target.relativePath}`);
      continue;
    }

    const size = await fileSize(absolutePath);
    if (size <= 0) {
      issues.push(`Empty video file: ${target.relativePath}`);
      continue;
    }

    try {
      const actual = await probeVideo(absolutePath);
      issues.push(
        ...videoCheckIssues({
          target,
          actual,
          expectedWidth: spec.width,
          expectedHeight: spec.height,
        }),
      );
    } catch (error) {
      issues.push(error.message);
    }
  }

  if (issues.length > 0) {
    console.error(issues.join("\n"));
    process.exitCode = 1;
    return;
  }

  console.log(`Verified ${videoTargets(plan).length} video file(s).`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { finalVideoPath, previewVideoPath, videoOutputPaths } from "../../../scripts/lib/quality.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const remotionRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(remotionRoot, "../..");

function unique(paths) {
  return [...new Set(paths.filter(Boolean).map((item) => path.resolve(item)))];
}

function findRuntimePlan() {
  if (process.env.MOTION_COMIC_PLAN) {
    const explicit = path.resolve(process.env.MOTION_COMIC_PLAN);
    if (!existsSync(explicit)) {
      throw new Error(`Runtime motion plan not found at MOTION_COMIC_PLAN=${explicit}`);
    }
    return explicit;
  }

  const candidates = unique([
    path.join(process.cwd(), "project_output/plans/motion_plan.json"),
    process.env.INIT_CWD && path.join(process.env.INIT_CWD, "project_output/plans/motion_plan.json"),
    path.join(repoRoot, "project_output/plans/motion_plan.json"),
  ]);

  const found = candidates.find((candidate) => existsSync(candidate));
  if (found) {
    return found;
  }

  throw new Error(
    [
      "Runtime motion plan not found.",
      "Expected project_output/plans/motion_plan.json under the command cwd, INIT_CWD, or repository root.",
      `Checked: ${candidates.join(", ")}`,
      "Run the planning step first, or set MOTION_COMIC_PLAN=/absolute/path/to/motion_plan.json.",
    ].join(" "),
  );
}

function readPlan(planPath) {
  const plan = JSON.parse(readFileSync(planPath, "utf8"));
  if (!Array.isArray(plan.shots) || plan.shots.length === 0) {
    throw new Error(`Runtime motion plan has no shots: ${planPath}`);
  }
  return plan;
}

function durationFrames(shot, fps) {
  const explicit = Number(shot.duration_frames ?? shot.durationFrames);
  if (Number.isFinite(explicit) && explicit > 0) {
    return Math.round(explicit);
  }
  const seconds = Number(shot.duration_seconds ?? shot.durationSeconds ?? shot.duration ?? 3);
  return Math.max(1, Math.round((Number.isFinite(seconds) ? seconds : 3) * fps));
}

function compositionIdForShot(shotId) {
  return `shot-${String(shotId).replace(/[^a-zA-Z0-9\u4e00-\u9fa5-]/g, "-")}`;
}

function publicAssetPath(sourcePath, publicRoot) {
  const relative = path.relative(publicRoot, sourcePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(
      `Remotion source images must be under ${publicRoot} so they can be served as static files: ${sourcePath}`,
    );
  }
  return relative.split(path.sep).join("/");
}

function resolveOptionalPublicAsset(source, projectRoot, publicRoot, label) {
  if (!source) {
    return null;
  }
  if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(source)) {
    return source;
  }

  const candidates = path.isAbsolute(source)
    ? [source]
    : [path.join(projectRoot, source), path.join(publicRoot, source)];
  const sourcePath = candidates.find((candidate) => existsSync(candidate));
  if (!sourcePath) {
    throw new Error(`Missing ${label}: ${candidates.join(" or ")}`);
  }
  if (sourcePath === source || /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(sourcePath)) {
    return sourcePath;
  }
  return publicAssetPath(sourcePath, publicRoot);
}

function enrichNarrationAudio(plan, projectRoot, publicRoot) {
  const narration = plan.audio?.narration;
  if (!narration) {
    return plan.audio;
  }
  const source = narration.resolved_audio ?? narration.resolvedAudio ?? narration.src ?? narration.audio ?? narration.source;
  return {
    ...(plan.audio ?? {}),
    narration: {
      ...narration,
      resolved_audio: resolveOptionalPublicAsset(source, projectRoot, publicRoot, "narration audio"),
    },
  };
}

function enrichPlan(plan, projectRoot, publicRoot) {
  const fps = Number(plan.render?.fps ?? plan.fps ?? 24) || 24;
  return {
    ...plan,
    render: {
      ...(plan.render ?? {}),
      width: Number(plan.render?.width ?? 1920) || 1920,
      height: Number(plan.render?.height ?? 1080) || 1080,
      fps,
    },
    audio: enrichNarrationAudio(plan, projectRoot, publicRoot),
    shots: plan.shots.map((shot, index) => {
      const sourceImage = shot.source_image ?? shot.sourceImage ?? shot.image;
      if (!sourceImage) {
        throw new Error(`Shot ${shot.shot_id ?? index} is missing source_image`);
      }
      const sourcePath = path.isAbsolute(sourceImage) ? sourceImage : path.join(projectRoot, sourceImage);
      if (!existsSync(sourcePath)) {
        throw new Error(`Missing source image for ${shot.shot_id ?? index}: ${sourcePath}`);
      }
      return {
        ...shot,
        shot_id: shot.shot_id ?? shot.id ?? `shot_${String(index + 1).padStart(3, "0")}`,
        duration_frames: durationFrames(shot, fps),
        resolved_source_image: publicAssetPath(sourcePath, publicRoot),
      };
    }),
  };
}

async function renderComposition({ entryPoint, compositionId, inputProps, outputLocation }) {
  const composition = await selectComposition({
    serveUrl: entryPoint,
    id: compositionId,
    inputProps,
  });

  await renderMedia({
    composition,
    serveUrl: entryPoint,
    codec: "h264",
    outputLocation,
    inputProps,
  });
}

const planPath = findRuntimePlan();
const projectRoot = path.resolve(path.dirname(planPath), "../..");
const publicRoot = path.join(projectRoot, "project_output");
const plan = enrichPlan(readPlan(planPath), projectRoot, publicRoot);
const inputProps = { plan };
const entryPoint = await bundle({
  entryPoint: path.join(remotionRoot, "src/Root.tsx"),
  publicDir: publicRoot,
  webpackOverride: (config) => config,
});

const outputPaths = videoOutputPaths(plan);
const previewDir = path.join(projectRoot, outputPaths.previewsDir);
const finalDir = path.dirname(path.join(projectRoot, outputPaths.final));
mkdirSync(previewDir, { recursive: true });
mkdirSync(finalDir, { recursive: true });

for (const shot of plan.shots) {
  const outputLocation = path.join(projectRoot, previewVideoPath(shot, plan));
  await renderComposition({
    entryPoint,
    compositionId: compositionIdForShot(shot.shot_id),
    inputProps,
    outputLocation,
  });
  console.log(`Rendered ${outputLocation}`);
}

if (process.env.MOTION_COMIC_SKIP_FINAL === "1") {
  console.log("Skipped motion-comic-preview final render because MOTION_COMIC_SKIP_FINAL=1");
  process.exit(0);
}

const finalOutput = path.join(projectRoot, finalVideoPath(plan));
await renderComposition({
  entryPoint,
  compositionId: "motion-comic-preview",
  inputProps,
  outputLocation: finalOutput,
});
console.log(`Rendered ${finalOutput}`);

import { mkdir, readdir, copyFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const renderSpec = {
  width: 1920,
  height: 1080,
  fps: 24,
};

export const verticalRenderSpec = {
  width: 1080,
  height: 1920,
  fps: 24,
};

export function inferRenderSpec(panelPack) {
  const pages = Array.isArray(panelPack?.pages) ? panelPack.pages : [];
  if (pages.length > 0 && pages.every((page) => looksLikeVerticalStoryPage(page))) {
    return verticalRenderSpec;
  }
  return renderSpec;
}

export function toPosixPath(value) {
  return value.split(path.sep).join("/");
}

export function shotId(index) {
  return `shot_${String(index + 1).padStart(3, "0")}`;
}

export async function ensureDir(dir) {
  await mkdir(dir, { recursive: true });
}

export async function writeJson(filePath, data) {
  await ensureDir(path.dirname(filePath));
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

export async function listInputPages(cwd) {
  const pagesDir = path.join(cwd, "input", "pages");
  const entries = await readdir(pagesDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && /\.(png|jpe?g|webp)$/i.test(entry.name))
    .map((entry) => path.join(pagesDir, entry.name))
    .sort((a, b) => a.localeCompare(b));
}

export function buildShot(pagePath, index, cwd, options = {}) {
  const id = shotId(index);
  const sourceImage = toPosixPath(path.relative(cwd, pagePath));
  const cameraTypes = ["slow_push_in", "pan_right", "tilt_up", "hold"];
  const durationFrames = index % 2 === 0 ? 96 : 84;

  return {
    shot_id: id,
    ...(options.panelId ? { panel_id: options.panelId } : {}),
    source_image: sourceImage,
    duration_sec: Number((durationFrames / renderSpec.fps).toFixed(2)),
    duration_frames: durationFrames,
    main_subject: index % 2 === 0 ? "foreground character and action focus" : "scene panel with foreground emphasis",
    camera_motion: {
      type: cameraTypes[index % cameraTypes.length],
      start_scale: index % 2 === 0 ? 1 : 1.03,
      end_scale: index % 2 === 0 ? 1.08 : 1.01,
      start_position: { x: 0, y: 0 },
      end_position: {
        x: index % 2 === 0 ? -42 : 48,
        y: index % 3 === 0 ? -18 : 12,
      },
    },
    local_motion: [
      {
        target: "foreground_focus",
        layer_id: "foreground_focus",
        type: "parallax_drift",
        amplitude_px: 18 + index * 4,
        direction: index % 2 === 0 ? "left" : "right",
      },
      {
        target: "panel_energy",
        type: index % 2 === 0 ? "glow_flicker" : "speed_line_overlay",
        intensity: index % 2 === 0 ? "medium" : "low",
      },
    ],
    effects: index % 2 === 0 ? ["subtle_shake", "glow", "flash"] : ["speed_lines", "soft_vignette"],
    layer_plan: ["full_frame_fallback", "foreground_focus", "effects_overlay"],
    risk: "medium",
    manual_review_required: true,
    review_metadata: {
      suggested_rating: "review_required",
      main_issues: ["sample input only", "automatic layer refinement deferred"],
      recommended_fix: "Replace sample pages with licensed manga panels and review motion strength.",
      can_enter_final: true,
      manual_retouch_required: false,
    },
    defer_layer_refinement: true,
  };
}

function looksLikeVerticalStoryPage(page) {
  const width = Number(page?.width);
  const height = Number(page?.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || height <= width) {
    return false;
  }
  const aspect = width / height;
  return aspect >= 0.5 && aspect <= 0.65;
}

export async function writeLayerAsset({ cwd, outputRoot, shot }) {
  const shotDir = path.join(outputRoot, "assets", shot.shot_id);
  await ensureDir(shotDir);

  const sourcePath = path.join(cwd, shot.source_image);
  const ext = path.extname(shot.source_image).toLowerCase() || ".png";
  const copiedSource = path.join(shotDir, `source${ext}`);
  await copyFile(sourcePath, copiedSource);

  const manifest = {
    version: 1,
    shot_id: shot.shot_id,
    source_image: toPosixPath(path.relative(cwd, copiedSource)),
    layers: [
      {
        layer_id: "full_frame_fallback",
        source: path.basename(copiedSource),
        role: "base_plate",
        opacity: 1,
      },
    ],
    defer_layer_refinement: true,
    notes: [
      "自动分层未执行，使用整张源图作为保守回退层。",
      "后续可由人工或视觉模型补充分层 mask 与局部动效绑定。",
    ],
  };

  await writeJson(path.join(shotDir, "layer_manifest.json"), manifest);
  return manifest;
}

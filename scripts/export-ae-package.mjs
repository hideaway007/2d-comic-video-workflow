#!/usr/bin/env node
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";

const cwd = process.env.MOTION_COMIC_TEST_ROOT || process.cwd();
const sourceRun =
  process.env.AE_SOURCE_RUN || "project_output/runs/biaoren_ai_motion_20260514_001605";
const manifestRelativePath = process.env.AE_PANEL_MANIFEST || path.join(sourceRun, "ai_panel_manifest.json");
const outputRelativeRoot =
  process.env.AE_EXPORT_ROOT || "project_output/ae_export/biaoren_ai_motion_ae";

const manifestPath = resolveProjectPath(manifestRelativePath);
const sourceRunPath = resolveProjectPath(sourceRun);
const outputRoot = resolveProjectPath(outputRelativeRoot);
const sequenceDir = path.join(outputRoot, "image_sequence");
const scriptsDir = path.join(outputRoot, "ae_scripts");
const projectDir = path.join(outputRoot, "ae_project");
const rendersDir = path.join(outputRoot, "renders");

const renderSpec = {
  width: 1920,
  height: 1080,
  fps: 24,
  shot_seconds: 2.2,
  transition_seconds: 0.35,
};

if (!existsSync(manifestPath)) {
  throw new Error(`AE panel manifest not found: ${manifestPath}`);
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
if (!Array.isArray(manifest.panels) || manifest.panels.length === 0) {
  throw new Error(`AE panel manifest has no panels: ${manifestPath}`);
}

await mkdir(sequenceDir, { recursive: true });
await mkdir(scriptsDir, { recursive: true });
await mkdir(projectDir, { recursive: true });
await mkdir(rendersDir, { recursive: true });

const panels = [];
for (const [index, panel] of manifest.panels.entries()) {
  const sourceImagePath = resolveSourceImage(panel.file);
  if (!existsSync(sourceImagePath)) {
    throw new Error(`Missing source panel image for ${panel.id ?? index + 1}: ${sourceImagePath}`);
  }

  const sequenceName = `panel_${String(index + 1).padStart(4, "0")}.png`;
  const sequencePath = path.join(sequenceDir, sequenceName);
  await copyFile(sourceImagePath, sequencePath);
  const size = readPngSize(sourceImagePath);
  panels.push({
    index: index + 1,
    id: panel.id ?? `panel_${String(index + 1).padStart(3, "0")}`,
    page: panel.page ?? null,
    label: panel.label ?? "",
    motion: panel.motion ?? "slow_push",
    source_file: toPosixPath(path.relative(cwd, sourceImagePath)),
    sequence_file: toPosixPath(path.relative(cwd, sequencePath)),
    absolute_sequence_file: sequencePath,
    width: size.width,
    height: size.height,
  });
}

const timeline = buildTimeline(panels, renderSpec);
const aeManifest = {
  version: 1,
  generated_at: new Date().toISOString(),
  source_manifest: toPosixPath(path.relative(cwd, manifestPath)),
  source_run: toPosixPath(path.relative(cwd, sourceRunPath)),
  output_root: outputRelativeRoot,
  render: renderSpec,
  panels,
  timeline,
  ae: {
    jsx: toPosixPath(path.relative(cwd, path.join(scriptsDir, "build_motion_comic_project.jsx"))),
    expected_project: toPosixPath(path.relative(cwd, path.join(projectDir, "biaoren_ai_motion_ae.aep"))),
    native_render_placeholder: toPosixPath(path.relative(cwd, path.join(rendersDir, "biaoren_ai_motion_ae_native.mov"))),
    mp4_target: toPosixPath(path.relative(cwd, path.join(rendersDir, "biaoren_ai_motion_ae_native.mp4"))),
  },
};

await writeJson(path.join(outputRoot, "ae_manifest.json"), aeManifest);
await writeFile(path.join(scriptsDir, "build_motion_comic_project.jsx"), buildAfterEffectsJsx(aeManifest), "utf8");
await writeFile(path.join(outputRoot, "README.md"), buildReadme(aeManifest), "utf8");
await writeFile(path.join(outputRoot, "animation_composer_apply_plan.md"), buildAnimationComposerPlan(aeManifest), "utf8");

console.log(`Exported ${panels.length} panel image sequence frame(s) to ${toPosixPath(path.relative(cwd, sequenceDir))}`);
console.log(`Generated AE script at ${toPosixPath(path.relative(cwd, path.join(scriptsDir, "build_motion_comic_project.jsx")))}`);

function resolveProjectPath(relativeOrAbsolutePath) {
  return path.isAbsolute(relativeOrAbsolutePath)
    ? relativeOrAbsolutePath
    : path.join(cwd, relativeOrAbsolutePath);
}

function resolveSourceImage(filePath) {
  const directProjectPath = resolveProjectPath(filePath);
  if (existsSync(directProjectPath)) {
    return directProjectPath;
  }
  return path.join(sourceRunPath, filePath);
}

function readPngSize(filePath) {
  const png = PNG.sync.read(readFileSync(filePath));
  return { width: png.width, height: png.height };
}

function buildTimeline(items, spec) {
  const shotFrames = Math.round(spec.shot_seconds * spec.fps);
  const transitionFrames = Math.round(spec.transition_seconds * spec.fps);
  const stepFrames = shotFrames - transitionFrames;
  return items.map((panel, index) => ({
    panel_id: panel.id,
    sequence_file: panel.sequence_file,
    start_frame: index * stepFrames,
    duration_frames: shotFrames,
    transition_in_frames: index === 0 ? 0 : transitionFrames,
    transition_out_frames: index === items.length - 1 ? 0 : transitionFrames,
    native_transition: transitionFor(index),
    camera: cameraFor(panel.motion, index),
  }));
}

function transitionFor(index) {
  const transitions = ["fade_push", "slide_left", "zoom_blur", "slide_up", "whip_pan"];
  return transitions[index % transitions.length];
}

function cameraFor(motion, index) {
  if (motion === "hero_zoom_out") {
    return { type: "zoom_out", start_scale: 112, end_scale: 100, pan_x: 0, pan_y: 0 };
  }
  if (motion === "slow_push") {
    return { type: "push_in", start_scale: 100, end_scale: 110, pan_x: 0, pan_y: 0 };
  }
  if (motion === "reveal" || motion === "focus_reveal") {
    return { type: "reveal_push", start_scale: 102, end_scale: 108, pan_x: index % 2 === 0 ? -36 : 36, pan_y: 0 };
  }
  return {
    type: "drift",
    start_scale: 103,
    end_scale: 108,
    pan_x: index % 2 === 0 ? -42 : 42,
    pan_y: index % 3 === 0 ? -22 : 18,
  };
}

function buildAfterEffectsJsx(data) {
  const payload = {
    comp: {
      name: "biaoren_ai_motion_ae",
      width: data.render.width,
      height: data.render.height,
      fps: data.render.fps,
      duration: (Math.max(...data.timeline.map((item) => item.start_frame + item.duration_frames)) / data.render.fps),
      background: [0.03, 0.03, 0.035],
    },
    projectPath: path.join(projectDir, "biaoren_ai_motion_ae.aep"),
    renderMovPath: path.join(rendersDir, "biaoren_ai_motion_ae_native.mov"),
    panels: data.panels.map((panel) => ({
      id: panel.id,
      label: panel.label,
      file: panel.absolute_sequence_file,
      width: panel.width,
      height: panel.height,
    })),
    timeline: data.timeline,
  };

  return `// Generated by scripts/export-ae-package.mjs
// Run in After Effects: File > Scripts > Run Script File...
// The script creates a native-transition comparison comp and saves the .aep file.

(function () {
  var data = ${JSON.stringify(payload, null, 2)};
  app.beginUndoGroup("Build Biaoren motion comic AE project");
  app.newProject();

  var project = app.project;
  var footageFolder = project.items.addFolder("01_panel_sequence");
  var compFolder = project.items.addFolder("02_comps");
  var comp = project.items.addComp(
    data.comp.name,
    data.comp.width,
    data.comp.height,
    1,
    data.comp.duration,
    data.comp.fps
  );
  comp.parentFolder = compFolder;
  comp.bgColor = data.comp.background;

  var background = comp.layers.addSolid(data.comp.background, "background", data.comp.width, data.comp.height, 1, data.comp.duration);
  background.moveToEnd();

  for (var i = 0; i < data.panels.length; i += 1) {
    var panel = data.panels[i];
    var timing = data.timeline[i];
    var importOptions = new ImportOptions(new File(panel.file));
    importOptions.sequence = false;
    var footage = project.importFile(importOptions);
    footage.name = zeroPad(i + 1, 4) + "_" + panel.id;
    footage.parentFolder = footageFolder;

    var layer = comp.layers.add(footage);
    layer.name = zeroPad(i + 1, 4) + "_" + panel.id + "_" + timing.native_transition;
    layer.startTime = timing.start_frame / data.comp.fps;
    layer.inPoint = layer.startTime;
    layer.outPoint = (timing.start_frame + timing.duration_frames) / data.comp.fps;

    var fitScale = Math.min(data.comp.width / panel.width, data.comp.height / panel.height) * 100;
    var startTime = layer.inPoint;
    var endTime = layer.outPoint;
    var introEnd = startTime + timing.transition_in_frames / data.comp.fps;
    var outroStart = endTime - timing.transition_out_frames / data.comp.fps;
    var camera = timing.camera;

    var scale = layer.property("ADBE Transform Group").property("ADBE Scale");
    var position = layer.property("ADBE Transform Group").property("ADBE Position");
    var opacity = layer.property("ADBE Transform Group").property("ADBE Opacity");

    scale.setValueAtTime(startTime, [fitScale * camera.start_scale / 100, fitScale * camera.start_scale / 100]);
    scale.setValueAtTime(endTime, [fitScale * camera.end_scale / 100, fitScale * camera.end_scale / 100]);
    position.setValueAtTime(startTime, [data.comp.width / 2 - camera.pan_x / 2, data.comp.height / 2 - camera.pan_y / 2]);
    position.setValueAtTime(endTime, [data.comp.width / 2 + camera.pan_x / 2, data.comp.height / 2 + camera.pan_y / 2]);

    if (timing.transition_in_frames > 0) {
      opacity.setValueAtTime(startTime, 0);
      opacity.setValueAtTime(introEnd, 100);
    } else {
      opacity.setValueAtTime(startTime, 100);
    }
    if (timing.transition_out_frames > 0) {
      opacity.setValueAtTime(outroStart, 100);
      opacity.setValueAtTime(endTime, 0);
    }

    applyTransitionOffsets(layer, timing.native_transition, startTime, introEnd, endTime, data.comp);
    applyEasyEase(scale);
    applyEasyEase(position);
    applyEasyEase(opacity);
  }

  var rqItem = project.renderQueue.items.add(comp);
  rqItem.outputModule(1).file = new File(data.renderMovPath);

  project.save(new File(data.projectPath));
  app.endUndoGroup();

  function applyTransitionOffsets(layer, transitionName, startTime, introEnd, endTime, compData) {
    if (introEnd <= startTime) {
      return;
    }
    var position = layer.property("ADBE Transform Group").property("ADBE Position");
    var current = position.valueAtTime(startTime, false);
    if (transitionName === "slide_left") {
      position.setValueAtTime(startTime, [current[0] + 180, current[1]]);
      position.setValueAtTime(introEnd, current);
    } else if (transitionName === "slide_up") {
      position.setValueAtTime(startTime, [current[0], current[1] + 150]);
      position.setValueAtTime(introEnd, current);
    } else if (transitionName === "whip_pan") {
      position.setValueAtTime(startTime, [current[0] + 260, current[1]]);
      position.setValueAtTime(introEnd, current);
    } else if (transitionName === "zoom_blur") {
      var scale = layer.property("ADBE Transform Group").property("ADBE Scale");
      var currentScale = scale.valueAtTime(startTime, false);
      scale.setValueAtTime(startTime, [currentScale[0] * 1.08, currentScale[1] * 1.08]);
      scale.setValueAtTime(introEnd, currentScale);
    }
  }

  function applyEasyEase(property) {
    for (var key = 1; key <= property.numKeys; key += 1) {
      try {
        property.setInterpolationTypeAtKey(key, KeyframeInterpolationType.BEZIER, KeyframeInterpolationType.BEZIER);
        property.setTemporalEaseAtKey(key, [new KeyframeEase(0, 33)], [new KeyframeEase(0, 33)]);
      } catch (error) {
      }
    }
  }

  function zeroPad(number, width) {
    var text = String(number);
    while (text.length < width) {
      text = "0" + text;
    }
    return text;
  }
})();
`;
}

function buildReadme(data) {
  return `# AE 导出包

结论：这里是当前 30 个 panel 的 After Effects 交付结构。已导出规范 image sequence，并生成可在 AE 内运行的 JSX。

## 内容

- image sequence: \`${data.output_root}/image_sequence/panel_0001.png\` 到 \`panel_0030.png\`
- manifest: \`${data.output_root}/ae_manifest.json\`
- AE script: \`${data.ae.jsx}\`
- Animation Composer 操作计划: \`${data.output_root}/animation_composer_apply_plan.md\`

## 使用

1. 打开 After Effects。
2. 运行 \`File > Scripts > Run Script File...\`，选择 \`${data.ae.jsx}\`。
3. 脚本会创建 1920x1080 / 24fps comp，按 30 个 panel 摆好镜头、原生转场和镜头运动，并保存 \`${data.ae.expected_project}\`。
4. 如果 Animation Composer 已安装，在 AE 菜单 \`Window > Animation Composer\` 打开插件，按 \`animation_composer_apply_plan.md\` 给切点替换更强的转场。
5. AE 原生 render queue 默认输出 mov；如需 MP4，可用：

\`\`\`bash
ffmpeg -y -i "${data.ae.native_render_placeholder}" -c:v libx264 -pix_fmt yuv420p -movflags +faststart "${data.ae.mp4_target}"
\`\`\`

## 当前边界

本包不依赖 AE 已安装即可生成；真正生成 \`.aep\` 和 AE 渲染文件必须在 After Effects 内运行 JSX。
`;
}

function buildAnimationComposerPlan(data) {
  const rows = data.timeline.map((item, index) => {
    const panel = data.panels[index];
    return `| ${String(index + 1).padStart(2, "0")} | ${item.panel_id} | ${formatFrames(item.start_frame, data.render.fps)} | ${panel.label || "-"} | ${item.native_transition} | ${composerPresetFor(item.native_transition)} | ${item.camera.type} |`;
  });

  return `# Animation Composer 套版计划

目标：先用 JSX 生成可复查的 AE 基础版，再在 Animation Composer 中把切点转场替换成插件预设。

## 插件建议

- 插件入口：\`Window > Animation Composer\`
- 先试免费内容：Transitions、Keyframe Wingman、Transition Shifter
- 套版策略：保留 JSX 生成的 panel timing 和 camera keyframes，只替换相邻 panel overlap 区间的 transition 表现

## 时间表

| # | panel | start | label | native fallback | Animation Composer preset direction | camera |
| ---: | --- | ---: | --- | --- | --- | --- |
${rows.join("\n")}

## 导出对比

- 旧版参考：\`project_output/runs/biaoren_ai_motion_20260514_001605/video/biaoren_ai_motion.mp4\`
- AE 原生 fallback：\`${data.ae.mp4_target}\`
- AE + Animation Composer：建议导出为 \`${data.output_root}/renders/biaoren_ai_motion_animation_composer.mp4\`
`;
}

function composerPresetFor(nativeTransition) {
  const map = {
    fade_push: "Transitions > Smooth / Fade 或 Camera movement 类",
    slide_left: "Transitions > Slide / Push 类",
    zoom_blur: "Transitions > Zoom / Blur 类",
    slide_up: "Transitions > Slide / Wipe 类",
    whip_pan: "Transitions > Whip / Pan 类",
  };
  return map[nativeTransition] ?? "Transitions > Smooth 类";
}

function formatFrames(frame, fps) {
  const totalSeconds = Math.floor(frame / fps);
  const frames = frame % fps;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}:${String(frames).padStart(2, "0")}`;
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function toPosixPath(value) {
  return value.split(path.sep).join("/");
}

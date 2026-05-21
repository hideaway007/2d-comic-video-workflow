#!/usr/bin/env node

import { readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const numericKeys = new Set([
  "width",
  "height",
  "fps",
  "fontSize",
  "bottom",
  "maxTextWidth",
  "mergeWidth",
  "minTextWidth",
  "maxPixelWidth",
]);

const options = parseArgs(process.argv.slice(2));
if (!options.runFolder) {
  console.error("用法：node scripts/burn-subtitles.mjs <run-folder> [--project-root <repo-root>] [--input <mp4>] [--output <mp4>]");
  process.exit(2);
}

const projectRoot = path.resolve(options.projectRoot);
const runFolder = path.resolve(projectRoot, options.runFolder);
const inputVideo = path.resolve(projectRoot, options.input ?? path.join(runFolder, "05_video/motion_comic_preview.mp4"));
const outputVideo = path.resolve(
  projectRoot,
  options.output ?? path.join(runFolder, "05_video/motion_comic_preview_subtitled.mp4"),
);
const timelinePath = path.resolve(projectRoot, options.timeline ?? path.join(runFolder, "05_video/audio/voice_timeline.json"));
const outDir = path.resolve(projectRoot, options.out ?? path.join(runFolder, "05_video/subtitles"));
const framesDir = path.join(outDir, "frames-segmented-white");
const eventsPath = path.join(outDir, "subtitle-events-segmented-white.json");
const concatPath = path.join(outDir, "subtitle-layer-segmented-white.ffconcat");
const assPath = path.join(outDir, "subtitles-segmented-white.zh.ass");

for (const required of [inputVideo, timelinePath]) {
  if (!existsSync(required)) {
    console.error(`缺少字幕输入文件：${required}`);
    process.exit(1);
  }
}

const inferredVideo = await probeVideoDimensions(inputVideo);
options.width = options.width ?? inferredVideo.width;
options.height = options.height ?? inferredVideo.height;
options.maxPixelWidth = options.maxPixelWidth ?? Math.round(options.width * 0.86);

const timeline = normalizeTimeline(JSON.parse(await readFile(timelinePath, "utf8")));
const events = timeline.cues.flatMap((cue) =>
  makeEvents(cue, options.maxTextWidth, options.mergeWidth, options.minTextWidth),
);

await rm(framesDir, { recursive: true, force: true });
await mkdir(framesDir, { recursive: true });
await mkdir(path.dirname(outputVideo), { recursive: true });

for (let index = 0; index < events.length; index += 1) {
  events[index].file = path.join(framesDir, `subtitle_${String(index).padStart(4, "0")}.png`);
}

await writeFile(eventsPath, `${JSON.stringify(events, null, 2)}\n`, "utf8");
await writeFile(assPath, buildAss(events, options), "utf8");
await renderSubtitleFrames({
  eventsPath,
  width: options.width,
  height: options.height,
  fontSize: options.fontSize,
  bottom: options.bottom,
  maxPixelWidth: options.maxPixelWidth,
  fontPath: options.fontPath,
});
await writeFile(concatPath, buildConcat(events), "utf8");

await run("ffmpeg", [
  "-hide_banner",
  "-loglevel",
  "error",
  "-y",
  "-f",
  "concat",
  "-safe",
  "0",
  "-i",
  concatPath,
  "-i",
  inputVideo,
  "-filter_complex",
  `[0:v]format=rgba,fps=${options.fps},setpts=PTS-STARTPTS[ov];[1:v]setpts=PTS-STARTPTS[base];[base][ov]overlay=0:0:format=auto,format=yuv420p[v]`,
  "-map",
  "[v]",
  "-map",
  "1:a?",
  "-c:v",
  options.videoCodec,
  "-b:v",
  options.videoBitrate,
  "-pix_fmt",
  "yuv420p",
  "-c:a",
  "copy",
  "-shortest",
  "-movflags",
  "+faststart",
  outputVideo,
]);

console.log(
  JSON.stringify(
    {
      input: toProjectRelative(inputVideo),
      output: toProjectRelative(outputVideo),
      timeline: toProjectRelative(timelinePath),
      cues: timeline.cues.length,
      subtitle_events: events.length,
      style: {
        color: "white",
        font_size: options.fontSize,
        background: "none",
        bottom: options.bottom,
        segmented_by: "punctuation-and-cue-duration",
      },
      artifacts: {
        events: toProjectRelative(eventsPath),
        ass: toProjectRelative(assPath),
        concat: toProjectRelative(concatPath),
      },
    },
    null,
    2,
  ),
);

function parseArgs(values) {
  const parsed = {
    runFolder: null,
    projectRoot: process.cwd(),
    input: null,
    output: null,
    timeline: null,
    out: null,
    width: null,
    height: null,
    fps: 24,
    fontSize: 66,
    bottom: 36,
    maxTextWidth: 36,
    mergeWidth: 38,
    minTextWidth: 8,
    maxPixelWidth: null,
    fontPath: "/System/Library/Fonts/Hiragino Sans GB.ttc",
    videoCodec: "h264_videotoolbox",
    videoBitrate: "8M",
  };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--") && !parsed.runFolder) {
      parsed.runFolder = value;
      continue;
    }
    const [rawKey, inlineValue] = value.replace(/^--/, "").split("=");
    const key = rawKey.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const nextValue = inlineValue ?? values[index + 1];
    if (inlineValue === undefined) {
      index += 1;
    }
    if (!(key in parsed)) {
      throw new Error(`未知参数：${value}`);
    }
    parsed[key] = numericKeys.has(key) ? Number(nextValue) : nextValue;
  }
  return parsed;
}

async function probeVideoDimensions(filePath) {
  const result = await runCapture("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height",
    "-of",
    "json",
    filePath,
  ]);
  if (result.status !== 0) {
    throw new Error(`ffprobe failed for subtitle input: ${result.stderr || result.stdout}`.trim());
  }
  const data = JSON.parse(result.stdout);
  const stream = data.streams?.[0];
  const width = Number(stream?.width);
  const height = Number(stream?.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error("Could not infer subtitle input video dimensions");
  }
  return { width, height };
}

function normalizeTimeline(value) {
  if (Array.isArray(value.cues) && value.cues.length > 0) {
    return value;
  }
  if (!Array.isArray(value.segments) || value.segments.length === 0) {
    throw new Error("字幕时间轴必须包含 cues 或 segments");
  }
  let cursor = 0;
  return {
    ...value,
    cues: value.segments.map((segment, index) => {
      const durationMs = Number(segment.durationMs);
      const startMs = Number.isFinite(Number(segment.startMs)) ? Number(segment.startMs) : cursor;
      const endMs = Number.isFinite(Number(segment.endMs)) ? Number(segment.endMs) : startMs + durationMs;
      cursor = endMs;
      return {
        cue_id: segment.segment_id ?? `cue_${String(index + 1).padStart(3, "0")}`,
        chapter: segment.page_id ?? null,
        step: segment.panel_id ?? null,
        text: String(segment.text ?? "").trim(),
        startMs,
        endMs,
      };
    }),
  };
}

function displayWidth(str) {
  let width = 0;
  for (const ch of str) {
    if (/\s/.test(ch)) width += 0.5;
    else if (/[^\x00-\xff]/.test(ch)) width += 2;
    else width += 1;
  }
  return width;
}

function phraseSplit(text) {
  const parts = [];
  let buffer = "";
  for (const ch of text.replace(/\s*\n\s*/g, " ").trim()) {
    buffer += ch;
    if (/[。！？；：，,]/.test(ch)) {
      parts.push(buffer.trim());
      buffer = "";
    }
  }
  if (buffer.trim()) {
    parts.push(buffer.trim());
  }
  return parts.length > 0 ? parts : [text.trim()];
}

function splitLongPhrase(str, maxWidth) {
  if (displayWidth(str) <= maxWidth) {
    return [str];
  }
  const chunks = [];
  let line = "";
  let lastBreakIndex = -1;
  const breakChars = /[，、：, ]/;
  for (const ch of str) {
    line += ch;
    if (breakChars.test(ch)) {
      lastBreakIndex = [...line].length;
    }
    if (displayWidth(line) > maxWidth) {
      if (lastBreakIndex > 0) {
        const chars = [...line];
        const head = chars.slice(0, lastBreakIndex).join("").trim();
        const tail = chars.slice(lastBreakIndex).join("").trim();
        if (head) {
          chunks.push(head);
        }
        line = tail;
      } else {
        const chars = [...line];
        const tail = chars.pop() ?? "";
        const head = chars.join("").trim();
        if (head) {
          chunks.push(head);
        }
        line = tail;
      }
      lastBreakIndex = -1;
    }
  }
  if (line.trim()) {
    chunks.push(line.trim());
  }
  return chunks;
}

function mergeSmallChunks(chunks, maxWidth, minWidth) {
  const result = [];
  for (const chunk of chunks) {
    const previous = result.at(-1);
    const isTiny = displayWidth(chunk) < minWidth;
    if (previous && isTiny && displayWidth(previous + chunk) <= maxWidth) {
      result[result.length - 1] = previous + chunk;
    } else {
      result.push(chunk);
    }
  }
  for (let index = 0; index < result.length - 1; index += 1) {
    if (displayWidth(result[index]) < minWidth && displayWidth(result[index] + result[index + 1]) <= maxWidth) {
      result[index + 1] = result[index] + result[index + 1];
      result.splice(index, 1);
      index -= 1;
    }
  }
  return result;
}

function makeEvents(cue, maxTextWidth, mergeWidth, minTextWidth) {
  const rawChunks = phraseSplit(cue.text).flatMap((part) => splitLongPhrase(part, maxTextWidth));
  const chunks = mergeSmallChunks(rawChunks, mergeWidth, minTextWidth);
  const weights = chunks.map((chunk) => Math.max(5, displayWidth(chunk)));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  let cursor = cue.startMs;
  return chunks.map((text, index) => {
    const startMs = cursor;
    const endMs =
      index === chunks.length - 1
        ? cue.endMs
        : Math.round(cursor + (cue.endMs - cue.startMs) * (weights[index] / totalWeight));
    cursor = endMs;
    return {
      cue_id: cue.cue_id ?? null,
      startMs,
      endMs,
      durationMs: endMs - startMs,
      chapter: cue.chapter,
      step: cue.step,
      text,
    };
  });
}

function buildConcat(events) {
  let concat = "ffconcat version 1.0\n";
  for (const event of events) {
    concat += `file '${event.file.replaceAll("'", "'\\''")}'\n`;
    concat += `duration ${((event.endMs - event.startMs) / 1000).toFixed(6)}\n`;
  }
  concat += `file '${events.at(-1).file.replaceAll("'", "'\\''")}'\n`;
  return concat;
}

function buildAss(events, { width, height, fontSize, bottom }) {
  return `[Script Info]
ScriptType: v4.00+
WrapStyle: 2
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709
PlayResX: ${width}
PlayResY: ${height}

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Hiragino Sans GB,${fontSize},&H00F0FAFF,&H000000FF,&H00141820,&H00000000,1,0,0,0,100,100,0,0,1,5,0,2,120,120,${bottom},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${events.map((event) => `Dialogue: 0,${assTime(event.startMs)},${assTime(event.endMs)},Default,,0,0,0,,${assEscape(event.text)}`).join("\n")}
`;
}

function assTime(ms) {
  const totalCentiseconds = Math.max(0, Math.round(ms / 10));
  const centiseconds = totalCentiseconds % 100;
  const totalSeconds = Math.floor(totalCentiseconds / 100);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(centiseconds).padStart(2, "0")}`;
}

function assEscape(str) {
  return str.replace(/\{/g, "\\{").replace(/\}/g, "\\}");
}

async function renderSubtitleFrames({ eventsPath, width, height, fontSize, bottom, maxPixelWidth, fontPath }) {
  const python = String.raw`
import json
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter

events_path, width, height, font_size, bottom, max_pixel_width, font_path = sys.argv[1:]
width = int(width)
height = int(height)
font_size = int(font_size)
bottom = int(bottom)
max_pixel_width = int(max_pixel_width)
events = json.loads(Path(events_path).read_text(encoding="utf-8"))

def load_font(size):
    return ImageFont.truetype(font_path, size=size)

for event in events:
    text = event["text"]
    size = font_size
    font = load_font(size)
    probe = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(probe)
    bbox = draw.textbbox((0, 0), text, font=font, stroke_width=5)
    while (bbox[2] - bbox[0]) > max_pixel_width and size > max(24, font_size - 12):
        size -= 1
        font = load_font(size)
        bbox = draw.textbbox((0, 0), text, font=font, stroke_width=5)
    text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]
    x = (width - text_w) // 2 - bbox[0]
    y = height - bottom - text_h - bbox[1]

    image = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    shadow = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    shadow_draw = ImageDraw.Draw(shadow)
    shadow_draw.text((x, y + 4), text, font=font, fill=(32, 24, 20, 130), stroke_width=6, stroke_fill=(32, 24, 20, 150))
    shadow = shadow.filter(ImageFilter.GaussianBlur(4))
    image.alpha_composite(shadow)
    draw = ImageDraw.Draw(image)
    draw.text((x, y), text, font=font, fill=(255, 250, 240, 255), stroke_width=5, stroke_fill=(32, 24, 20, 210))
    Path(event["file"]).parent.mkdir(parents=True, exist_ok=True)
    image.save(event["file"])
`;
  await run("python3", [
    "-c",
    python,
    eventsPath,
    String(width),
    String(height),
    String(fontSize),
    String(bottom),
    String(maxPixelWidth),
    fontPath,
  ]);
}

function run(command, args) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("error", rejectRun);
    child.on("close", (code) => {
      if (code === 0) {
        resolveRun();
      } else {
        rejectRun(new Error(`${command} exited with ${code}`));
      }
    });
  });
}

function runCapture(command, args) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", rejectRun);
    child.on("close", (status) => {
      resolveRun({ status, stdout, stderr });
    });
  });
}

function toProjectRelative(filePath) {
  return path.relative(projectRoot, filePath).split(path.sep).join("/");
}

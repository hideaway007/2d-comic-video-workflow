import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import path from "node:path";
import { buildPlanningInput } from "./ai-planning.mjs";

const allowedShotFields = new Set([
  "panel_id",
  "intent",
  "tempo",
  "duration_seconds",
  "primitive_hints",
  "review_flags",
]);

export async function createCodexCliAnalysisPlan({
  cwd,
  panelPack,
  model = "gpt-5.5",
  codexBin = process.env.MOTION_COMIC_CODEX_BIN || "codex",
  runner = defaultCodexRunner,
} = {}) {
  if (!cwd) {
    throw new Error("createCodexCliAnalysisPlan requires cwd");
  }
  if (!panelPack || !Array.isArray(panelPack.panels)) {
    throw new Error("createCodexCliAnalysisPlan requires panelPack.panels");
  }

  const tempDir = await mkdtemp(path.join(tmpdir(), "motion-comic-codex-planner-"));
  const outputPath = path.join(tempDir, "last-message.txt");
  const planningInput = buildPlanningInput(panelPack);
  const attachments = buildPanelImageAttachments({ cwd, panelPack });
  const imagePaths = attachments.map((attachment) => attachment.image_path);
  const prompt = buildCodexPlanningPrompt(planningInput, attachments);
  const args = [
    "--ask-for-approval",
    "never",
    "exec",
    "--ephemeral",
    "--sandbox",
    "read-only",
    "--skip-git-repo-check",
    "--model",
    model,
    "--cd",
    cwd,
    "--output-last-message",
    outputPath,
    ...imagePaths.flatMap((imagePath) => ["--image", imagePath]),
    "-",
  ];

  try {
    const result = await runner({
      command: codexBin,
      args,
      input: prompt,
      cwd,
      outputPath,
      imagePaths,
      model,
    });
    if (result.status !== 0) {
      throw new Error(formatRunnerFailure(result));
    }

    const outputText = await readOutputText({ result, outputPath });
    const analysisPlan = parseCodexAnalysisPlan(outputText);
    return {
      ...analysisPlan,
      provider: `codex_cli:${model}`,
      planning_input: "project_output/plans/planning_input.json",
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export function buildCodexPlanningPrompt(planningInput, attachments = []) {
  return [
    "You are planning conservative 2.5D motion for a manga panel pack.",
    "Return only JSON. Do not use Markdown except when the host forces a fenced JSON block.",
    "Attached images are panel crops in the same order as planning_input.panels.",
    "Attachment map:",
    ...formatAttachmentMap(attachments),
    "The JSON schema is exactly:",
    "{",
    '  "version": 1,',
    '  "kind": "analysis_plan",',
    '  "provider": "codex_cli",',
    '  "planning_input": "project_output/plans/planning_input.json",',
    '  "shots": [',
    "    {",
    '      "panel_id": "string",',
    '      "intent": "string",',
    '      "tempo": "steady|quick|slow",',
    '      "duration_seconds": 1.5,',
    '      "primitive_hints": [{ "primitive": "hold|camera_push|camera_pan|camera_zoom|shake|focus_reveal|overlay_effect|parallax_hint", "scale": 1.04, "pan": { "x": 0, "y": 0 }, "easing": "linear|ease_in|ease_out|ease_in_out" }],',
    '      "review_flags": []',
    "    }",
    "  ]",
    "}",
    "Do not output source_image, camera_motion, local_motion, effects, transforms, paths, or renderer instructions.",
    "Create one shot for each input panel_id. Keep durations between 1.5 and 8 seconds.",
    "",
    "Planning input:",
    JSON.stringify(planningInput, null, 2),
  ].join("\n");
}

export function parseCodexAnalysisPlan(text) {
  const jsonText = extractJsonText(text);
  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch (error) {
    throw new Error(`Unable to parse codex_cli analysis_plan JSON: ${error.message}`);
  }

  if (!parsed || parsed.kind !== "analysis_plan" || !Array.isArray(parsed.shots)) {
    throw new Error("codex_cli output must be an analysis_plan with shots[]");
  }

  return {
    version: Number(parsed.version) || 1,
    kind: "analysis_plan",
    provider: typeof parsed.provider === "string" ? parsed.provider : "codex_cli",
    planning_input:
      typeof parsed.planning_input === "string"
        ? parsed.planning_input
        : "project_output/plans/planning_input.json",
    shots: parsed.shots.map((shot) => sanitizeShot(shot)),
  };
}

export function selectPanelImageAttachments({ cwd, panelPack }) {
  return buildPanelImageAttachments({ cwd, panelPack }).map((attachment) => attachment.image_path);
}

function buildPanelImageAttachments({ cwd, panelPack }) {
  return [...panelPack.panels]
    .sort((a, b) => Number(a.reading_order ?? 0) - Number(b.reading_order ?? 0) || a.panel_id.localeCompare(b.panel_id))
    .filter((panel) => typeof panel.crop_asset === "string" && panel.crop_asset.length > 0)
    .map((panel, index) => ({
      image_id: `image_${index + 1}`,
      panel_id: panel.panel_id,
      crop_asset: panel.crop_asset,
      reading_order: panel.reading_order,
      image_path: path.resolve(cwd, panel.crop_asset),
    }));
}

function formatAttachmentMap(attachments) {
  if (attachments.length === 0) {
    return ["none"];
  }
  return attachments.map(
    (attachment) =>
      `${attachment.image_id} => panel_id ${attachment.panel_id} | crop_asset ${attachment.crop_asset} | reading_order ${attachment.reading_order}`,
  );
}

async function defaultCodexRunner({ command, args, input, cwd }) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      resolve({ status: 127, stdout, stderr: `${stderr}${error.message}` });
    });
    child.on("close", (status) => {
      resolve({ status: status ?? 1, stdout, stderr });
    });
    child.stdin.end(input);
  });
}

async function readOutputText({ result, outputPath }) {
  try {
    const fileText = await readFile(outputPath, "utf8");
    if (fileText.trim()) {
      return fileText;
    }
  } catch {
    // Some injected runners return stdout directly instead of writing --output-last-message.
  }
  if (typeof result.stdout === "string" && result.stdout.trim()) {
    return result.stdout;
  }
  throw new Error("codex_cli runner produced no analysis_plan output");
}

function extractJsonText(text) {
  const trimmed = String(text ?? "").trim();
  const fencedBlocks = [...trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map((match) => match[1].trim());
  for (const block of fencedBlocks) {
    try {
      JSON.parse(block);
      return block;
    } catch {
      // Try the next fenced block before falling back to the full response.
    }
  }
  return trimmed;
}

function sanitizeShot(shot) {
  if (!shot || typeof shot !== "object") {
    return {
      panel_id: "",
      intent: "panel motion",
      tempo: "steady",
      duration_seconds: 3.5,
      primitive_hints: [{ primitive: "hold" }],
      review_flags: [],
    };
  }

  const sanitized = {};
  for (const key of allowedShotFields) {
    if (key in shot) {
      sanitized[key] = shot[key];
    }
  }
  sanitized.panel_id = String(sanitized.panel_id ?? "");
  sanitized.intent = String(sanitized.intent ?? "panel motion");
  sanitized.tempo = String(sanitized.tempo ?? "steady");
  sanitized.duration_seconds = sanitized.duration_seconds ?? 3.5;
  sanitized.primitive_hints = Array.isArray(sanitized.primitive_hints)
    ? sanitized.primitive_hints
    : [{ primitive: "hold" }];
  sanitized.review_flags = Array.isArray(sanitized.review_flags) ? sanitized.review_flags : [];
  return sanitized;
}

function formatRunnerFailure(result) {
  const stderr = String(result.stderr ?? "").trim();
  const stdout = String(result.stdout ?? "").trim();
  const detail = stderr || stdout || "no output";
  return `codex_cli runner exited with status ${result.status}: ${detail}`;
}

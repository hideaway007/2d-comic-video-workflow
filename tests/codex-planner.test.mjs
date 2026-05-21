import assert from "node:assert/strict";
import test from "node:test";
import {
  createCodexCliAnalysisPlan,
  parseCodexAnalysisPlan,
} from "../scripts/lib/codex-planner.mjs";
import { normalizeAnalysisPlan } from "../scripts/lib/ai-planning.mjs";

test("parseCodexAnalysisPlan accepts a fenced JSON analysis_plan and strips renderer fields", () => {
  const plan = parseCodexAnalysisPlan(`\`\`\`json
{
  "version": 1,
  "kind": "analysis_plan",
  "provider": "codex_cli:test-model",
  "planning_input": "project_output/plans/planning_input.json",
  "shots": [
    {
      "panel_id": "panel_001",
      "intent": "guide attention",
      "tempo": "steady",
      "duration_seconds": 3,
      "primitive_hints": [{ "primitive": "camera_push", "scale": 1.05, "pan": { "x": 10, "y": 0 }, "easing": "ease_in_out" }],
      "review_flags": [],
      "source_image": "project_output/panels/crops/panel_001.png",
      "camera_motion": { "type": "camera_push" }
    }
  ]
}
\`\`\``);

  assert.equal(plan.kind, "analysis_plan");
  assert.equal(plan.provider, "codex_cli:test-model");
  assert.deepEqual(Object.keys(plan.shots[0]), [
    "panel_id",
    "intent",
    "tempo",
    "duration_seconds",
    "primitive_hints",
    "review_flags",
  ]);
});

test("parseCodexAnalysisPlan accepts pure JSON analysis_plan output", () => {
  const plan = parseCodexAnalysisPlan(
    JSON.stringify({
      version: 1,
      kind: "analysis_plan",
      provider: "codex_cli:test-model",
      planning_input: "project_output/plans/planning_input.json",
      shots: [
        {
          panel_id: "panel_001",
          intent: "hold readable composition",
          tempo: "slow",
          duration_seconds: 4,
          primitive_hints: [{ primitive: "hold" }],
          review_flags: ["manual_review"],
        },
      ],
    }),
  );

  assert.equal(plan.shots[0].panel_id, "panel_001");
  assert.equal(plan.shots[0].primitive_hints[0].primitive, "hold");
});

test("createCodexCliAnalysisPlan calls an injected runner and leaves unsafe primitive correction to normalizer", async () => {
  const panelPack = singlePanelPack();
  const calls = [];
  const analysisPlan = await createCodexCliAnalysisPlan({
    cwd: "/tmp/motion-comic-test",
    panelPack,
    model: "test-model",
    runner: async (request) => {
      calls.push(request);
      return {
        status: 0,
        stdout: JSON.stringify({
          version: 1,
          kind: "analysis_plan",
          provider: "codex_cli:test-model",
          planning_input: "project_output/plans/planning_input.json",
          shots: [
            {
              panel_id: "panel_001",
              intent: "unsafe primitive should be normalized",
              tempo: "quick",
              duration_seconds: 99,
              primitive_hints: [{ primitive: "warp_face", scale: 2, pan: { x: 500, y: 0 }, easing: "teleport" }],
              review_flags: [],
            },
          ],
        }),
        stderr: "",
      };
    },
  });

  assert.equal(calls.length, 1);
  assert.ok(calls[0].args.includes("exec"));
  assert.ok(calls[0].args.includes("--output-last-message"));
  assert.ok(calls[0].args.includes("--sandbox"));
  assert.ok(calls[0].args.includes("read-only"));
  assert.ok(calls[0].args.includes("--ask-for-approval"));
  assert.ok(calls[0].args.includes("never"));
  assert.ok(calls[0].args.includes("--skip-git-repo-check"));
  assert.ok(calls[0].args.includes("--image"));
  assert.equal(analysisPlan.provider, "codex_cli:test-model");

  const { plan, report } = normalizeAnalysisPlan({ panelPack, analysisPlan });
  assert.equal(plan.shots[0].primitive, "hold");
  assert.ok(plan.shots[0].review_flags.includes("unknown_primitive_fallback"));
  assert.ok(report.summary.corrections >= 1);
});

test("createCodexCliAnalysisPlan maps attached images to panel ids in prompt order", async () => {
  const panelPack = multiPanelPack();
  const calls = [];
  await createCodexCliAnalysisPlan({
    cwd: "/tmp/motion-comic-test",
    panelPack,
    model: "test-model",
    runner: async (request) => {
      calls.push(request);
      return {
        status: 0,
        stdout: JSON.stringify({
          version: 1,
          kind: "analysis_plan",
          provider: "codex_cli:test-model",
          shots: [
            { panel_id: "panel_b", intent: "first", tempo: "steady", duration_seconds: 3, primitive_hints: [{ primitive: "hold" }], review_flags: [] },
            { panel_id: "panel_a", intent: "second", tempo: "steady", duration_seconds: 3, primitive_hints: [{ primitive: "hold" }], review_flags: [] },
          ],
        }),
        stderr: "",
      };
    },
  });

  const call = calls[0];
  const imageArgs = [];
  for (let index = 0; index < call.args.length; index += 1) {
    if (call.args[index] === "--image") {
      imageArgs.push(call.args[index + 1]);
    }
  }

  assert.deepEqual(imageArgs, [
    "/tmp/motion-comic-test/project_output/panels/crops/panel_b.png",
    "/tmp/motion-comic-test/project_output/panels/crops/panel_a.png",
  ]);
  assert.match(call.input, /Attached images are panel crops in the same order as planning_input\.panels\./);
  assert.match(
    call.input,
    /image_1 => panel_id panel_b \| crop_asset project_output\/panels\/crops\/panel_b\.png \| reading_order 1/,
  );
  assert.match(
    call.input,
    /image_2 => panel_id panel_a \| crop_asset project_output\/panels\/crops\/panel_a\.png \| reading_order 2/,
  );
  assert.ok(call.input.indexOf("image_1 => panel_id panel_b") < call.input.indexOf("image_2 => panel_id panel_a"));
});

function singlePanelPack() {
  return {
    version: 1,
    panel_pack_path: "project_output/panels/panel_pack.json",
    pages: [{ page_id: "page_001", source_image: "input/pages/page_001.png", width: 120, height: 80 }],
    panels: [
      {
        panel_id: "panel_001",
        page_id: "page_001",
        crop_asset: "project_output/panels/crops/panel_001.png",
        reading_order: 1,
        bbox_pct: { x: 0, y: 0, width: 1, height: 1 },
        safe_frame: { x_pct: 0.1, y_pct: 0.1, width_pct: 0.8, height_pct: 0.8 },
        review_flags: [],
      },
    ],
    review_flags: [],
  };
}

function multiPanelPack() {
  return {
    version: 1,
    panel_pack_path: "project_output/panels/panel_pack.json",
    pages: [{ page_id: "page_001", source_image: "input/pages/page_001.png", width: 120, height: 80 }],
    panels: [
      {
        panel_id: "panel_a",
        page_id: "page_001",
        crop_asset: "project_output/panels/crops/panel_a.png",
        reading_order: 2,
        bbox_pct: { x: 0.5, y: 0, width: 0.5, height: 1 },
        safe_frame: { x_pct: 0.1, y_pct: 0.1, width_pct: 0.8, height_pct: 0.8 },
        review_flags: [],
      },
      {
        panel_id: "panel_b",
        page_id: "page_001",
        crop_asset: "project_output/panels/crops/panel_b.png",
        reading_order: 1,
        bbox_pct: { x: 0, y: 0, width: 0.5, height: 1 },
        safe_frame: { x_pct: 0.1, y_pct: 0.1, width_pct: 0.8, height_pct: 0.8 },
        review_flags: [],
      },
    ],
    review_flags: [],
  };
}

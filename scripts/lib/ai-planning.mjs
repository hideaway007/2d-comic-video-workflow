import { renderSpec, shotId } from "./planning.mjs";

export const allowedPrimitives = new Set([
  "hold",
  "camera_push",
  "camera_pan",
  "camera_zoom",
  "shake",
  "focus_reveal",
  "overlay_effect",
  "parallax_hint",
]);

const allowedEasings = new Set(["linear", "ease_in", "ease_out", "ease_in_out"]);
const durationBounds = { min: 1.5, max: 8 };
const scaleBounds = { min: 1, max: 1.22 };
const panBounds = { min: -160, max: 160 };

export function buildPlanningInput(panelPack) {
  return {
    version: 1,
    kind: "planning_input",
    panel_pack: panelPack.panel_pack_path ?? "project_output/panels/panel_pack.json",
    panels: sortedPanels(panelPack).map((panel) => ({
      panel_id: panel.panel_id,
      page_id: panel.page_id,
      reading_order: panel.reading_order,
      bbox_pct: panel.bbox_pct,
      safe_frame: panel.safe_frame,
      review_flags: panel.review_flags ?? [],
    })),
  };
}

export function createMockAnalysisPlan(panelPack, options = {}) {
  const primitiveCycle = ["camera_push", "camera_pan", "camera_zoom", "camera_push", "camera_pan", "camera_zoom"];
  const tempoCycle = ["steady", "quick", "slow"];
  return {
    version: 1,
    kind: "analysis_plan",
    provider: options.provider ?? "mock_deterministic_v1",
    planning_input: panelPack.panel_pack_path ?? "project_output/panels/panel_pack.json",
    shots: sortedPanels(panelPack).map((panel, index) => {
      const primitive = primitiveCycle[index % primitiveCycle.length];
      return {
        panel_id: panel.panel_id,
        intent: intentForPanel(panel, index),
        tempo: tempoCycle[index % tempoCycle.length],
        duration_seconds: index % 2 === 0 ? 4 : 3.5,
        primitive_hints: [
          {
            primitive,
            scale: scaleForPrimitive(primitive),
            pan: panForIndex(index),
            easing: "ease_in_out",
          },
        ],
        review_flags: panel.review_flags?.length ? ["panel_review_required"] : [],
      };
    }),
  };
}

export function normalizeAnalysisPlan({ panelPack, analysisPlan, render = renderSpec } = {}) {
  if (!panelPack || !Array.isArray(panelPack.panels)) {
    throw new Error("normalizeAnalysisPlan requires panelPack.panels");
  }
  if (!analysisPlan || !Array.isArray(analysisPlan.shots)) {
    throw new Error("normalizeAnalysisPlan requires analysisPlan.shots");
  }

  const panelById = new Map(panelPack.panels.map((panel) => [panel.panel_id, panel]));
  const report = {
    version: 1,
    generated_at: new Date().toISOString(),
    analysis_plan: "project_output/plans/analysis_plan.json",
    output_plan: "project_output/plans/motion_plan.json",
    corrections: [],
    errors: [],
    summary: {
      input_shots: analysisPlan.shots.length,
      output_shots: 0,
      corrections: 0,
      errors: 0,
    },
  };

  const shots = [];
  for (const [analysisIndex, analysisShot] of analysisPlan.shots.entries()) {
    const panel = panelById.get(analysisShot.panel_id);
    if (!panel) {
      report.errors.push({
        severity: "error",
        analysis_index: analysisIndex,
        field: "panel_id",
        value: analysisShot.panel_id ?? null,
        message: `Unknown panel_id in analysis plan: ${analysisShot.panel_id ?? "(missing)"}`,
      });
      continue;
    }

    const correctionsBefore = report.corrections.length;
    const durationSec = correctedNumber({
      report,
      analysisIndex,
      panelId: panel.panel_id,
      field: "duration_seconds",
      value: analysisShot.duration_seconds,
      fallback: 3.5,
      min: durationBounds.min,
      max: durationBounds.max,
    });
    const primitiveHint = firstPrimitiveHint(analysisShot);
    const primitiveResult = normalizePrimitive({
      report,
      analysisIndex,
      panelId: panel.panel_id,
      primitive: primitiveHint.primitive,
    });
    const primitive = primitiveResult.primitive;
    const scale = correctedNumber({
      report,
      analysisIndex,
      panelId: panel.panel_id,
      field: "primitive_hints[0].scale",
      value: primitiveHint.scale,
      fallback: primitive === "hold" ? 1 : 1.04,
      min: scaleBounds.min,
      max: scaleBounds.max,
    });
    const pan = normalizePan({
      report,
      analysisIndex,
      panelId: panel.panel_id,
      pan: primitiveHint.pan,
    });
    const easing = normalizeEasing({
      report,
      analysisIndex,
      panelId: panel.panel_id,
      easing: primitiveHint.easing,
    });

    const shot = buildNormalizedShot({
      id: shotId(shots.length),
      panel,
      analysisShot,
      primitive,
      durationSec,
      render,
      scale,
      pan,
      easing,
      hadCorrection: report.corrections.length > correctionsBefore,
      unknownPrimitiveFallback: primitiveResult.unknownPrimitiveFallback,
    });
    shots.push(shot);
  }

  report.summary.output_shots = shots.length;
  report.summary.corrections = report.corrections.length;
  report.summary.errors = report.errors.length;

  return {
    plan: {
      version: 2,
      generated_at: new Date().toISOString(),
      render,
      source_root: panelPack.source_root ?? "input/pages",
      output_root: "project_output",
      panel_pack: panelPack.panel_pack_path ?? "project_output/panels/panel_pack.json",
      pages: panelPack.pages ?? [],
      panels: panelPack.panels,
      shots,
      audio: {
        tracks: [],
        narration: null,
      },
      review_flags: aggregateReviewFlags(panelPack, shots, report),
    },
    report,
  };
}

function sortedPanels(panelPack) {
  return [...(panelPack.panels ?? [])].sort(
    (a, b) => Number(a.reading_order ?? 0) - Number(b.reading_order ?? 0) || a.panel_id.localeCompare(b.panel_id),
  );
}

function intentForPanel(panel, index) {
  if (panel.review_flags?.length) {
    return "hold readable composition for manual review";
  }
  return index % 3 === 0 ? "establish panel action" : "guide attention through panel";
}

function panForIndex(index) {
  const values = [
    { x: -112, y: -24 },
    { x: 128, y: 0 },
    { x: 0, y: -96 },
    { x: 104, y: 40 },
    { x: -144, y: 20 },
    { x: 80, y: -56 },
  ];
  return values[index % values.length];
}

function scaleForPrimitive(primitive) {
  if (primitive === "camera_push") {
    return 1.18;
  }
  if (primitive === "camera_pan") {
    return 1.1;
  }
  if (primitive === "camera_zoom") {
    return 1.16;
  }
  return 1;
}

function firstPrimitiveHint(analysisShot) {
  const hint = Array.isArray(analysisShot.primitive_hints) ? analysisShot.primitive_hints[0] : null;
  return hint && typeof hint === "object" ? hint : { primitive: "hold" };
}

function normalizePrimitive({ report, analysisIndex, panelId, primitive }) {
  if (allowedPrimitives.has(primitive)) {
    return { primitive, unknownPrimitiveFallback: false };
  }
  report.corrections.push({
    severity: "warning",
    analysis_index: analysisIndex,
    panel_id: panelId,
    field: "primitive_hints[0].primitive",
    from: primitive ?? null,
    to: "hold",
    reason: `unknown primitive "${primitive ?? "missing"}" fell back to hold`,
  });
  return { primitive: "hold", unknownPrimitiveFallback: true };
}

function normalizeEasing({ report, analysisIndex, panelId, easing }) {
  if (allowedEasings.has(easing)) {
    return easing;
  }
  report.corrections.push({
    severity: "warning",
    analysis_index: analysisIndex,
    panel_id: panelId,
    field: "primitive_hints[0].easing",
    from: easing ?? null,
    to: "ease_in_out",
    reason: "unsupported easing fell back to ease_in_out",
  });
  return "ease_in_out";
}

function normalizePan({ report, analysisIndex, panelId, pan }) {
  const original = {
    x: Number.isFinite(Number(pan?.x)) ? Number(pan.x) : 0,
    y: Number.isFinite(Number(pan?.y)) ? Number(pan.y) : 0,
  };
  const corrected = {
    x: round(Math.min(Math.max(original.x, panBounds.min), panBounds.max)),
    y: round(Math.min(Math.max(original.y, panBounds.min), panBounds.max)),
  };
  if (corrected.x !== original.x || corrected.y !== original.y) {
    report.corrections.push({
      severity: "warning",
      analysis_index: analysisIndex,
      panel_id: panelId,
      field: "primitive_hints[0].pan",
      from: original,
      to: corrected,
      reason: `pan clamped to safe range ${panBounds.min}..${panBounds.max}`,
    });
  }
  return corrected;
}

function correctedNumber({ report, analysisIndex, panelId, field, value, fallback, min, max }) {
  const numeric = Number.isFinite(Number(value)) ? Number(value) : fallback;
  const corrected = round(Math.min(Math.max(numeric, min), max));
  if (corrected !== value) {
    report.corrections.push({
      severity: "warning",
      analysis_index: analysisIndex,
      panel_id: panelId,
      field,
      from: Number.isFinite(Number(value)) ? Number(value) : null,
      to: corrected,
      reason: `${field} clamped to safe range ${min}..${max}`,
    });
  }
  return corrected;
}

function buildNormalizedShot({
  id,
  panel,
  analysisShot,
  primitive,
  durationSec,
  render,
  scale,
  pan,
  easing,
  hadCorrection,
  unknownPrimitiveFallback,
}) {
  const motion = motionForPrimitive({ primitive, scale, pan, easing });
  const reviewFlags = Array.from(
    new Set([
      ...(panel.review_flags ?? []),
      ...(analysisShot.review_flags ?? []),
      ...(unknownPrimitiveFallback ? ["unknown_primitive_fallback"] : []),
      ...(hadCorrection ? ["normalizer_corrected"] : []),
    ]),
  );
  const durationFrames = Math.max(1, Math.round(durationSec * Number(render.fps ?? 24)));
  return {
    shot_id: id,
    panel_id: panel.panel_id,
    source_image: panel.crop_asset,
    primitive,
    intent: String(analysisShot.intent ?? "panel motion"),
    tempo: String(analysisShot.tempo ?? "steady"),
    duration_sec: durationSec,
    duration_frames: durationFrames,
    main_subject: String(analysisShot.intent ?? "panel composition"),
    camera_motion: motion.camera_motion,
    local_motion: motion.local_motion,
    effects: motion.effects,
    layer_plan: ["full_frame_fallback", "foreground_focus", "effects_overlay"],
    risk: reviewFlags.length > 0 ? "medium" : "low",
    manual_review_required: reviewFlags.length > 0,
    review_flags: reviewFlags,
    review_metadata: {
      suggested_rating: reviewFlags.length > 0 ? "review_required" : "auto_pass_pending_visual_review",
      main_issues: reviewFlags,
      recommended_fix: reviewFlags.length > 0
        ? "Review normalizer flags and adjust panel pack or analysis plan if needed."
        : "Visual review before final render.",
      can_enter_final: true,
      manual_retouch_required: false,
    },
    defer_layer_refinement: true,
  };
}

function motionForPrimitive({ primitive, scale, pan, easing }) {
  const baseCamera = {
    type: "hold",
    start_scale: 1,
    end_scale: 1,
    start_position: { x: 0, y: 0 },
    end_position: { x: 0, y: 0 },
    easing,
  };

  if (primitive === "camera_push" || primitive === "camera_zoom") {
    return {
      camera_motion: {
        ...baseCamera,
        type: primitive === "camera_zoom" ? "zoom_out" : "slow_push_in",
        end_scale: scale,
        end_position: pan,
      },
      local_motion: [],
      effects: [],
    };
  }
  if (primitive === "camera_pan") {
    return {
      camera_motion: {
        ...baseCamera,
        type: pan.x >= 0 ? "pan_right" : "pan_left",
        end_scale: Math.max(1, Math.min(scale, 1.12)),
        end_position: pan,
      },
      local_motion: [],
      effects: [],
    };
  }
  if (primitive === "shake") {
    return {
      camera_motion: baseCamera,
      local_motion: [],
      effects: ["subtle_shake"],
    };
  }
  if (primitive === "focus_reveal") {
    return {
      camera_motion: baseCamera,
      local_motion: [{ target: "foreground_focus", type: "focus_reveal", intensity: "low" }],
      effects: ["soft_vignette"],
    };
  }
  if (primitive === "overlay_effect") {
    return {
      camera_motion: baseCamera,
      local_motion: [{ target: "panel_energy", type: "speed_line_overlay", intensity: "low" }],
      effects: ["speed_lines"],
    };
  }
  if (primitive === "parallax_hint") {
    return {
      camera_motion: baseCamera,
      local_motion: [
        {
          target: "foreground_focus",
          layer_id: "foreground_focus",
          type: "parallax_drift",
          amplitude_px: 18,
          direction: pan.x >= 0 ? "right" : "left",
        },
      ],
      effects: [],
    };
  }
  return { camera_motion: baseCamera, local_motion: [], effects: [] };
}

function aggregateReviewFlags(panelPack, shots, report) {
  const flags = new Set(panelPack.review_flags ?? []);
  for (const shot of shots) {
    for (const flag of shot.review_flags ?? []) {
      flags.add(flag);
    }
  }
  if (report.errors.length > 0) {
    flags.add("normalizer_errors");
  }
  if (report.corrections.length > 0) {
    flags.add("normalizer_corrections");
  }
  return Array.from(flags);
}

function round(value) {
  return Number(value.toFixed(3));
}

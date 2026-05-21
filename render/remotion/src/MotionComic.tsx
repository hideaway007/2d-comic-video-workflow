import React from "react";
import {
  AbsoluteFill,
  Audio,
  Easing,
  Img,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

export type CameraMotion = {
  type?: string;
  intensity?: number;
  direction?: string;
  rotate?: number;
  start_scale?: number;
  end_scale?: number;
  startScale?: number;
  endScale?: number;
  start_position?: { x?: number; y?: number };
  end_position?: { x?: number; y?: number };
  startPosition?: { x?: number; y?: number };
  endPosition?: { x?: number; y?: number };
};

export type LocalMotion = {
  type?: string;
  target?: string;
  layer_id?: string;
  intensity?: number;
  amplitude_px?: number;
  amplitudePx?: number;
  direction?: string;
  start_frame?: number;
  end_frame?: number;
  startFrame?: number;
  endFrame?: number;
};

export type SafeFrame = {
  x_pct?: number;
  y_pct?: number;
  width_pct?: number;
  height_pct?: number;
};

export type Panel = {
  panel_id?: string;
  safe_frame?: SafeFrame;
  safeFrame?: SafeFrame;
};

export type Shot = {
  shot_id: string;
  panel_id?: string;
  panelId?: string;
  primitive?: string;
  source_image?: string;
  sourceImage?: string;
  resolved_source_image?: string;
  resolvedSourceImage?: string;
  safe_frame?: SafeFrame;
  safeFrame?: SafeFrame;
  duration_frames?: number;
  durationFrames?: number;
  duration_seconds?: number;
  durationSeconds?: number;
  duration?: number;
  camera_motion?: CameraMotion;
  cameraMotion?: CameraMotion;
  local_motion?: LocalMotion[];
  localMotion?: LocalMotion[];
  effects?: string[];
};

export type Plan = {
  fps?: number;
  render?: {
    width?: number;
    height?: number;
    fps?: number;
  };
  panels?: Panel[];
  audio?: {
    narration?: {
      src?: string;
      audio?: string;
      source?: string;
      resolved_audio?: string;
      resolvedAudio?: string;
      volume?: number;
    } | null;
  };
  shots: Shot[];
};

type Props = {
  plan?: Plan;
  shotId?: string;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const DEFAULT_SAFE_FRAME: Required<SafeFrame> = { x_pct: 0, y_pct: 0, width_pct: 1, height_pct: 1 };
const MAX_CAMERA_SCALE = 1.22;
const MAX_CAMERA_PAN_PX = 160;

const shotDuration = (shot: Shot, fps: number) => {
  const explicit = Number(shot.duration_frames ?? shot.durationFrames);
  if (Number.isFinite(explicit) && explicit > 0) {
    return Math.round(explicit);
  }
  const seconds = Number(shot.duration_seconds ?? shot.durationSeconds ?? shot.duration ?? 3);
  return Math.max(1, Math.round((Number.isFinite(seconds) ? seconds : 3) * fps));
};

const shotImage = (shot: Shot) => {
  const image = shot.resolved_source_image ?? shot.resolvedSourceImage ?? shot.source_image ?? shot.sourceImage;
  if (!image) {
    throw new Error(`Shot ${shot.shot_id} is missing a source image`);
  }
  return /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(image) || image.startsWith("/") ? image : staticFile(image);
};

const assetSource = (source: string) =>
  /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(source) || source.startsWith("/") ? source : staticFile(source);

const narrationAudioSource = (plan: Plan) => {
  const narration = plan.audio?.narration;
  const audio = narration?.resolved_audio ?? narration?.resolvedAudio ?? narration?.src ?? narration?.audio ?? narration?.source;
  return audio ? assetSource(audio) : null;
};

const normalizeSafeFrame = (safeFrame?: SafeFrame): Required<SafeFrame> => {
  const x = clamp(Number(safeFrame?.x_pct ?? DEFAULT_SAFE_FRAME.x_pct), 0, 0.99);
  const y = clamp(Number(safeFrame?.y_pct ?? DEFAULT_SAFE_FRAME.y_pct), 0, 0.99);
  const width = clamp(Number(safeFrame?.width_pct ?? DEFAULT_SAFE_FRAME.width_pct), 0.01, 1 - x);
  const height = clamp(Number(safeFrame?.height_pct ?? DEFAULT_SAFE_FRAME.height_pct), 0.01, 1 - y);
  return {
    x_pct: x,
    y_pct: y,
    width_pct: width,
    height_pct: height,
  };
};

const safeFrameForShot = (plan: Plan, shot: Shot): Required<SafeFrame> => {
  const direct = shot.safe_frame ?? shot.safeFrame;
  if (direct) {
    return normalizeSafeFrame(direct);
  }

  const panelId = shot.panel_id ?? shot.panelId;
  const panel = plan.panels?.find((candidate) => candidate.panel_id === panelId);
  return normalizeSafeFrame(panel?.safe_frame ?? panel?.safeFrame);
};

const progressFor = (frame: number, duration: number) =>
  interpolate(frame, [0, Math.max(1, duration - 1)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.cubic),
  });

const primitiveForShot = (shot: Shot) => {
  const motion = shot.camera_motion ?? shot.cameraMotion ?? {};
  const explicitPrimitive = String(shot.primitive ?? "").toLowerCase();
  if (explicitPrimitive) {
    return explicitPrimitive;
  }
  const type = String(motion.type ?? "").toLowerCase();
  if (type.includes("pan") || type.includes("tilt")) {
    return "camera_pan";
  }
  if (type.includes("zoom")) {
    return "camera_zoom";
  }
  if (type.includes("push") || type.includes("pull")) {
    return "camera_push";
  }
  if (hasEffect(shot, "shake")) {
    return "shake";
  }
  if (hasEffect(shot, "focus_reveal")) {
    return "focus_reveal";
  }
  if (hasEffect(shot, "speed") || hasEffect(shot, "overlay")) {
    return "overlay_effect";
  }
  if (hasEffect(shot, "parallax")) {
    return "parallax_hint";
  }
  return "hold";
};

const safeTransformLimits = (safeFrame: Required<SafeFrame>) => {
  const marginX = Math.min(safeFrame.x_pct, 1 - safeFrame.x_pct - safeFrame.width_pct);
  const marginY = Math.min(safeFrame.y_pct, 1 - safeFrame.y_pct - safeFrame.height_pct);
  const minMargin = Math.max(0, Math.min(marginX, marginY));
  return {
    maxScale: Math.max(MAX_CAMERA_SCALE, 1 + minMargin * 0.8),
    maxPanX: Math.max(MAX_CAMERA_PAN_PX, Math.round(marginX * 360)),
    maxPanY: Math.max(MAX_CAMERA_PAN_PX, Math.round(marginY * 240)),
  };
};

const safeFrameTransformOrigin = (safeFrame: Required<SafeFrame>) => {
  const x = (safeFrame.x_pct + safeFrame.width_pct / 2) * 100;
  const y = (safeFrame.y_pct + safeFrame.height_pct / 2) * 100;
  return `${x}% ${y}%`;
};

const cameraTransform = (shot: Shot, frame: number, duration: number, safeFrame: Required<SafeFrame>) => {
  const motion = shot.camera_motion ?? shot.cameraMotion ?? {};
  const type = String(motion.type ?? "hold").toLowerCase();
  const direction = String(motion.direction ?? type).toLowerCase();
  const progress = progressFor(frame, duration);
  const intensity = clamp(Number(motion.intensity ?? 1), 0, 3);
  const startPosition = motion.start_position ?? motion.startPosition;
  const endPosition = motion.end_position ?? motion.endPosition;
  const hasPlanPosition = startPosition || endPosition;
  const limits = safeTransformLimits(safeFrame);
  const planX = hasPlanPosition
    ? interpolate(progress, [0, 1], [Number(startPosition?.x ?? 0), Number(endPosition?.x ?? 0)])
    : 0;
  const planY = hasPlanPosition
    ? interpolate(progress, [0, 1], [Number(startPosition?.y ?? 0), Number(endPosition?.y ?? 0)])
    : 0;
  const fallbackPan = 42 * intensity;
  const rotate = interpolate(progress, [0, 1], [0, Number(motion.rotate ?? 0)]);
  const primitive = primitiveForShot(shot);
  const startScale = clamp(Number(motion.start_scale ?? motion.startScale ?? 1), 1, limits.maxScale);
  const requestedEndScale = Number(motion.end_scale ?? motion.endScale ?? 1.04 + intensity * 0.01);
  const endScale = clamp(requestedEndScale, 1, limits.maxScale);
  let x = 0;
  let y = 0;
  let scale = 1;

  switch (primitive) {
    case "camera_push":
    case "camera_zoom":
      scale = type.includes("pull") || type.includes("zoom_out")
        ? interpolate(progress, [0, 1], [endScale, startScale])
        : interpolate(progress, [0, 1], [startScale, endScale]);
      x = planX;
      y = planY;
      break;
    case "camera_pan":
      scale = clamp(endScale, 1, Math.min(limits.maxScale, 1.12));
      x = hasPlanPosition
        ? planX
        : direction.includes("left")
          ? interpolate(progress, [0, 1], [fallbackPan, -fallbackPan])
          : direction.includes("right")
            ? interpolate(progress, [0, 1], [-fallbackPan, fallbackPan])
            : 0;
      y = hasPlanPosition
        ? planY
        : direction.includes("up")
          ? interpolate(progress, [0, 1], [fallbackPan * 0.45, -fallbackPan * 0.45])
          : direction.includes("down")
            ? interpolate(progress, [0, 1], [-fallbackPan * 0.45, fallbackPan * 0.45])
            : 0;
      break;
    case "shake":
    case "focus_reveal":
    case "overlay_effect":
    case "parallax_hint":
    case "hold":
    default:
      scale = 1;
      x = 0;
      y = 0;
      break;
  }

  return `translate3d(${clamp(x, -limits.maxPanX, limits.maxPanX)}px, ${clamp(y, -limits.maxPanY, limits.maxPanY)}px, 0) scale(${scale}) rotate(${rotate}deg)`;
};

const hasEffect = (shot: Shot, name: string) => {
  const local = shot.local_motion ?? shot.localMotion ?? [];
  const cameraType = String((shot.camera_motion ?? shot.cameraMotion ?? {}).type ?? "").toLowerCase();
  const effects = Array.isArray(shot.effects) ? shot.effects : [];
  return (
    cameraType.includes(name) ||
    effects.some((item) => String(item).toLowerCase().includes(name)) ||
    local.some((item) => String(item.type ?? "").toLowerCase().includes(name))
  );
};

const localParallaxTransform = (shot: Shot, progress: number) => {
  const local = shot.local_motion ?? shot.localMotion ?? [];
  const parallax = local.find((item) => String(item.type ?? "").toLowerCase().includes("parallax"));
  const amplitude = Number(parallax?.amplitude_px ?? parallax?.amplitudePx ?? 18);
  const direction = String(parallax?.direction ?? "right").toLowerCase();
  const x =
    direction.includes("left")
      ? interpolate(progress, [0, 1], [amplitude, -amplitude])
      : direction.includes("right")
        ? interpolate(progress, [0, 1], [-amplitude, amplitude])
        : 0;
  const y =
    direction.includes("up")
      ? interpolate(progress, [0, 1], [amplitude * 0.45, -amplitude * 0.45])
      : direction.includes("down")
        ? interpolate(progress, [0, 1], [-amplitude * 0.45, amplitude * 0.45])
        : interpolate(progress, [0, 1], [amplitude * 0.25, -amplitude * 0.25]);

  return `translate3d(${x}px, ${y}px, 0) scale(1.09)`;
};

const shakeOffset = (shot: Shot, frame: number) => {
  if (primitiveForShot(shot) !== "shake" && !hasEffect(shot, "shake")) {
    return { x: 0, y: 0 };
  }
  const strength = 7;
  return {
    x: Math.sin(frame * 2.7) * strength,
    y: Math.cos(frame * 3.1) * strength * 0.55,
  };
};

const SpeedLines: React.FC<{ opacity: number }> = ({ opacity }) => (
  <AbsoluteFill
    style={{
      opacity,
      background:
        "repeating-linear-gradient(105deg, transparent 0 38px, rgba(255,255,255,0.28) 39px 41px, transparent 42px 72px)",
      mixBlendMode: "screen",
    }}
  />
);

const ShotView: React.FC<{ plan: Plan; shot: Shot; offsetFrame?: number }> = ({ plan, shot, offsetFrame = 0 }) => {
  const frame = useCurrentFrame() - offsetFrame;
  const { fps } = useVideoConfig();
  const duration = shotDuration(shot, fps);
  const progress = progressFor(frame, duration);
  const primitive = primitiveForShot(shot);
  const safeFrame = safeFrameForShot(plan, shot);
  const shake = shakeOffset(shot, frame);
  const flash = hasEffect(shot, "flash") || primitive === "overlay_effect" ? Math.max(0, 1 - progress * 5) : 0;
  const speedLines = hasEffect(shot, "speed") || primitive === "overlay_effect"
    ? interpolate(progress, [0, 0.18, 0.85, 1], [0, 0.45, 0.18, 0])
    : 0;
  const glow = hasEffect(shot, "glow") || hasEffect(shot, "flash") || primitive === "focus_reveal";
  const focusOpacity = primitive === "focus_reveal" ? interpolate(progress, [0, 0.3, 1], [0.28, 0.14, 0]) : 0;
  const showParallax = primitive === "parallax_hint" || hasEffect(shot, "parallax");

  return (
    <AbsoluteFill style={{ backgroundColor: "#080808", overflow: "hidden" }}>
      <AbsoluteFill
        style={{
          transform: `translate3d(${shake.x}px, ${shake.y}px, 0)`,
          transformOrigin: "center center",
        }}
      >
        <Img
          src={shotImage(shot)}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "contain",
            transform: cameraTransform(shot, frame, duration, safeFrame),
            transformOrigin: safeFrameTransformOrigin(safeFrame),
            filter: glow ? "contrast(1.05) saturate(1.08) drop-shadow(0 0 18px rgba(255,245,180,0.24))" : "contrast(1.04)",
          }}
        />
        {showParallax ? (
          <Img
            src={shotImage(shot)}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "contain",
              opacity: 0.16,
              transform: localParallaxTransform(shot, progress),
              transformOrigin: safeFrameTransformOrigin(safeFrame),
              mixBlendMode: "screen",
              filter: "blur(1.5px) saturate(1.12)",
            }}
          />
        ) : null}
      </AbsoluteFill>
      <AbsoluteFill
        style={{
          background: "radial-gradient(circle at center, transparent 48%, rgba(0,0,0,0.46) 100%)",
        }}
      />
      <AbsoluteFill
        style={{
          opacity: focusOpacity,
          background: "radial-gradient(circle at center, transparent 34%, rgba(0,0,0,0.58) 100%)",
        }}
      />
      {speedLines > 0 ? <SpeedLines opacity={speedLines} /> : null}
      <AbsoluteFill
        style={{
          opacity: flash,
          backgroundColor: "white",
          mixBlendMode: "screen",
        }}
      />
    </AbsoluteFill>
  );
};

export const MotionComic: React.FC<Props> = ({ plan, shotId }) => {
  if (!plan || !Array.isArray(plan.shots) || plan.shots.length === 0) {
    throw new Error("MotionComic requires runtime plan data with at least one shot");
  }

  const { fps } = useVideoConfig();
  if (shotId) {
    const shot = plan.shots.find((candidate) => candidate.shot_id === shotId);
    if (!shot) {
      throw new Error(`Shot not found in runtime plan: ${shotId}`);
    }
    return <ShotView plan={plan} shot={shot} />;
  }

  let cursor = 0;
  const narrationSrc = narrationAudioSource(plan);
  const narrationVolume = clamp(Number(plan.audio?.narration?.volume ?? 1), 0, 2);
  return (
    <AbsoluteFill>
      {narrationSrc ? <Audio src={narrationSrc} volume={narrationVolume} /> : null}
      {plan.shots.map((shot) => {
        const from = cursor;
        const duration = shotDuration(shot, fps);
        cursor += duration;
        return (
          <Sequence key={shot.shot_id} from={from} durationInFrames={duration}>
            <ShotView plan={plan} shot={shot} offsetFrame={from} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};

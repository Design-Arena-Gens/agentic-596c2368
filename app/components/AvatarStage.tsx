"use client";

import { forwardRef, useEffect, useRef, useState } from "react";
import type { AvatarStyle, AvatarVisualState } from "../lib/avatars";

const CANVAS_WIDTH = 520;
const CANVAS_HEIGHT = 520;

function applyRef<T>(ref: React.ForwardedRef<T>, value: T) {
  if (!ref) return;
  if (typeof ref === "function") {
    ref(value);
  } else {
    ref.current = value;
  }
}

function ease(value: number) {
  return Math.max(0, Math.min(1, value));
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
) {
  const r = Math.min(radius, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawEmotionGlow(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  radius: number,
  color: string,
  intensity: number,
) {
  const gradient = ctx.createRadialGradient(centerX, centerY, radius * 0.25, centerX, centerY, radius);
  gradient.addColorStop(0, `${color}${Math.floor(160 * intensity).toString(16).padStart(2, "0")}`);
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
  ctx.fill();
}

const AvatarStage = forwardRef<HTMLCanvasElement, {
  state: AvatarVisualState;
  avatarStyle: AvatarStyle;
  imageSrc?: string | null;
  className?: string;
}>(function AvatarStage({ state, avatarStyle, imageSrc, className }, forwardedRef) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [imageElement, setImageElement] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    canvas.width = CANVAS_WIDTH * dpr;
    canvas.height = CANVAS_HEIGHT * dpr;
    canvas.style.width = `${CANVAS_WIDTH}px`;
    canvas.style.height = `${CANVAS_HEIGHT}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
  }, []);

  useEffect(() => {
    if (!imageSrc) {
      setImageElement(null);
      return;
    }
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.src = imageSrc;
    const handleLoad = () => setImageElement(image);
    image.addEventListener("load", handleLoad);
    return () => {
      image.removeEventListener("load", handleLoad);
    };
  }, [imageSrc]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    ctx.save();
    drawRoundedRect(ctx, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT, 36);
    ctx.clip();

    const backgroundGradient = ctx.createLinearGradient(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    backgroundGradient.addColorStop(0, "rgba(3,7,18,0.65)");
    backgroundGradient.addColorStop(1, "rgba(5,12,34,0.95)");
    ctx.fillStyle = backgroundGradient;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    ctx.fillStyle = "rgba(255,255,255,0.04)";
    for (let i = 0; i < 3; i++) {
      const radius = 160 + i * 80;
      ctx.beginPath();
      ctx.arc(260, 220, radius, 0, Math.PI * 2);
      ctx.fill();
    }

    drawEmotionGlow(ctx, 260, 260, 220, avatarStyle.accent.replace("#", "#"), ease(state.emotionIntensity));

    ctx.save();
    ctx.translate(CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 - 30);
    ctx.rotate((state.headTilt * Math.PI) / 180);
    ctx.translate(0, 12 * ease(state.headTilt / 15));
    ctx.scale(1 + state.headTurn * 0.03, 1);

    if (imageElement) {
      ctx.save();
      const maskRadius = 170;
      ctx.beginPath();
      ctx.arc(0, -10, maskRadius, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(imageElement, -maskRadius, -maskRadius - 10, maskRadius * 2, maskRadius * 2);
      ctx.restore();
    } else {
      ctx.save();
      const headGradient = ctx.createLinearGradient(-140, -200, 140, 160);
      headGradient.addColorStop(0, avatarStyle.base);
      headGradient.addColorStop(1, avatarStyle.secondary);
      ctx.fillStyle = headGradient;
      ctx.beginPath();
      ctx.ellipse(0, -30, 150, 190, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.ellipse(0, -30, 152, 192, 0, 0, Math.PI * 2);
      ctx.stroke();

      const hairGradient = ctx.createLinearGradient(-140, -200, 140, -80);
      hairGradient.addColorStop(0, avatarStyle.highlight);
      hairGradient.addColorStop(1, avatarStyle.base);
      ctx.fillStyle = hairGradient;
      ctx.beginPath();
      ctx.ellipse(0, -150, 180, 120, 0, Math.PI, 0);
      ctx.fill();
      ctx.closePath();
    }

    const eyeSeparation = 100;
    const eyeHeight = -50;
    const blink = ease(state.blink);
    const eyeOpen = 26 * (1 - blink * 0.92);
    const eyeOffsetX = state.eyeOffsetX * 12;
    const eyeOffsetY = state.eyeOffsetY * 8;

    ctx.fillStyle = "rgba(8,47,73,0.8)";
    ctx.beginPath();
    ctx.ellipse(-eyeSeparation / 2, eyeHeight - 10, 44, 30, 0, 0, Math.PI * 2);
    ctx.ellipse(eyeSeparation / 2, eyeHeight - 10, 44, 30, 0, 0, Math.PI * 2);
    ctx.fill();

    [ -eyeSeparation / 2, eyeSeparation / 2 ].forEach((x) => {
      ctx.save();
      ctx.translate(x, eyeHeight);
      drawRoundedRect(ctx, -32, -eyeOpen / 2 - 3, 64, eyeOpen + 6, 18);
      ctx.clip();
      const scleraGradient = ctx.createLinearGradient(-32, -eyeOpen, 40, eyeOpen);
      scleraGradient.addColorStop(0, "#f8fafc");
      scleraGradient.addColorStop(1, "#e2e8f0");
      ctx.fillStyle = scleraGradient;
      ctx.fillRect(-32, -eyeOpen / 2 - 3, 64, eyeOpen + 6);

      ctx.fillStyle = "#0f172a";
      ctx.beginPath();
      ctx.arc(eyeOffsetX, eyeOffsetY * 0.8, 17, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = avatarStyle.accent;
      ctx.beginPath();
      ctx.arc(eyeOffsetX - 3, eyeOffsetY * 0.6, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "white";
      ctx.beginPath();
      ctx.arc(eyeOffsetX - 8, eyeOffsetY * 0.4, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });

    ctx.strokeStyle = `rgba(255,255,255,${0.25 + state.browLift * 0.4})`;
    ctx.lineWidth = 6;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-eyeSeparation / 2 - 36, eyeHeight - 42 - state.browLift * 10);
    ctx.lineTo(-eyeSeparation / 2 + 24, eyeHeight - 52 + state.browLift * 8);
    ctx.moveTo(eyeSeparation / 2 - 24, eyeHeight - 52 + state.browLift * 8);
    ctx.lineTo(eyeSeparation / 2 + 36, eyeHeight - 42 - state.browLift * 10);
    ctx.stroke();

    const baseMouthWidth = 98 * ease(state.mouthWidth);
    const openness = 48 * ease(state.mouthOpenness);
    const roundness = 22 * ease(state.mouthRoundness);

    ctx.fillStyle = "rgba(10, 10, 14, 0.85)";
    ctx.beginPath();
    ctx.moveTo(-baseMouthWidth / 2, 40);
    ctx.quadraticCurveTo(0, 40 + openness, baseMouthWidth / 2, 40);
    ctx.quadraticCurveTo(0, 40 + openness + roundness, -baseMouthWidth / 2, 40);
    ctx.fill();

    const glossGradient = ctx.createLinearGradient(-baseMouthWidth / 2, 40, baseMouthWidth / 2, 40 + openness);
    glossGradient.addColorStop(0, `${avatarStyle.accent}88`);
    glossGradient.addColorStop(0.5, "rgba(255,255,255,0.35)");
    glossGradient.addColorStop(1, `${avatarStyle.accent}33`);
    ctx.strokeStyle = glossGradient;
    ctx.lineWidth = 4;
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(-baseMouthWidth / 2, 38);
    ctx.quadraticCurveTo(0, 38 + openness * 0.65, baseMouthWidth / 2, 38);
    ctx.stroke();

    ctx.fillStyle = `${avatarStyle.highlight}55`;
    ctx.beginPath();
    ctx.moveTo(-baseMouthWidth / 2 + 12, 38);
    ctx.quadraticCurveTo(0, 48 + openness * 0.2, baseMouthWidth / 2 - 12, 38);
    ctx.fill();

    const emotionHue = {
      happy: "#34d399",
      sad: "#60a5fa",
      angry: "#fb7185",
      surprised: "#facc15",
      neutral: avatarStyle.accent,
    }[state.emotion];

    ctx.strokeStyle = `${emotionHue}55`;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(0, 90, 120, Math.PI * 0.15, Math.PI * 0.85);
    ctx.stroke();

    const handOffset = state.handCycle * 60;
    ctx.fillStyle = `${avatarStyle.clothing}cc`;
    drawRoundedRect(ctx, -180, 180 + handOffset * 0.4, 120, 140, 60);
    ctx.fill();
    drawRoundedRect(ctx, 60, 180 - handOffset * 0.3, 120, 140, 60);
    ctx.fill();

    ctx.fillStyle = `${avatarStyle.skin}dd`;
    ctx.beginPath();
    ctx.ellipse(-140, 200 + handOffset * 0.5, 32, 46, 0.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(140, 200 - handOffset * 0.5, 32, 46, -0.35, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
    ctx.restore();

    ctx.strokeStyle = "rgba(148,163,184,0.18)";
    ctx.lineWidth = 1.4;
    ctx.strokeRect(0.5, 0.5, CANVAS_WIDTH - 1, CANVAS_HEIGHT - 1);

    ctx.fillStyle = "rgba(2,6,23,0.68)";
    ctx.fillRect(24, CANVAS_HEIGHT - 72, 220, 48);
    ctx.fillStyle = "rgba(96,165,250,0.28)";
    ctx.fillRect(24, CANVAS_HEIGHT - 20, 220 * ease(state.audioLevel), 5);

    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.font = "600 16px 'Inter', sans-serif";
    ctx.fillText(state.timelineLabel ?? "Idle", 38, CANVAS_HEIGHT - 42);
    ctx.fillStyle = "rgba(148,163,184,0.9)";
    ctx.font = "500 13px 'Inter', sans-serif";
    ctx.fillText(`VIS ${state.emotion.toUpperCase()} · ${(state.audioLevel * 100).toFixed(0)}%`, 38, CANVAS_HEIGHT - 24);
  }, [state, avatarStyle, imageElement]);

  return (
    <canvas
      ref={(node) => {
        canvasRef.current = node;
        applyRef(forwardedRef, node);
      }}
      className={className}
    />
  );
});

AvatarStage.displayName = "AvatarStage";

export default AvatarStage;

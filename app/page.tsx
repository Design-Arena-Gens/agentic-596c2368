"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AvatarStage from "./components/AvatarStage";
import {
  avatarStyles,
  defaultVisualState,
  type AvatarStyle,
  type AvatarVisualState,
  type Emotion,
} from "./lib/avatars";
import clsx from "clsx";

const defaultScript = "Hello! I am your virtual presenter. Give me any script or voice input and I will bring it to life with expressive animation.";

const emotions: { id: Emotion; label: string; tone: string }[] = [
  { id: "neutral", label: "Neutral", tone: "Balanced articulation" },
  { id: "happy", label: "Happy", tone: "Energetic and upbeat" },
  { id: "sad", label: "Sad", tone: "Soft and mellow" },
  { id: "angry", label: "Angry", tone: "Intense and sharp" },
  { id: "surprised", label: "Surprised", tone: "Bright and wide-eyed" },
];

type TimelineMode = "text" | "audio";

type TimelineState = {
  mode: TimelineMode;
  startTime: number;
  duration: number;
  tokens: string[];
  segments: number[];
  emotion: Emotion;
};

const round = (value: number, decimals: number) => {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
};

export default function Home() {
  const [mode, setMode] = useState<TimelineMode>("text");
  const [script, setScript] = useState(defaultScript);
  const [emotion, setEmotion] = useState<Emotion>("neutral");
  const [selectedAvatarId, setSelectedAvatarId] = useState(avatarStyles[0].id);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [status, setStatus] = useState("Ready");
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [avatarState, setAvatarState] = useState<AvatarVisualState>(defaultVisualState);
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceName, setVoiceName] = useState<string | null>(null);
  const [speechRate, setSpeechRate] = useState(1.0);
  const [speechPitch, setSpeechPitch] = useState(1.0);
  const [audioFileName, setAudioFileName] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const animationFrameRef = useRef<number>();
  const timelineRef = useRef<TimelineState | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const lastBlinkRef = useRef<number>(performance.now());
  const blinkIntervalRef = useRef<number>(4000);
  const lastEmotionPulseRef = useRef<number>(performance.now());

  const avatarStyle = useMemo<AvatarStyle>(() => {
    return avatarStyles.find((avatar) => avatar.id === selectedAvatarId) ?? avatarStyles[0];
  }, [selectedAvatarId]);

  const ensureAudioContext = useCallback(() => {
    if (typeof window === "undefined") return null;
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext();
    }
    return audioContextRef.current;
  }, []);

  const resetAnimationFrame = useCallback(() => {
    if (animationFrameRef.current !== undefined) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = undefined;
    }
  }, []);

  const stopSpeech = useCallback(() => {
    if (typeof window === "undefined") return;
    if (utteranceRef.current) {
      window.speechSynthesis.cancel();
      utteranceRef.current = null;
    }
  }, []);

  const stopAudioPlayback = useCallback(() => {
    const audio = audioElementRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
    if (audioSourceRef.current) {
      audioSourceRef.current.disconnect();
      audioSourceRef.current = null;
    }
    if (analyserRef.current) {
      analyserRef.current.disconnect();
      analyserRef.current = null;
    }
  }, []);

  const stopAllPlayback = useCallback(() => {
    resetAnimationFrame();
    stopSpeech();
    stopAudioPlayback();
    timelineRef.current = null;
    setIsPreviewing(false);
    setProgress(0);
    setAvatarState((prev) => ({
      ...prev,
      mouthOpenness: 0,
      mouthWidth: 0.5,
      mouthRoundness: 0.2,
      eyeOffsetX: 0,
      eyeOffsetY: 0,
      blink: 0,
      handCycle: 0,
      timelineLabel: "Idle",
      audioLevel: 0,
      emotionIntensity: 0.25,
    }));
  }, [resetAnimationFrame, stopAudioPlayback, stopSpeech]);

  const updateAnimation = useCallback(() => {
    const timeline = timelineRef.current;
    if (!timeline) return;

    const now = performance.now();
    const elapsed = now - timeline.startTime;
    const duration = timeline.duration;
    const clampedElapsed = Math.min(elapsed, duration);
    const ratio = duration === 0 ? 0 : clampedElapsed / duration;
    const easedProgress = Math.pow(ratio, 0.9);
    const baseEmotion = timeline.emotion;

    const blinkNow = now - lastBlinkRef.current;
    if (blinkNow > blinkIntervalRef.current) {
      lastBlinkRef.current = now;
      blinkIntervalRef.current = 2500 + Math.random() * 3200;
    }
    const blinkPhase = Math.max(0, 1 - Math.abs((blinkNow % 180) - 90) / 90);

    let activeIndex = timeline.tokens.length - 1;
    let accumulated = 0;
    for (let i = 0; i < timeline.segments.length; i++) {
      accumulated += timeline.segments[i];
      if (clampedElapsed <= accumulated) {
        activeIndex = i;
        break;
      }
    }

    const token = timeline.tokens[activeIndex] ?? "";
    const phoneticEnergy = Math.min(1, token.replace(/[^a-z]/gi, "").length / 6 + 0.2);
    const localElapsed = clampedElapsed - (accumulated - timeline.segments[activeIndex]);
    const localDuration = timeline.segments[activeIndex] || 1;
    const localRatio = Math.max(0, Math.min(1, localElapsed / localDuration));
    const localEnvelope = Math.sin(localRatio * Math.PI);

    const audioLevel = Math.max(0.05, localEnvelope * phoneticEnergy);

    const nowSinceEmotionPulse = now - lastEmotionPulseRef.current;
    if (nowSinceEmotionPulse > 6000) {
      lastEmotionPulseRef.current = now;
    }
    const emotionPulse = Math.sin(((now - lastEmotionPulseRef.current) / 6000) * Math.PI * 2) * 0.15 + 0.85;
    const emotionIntensity = Math.min(1, 0.3 + emotionPulse * (0.5 + phoneticEnergy * 0.5));

    setAvatarState((prev) => ({
      ...prev,
      emotion: baseEmotion,
      emotionIntensity,
      mouthOpenness: audioLevel,
      mouthRoundness: 0.35 - phoneticEnergy * 0.12 + (baseEmotion === "surprised" ? 0.25 : 0),
      mouthWidth: 0.55 + phoneticEnergy * 0.3,
      headTilt: Math.sin(ratio * Math.PI * 2 + phoneticEnergy) * 6 +
        (baseEmotion === "happy" ? 3 : baseEmotion === "sad" ? -4 : 0),
      headTurn: Math.sin(now / 1200) * 4 + Math.cos(ratio * Math.PI * 4) * 3,
      browLift: 0.2 + localEnvelope * 0.5 + (baseEmotion === "angry" ? -0.2 : 0),
      eyeOffsetX: Math.sin(now / 800) * 0.7 + Math.sin(ratio * Math.PI * 6) * 0.2,
      eyeOffsetY: Math.cos(now / 1000) * 0.3 + (baseEmotion === "sad" ? 0.2 : 0),
      blink: Math.pow(Math.min(1, blinkPhase), 2),
      handCycle: Math.sin(ratio * Math.PI * 2 + phoneticEnergy * 2) * phoneticEnergy,
      shimmer: Math.sin(now / 320) * 0.5 + 0.5,
      timelineLabel: token ? token : "Expressing",
      audioLevel,
    }));
    setProgress(round(easedProgress * 100, 1));

    if (elapsed < duration) {
      animationFrameRef.current = requestAnimationFrame(updateAnimation);
    } else {
      stopAllPlayback();
      setStatus("Preview complete");
    }
  }, [setAvatarState, stopAllPlayback]);

  const startTextTimeline = useCallback(
    (text: string, durationMultiplier = 82) => {
      const tokens = text
        .replace(/\s+/g, " ")
        .trim()
        .split(" ")
        .filter(Boolean);
      if (tokens.length === 0) return;
      const segments = tokens.map((token) => {
        const letters = token.replace(/[^a-z]/gi, "").length || 1;
        const punctuationBoost = /[,.!?]$/.test(token) ? 420 : 0;
        return letters * durationMultiplier + 240 + punctuationBoost;
      });
      const duration = segments.reduce((acc, item) => acc + item, 0);
      timelineRef.current = {
        mode: "text",
        startTime: performance.now(),
        duration,
        tokens,
        segments,
        emotion,
      };
      animationFrameRef.current = requestAnimationFrame(updateAnimation);
    },
    [emotion, updateAnimation],
  );

  const speakText = useCallback(() => {
    if (typeof window === "undefined") return;
    stopAllPlayback();
    setStatus("Synthesizing voice");
    const utterance = new SpeechSynthesisUtterance(script);
    utterance.rate = speechRate;
    utterance.pitch = speechPitch;
    if (voiceName) {
      const voice = window.speechSynthesis.getVoices().find((v) => v.name === voiceName);
      if (voice) utterance.voice = voice;
    }
    utterance.onstart = () => {
      setIsPreviewing(true);
      setStatus("Playing preview");
      startTextTimeline(script, 78 - speechRate * 6 + (speechPitch > 1 ? -4 : 0));
    };
    utterance.onend = () => {
      stopAllPlayback();
      setStatus("Preview complete");
    };
    utterance.onerror = (event) => {
      console.error(event);
      stopAllPlayback();
      setStatus("Speech synthesis error");
    };
    utteranceRef.current = utterance;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }, [script, speechRate, speechPitch, voiceName, startTextTimeline, stopAllPlayback]);

  const driveAudioTimeline = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser) return;
    const dataArray = new Uint8Array(analyser.fftSize);
    const timeline = timelineRef.current;
    if (!timeline) return;

    const now = performance.now();
    const elapsed = now - timeline.startTime;
    const duration = timeline.duration;

    analyser.getByteFrequencyData(dataArray);
    const avg = dataArray.reduce((acc, value) => acc + value, 0) / dataArray.length;
    const level = Math.min(1, avg / 180);

    const ratio = duration === 0 ? 0 : Math.min(1, elapsed / duration);
    const easedProgress = Math.pow(ratio, 0.92);

    setAvatarState((prev) => ({
      ...prev,
      emotion: emotion,
      emotionIntensity: 0.3 + level * 0.6,
      mouthOpenness: 0.1 + level * 1.1,
      mouthWidth: 0.6 + level * 0.35,
      mouthRoundness: 0.3 - level * 0.1,
      headTilt: Math.sin(now / 720) * (5 + level * 6),
      headTurn: Math.cos(now / 960) * (4 + level * 5),
      browLift: 0.15 + level * 0.55,
      eyeOffsetX: Math.sin(now / 640) * (0.6 + level * 0.6),
      eyeOffsetY: Math.sin(now / 820) * (0.4 + level * 0.4),
      blink: Math.pow(Math.sin(now / 1200) * 0.5 + 0.5, 8),
      handCycle: Math.sin(now / 380) * (0.4 + level * 0.7),
      shimmer: Math.sin(now / 220) * 0.5 + 0.5,
      timelineLabel: `${Math.floor(ratio * 100)}% energy`,
      audioLevel: level,
    }));

    setProgress(round(easedProgress * 100, 1));

    if (elapsed < duration && isPreviewing) {
      animationFrameRef.current = requestAnimationFrame(driveAudioTimeline);
    } else {
      stopAllPlayback();
      setStatus("Preview complete");
    }
  }, [emotion, isPreviewing, setAvatarState, stopAllPlayback]);

  const playAudioFile = useCallback(async () => {
    const audio = audioElementRef.current;
    if (!audio || !audioUrl) return;
    stopAllPlayback();
    const ctx = ensureAudioContext();
    if (!ctx) return;

    if (!audioSourceRef.current) {
      audioSourceRef.current = ctx.createMediaElementSource(audio);
    }
    if (!analyserRef.current) {
      analyserRef.current = ctx.createAnalyser();
      analyserRef.current.fftSize = 512;
    }
    audioSourceRef.current.connect(analyserRef.current);
    analyserRef.current.connect(ctx.destination);

    await ctx.resume();

    const duration = (audio.duration || 8) * 1000;
    timelineRef.current = {
      mode: "audio",
      startTime: performance.now(),
      duration,
      tokens: [],
      segments: [],
      emotion,
    };

    audio.currentTime = 0;
    audio.play();
    setIsPreviewing(true);
    setStatus("Analyzing audio");
    animationFrameRef.current = requestAnimationFrame(driveAudioTimeline);
  }, [audioUrl, driveAudioTimeline, emotion, ensureAudioContext, stopAllPlayback]);

  const handleGenerate = useCallback(() => {
    if (mode === "text") {
      speakText();
    } else {
      playAudioFile();
    }
  }, [mode, speakText, playAudioFile]);

  const handleFileUpload = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setAudioFileName(file.name);
    setAudioUrl(url);
    setMode("audio");
    setStatus("Audio ready");
  }, []);

  const handleImageUpload = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setImagePreview(url);
  }, []);

  const handleExport = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const stream = canvas.captureStream(60);
    const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
      ? "video/webm;codecs=vp9"
      : MediaRecorder.isTypeSupported("video/webm;codecs=vp8")
      ? "video/webm;codecs=vp8"
      : "video/webm";
    recorderRef.current = new MediaRecorder(stream, { mimeType });
    recordingChunksRef.current = [];
    recorderRef.current.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        recordingChunksRef.current.push(event.data);
      }
    };
    recorderRef.current.onstop = () => {
      const blob = new Blob(recordingChunksRef.current, { type: mimeType });
      const downloadUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = `lipforge-preview-${Date.now()}.webm`;
      link.click();
      URL.revokeObjectURL(downloadUrl);
      setStatus("Export generated");
    };
    recorderRef.current.start();
    setStatus("Recording canvas");
    setTimeout(() => {
      if (recorderRef.current && recorderRef.current.state === "recording") {
        recorderRef.current.stop();
      }
    }, 8000);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    function populateVoices() {
      const voices = window.speechSynthesis.getVoices();
      if (voices.length) {
        setAvailableVoices(voices);
        if (!voiceName) {
          const preferred = voices.find((voice) => /en-US|en_GB/.test(voice.lang));
          setVoiceName(preferred?.name ?? voices[0].name);
        }
      }
    }
    populateVoices();
    window.speechSynthesis.addEventListener("voiceschanged", populateVoices);
    return () => {
      window.speechSynthesis.removeEventListener("voiceschanged", populateVoices);
    };
  }, [voiceName]);

  useEffect(() => {
    return () => {
      stopAllPlayback();
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      if (imagePreview) URL.revokeObjectURL(imagePreview);
    };
  }, [audioUrl, imagePreview, stopAllPlayback]);

  const activityTag = useMemo(() => {
    if (isPreviewing) return "Live Preview";
    switch (mode) {
      case "text":
        return "Text-to-Speech";
      case "audio":
        return "Audio-to-Avatar";
      default:
        return "Studio";
    }
  }, [mode, isPreviewing]);

  const computedStatusColor = useMemo(() => {
    if (isPreviewing) return "var(--success)";
    if (/error/i.test(status)) return "var(--danger)";
    return "var(--primary)";
  }, [isPreviewing, status]);

  return (
    <main
      className="relative flex min-h-screen w-full flex-col items-center justify-start overflow-x-hidden pb-32 pt-16"
    >
      <div className="noise-overlay" />
      <div className="z-10 flex w-full max-w-7xl flex-col gap-10 px-6">
        <div className="flex flex-col gap-6">
          <div className="tag" style={{ alignSelf: "flex-start" }}>
            <span className="status-dot" style={{ background: computedStatusColor }} />
            {activityTag}
          </div>
          <div className="flex flex-col gap-4">
            <h1
              style={{
                fontSize: "clamp(2.6rem, 4vw + 1rem, 3.9rem)",
                lineHeight: 1.1,
                fontWeight: 700,
                letterSpacing: "-0.03em",
                maxWidth: "18ch",
              }}
            >
              LipForge Studio
            </h1>
            <p
              style={{
                color: "var(--muted)",
                maxWidth: "60ch",
                fontSize: "17px",
                lineHeight: 1.7,
              }}
            >
              Upload a portrait or pick a stylized avatar, choose the mood, and feed in text or audio. LipForge syncs speech, expressions, and gestures in real time with cinematic lighting and export-ready playback.
            </p>
          </div>
        </div>

        <div className="layout-grid grid grid-cols-12 gap-7">
          <section className="card col-span-12 flex flex-col gap-8 p-8 shadow-xl lg:col-span-7">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 style={{ fontSize: "24px", fontWeight: 600 }}>Real-time Avatar Preview</h2>
                <p style={{ color: "var(--muted)", marginTop: 4 }}>
                  Facial sync, head motion, blinks, and gesture choreography respond to your voice input instantly.
                </p>
              </div>
              <div style={{ display: "flex", gap: "12px" }}>
                <button className="button-outline" onClick={stopAllPlayback} disabled={!isPreviewing}>
                  Stop
                </button>
                <button className="button-primary" onClick={handleGenerate}>
                  {isPreviewing ? "Regenerate" : "Generate & Preview"}
                </button>
              </div>
            </div>

            <div
              className="glass-border flex flex-col items-center justify-center gap-6 rounded-3xl p-6"
              style={{ position: "relative" }}
            >
              <AvatarStage
                ref={canvasRef}
                state={avatarState}
                avatarStyle={avatarStyle}
                imageSrc={imagePreview ?? undefined}
                className="rounded-[32px] shadow-[0_30px_60px_rgba(15,23,42,0.55)]"
              />

              <div className="flex w-full flex-wrap items-center justify-between gap-4 pt-4">
                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  <span className="status-dot" style={{ background: computedStatusColor }} />
                  <div>
                    <strong style={{ display: "block", fontSize: "16px" }}>{status}</strong>
                    <span style={{ color: "var(--muted)", fontSize: "13px" }}>
                      Sync accuracy&nbsp;{round(avatarState.audioLevel * 100, 0)}% · Progress {progress}%
                    </span>
                  </div>
                </div>
                <div style={{ display: "flex", gap: "10px" }}>
                  <button className="button-outline" onClick={handleExport}>
                    Export MP4
                  </button>
                  <button className="button-outline" onClick={handleGenerate}>
                    Regenerate
                  </button>
                </div>
              </div>
            </div>

            <div className="metrics-grid">
              <div className="metric-card">
                <span>Emotion</span>
                <strong>{emotion.toUpperCase()}</strong>
              </div>
              <div className="metric-card">
                <span>Mode</span>
                <strong>{mode === "text" ? "Text" : "Audio"}</strong>
              </div>
              <div className="metric-card">
                <span>Preview</span>
                <strong>{isPreviewing ? "Active" : "Standby"}</strong>
              </div>
              <div className="metric-card">
                <span>Avatar</span>
                <strong>{avatarStyle.label}</strong>
              </div>
            </div>
          </section>

          <aside className="col-span-12 flex flex-col gap-7 lg:col-span-5">
            <section className="card flex flex-col gap-6 p-7">
              <header className="flex items-center justify-between">
                <div>
                  <h3 style={{ fontSize: "20px", fontWeight: 600 }}>Input Controller</h3>
                  <p style={{ color: "var(--muted)", marginTop: 4 }}>
                    Switch between text narration or audio upload. Text mode uses speech synthesis, audio mode performs direct lip-sync.
                  </p>
                </div>
                <div
                  style={{
                    display: "inline-flex",
                    padding: "8px 14px",
                    borderRadius: 999,
                    background: "rgba(96,165,250,0.12)",
                    fontSize: "13px",
                  }}
                >
                  {mode === "text" ? "Text-to-Speech" : "Audio-to-Speech"}
                </div>
              </header>

              <div className="flex gap-2 rounded-2xl bg-[rgba(15,23,42,0.85)] p-1">
                <button
                  className={clsx("flex-1 rounded-2xl px-4 py-3 text-sm font-semibold transition", {
                    "bg-[rgba(96,165,250,0.16)] text-white": mode === "text",
                    "text-[rgba(226,232,240,0.65)]": mode !== "text",
                  })}
                  onClick={() => setMode("text")}
                >
                  Text Script
                </button>
                <button
                  className={clsx("flex-1 rounded-2xl px-4 py-3 text-sm font-semibold transition", {
                    "bg-[rgba(96,165,250,0.16)] text-white": mode === "audio",
                    "text-[rgba(226,232,240,0.65)]": mode !== "audio",
                  })}
                  onClick={() => setMode("audio")}
                >
                  Audio Upload
                </button>
              </div>

              {mode === "text" ? (
                <div className="flex flex-col gap-4">
                  <label className="flex flex-col gap-3 text-sm text-[rgba(148,163,184,0.9)]">
                    Speech Script
                    <textarea
                      value={script}
                      onChange={(event) => setScript(event.target.value)}
                      rows={5}
                      placeholder="Type a narration or paste your script"
                      className="rounded-2xl border border-[rgba(148,163,184,0.18)] bg-[rgba(2,6,23,0.75)] px-4 py-3 text-base text-white outline-none transition focus:border-[rgba(96,165,250,0.5)]"
                    />
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="flex flex-col gap-2 text-sm text-[rgba(148,163,184,0.9)]">
                      Voice Model
                      <select
                        value={voiceName ?? ""}
                        onChange={(event) => setVoiceName(event.target.value)}
                        className="rounded-xl border border-[rgba(148,163,184,0.18)] bg-[rgba(2,6,23,0.75)] px-3 py-3 text-sm text-white outline-none focus:border-[rgba(96,165,250,0.5)]"
                      >
                        {availableVoices.map((voice) => (
                          <option key={voice.name} value={voice.name}>
                            {voice.name.replace(/\(.*\)/g, "").trim()} · {voice.lang}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="flex gap-3">
                      <label className="flex flex-1 flex-col gap-2 text-sm text-[rgba(148,163,184,0.9)]">
                        Rate
                        <input
                          type="range"
                          min="0.6"
                          max="1.4"
                          step="0.05"
                          value={speechRate}
                          onChange={(event) => setSpeechRate(parseFloat(event.target.value))}
                        />
                        <span style={{ fontSize: "12px", color: "var(--muted)" }}>{speechRate.toFixed(2)}x</span>
                      </label>
                      <label className="flex flex-1 flex-col gap-2 text-sm text-[rgba(148,163,184,0.9)]">
                        Pitch
                        <input
                          type="range"
                          min="0.6"
                          max="1.6"
                          step="0.05"
                          value={speechPitch}
                          onChange={(event) => setSpeechPitch(parseFloat(event.target.value))}
                        />
                        <span style={{ fontSize: "12px", color: "var(--muted)" }}>{speechPitch.toFixed(2)}</span>
                      </label>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  <label className="flex flex-col gap-3 text-sm text-[rgba(148,163,184,0.9)]">
                    Upload Audio (MP3 / WAV / M4A)
                    <input
                      type="file"
                      accept="audio/*"
                      onChange={handleFileUpload}
                      className="rounded-2xl border border-dashed border-[rgba(96,165,250,0.4)] bg-[rgba(2,6,23,0.6)] px-4 py-4 text-sm text-white"
                    />
                  </label>
                  {audioFileName ? (
                    <div className="rounded-2xl border border-[rgba(96,165,250,0.2)] bg-[rgba(15,23,42,0.6)] px-4 py-3 text-sm">
                      <strong>{audioFileName}</strong>
                      <p style={{ color: "var(--muted)", marginTop: 4 }}>
                        Ready for lip-sync preview. Click “Generate & Preview” to animate.
                      </p>
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-[rgba(148,163,184,0.2)] bg-[rgba(15,23,42,0.45)] px-4 py-3 text-sm text-[rgba(148,163,184,0.9)]">
                      No file selected yet.
                    </div>
                  )}
                </div>
              )}

              <div className="flex flex-col gap-3">
                <span className="text-sm font-semibold tracking-wide text-[rgba(148,163,184,0.9)]">
                  Emotional Direction
                </span>
                <div className="grid grid-cols-2 gap-2">
                  {emotions.map((item) => (
                    <button
                      key={item.id}
                      className={clsx(
                        "rounded-2xl border px-4 py-3 text-left transition",
                        emotion === item.id
                          ? "border-[rgba(96,165,250,0.6)] bg-[rgba(37,99,235,0.16)] text-white"
                          : "border-[rgba(148,163,184,0.18)] bg-[rgba(2,6,23,0.6)] text-[rgba(148,163,184,0.92)]",
                      )}
                      onClick={() => setEmotion(item.id)}
                    >
                      <strong className="block text-sm">{item.label}</strong>
                      <span className="text-xs text-[rgba(148,163,184,0.75)]">{item.tone}</span>
                    </button>
                  ))}
                </div>
              </div>
            </section>

            <section className="card flex flex-col gap-6 p-7">
              <header className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h3 style={{ fontSize: "20px", fontWeight: 600 }}>Avatar Deck</h3>
                  <p style={{ color: "var(--muted)", marginTop: 4 }}>
                    Upload any portrait or switch to high-fidelity 3D-inspired personas instantly.
                  </p>
                </div>
                <label className="button-outline">
                  Upload Portrait
                  <input type="file" accept="image/*" onChange={handleImageUpload} hidden />
                </label>
              </header>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {avatarStyles.map((avatar) => (
                  <button
                    key={avatar.id}
                    onClick={() => {
                      setSelectedAvatarId(avatar.id);
                      setImagePreview(null);
                    }}
                    className={clsx(
                      "relative flex h-28 w-full flex-col gap-2 overflow-hidden rounded-2xl border p-4 text-left transition",
                      selectedAvatarId === avatar.id && !imagePreview
                        ? "border-[rgba(96,165,250,0.5)] shadow-[0_12px_40px_rgba(37,99,235,0.32)]"
                        : "border-[rgba(148,163,184,0.15)] bg-[rgba(2,6,23,0.65)]",
                    )}
                    style={{ background: avatar.background }}
                  >
                    <span className="text-sm font-semibold text-white">{avatar.label}</span>
                    <span className="text-xs text-[rgba(226,232,240,0.7)]">{avatar.description}</span>
                    <span
                      className="absolute right-3 top-3 h-10 w-10 rounded-full border border-[rgba(255,255,255,0.35)]"
                      style={{ background: avatar.accent }}
                    />
                  </button>
                ))}
              </div>

              {imagePreview && (
                <div className="flex items-center gap-4 rounded-2xl border border-[rgba(96,165,250,0.2)] bg-[rgba(15,23,42,0.65)] p-4">
                  <Image
                    src={imagePreview}
                    alt="Uploaded portrait"
                    width={64}
                    height={64}
                    className="h-16 w-16 rounded-2xl object-cover"
                    unoptimized
                  />
                  <div>
                    <strong className="text-sm">Custom Portrait</strong>
                    <p className="text-xs text-[rgba(148,163,184,0.8)]">
                      Using uploaded image. Select a preset to switch back to procedural avatar.
                    </p>
                  </div>
                </div>
              )}
            </section>
          </aside>
        </div>
      </div>

      <audio ref={audioElementRef} src={audioUrl ?? undefined} preload="auto" hidden />
    </main>
  );
}

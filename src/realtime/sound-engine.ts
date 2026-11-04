"use client";

const SOUND_PREF_STORAGE_KEY = "pf:sound-enabled:v1";

type AudioContextConstructor = typeof AudioContext;

interface WindowWithWebkitAudio extends Window {
  webkitAudioContext?: AudioContextConstructor;
}

export interface PlayAlertOptions {
  /** Si es `true`, reproduce el sonido incluso si la preferencia está silenciada (ej. botón "Probar sonido") */
  force?: boolean;
  /** Activa vibración háptica complementaria en dispositivos móviles compatibles (por defecto `true`) */
  vibrate?: boolean;
}

interface ToneStep {
  frequencyHz: number;
  startOffsetSec: number;
  durationSec: number;
  gainPeak: number;
  type: OscillatorType;
}

let sharedAudioContext: AudioContext | null = null;
let audioUnlocked = false;
let fallbackSoundEnabled = true;
let autoUnlockCleanup: (() => void) | null = null;

const stateListeners = new Set<() => void>();

function emitSoundStateChange(): void {
  for (const listener of stateListeners) {
    listener();
  }
}

function getAudioContextConstructor(): AudioContextConstructor | null {
  if (typeof window === "undefined") return null;
  if (typeof window.AudioContext === "function") {
    return window.AudioContext;
  }
  const maybeWebkit = (window as WindowWithWebkitAudio).webkitAudioContext;
  return typeof maybeWebkit === "function" ? maybeWebkit : null;
}

function getOrCreateAudioContext(): AudioContext | null {
  if (sharedAudioContext && sharedAudioContext.state !== "closed") {
    return sharedAudioContext;
  }
  const Ctor = getAudioContextConstructor();
  if (!Ctor) return null;

  try {
    sharedAudioContext = new Ctor();
    sharedAudioContext.addEventListener("statechange", () => {
      const running = sharedAudioContext?.state === "running";
      if (running !== audioUnlocked) {
        audioUnlocked = running;
        emitSoundStateChange();
      }
    });
    return sharedAudioContext;
  } catch {
    return null;
  }
}

/**
 * Consulta si las alertas sonoras están habilitadas para este dispositivo.
 */
export function isSoundEnabled(defaultEnabled = true): boolean {
  if (typeof window === "undefined") return defaultEnabled;
  try {
    const raw = window.localStorage.getItem(SOUND_PREF_STORAGE_KEY);
    if (raw === "true") return true;
    if (raw === "false") return false;
  } catch {
    return fallbackSoundEnabled;
  }
  return defaultEnabled;
}

/**
 * Inicializa el valor por defecto de sonido únicamente si el operador aún no guardó preferencia propia.
 */
export function initializeSoundPreference(defaultEnabled: boolean): void {
  fallbackSoundEnabled = defaultEnabled;
  if (typeof window === "undefined") return;
  try {
    const existing = window.localStorage.getItem(SOUND_PREF_STORAGE_KEY);
    if (existing === null) {
      window.localStorage.setItem(
        SOUND_PREF_STORAGE_KEY,
        defaultEnabled ? "true" : "false"
      );
      emitSoundStateChange();
    }
  } catch {
    // Fallback en memoria ya actualizado
  }
}

/**
 * Activa o silencia las alertas sonoras persistiendo la preferencia en `localStorage`.
 */
export function setSoundEnabled(enabled: boolean): void {
  fallbackSoundEnabled = enabled;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(
        SOUND_PREF_STORAGE_KEY,
        enabled ? "true" : "false"
      );
    } catch {
      // Continúa con preferencia en memoria
    }
  }
  emitSoundStateChange();
}

/**
 * Alterna el estado de silencio/sonido activo. Si pasa a activo, intenta desbloquear el contexto de audio.
 */
export function toggleSoundEnabled(): boolean {
  const next = !isSoundEnabled(fallbackSoundEnabled);
  setSoundEnabled(next);
  if (next) {
    void unlockAudioContext();
  }
  return next;
}

/**
 * Indica si el pipeline de Web Audio API ya fue desbloqueado tras interacción del usuario.
 */
export function isAudioUnlocked(): boolean {
  if (sharedAudioContext?.state === "running") {
    audioUnlocked = true;
  }
  return audioUnlocked;
}

/**
 * Suscribe un listener a cambios de preferencia de sonido o estado de desbloqueo del navegador.
 */
export function subscribeSoundState(listener: () => void): () => void {
  stateListeners.add(listener);

  const onStorage = (event: StorageEvent) => {
    if (event.key === SOUND_PREF_STORAGE_KEY) {
      emitSoundStateChange();
    }
  };

  if (typeof window !== "undefined") {
    window.addEventListener("storage", onStorage);
  }

  return () => {
    stateListeners.delete(listener);
    if (typeof window !== "undefined") {
      window.removeEventListener("storage", onStorage);
    }
  };
}

/**
 * Desbloquea el `AudioContext` reproduciendo un pulso inaudible de 10 ms.
 * Compatible con las políticas de autoplay de iOS Safari y Android Chrome.
 */
export async function unlockAudioContext(): Promise<boolean> {
  const ctx = getOrCreateAudioContext();
  if (!ctx) return false;

  try {
    if (ctx.state === "suspended") {
      await ctx.resume();
    }

    // Pulso cuasi-silencioso para destrabar el canal de salida en WebKit móvil
    const now = ctx.currentTime;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.01);

    audioUnlocked = ctx.state === "running";
    emitSoundStateChange();
    return audioUnlocked;
  } catch {
    return false;
  }
}

/**
 * Registra listeners pasivos globales para desbloquear automáticamente el motor de audio
 * en el primer toque, click o pulsación de tecla del personal del restaurante.
 */
export function installAudioAutoUnlock(): () => void {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return () => {};
  }
  if (autoUnlockCleanup) {
    return autoUnlockCleanup;
  }

  const interactionEvents = ["pointerdown", "touchend", "click", "keydown"] as const;

  const removeInteractionListeners = () => {
    for (const evt of interactionEvents) {
      window.removeEventListener(evt, handleFirstInteraction, true);
    }
  };

  const handleFirstInteraction = () => {
    void unlockAudioContext().then((unlocked) => {
      if (unlocked) {
        removeInteractionListeners();
      }
    });
  };

  const handleVisibilityChange = () => {
    if (
      document.visibilityState === "visible" &&
      sharedAudioContext &&
      sharedAudioContext.state === "suspended" &&
      audioUnlocked
    ) {
      void sharedAudioContext.resume().catch(() => {
        audioUnlocked = false;
        emitSoundStateChange();
      });
    }
  };

  for (const evt of interactionEvents) {
    window.addEventListener(evt, handleFirstInteraction, {
      capture: true,
      passive: true,
    });
  }
  document.addEventListener("visibilitychange", handleVisibilityChange);

  autoUnlockCleanup = () => {
    removeInteractionListeners();
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    autoUnlockCleanup = null;
  };

  return autoUnlockCleanup;
}

function triggerHaptic(pattern: number | number[]): void {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") {
    return;
  }
  try {
    navigator.vibrate(pattern);
  } catch {
    // Ignorado en navegadores sin permiso o soporte de vibración (ej. iOS Safari)
  }
}

async function playToneSequence(
  steps: readonly ToneStep[],
  options?: PlayAlertOptions
): Promise<boolean> {
  if (!options?.force && !isSoundEnabled(fallbackSoundEnabled)) {
    return false;
  }

  const ctx = getOrCreateAudioContext();
  if (!ctx) return false;

  try {
    if (ctx.state === "suspended") {
      await ctx.resume();
    }
    if (ctx.state !== "running") {
      audioUnlocked = false;
      emitSoundStateChange();
      return false;
    }

    audioUnlocked = true;
    const baseTime = ctx.currentTime + 0.01;
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.setValueAtTime(-16, baseTime);
    compressor.ratio.setValueAtTime(6, baseTime);
    compressor.connect(ctx.destination);

    for (const step of steps) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const startAt = baseTime + step.startOffsetSec;
      const stopAt = startAt + step.durationSec;

      osc.type = step.type;
      osc.frequency.setValueAtTime(step.frequencyHz, startAt);

      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.linearRampToValueAtTime(step.gainPeak, startAt + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, stopAt);

      osc.connect(gain);
      gain.connect(compressor);

      osc.start(startAt);
      osc.stop(stopAt + 0.01);
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Alerta acústica de **Nueva Comanda** para Cocina (KDS):
 * Doble campana de pase de alta claridad (`A5 -> E6` × 2) diseñada para cortar ruido ambiente de cocina.
 */
export async function playNewComandaAlert(
  options?: PlayAlertOptions
): Promise<boolean> {
  if (options?.vibrate !== false && (options?.force || isSoundEnabled(fallbackSoundEnabled))) {
    triggerHaptic([90, 60, 90]);
  }

  return playToneSequence(
    [
      {
        frequencyHz: 880,
        startOffsetSec: 0,
        durationSec: 0.14,
        gainPeak: 0.28,
        type: "triangle",
      },
      {
        frequencyHz: 1318.51,
        startOffsetSec: 0.11,
        durationSec: 0.26,
        gainPeak: 0.32,
        type: "sine",
      },
      {
        frequencyHz: 880,
        startOffsetSec: 0.42,
        durationSec: 0.14,
        gainPeak: 0.28,
        type: "triangle",
      },
      {
        frequencyHz: 1318.51,
        startOffsetSec: 0.53,
        durationSec: 0.32,
        gainPeak: 0.34,
        type: "sine",
      },
    ],
    options
  );
}

/**
 * Alerta acústica de **Comanda Lista** para el Mozo:
 * Arpegio mayor ascendente brillante (`D5 -> G5 -> B5 -> D6`) acompañado de vibración háptica en el móvil.
 */
export async function playComandaReadyAlert(
  options?: PlayAlertOptions
): Promise<boolean> {
  if (options?.vibrate !== false && (options?.force || isSoundEnabled(fallbackSoundEnabled))) {
    triggerHaptic([150, 70, 190]);
  }

  return playToneSequence(
    [
      {
        frequencyHz: 587.33,
        startOffsetSec: 0,
        durationSec: 0.11,
        gainPeak: 0.24,
        type: "triangle",
      },
      {
        frequencyHz: 783.99,
        startOffsetSec: 0.09,
        durationSec: 0.11,
        gainPeak: 0.26,
        type: "triangle",
      },
      {
        frequencyHz: 987.77,
        startOffsetSec: 0.18,
        durationSec: 0.12,
        gainPeak: 0.28,
        type: "sine",
      },
      {
        frequencyHz: 1174.66,
        startOffsetSec: 0.28,
        durationSec: 0.34,
        gainPeak: 0.34,
        type: "sine",
      },
    ],
    options
  );
}

/**
 * Alerta acústica suave para Caja cuando una mesa solicita cierre de cuenta (`pendiente_cobro`).
 */
export async function playBillRequestedAlert(
  options?: PlayAlertOptions
): Promise<boolean> {
  return playToneSequence(
    [
      {
        frequencyHz: 783.99,
        startOffsetSec: 0,
        durationSec: 0.14,
        gainPeak: 0.2,
        type: "sine",
      },
      {
        frequencyHz: 1046.5,
        startOffsetSec: 0.13,
        durationSec: 0.24,
        gainPeak: 0.24,
        type: "sine",
      },
    ],
    options
  );
}

'use client';

/**
 * Mic button that toggles a streaming-STT session.
 *
 * Click → opens a WebSocket to the engine, requests the mic, and pipes
 * 16 kHz int16 PCM frames upstream while transcript events come back.
 * Click again (or click outside the host page) → cleanly tears down the
 * audio graph and the socket.
 *
 * The parent (PromptInput) decides what to do with each transcript:
 *   - `onPartialTranscript` fires every ~400-500 ms while the user speaks
 *     and is meant to be rendered as ephemeral / "ghost" text.
 *   - `onFinalTranscript` fires once silence has been detected and the
 *     text is committed — append to the textarea contents here.
 *
 * The visual: a circular mic chip that matches the existing prompt-bar
 * design language. When recording, it pulses on the accent color and a
 * mini bar-meter animates from the live RMS level. No external icons.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Mic, MicOff } from 'lucide-react';

import { createMicStream, type MicStreamHandle, type MicStreamState } from '@/lib/audio/streamMic';

export interface VoiceButtonProps {
  /** Called on every partial transcript (text may change). */
  onPartialTranscript?: (text: string) => void;
  /** Called once a final segment is committed (text will not change). */
  onFinalTranscript?: (text: string) => void;
  /** Disable the button (e.g. while the user is submitting a prompt). */
  disabled?: boolean;
  /** Override the WS URL (defaults to NEXT_PUBLIC_STT_WS_URL or localhost). */
  wsUrl?: string;
}

const BAR_COUNT = 5;

export default function VoiceButton({
  onPartialTranscript,
  onFinalTranscript,
  disabled = false,
  wsUrl,
}: VoiceButtonProps) {
  const [state, setState] = useState<MicStreamState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState(0);
  const handleRef = useRef<MicStreamHandle | null>(null);
  const recording = state === 'recording';
  const busy = state === 'connecting' || state === 'stopping';

  // Build a stable handle once per mount. The callbacks close over the
  // current refs so we don't need to recreate the stream on every prop change.
  const partialCb = useRef(onPartialTranscript);
  const finalCb = useRef(onFinalTranscript);
  partialCb.current = onPartialTranscript;
  finalCb.current = onFinalTranscript;

  useEffect(() => {
    handleRef.current = createMicStream(
      {
        onPartial: (text) => partialCb.current?.(text),
        onFinal: (text) => finalCb.current?.(text),
        onLevel: (rms) => setLevel(rms),
        onStateChange: (s) => setState(s),
        onError: (err) => setError(err.message),
      },
      { wsUrl },
    );
    return () => {
      void handleRef.current?.stop();
      handleRef.current = null;
    };
  }, [wsUrl]);

  const toggle = useCallback(async () => {
    if (disabled || busy) return;
    setError(null);
    try {
      if (recording) {
        await handleRef.current?.stop();
      } else {
        await handleRef.current?.start();
      }
    } catch (err) {
      // The stream already surfaced the error via onError; just stop here
      // so the disabled state doesn't get stuck.
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    }
  }, [busy, disabled, recording]);

  const Icon = recording ? MicOff : Mic;
  // Normalise RMS for the bar meter: typical voice RMS sits around 0.05-0.15.
  const normalised = Math.min(1, level * 6);

  return (
    <div className="relative inline-flex items-center gap-2">
      <button
        type="button"
        onClick={toggle}
        disabled={disabled || busy}
        aria-label={recording ? 'Stop voice input' : 'Start voice input'}
        aria-pressed={recording}
        title={
          error
            ? `Voice error: ${error}`
            : recording
              ? 'Recording — click to stop'
              : 'Click to speak your prompt'
        }
        data-testid="voice-button"
        data-state={state}
        className={
          'relative inline-flex h-8 w-8 items-center justify-center rounded-full border transition ' +
          (recording
            ? 'border-accent-400 bg-accent-50 text-accent-700 shadow-glow animate-pulse'
            : busy
              ? 'cursor-wait border-border-light bg-bg-secondary text-text-tertiary'
              : 'border-border-light bg-bg-secondary text-text-secondary hover:border-accent-300 hover:text-accent-600') +
          (disabled || busy ? ' cursor-not-allowed opacity-60' : ' cursor-pointer')
        }
      >
        <Icon className="h-4 w-4" />
        {recording && (
          <span
            className="pointer-events-none absolute -inset-1 rounded-full ring-2 ring-accent-300/40"
            aria-hidden="true"
          />
        )}
      </button>

      {recording && (
        <div
          className="flex h-6 items-end gap-0.5"
          aria-hidden="true"
          data-testid="voice-meter"
        >
          {Array.from({ length: BAR_COUNT }).map((_, i) => {
            // Each bar reacts to a different slice of the level, giving a
            // simple multi-band illusion without computing a real FFT.
            const phase = (i / (BAR_COUNT - 1)) * Math.PI;
            const bias = 0.4 + 0.6 * Math.sin(phase + Date.now() * 0.005);
            const h = Math.max(2, Math.round(normalised * bias * 22));
            return (
              <span
                key={i}
                style={{ height: `${h}px` }}
                className="w-0.5 rounded-sm bg-accent-500 transition-[height] duration-75"
              />
            );
          })}
        </div>
      )}

      {error && !recording && (
        <span
          role="status"
          className="text-2xs text-secondary-600"
          data-testid="voice-error"
        >
          {error}
        </span>
      )}
    </div>
  );
}

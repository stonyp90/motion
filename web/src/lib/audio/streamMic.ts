// Mic capture lifecycle.
//
// Connects to the engine's `/v1/stt/stream` WebSocket, opens the browser's
// microphone, registers the `mf-stt-resampler` worklet, and streams int16
// PCM frames over the socket. Transcript events come back as JSON text
// frames and are surfaced via the user-provided callbacks.
//
// Lifecycle is captured in the `{ start, stop, getState }` handle returned
// from `createMicStream(...)`. Repeated `start()` calls are no-ops while
// the previous session is still open; `stop()` is idempotent.

import {
  AUDIO_FRAME_SAMPLES,
  AUDIO_TARGET_RATE,
  AUDIO_WORKLET_PROCESSOR_NAME,
  audioWorkletSource,
} from './AudioWorklet';

/**
 * Transcript event from the server. Mirrors `motion_forge_stt::TranscriptEvent`
 * (engine/crates/stt/src/lib.rs) — keep field names in sync.
 */
export type TranscriptEventType = 'partial' | 'final';
export interface TranscriptEvent {
  type: TranscriptEventType;
  text: string;
  t_ms: number;
}

/** Callback API consumed by the React component. */
export interface MicStreamCallbacks {
  onPartial?: (text: string, event: TranscriptEvent) => void;
  onFinal?: (text: string, event: TranscriptEvent) => void;
  onError?: (error: Error) => void;
  /** Called whenever the recording state changes (idle → recording → idle). */
  onStateChange?: (state: MicStreamState) => void;
  /**
   * Receive amplitude updates (0..1 RMS over the last frame) so the UI can
   * render a live waveform / pulse without re-tapping the audio graph.
   */
  onLevel?: (rms: number) => void;
}

export type MicStreamState = 'idle' | 'connecting' | 'recording' | 'stopping' | 'error';

export interface MicStreamHandle {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  getState: () => MicStreamState;
}

/**
 * Resolve the engine WebSocket URL. Honours, in priority order:
 *   1. an explicit `wsUrl` argument
 *   2. NEXT_PUBLIC_STT_WS_URL (build-time env)
 *   3. NEXT_PUBLIC_API_BASE swapped to ws(s):// scheme
 *   4. `ws://${window.location.hostname}:7755/v1/stt/stream` for local dev
 */
export function resolveSttWsUrl(explicit?: string): string {
  if (explicit) return explicit;
  // Process env may be statically inlined by Next at build time.
  const envWs = process.env.NEXT_PUBLIC_STT_WS_URL;
  if (envWs) return envWs;
  const apiBase = process.env.NEXT_PUBLIC_API_BASE;
  if (apiBase) {
    const url = new URL(apiBase);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.pathname = '/v1/stt/stream';
    return url.toString();
  }
  if (typeof window === 'undefined') {
    // Used during SSR sanity-checks only — the start() call always runs in the browser.
    return 'ws://localhost:7755/v1/stt/stream';
  }
  return `ws://${window.location.hostname}:7755/v1/stt/stream`;
}

/** Build a handle. The microphone isn't opened until `start()` is called. */
export function createMicStream(
  callbacks: MicStreamCallbacks = {},
  options: { wsUrl?: string } = {},
): MicStreamHandle {
  let state: MicStreamState = 'idle';
  let socket: WebSocket | null = null;
  let audioContext: AudioContext | null = null;
  let mediaStream: MediaStream | null = null;
  let workletNode: AudioWorkletNode | null = null;
  let sourceNode: MediaStreamAudioSourceNode | null = null;
  let analyserNode: AnalyserNode | null = null;
  let levelRafId: number | null = null;
  let workletBlobUrl: string | null = null;

  function setState(next: MicStreamState) {
    if (state === next) return;
    state = next;
    callbacks.onStateChange?.(state);
  }

  function reportError(err: unknown) {
    const e = err instanceof Error ? err : new Error(String(err));
    setState('error');
    callbacks.onError?.(e);
  }

  async function start(): Promise<void> {
    if (state === 'recording' || state === 'connecting') return;
    setState('connecting');
    try {
      // 1. Open the WebSocket first so we surface auth/network errors
      //    before bothering the user with a microphone prompt.
      const wsUrl = resolveSttWsUrl(options.wsUrl);
      socket = await openSocket(wsUrl);
      socket.binaryType = 'arraybuffer';
      socket.addEventListener('message', handleMessage);
      socket.addEventListener('close', handleSocketClose);
      socket.addEventListener('error', () => reportError(new Error('websocket error')));

      // 2. Request the mic. The user agent throws on permission denial.
      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });

      // 3. Spin up the AudioContext and register the worklet.
      const AudioCtor: typeof AudioContext =
        // Safari prefix lingers in some build targets.
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ??
        window.AudioContext;
      audioContext = new AudioCtor();
      if (!workletBlobUrl) {
        const blob = new Blob([audioWorkletSource], { type: 'application/javascript' });
        workletBlobUrl = URL.createObjectURL(blob);
      }
      await audioContext.audioWorklet.addModule(workletBlobUrl);

      // 4. Wire up: mic → analyser (for level meter) → worklet (decimator)
      //    The worklet posts int16 frames back to the main thread.
      sourceNode = audioContext.createMediaStreamSource(mediaStream);
      analyserNode = audioContext.createAnalyser();
      analyserNode.fftSize = 256;
      analyserNode.smoothingTimeConstant = 0.6;
      workletNode = new AudioWorkletNode(audioContext, AUDIO_WORKLET_PROCESSOR_NAME, {
        numberOfInputs: 1,
        numberOfOutputs: 0,
        channelCount: 1,
        channelCountMode: 'explicit',
        channelInterpretation: 'speakers',
      });
      workletNode.port.onmessage = (ev: MessageEvent) => {
        const data = ev.data as ArrayBuffer;
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.send(data);
        }
      };

      sourceNode.connect(analyserNode);
      analyserNode.connect(workletNode);

      startLevelMeter();
      setState('recording');
    } catch (err) {
      await cleanup();
      reportError(err);
      throw err;
    }
  }

  async function stop(): Promise<void> {
    if (state === 'idle' || state === 'stopping') return;
    setState('stopping');
    await cleanup();
    setState('idle');
  }

  function getState(): MicStreamState {
    return state;
  }

  function handleMessage(ev: MessageEvent) {
    if (typeof ev.data !== 'string') return;
    try {
      const payload = JSON.parse(ev.data) as TranscriptEvent | { type: 'error'; error?: string };
      if (payload.type === 'error') {
        reportError(new Error((payload as { error?: string }).error ?? 'stt server error'));
        return;
      }
      const event = payload as TranscriptEvent;
      if (event.type === 'partial') {
        callbacks.onPartial?.(event.text, event);
      } else if (event.type === 'final') {
        callbacks.onFinal?.(event.text, event);
      }
    } catch (err) {
      // Server should only send JSON; non-JSON text is treated as a soft warning.
      console.warn('stt: unparseable server message', err);
    }
  }

  function handleSocketClose() {
    if (state === 'recording' || state === 'connecting') {
      // Server hung up unexpectedly.
      void cleanup().then(() => setState('idle'));
    }
  }

  function startLevelMeter() {
    if (!analyserNode || !callbacks.onLevel) return;
    const analyser = analyserNode;
    const buffer = new Float32Array(analyser.fftSize);
    const tick = () => {
      if (!analyserNode || state !== 'recording') return;
      analyser.getFloatTimeDomainData(buffer);
      let sumSq = 0;
      for (let i = 0; i < buffer.length; i++) {
        sumSq += buffer[i] * buffer[i];
      }
      const rms = Math.sqrt(sumSq / buffer.length);
      callbacks.onLevel!(rms);
      levelRafId = requestAnimationFrame(tick);
    };
    levelRafId = requestAnimationFrame(tick);
  }

  async function cleanup(): Promise<void> {
    if (levelRafId !== null) {
      cancelAnimationFrame(levelRafId);
      levelRafId = null;
    }
    if (workletNode) {
      try {
        workletNode.port.onmessage = null;
        workletNode.disconnect();
      } catch {
        /* ignored */
      }
      workletNode = null;
    }
    if (analyserNode) {
      try {
        analyserNode.disconnect();
      } catch {
        /* ignored */
      }
      analyserNode = null;
    }
    if (sourceNode) {
      try {
        sourceNode.disconnect();
      } catch {
        /* ignored */
      }
      sourceNode = null;
    }
    if (mediaStream) {
      for (const track of mediaStream.getTracks()) {
        try {
          track.stop();
        } catch {
          /* ignored */
        }
      }
      mediaStream = null;
    }
    if (audioContext && audioContext.state !== 'closed') {
      try {
        await audioContext.close();
      } catch {
        /* ignored */
      }
    }
    audioContext = null;
    if (socket) {
      try {
        if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
          socket.close(1000, 'client stop');
        }
      } catch {
        /* ignored */
      }
      socket = null;
    }
    if (workletBlobUrl) {
      URL.revokeObjectURL(workletBlobUrl);
      workletBlobUrl = null;
    }
  }

  return { start, stop, getState };
}

function openSocket(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      reject(err);
      return;
    }
    const onOpen = () => {
      ws.removeEventListener('open', onOpen);
      ws.removeEventListener('error', onError);
      resolve(ws);
    };
    const onError = () => {
      ws.removeEventListener('open', onOpen);
      ws.removeEventListener('error', onError);
      reject(new Error(`failed to open WebSocket: ${url}`));
    };
    ws.addEventListener('open', onOpen);
    ws.addEventListener('error', onError);
  });
}

/** Re-export for tests / debugging. */
export const __internal = {
  AUDIO_FRAME_SAMPLES,
  AUDIO_TARGET_RATE,
  AUDIO_WORKLET_PROCESSOR_NAME,
};

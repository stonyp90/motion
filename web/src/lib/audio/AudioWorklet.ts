// Audio worklet: pulls Float32 mic samples at the device sample rate
// (usually 48 kHz), downsamples to 16 kHz mono with a 15-line polyphase
// FIR low-pass, converts to int16, and ships out frames of exactly
// 512 samples (= 32 ms @ 16 kHz). The main thread forwards the frames
// to the WebSocket as-is.
//
// IMPORTANT: this file is compiled as a *string* and registered with
// `audioWorklet.addModule(URL.createObjectURL(new Blob([src])))`. It runs
// in a separate global scope without DOM APIs — keep it dependency-free.
//
// Registered processor name: 'mf-stt-resampler'.

declare const sampleRate: number;
declare const registerProcessor: (
  name: string,
  ctor: new (options?: AudioWorkletNodeOptions) => AudioWorkletProcessor,
) => void;

declare class AudioWorkletProcessor {
  constructor(options?: AudioWorkletNodeOptions);
  readonly port: MessagePort;
  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean;
}

const TARGET_RATE = 16_000;
const FRAME_SAMPLES = 512;

// Designed 15-tap windowed-sinc low-pass at cutoff = 0.4 * target_rate
// (~6.4 kHz). Calibrated for a 3:1 decimation (48 → 16 kHz); also acceptable
// for 44.1 → 16 kHz at the cost of mild aliasing in the top voice band.
const FIR_COEFFS: number[] = [
  -0.000893,
  -0.005397,
  -0.013413,
  -0.018478,
  -0.001488,
  0.05215,
  0.13073,
  0.20013,
  0.22831,
  0.20013,
  0.13073,
  0.05215,
  -0.001488,
  -0.018478,
  -0.013413,
];

export const audioWorkletSource = /* javascript */ `
const TARGET_RATE = ${TARGET_RATE};
const FRAME_SAMPLES = ${FRAME_SAMPLES};
const FIR = ${JSON.stringify(FIR_COEFFS)};

class MfSttResampler extends AudioWorkletProcessor {
  constructor() {
    super();
    // Use a fractional accumulator so we can handle non-integer ratios
    // (e.g. 44.1 → 16 kHz produces 2.75625 input samples per output sample).
    this.ratio = sampleRate / TARGET_RATE;
    this.pos = 0;
    // Sliding window for the FIR filter.
    this.firBuf = new Float32Array(FIR.length);
    this.firIdx = 0;
    // Output frame buffer (int16). We send a new frame every FRAME_SAMPLES.
    this.frame = new Int16Array(FRAME_SAMPLES);
    this.frameIdx = 0;
  }

  process(inputs) {
    const channels = inputs[0];
    if (!channels || channels.length === 0) {
      return true;
    }
    // Down-mix to mono.
    const ch0 = channels[0];
    const ch1 = channels.length > 1 ? channels[1] : null;
    const n = ch0.length;
    for (let i = 0; i < n; i++) {
      const sample = ch1 ? (ch0[i] + ch1[i]) * 0.5 : ch0[i];
      // FIR push.
      this.firBuf[this.firIdx] = sample;
      this.firIdx = (this.firIdx + 1) % FIR.length;
    }

    // Decimate using the accumulator. Each output sample uses the filter
    // value at the current sliding window.
    let inIdx = 0;
    while (inIdx < n) {
      // Advance until we've consumed (this.ratio - this.pos) input samples.
      const need = this.ratio - this.pos;
      const take = Math.min(need, n - inIdx);
      inIdx += take;
      this.pos += take;
      if (this.pos >= this.ratio - 1e-9) {
        // Emit one output sample by convolving the FIR window.
        let acc = 0;
        for (let k = 0; k < FIR.length; k++) {
          const idx = (this.firIdx + k) % FIR.length;
          acc += this.firBuf[idx] * FIR[k];
        }
        // Clamp + convert to int16.
        const clamped = Math.max(-1, Math.min(1, acc));
        this.frame[this.frameIdx++] = clamped < 0
          ? Math.round(clamped * 0x8000)
          : Math.round(clamped * 0x7fff);
        if (this.frameIdx === FRAME_SAMPLES) {
          // Transfer a copy so the underlying buffer can be reused.
          const out = new Int16Array(this.frame);
          this.port.postMessage(out.buffer, [out.buffer]);
          this.frameIdx = 0;
        }
        this.pos -= this.ratio;
      }
    }
    return true;
  }
}

registerProcessor('mf-stt-resampler', MfSttResampler);
`;

export const AUDIO_WORKLET_PROCESSOR_NAME = 'mf-stt-resampler';
export const AUDIO_FRAME_SAMPLES = FRAME_SAMPLES;
export const AUDIO_TARGET_RATE = TARGET_RATE;

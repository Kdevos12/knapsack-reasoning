// Success chime: short two-note triangle-wave arpeggio via WebAudio.
// No audio asset needed; generated at play time.
let ctx: AudioContext | null = null;

export function playSuccessChime() {
  try {
    ctx ??= new AudioContext();
    const t0 = ctx.currentTime;
    [659.25, 880].forEach((freq, i) => {
      const osc = ctx!.createOscillator();
      const gain = ctx!.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      const start = t0 + i * 0.12;
      gain.gain.setValueAtTime(0.001, start);
      gain.gain.exponentialRampToValueAtTime(0.18, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.5);
      osc.connect(gain).connect(ctx!.destination);
      osc.start(start);
      osc.stop(start + 0.55);
    });
  } catch {
    // Audio unavailable (autoplay policy, no device) — silently skip.
  }
}

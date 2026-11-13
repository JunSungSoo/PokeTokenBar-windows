/* Mac GIFDecoder.capFrameRate: keep the first frame of each duration bucket. */
(() => {
  function capFrameRate(durations, minimum) {
    const frames = [];
    let sum = 0;
    let first = 0;
    durations.forEach((duration, index) => {
      if (sum === 0) first = index;
      sum += duration < 0.02 ? 0.1 : duration;
      if (sum + 1e-9 >= minimum) { frames.push({ index: first, duration: sum }); sum = 0; }
    });
    if (sum > 0) {
      if (frames.length) frames[frames.length - 1].duration += sum;
      else frames.push({ index: first, duration: sum });
    }
    return frames;
  }
  function frameAt(frames, elapsed) {
    const total = frames.reduce((sum, frame) => sum + frame.duration, 0);
    if (!total) return undefined;
    let phase = ((elapsed % total) + total) % total;
    for (const frame of frames) { if (phase < frame.duration) return frame.index; phase -= frame.duration; }
    return frames.at(-1).index;
  }
  window.spriteTiming = { capFrameRate, frameAt, floors: { powerSaver: 0.4, balanced: 0.2, smooth: 0.1 } };
})();

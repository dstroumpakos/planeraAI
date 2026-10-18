// Pacing: the story is authored on a "story clock"; the film plays it back at a
// per-section speed, so dense moments get reading time without anything freezing.
// Shared by index.html (video) and music.js (cues), so picture and sound stay in sync.
(function (root) {
  // [story from, story to, playback speed]
  const SEGMENTS = [
    [0, 4.3, 0.78],      // hook on the app
    [4.3, 5.25, 0.85],   // into the dashboard
    [5.25, 8.25, 0.8],   // the form types itself
    [8.25, 9.5, 0.72],   // Unsplash picker
    [9.5, 10.9, 0.52],   // markets
    [10.9, 12.6, 0.6],   // CSV / API
    [12.6, 13.85, 0.5],  // approved
    [13.85, 18.0, 0.78], // live in the app, detail sheet
    [18.0, 21.25, 0.82], // the agency's own site
    [21.25, 24.75, 0.82],// reach stats
    [24.75, 29.5, 0.9],  // end card
  ];
  const STORY_END = 29.5;
  const starts = []; let acc = 0;
  for (const [a, b, s] of SEGMENTS) { starts.push(acc); acc += (b - a) / s; }
  const VIDEO_END = acc;
  function storyToVideo(st) {
    for (let i = 0; i < SEGMENTS.length; i++) {
      const [a, b, s] = SEGMENTS[i];
      if (st <= b || i === SEGMENTS.length - 1) return starts[i] + (Math.max(a, Math.min(st, b)) - a) / s + (st > b ? st - b : 0);
    }
    return st;
  }
  function videoToStory(vt) {
    for (let i = 0; i < SEGMENTS.length; i++) {
      const [a, b, s] = SEGMENTS[i];
      const v0 = starts[i], v1 = starts[i] + (b - a) / s;
      if (vt <= v1 || i === SEGMENTS.length - 1) return a + (Math.max(v0, vt) - v0) * s;
    }
    return vt;
  }
  const api = { SEGMENTS, STORY_END, VIDEO_END, storyToVideo, videoToStory };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.TIMEMAP = api;
})(this);

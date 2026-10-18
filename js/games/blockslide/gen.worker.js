// Module worker: generates fresh Block Slide puzzles for a timed test off the main thread.
// Messages in:  { type: 'start', setNo, seed, count }, { type: 'more', count }
// Messages out: { type: 'puzzle', k, puzzle } or { type: 'error', k, message }

import { generateFresh, freshSeed } from './stream.js';

let job = null;
let busy = false;

function pump() {
  if (busy || !job || job.wanted <= 0) return;
  busy = true;
  // One puzzle per macrotask so 'more' messages are seen between puzzles.
  setTimeout(() => {
    const k = job.k++;
    try {
      const puzzle = generateFresh(job.setNo, freshSeed(job.seed, k));
      job.wanted--;
      self.postMessage({ type: 'puzzle', k, puzzle });
    } catch (err) {
      self.postMessage({ type: 'error', k, message: err.message });
    }
    busy = false;
    pump();
  }, 0);
}

self.onmessage = (e) => {
  const msg = e.data || {};
  if (msg.type === 'start') job = { setNo: msg.setNo, seed: msg.seed, k: 0, wanted: msg.count ?? 3 };
  else if (msg.type === 'more' && job) job.wanted += msg.count ?? 1;
  pump();
};

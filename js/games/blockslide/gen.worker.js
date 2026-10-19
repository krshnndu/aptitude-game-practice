// Module worker: generates fresh Block Slide puzzles off the main thread.
// Messages in:  { type: 'start', setNo, seed, count, from }, { type: 'more', count },
//               { type: 'one', id, setNo, seed } (a single puzzle for a practice slot)
// Messages out: { type: 'puzzle', k, puzzle } or { type: 'error', k, message },
//               { type: 'one', id, puzzle } or { type: 'one', id, error }

import { generateFresh, freshSeed } from './stream.js';

let job = null;
let busy = false;
const singles = [];

function pump() {
  if (busy) return;
  if (!singles.length && (!job || job.wanted <= 0)) return;
  busy = true;
  // One puzzle per macrotask so new messages are seen between puzzles. Practice requests go first.
  setTimeout(() => {
    const one = singles.shift();
    if (one) {
      try {
        self.postMessage({ type: 'one', id: one.id, puzzle: generateFresh(one.setNo, one.seed) });
      } catch (err) {
        self.postMessage({ type: 'one', id: one.id, error: err.message });
      }
    } else {
      const k = job.k++;
      job.wanted--;
      try {
        self.postMessage({ type: 'puzzle', k, puzzle: generateFresh(job.setNo, freshSeed(job.seed, k)) });
      } catch (err) {
        self.postMessage({ type: 'error', k, message: err.message });
      }
    }
    busy = false;
    pump();
  }, 0);
}

self.onmessage = (e) => {
  const msg = e.data || {};
  if (msg.type === 'start') job = { setNo: msg.setNo, seed: msg.seed, k: msg.from ?? 0, wanted: msg.count ?? 3 };
  else if (msg.type === 'more' && job) job.wanted += msg.count ?? 1;
  else if (msg.type === 'one') singles.push({ id: msg.id, setNo: msg.setNo, seed: msg.seed });
  pump();
};

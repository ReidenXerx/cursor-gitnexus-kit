import { load } from './cache.js';

export function getCached(k) {
  return load(k);
}

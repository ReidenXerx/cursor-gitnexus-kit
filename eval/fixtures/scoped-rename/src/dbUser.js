import { load } from './db.js';

export function getRecord(i) {
  return load(i);
}

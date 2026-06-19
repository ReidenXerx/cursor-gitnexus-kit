import { parseConfig } from './config.js';

export function loadSettings(raw) {
  const cfg = parseConfig(raw);
  return cfg.name;
}

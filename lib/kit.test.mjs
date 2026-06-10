import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  listBundleFiles,
  substituteRepoName,
  PLACEHOLDER,
  BUNDLE_ROOT,
  GITIGNORE_MARKER,
} from './kit.mjs';

describe('cursor-gitnexus-kit', () => {
  it('bundle contains enforcement rule and hooks', () => {
    const files = listBundleFiles();
    assert.ok(
      files.some((f) => f.endsWith('00-gitnexus-enforcement.mdc')),
      `expected enforcement rule in bundle, got: ${files.filter((f) => f.includes('enforcement')).join(', ')}`
    );
    assert.ok(files.includes('.cursor/hooks.json'));
    assert.ok(files.includes('.cursor/hooks/lib/load-staleness.mjs'));
    assert.ok(fs.existsSync(BUNDLE_ROOT));
  });

  it('substituteRepoName replaces placeholder', () => {
    const out = substituteRepoName(`repo: "${PLACEHOLDER}"`, 'my-app');
    assert.equal(out, 'repo: "my-app"');
    assert.ok(!out.includes(PLACEHOLDER));
  });

  it('enforcement rule uses placeholder not hardcoded repo', () => {
    const bundleFiles = listBundleFiles();
    const rulePath = bundleFiles.find((f) => f.endsWith('00-gitnexus-enforcement.mdc'));
    const rule = fs.readFileSync(path.join(BUNDLE_ROOT, rulePath), 'utf8');
    assert.ok(rule.includes(PLACEHOLDER));
    assert.ok(!rule.includes('crypto-trading-bot'));
  });

  it('bundle includes docs required by gitnexus-setup.sh', () => {
    const files = listBundleFiles();
    assert.ok(files.includes('docs/GITNEXUS-TEAM-BUNDLE.md'));
    assert.ok(files.includes('docs/AGENT-PROFILES.stub.md'));
  });

  it('gitignore marker matches snippet header', () => {
    assert.ok(GITIGNORE_MARKER.includes('GitNexus + cursor-gitnexus-kit'));
  });
});

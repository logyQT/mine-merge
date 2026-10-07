#!/usr/bin/env node
// Size/file-count budget gate for Playables builds (PLAN.md §1.4).
//
//   node scripts/check-budget.mjs dist/yt
//
// Hard failures (exit 1):  > 8000 files, any file > 30 MiB, total > 250 MiB.
// Warnings:                 any file > 512 KiB, initial JS+CSS > 15 MiB.
//
// The pure part (checkBudget) is exported so vitest can pin the thresholds.

import { readdir, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

export const LIMITS = {
  maxFiles: 8000,
  maxFileBytes: 30 * 1024 * 1024, // 30 MiB
  maxTotalBytes: 250 * 1024 * 1024, // 250 MiB
  warnFileBytes: 512 * 1024, // 512 KiB
  warnInitialBytes: 15 * 1024 * 1024, // 15 MiB
};

const MiB = 1024 * 1024;

/**
 * @param {{ path: string, bytes: number }[]} files
 * @returns {{ ok: boolean, errors: string[], warnings: string[], totalBytes: number, initialBytes: number }}
 */
export function checkBudget(files, limits = LIMITS) {
  const errors = [];
  const warnings = [];

  if (files.length > limits.maxFiles) {
    errors.push(`${files.length} files > ${limits.maxFiles} allowed`);
  }

  let totalBytes = 0;
  let initialBytes = 0;
  for (const f of files) {
    totalBytes += f.bytes;
    if (f.bytes > limits.maxFileBytes) {
      errors.push(`${f.path}: ${(f.bytes / MiB).toFixed(1)} MiB > 30 MiB per file`);
    } else if (f.bytes > limits.warnFileBytes) {
      warnings.push(`${f.path}: ${(f.bytes / MiB).toFixed(2)} MiB > 512 KiB`);
    }
    if (/\.(js|css)$/i.test(f.path)) initialBytes += f.bytes;
  }

  if (totalBytes > limits.maxTotalBytes) {
    errors.push(`total ${(totalBytes / MiB).toFixed(1)} MiB > 250 MiB`);
  }
  if (initialBytes > limits.warnInitialBytes) {
    warnings.push(`initial JS+CSS ${(initialBytes / MiB).toFixed(1)} MiB > 15 MiB`);
  }

  return { ok: errors.length === 0, errors, warnings, totalBytes, initialBytes };
}

/** Recursively collect {path, bytes} for every file under dir (relative paths). */
export async function collectFiles(dir) {
  const out = [];
  async function walk(d) {
    for (const entry of await readdir(d, { withFileTypes: true })) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) {
        const s = await stat(full);
        out.push({ path: relative(dir, full).split(sep).join('/'), bytes: s.size });
      }
    }
  }
  await walk(dir);
  return out;
}

async function main() {
  const dir = process.argv[2];
  if (!dir) {
    console.error('usage: node scripts/check-budget.mjs <build-dir>');
    process.exit(2);
  }
  const files = await collectFiles(dir);
  const r = checkBudget(files);

  const fmt = (b) => `${(b / MiB).toFixed(2)} MiB`;
  console.log(`budget ${dir}: ${files.length} files, ${fmt(r.totalBytes)} total, ${fmt(r.initialBytes)} initial JS+CSS`);
  for (const w of r.warnings) console.warn(`WARN  ${w}`);
  for (const e of r.errors) console.error(`FAIL  ${e}`);
  if (!r.ok) process.exit(1);
}

// Run only when executed directly (not when imported by tests).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}

// Detects CPU cores, RAM, architecture, platform, model, disk class, and container status (monitor/perf-tuning.mjs detectHardware).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpus, totalmem, arch as osArch, platform as osPlatform } from 'node:os';
import { detectHardware } from '../perf-tuning.mjs';

// The fallback values detectHardware() reports when no CW_PERF_* override is given, computed from
// node:os exactly as the module computes them so the expectations hold on any host.
const fallback = () => {
  const list = cpus() || [];
  return {
    cores: list.length || 1,
    ramGB: Math.round(totalmem() / (1024 ** 3)),
    arch: osArch(),
    platform: osPlatform(),
    model: list[0]?.model || 'unknown',
  };
};

test('returns cores from env when CW_PERF_CORES is set', () => {
  const r = detectHardware({ env: { CW_PERF_CORES: '8' } });
  assert.equal(r.cores, 8);
});

test('returns cores from cpus length when CW_PERF_CORES is unset', () => {
  const r = detectHardware({ env: {} });
  assert.equal(r.cores, fallback().cores);
});

test('ignores a CW_PERF_CORES override of 0 and returns the detected core count', () => {
  const r = detectHardware({ env: { CW_PERF_CORES: '0' } });
  assert.equal(r.cores, fallback().cores);
});

test('returns ramGB from env when CW_PERF_RAM_GB is set', () => {
  const r = detectHardware({ env: { CW_PERF_RAM_GB: '16' } });
  assert.equal(r.ramGB, 16);
});

test('returns ramGB from totalmem when CW_PERF_RAM_GB is unset', () => {
  const r = detectHardware({ env: {} });
  assert.equal(r.ramGB, fallback().ramGB);
});

test('returns arch from env when CW_PERF_ARCH is set', () => {
  const r = detectHardware({ env: { CW_PERF_ARCH: 'arm64' } });
  assert.equal(r.arch, "arm64");
});

test('returns arch from osArch when CW_PERF_ARCH is unset', () => {
  const r = detectHardware({ env: {} });
  assert.equal(r.arch, fallback().arch);
});

test('returns platform from env when CW_PERF_PLATFORM is set', () => {
  const r = detectHardware({ env: { CW_PERF_PLATFORM: 'linux' } });
  assert.equal(r.platform, "linux");
});

test('returns platform from osPlatform when CW_PERF_PLATFORM is unset', () => {
  const r = detectHardware({ env: {} });
  assert.equal(r.platform, fallback().platform);
});

test('returns model from cpus list when available', () => {
  const r = detectHardware({ env: {} });
  assert.equal(r.model, fallback().model);
});

test('returns diskClass from env when CW_PERF_DISK is set', () => {
  const r = detectHardware({ env: { CW_PERF_DISK: 'ssd' } });
  assert.equal(r.diskClass, "ssd");
});

test('returns diskClass as unknown when CW_PERF_DISK is unset', () => {
  const r = detectHardware({ env: {} });
  assert.equal(r.diskClass, "unknown");
});

test('returns containers as null when CW_PERF_CONTAINERS is undefined', () => {
  const r = detectHardware({ env: {} });
  assert.equal(r.containers, null);
});

test('returns containers as true when CW_PERF_CONTAINERS is 1', () => {
  const r = detectHardware({ env: { CW_PERF_CONTAINERS: '1' } });
  assert.equal(r.containers, true);
});

test('returns containers as false when CW_PERF_CONTAINERS is 0', () => {
  const r = detectHardware({ env: { CW_PERF_CONTAINERS: '0' } });
  assert.equal(r.containers, false);
});

test('returns detectedAt from env when CW_NOW is set', () => {
  const r = detectHardware({ env: { CW_NOW: '2024-01-01T00:00:00Z' } });
  assert.equal(r.detectedAt, "2024-01-01T00:00:00Z");
});

test('returns detectedAt as null when CW_NOW is unset', () => {
  const r = detectHardware({ env: {} });
  assert.equal(r.detectedAt, null);
});

// Verifies the Gradle wrapper fetch path, script, and jar (bin/gradle-wrapper-verify.mjs verifyWrapper).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyWrapper } from '../gradle-wrapper-verify.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns not applicable when neither gradlew nor properties exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'verifyWrapper-'));
  try {
    const r = verifyWrapper(dir);
    assert.deepEqual(r, { ran: true, applicable: false, findings: [], reason: "no gradlew and no wrapper properties \u2014 this repo does not ship a Gradle wrapper" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns applicable true when only gradlew exists', () => {
  const dir = mkdtempSync(join(tmpdir(), 'verifyWrapper-'));
  try {
    writeFileSync(join(dir, 'gradlew'), '#!/bin/sh\necho hello\n');
    const r = verifyWrapper(dir);
    assert.deepEqual(r, { ran: true, applicable: true, hasGradlew: true, scope: "wrapper-fetch-path", doesNotCover: ["build.gradle configuration-time code", "gradle.properties jvmargs", "settings.gradle pluginManagement repositories", "wrappers in sub-modules (root only)"], gradlewSha256: "bfdeaeb08cffb6a36438bcd12dda25417e3cdd36f1e7e482a2849d539225288b", findings: [{ rule: "wrapper-properties-absent", sev: "med", message: "gradlew is present but gradle/wrapper/gradle-wrapper.properties is not \u2014 the wrapper resolves its distribution from somewhere this check cannot see" }, { rule: "wrapper-jar-absent", sev: "low", message: "gradlew is present but gradle-wrapper.jar is not \u2014 the wrapper would fetch one, which is a download this check cannot inspect" }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns applicable true when only properties exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'verifyWrapper-'));
  try {
    mkdirSync(join(dir, 'gradle', 'wrapper'), { recursive: true });
    writeFileSync(join(dir, 'gradle', 'wrapper', 'gradle-wrapper.properties'), 'distributionUrl=https\\://services.gradle.org/distributions/gradle-8.5-bin.zip\n');
    const r = verifyWrapper(dir);
    assert.deepEqual(r, { ran: true, applicable: true, hasGradlew: false, scope: "wrapper-fetch-path", doesNotCover: ["build.gradle configuration-time code", "gradle.properties jvmargs", "settings.gradle pluginManagement repositories", "wrappers in sub-modules (root only)"], distributionUrl: "https://services.gradle.org/distributions/gradle-8.5-bin.zip", declaredVersion: "8.5", findings: [{ rule: "distribution-checksum-undeclared", sev: "low", message: "no distributionSha256Sum \u2014 Gradle supports pinning the distribution hash and this wrapper does not, so a substituted download would not be detected by Gradle itself" }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reports plaintext http distribution url as high severity', () => {
  const dir = mkdtempSync(join(tmpdir(), 'verifyWrapper-'));
  try {
    writeFileSync(join(dir, 'gradlew'), '#!/bin/sh\necho hello\n');
    mkdirSync(join(dir, 'gradle', 'wrapper'), { recursive: true });
    writeFileSync(join(dir, 'gradle', 'wrapper', 'gradle-wrapper.properties'), 'distributionUrl=http://example.com/gradle-8.5-bin.zip\n');
    const r = verifyWrapper(dir);
    assert.deepEqual(r, { ran: true, applicable: true, hasGradlew: true, scope: "wrapper-fetch-path", doesNotCover: ["build.gradle configuration-time code", "gradle.properties jvmargs", "settings.gradle pluginManagement repositories", "wrappers in sub-modules (root only)"], distributionUrl: "http://example.com/gradle-8.5-bin.zip", declaredVersion: "8.5", gradlewSha256: "bfdeaeb08cffb6a36438bcd12dda25417e3cdd36f1e7e482a2849d539225288b", findings: [{ rule: "distribution-url-plaintext", sev: "high", message: "distributionUrl is http:// \u2014 the toolchain is fetched over a channel any network position can rewrite: http://example.com/gradle-8.5-bin.zip" }, { rule: "distribution-checksum-undeclared", sev: "low", message: "no distributionSha256Sum \u2014 Gradle supports pinning the distribution hash and this wrapper does not, so a substituted download would not be detected by Gradle itself" }, { rule: "wrapper-jar-absent", sev: "low", message: "gradlew is present but gradle-wrapper.jar is not \u2014 the wrapper would fetch one, which is a download this check cannot inspect" }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reports off-vendor distribution url as high severity', () => {
  const dir = mkdtempSync(join(tmpdir(), 'verifyWrapper-'));
  try {
    writeFileSync(join(dir, 'gradlew'), '#!/bin/sh\necho hello\n');
    mkdirSync(join(dir, 'gradle', 'wrapper'), { recursive: true });
    writeFileSync(join(dir, 'gradle', 'wrapper', 'gradle-wrapper.properties'), 'distributionUrl=https://mirror.example.com/gradle-8.5-bin.zip\n');
    const r = verifyWrapper(dir);
    assert.deepEqual(r, { ran: true, applicable: true, hasGradlew: true, scope: "wrapper-fetch-path", doesNotCover: ["build.gradle configuration-time code", "gradle.properties jvmargs", "settings.gradle pluginManagement repositories", "wrappers in sub-modules (root only)"], distributionUrl: "https://mirror.example.com/gradle-8.5-bin.zip", declaredVersion: "8.5", gradlewSha256: "bfdeaeb08cffb6a36438bcd12dda25417e3cdd36f1e7e482a2849d539225288b", findings: [{ rule: "distribution-url-off-vendor", sev: "high", message: "distributionUrl points outside services.gradle.org: https://mirror.example.com/gradle-8.5-bin.zip \u2014 ./gradlew downloads and EXECUTES whatever is there, before any build logic is evaluated. A corporate mirror is legitimate; verify this one is." }, { rule: "distribution-checksum-undeclared", sev: "low", message: "no distributionSha256Sum \u2014 Gradle supports pinning the distribution hash and this wrapper does not, so a substituted download would not be detected by Gradle itself" }, { rule: "wrapper-jar-absent", sev: "low", message: "gradlew is present but gradle-wrapper.jar is not \u2014 the wrapper would fetch one, which is a download this check cannot inspect" }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reports missing distribution url as medium severity', () => {
  const dir = mkdtempSync(join(tmpdir(), 'verifyWrapper-'));
  try {
    writeFileSync(join(dir, 'gradlew'), '#!/bin/sh\necho hello\n');
    mkdirSync(join(dir, 'gradle', 'wrapper'), { recursive: true });
    writeFileSync(join(dir, 'gradle', 'wrapper', 'gradle-wrapper.properties'), 'distributionBase=GRADLE_USER_HOME\n');
    const r = verifyWrapper(dir);
    assert.deepEqual(r, { ran: true, applicable: true, hasGradlew: true, scope: "wrapper-fetch-path", doesNotCover: ["build.gradle configuration-time code", "gradle.properties jvmargs", "settings.gradle pluginManagement repositories", "wrappers in sub-modules (root only)"], distributionUrl: null, declaredVersion: null, gradlewSha256: "bfdeaeb08cffb6a36438bcd12dda25417e3cdd36f1e7e482a2849d539225288b", findings: [{ rule: "distribution-url-absent", sev: "med", message: "no distributionUrl in gradle-wrapper.properties \u2014 the wrapper cannot be told where it fetches from" }, { rule: "distribution-checksum-undeclared", sev: "low", message: "no distributionSha256Sum \u2014 Gradle supports pinning the distribution hash and this wrapper does not, so a substituted download would not be detected by Gradle itself" }, { rule: "wrapper-jar-absent", sev: "low", message: "gradlew is present but gradle-wrapper.jar is not \u2014 the wrapper would fetch one, which is a download this check cannot inspect" }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reports missing checksum as low severity for vendor url', () => {
  const dir = mkdtempSync(join(tmpdir(), 'verifyWrapper-'));
  try {
    writeFileSync(join(dir, 'gradlew'), '#!/bin/sh\necho hello\n');
    mkdirSync(join(dir, 'gradle', 'wrapper'), { recursive: true });
    writeFileSync(join(dir, 'gradle', 'wrapper', 'gradle-wrapper.properties'), 'distributionUrl=https\\://services.gradle.org/distributions/gradle-8.5-bin.zip\n');
    const r = verifyWrapper(dir);
    assert.deepEqual(r, { ran: true, applicable: true, hasGradlew: true, scope: "wrapper-fetch-path", doesNotCover: ["build.gradle configuration-time code", "gradle.properties jvmargs", "settings.gradle pluginManagement repositories", "wrappers in sub-modules (root only)"], distributionUrl: "https://services.gradle.org/distributions/gradle-8.5-bin.zip", declaredVersion: "8.5", gradlewSha256: "bfdeaeb08cffb6a36438bcd12dda25417e3cdd36f1e7e482a2849d539225288b", findings: [{ rule: "distribution-checksum-undeclared", sev: "low", message: "no distributionSha256Sum \u2014 Gradle supports pinning the distribution hash and this wrapper does not, so a substituted download would not be detected by Gradle itself" }, { rule: "wrapper-jar-absent", sev: "low", message: "gradlew is present but gradle-wrapper.jar is not \u2014 the wrapper would fetch one, which is a download this check cannot inspect" }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reports oversized gradlew as high severity', () => {
  const dir = mkdtempSync(join(tmpdir(), 'verifyWrapper-'));
  try {
    writeFileSync(join(dir, 'gradlew'), 'x'.repeat(512 * 1024 + 1));
    const r = verifyWrapper(dir);
    assert.deepEqual(r, { ran: true, applicable: true, hasGradlew: true, scope: "wrapper-fetch-path", doesNotCover: ["build.gradle configuration-time code", "gradle.properties jvmargs", "settings.gradle pluginManagement repositories", "wrappers in sub-modules (root only)"], findings: [{ rule: "wrapper-properties-absent", sev: "med", message: "gradlew is present but gradle/wrapper/gradle-wrapper.properties is not \u2014 the wrapper resolves its distribution from somewhere this check cannot see" }, { rule: "gradlew-oversized", sev: "high", message: "gradlew is larger than 512 KB \u2014 the real wrapper script is a few hundred lines, and a shell script this size is not one" }, { rule: "wrapper-jar-absent", sev: "low", message: "gradlew is present but gradle-wrapper.jar is not \u2014 the wrapper would fetch one, which is a download this check cannot inspect" }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reports oversized jar as high severity', () => {
  const dir = mkdtempSync(join(tmpdir(), 'verifyWrapper-'));
  try {
    writeFileSync(join(dir, 'gradlew'), '#!/bin/sh\necho hello\n');
    mkdirSync(join(dir, 'gradle', 'wrapper'), { recursive: true });
    writeFileSync(join(dir, 'gradle', 'wrapper', 'gradle-wrapper.properties'), 'distributionUrl=https\\://services.gradle.org/distributions/gradle-8.5-bin.zip\n');
    writeFileSync(join(dir, 'gradle', 'wrapper', 'gradle-wrapper.jar'), Buffer.alloc(4 * 1024 * 1024 + 1, 0));
    const r = verifyWrapper(dir);
    assert.deepEqual(r, { ran: true, applicable: true, hasGradlew: true, scope: "wrapper-fetch-path", doesNotCover: ["build.gradle configuration-time code", "gradle.properties jvmargs", "settings.gradle pluginManagement repositories", "wrappers in sub-modules (root only)"], distributionUrl: "https://services.gradle.org/distributions/gradle-8.5-bin.zip", declaredVersion: "8.5", gradlewSha256: "bfdeaeb08cffb6a36438bcd12dda25417e3cdd36f1e7e482a2849d539225288b", jarBytes: 4194305, findings: [{ rule: "distribution-checksum-undeclared", sev: "low", message: "no distributionSha256Sum \u2014 Gradle supports pinning the distribution hash and this wrapper does not, so a substituted download would not be detected by Gradle itself" }, { rule: "wrapper-jar-oversized", sev: "high", message: "gradle-wrapper.jar exceeds 4 MB \u2014 the genuine wrapper is roughly 50 KB. It is NOT hashed, because reading it whole is what an oversized file is for." }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reports missing jar as low severity when gradlew present', () => {
  const dir = mkdtempSync(join(tmpdir(), 'verifyWrapper-'));
  try {
    writeFileSync(join(dir, 'gradlew'), '#!/bin/sh\necho hello\n');
    mkdirSync(join(dir, 'gradle', 'wrapper'), { recursive: true });
    writeFileSync(join(dir, 'gradle', 'wrapper', 'gradle-wrapper.properties'), 'distributionUrl=https\\://services.gradle.org/distributions/gradle-8.5-bin.zip\n');
    const r = verifyWrapper(dir);
    assert.deepEqual(r, { ran: true, applicable: true, hasGradlew: true, scope: "wrapper-fetch-path", doesNotCover: ["build.gradle configuration-time code", "gradle.properties jvmargs", "settings.gradle pluginManagement repositories", "wrappers in sub-modules (root only)"], distributionUrl: "https://services.gradle.org/distributions/gradle-8.5-bin.zip", declaredVersion: "8.5", gradlewSha256: "bfdeaeb08cffb6a36438bcd12dda25417e3cdd36f1e7e482a2849d539225288b", findings: [{ rule: "distribution-checksum-undeclared", sev: "low", message: "no distributionSha256Sum \u2014 Gradle supports pinning the distribution hash and this wrapper does not, so a substituted download would not be detected by Gradle itself" }, { rule: "wrapper-jar-absent", sev: "low", message: "gradlew is present but gradle-wrapper.jar is not \u2014 the wrapper would fetch one, which is a download this check cannot inspect" }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

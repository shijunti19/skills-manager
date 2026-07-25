#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const args = process.argv.slice(2);

const subcommand = args[0];
const rest = args.slice(1);

// -----------------------------------------------------------------------------
// Paths
// -----------------------------------------------------------------------------
const packagePath = path.join(root, 'package.json');
const tauriConfPath = path.join(root, 'src-tauri', 'tauri.conf.json');
const enI18nPath = path.join(root, 'src', 'i18n', 'en.json');
const zhI18nPath = path.join(root, 'src', 'i18n', 'zh.json');
const zhTwI18nPath = path.join(root, 'src', 'i18n', 'zh-TW.json');
const changelogPath = path.join(root, 'CHANGELOG.md');
const changelogZhPath = path.join(root, 'CHANGELOG-zh.md');

// -----------------------------------------------------------------------------
// Generic helpers
// -----------------------------------------------------------------------------
function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function parseSemver(version) {
  const m = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

function bumpVersion(current, releaseType) {
  const parsed = parseSemver(current);
  if (!parsed) {
    throw new Error(`Current package version is not SemVer: ${current}`);
  }
  if (releaseType === 'patch') return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
  if (releaseType === 'minor') return `${parsed.major}.${parsed.minor + 1}.0`;
  if (releaseType === 'major') return `${parsed.major + 1}.0.0`;
  if (parseSemver(releaseType)) return releaseType;
  throw new Error(`Invalid release type/version: ${releaseType}`);
}

function updateSettingsVersion(i18nObj, nextVersion, fileLabel) {
  if (!i18nObj.settings || typeof i18nObj.settings.version !== 'string') {
    throw new Error(`Missing settings.version in ${fileLabel}`);
  }
  i18nObj.settings.version = i18nObj.settings.version.replace(/\d+\.\d+\.\d+/, nextVersion);
}

function dateStr() {
  return new Date().toISOString().slice(0, 10);
}

// -----------------------------------------------------------------------------
// Git helpers
// -----------------------------------------------------------------------------
function git(args, opts = {}) {
  const res = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...opts,
  });
  if (res.error) throw res.error;
  if (res.status !== 0 && !opts.allowFailure) {
    throw new Error(
      `git ${args.join(' ')}\n  → exit ${res.status}\n  stderr: ${(res.stderr || '').trim()}`,
    );
  }
  return { stdout: (res.stdout || '').trim(), stderr: (res.stderr || '').trim(), status: res.status };
}

function isWorkingTreeClean() {
  return git(['status', '--porcelain'], { allowFailure: true }).stdout === '';
}

function tagExists(tag) {
  return git(['tag', '--list', tag], { allowFailure: true }).stdout === tag;
}

function headIsTaggedWith(tag) {
  // Returns true iff HEAD points at an existing tag with the given name.
  const res = git(['tag', '--points-at', 'HEAD'], { allowFailure: true }).stdout;
  return res.split('\n').includes(tag);
}

// -----------------------------------------------------------------------------
// CHANGELOG [Unreleased]/[未发布] skeleton
// -----------------------------------------------------------------------------
const UNRELEASED_EN = [
  '## [Unreleased]',
  '',
  '### Release Overview',
  '_Nothing yet._',
  '',
  '### User-facing',
  '_Nothing yet._',
  '',
  '### Developer & Governance',
  '_Nothing yet._',
  '',
].join('\n');

const UNRELEASED_ZH = [
  '## [未发布]',
  '',
  '### 发布概览',
  '_暂无。_',
  '',
  '### 用户可见更新',
  '_暂无。_',
  '',
  '### 开发者与治理更新',
  '_暂无。_',
  '',
].join('\n');

function insertUnreleasedSkeleton(changelog, skeleton) {
  // Idempotent: if a "## [Unreleased]" / "## [未发布]" heading already exists,
  // do nothing. Otherwise insert the skeleton after the introductory prose
  // (i.e. immediately before the first "## [version]" entry).
  const headingMatch = skeleton.match(/^## \[[^\]]+\]/m);
  if (!headingMatch) throw new Error('UNRELEASED template is malformed');
  const heading = headingMatch[0];
  if (changelog.includes(heading)) return changelog;

  const firstReleaseHeading = changelog.search(/^## \[/m);
  if (firstReleaseHeading === -1) {
    return `${changelog.trimEnd()}\n\n${skeleton}\n`;
  }
  return `${changelog.slice(0, firstReleaseHeading)}${skeleton}\n${changelog.slice(firstReleaseHeading)}`;
}

function ensureUnreleasedSection() {
  const en = fs.readFileSync(changelogPath, 'utf8');
  const zh = fs.readFileSync(changelogZhPath, 'utf8');
  const nextEn = insertUnreleasedSkeleton(en, UNRELEASED_EN);
  const nextZh = insertUnreleasedSkeleton(zh, UNRELEASED_ZH);
  if (nextEn !== en) fs.writeFileSync(changelogPath, nextEn);
  if (nextZh !== zh) fs.writeFileSync(changelogZhPath, nextZh);
  const addedEn = nextEn !== en;
  const addedZh = nextZh !== zh;
  console.log(
    addedEn || addedZh
      ? `Inserted Unreleased skeleton (en=${addedEn ? 'inserted' : 'kept'}, zh=${addedZh ? 'inserted' : 'kept'})`
      : 'Unreleased skeleton already present in both CHANGELOGs',
  );
}

// -----------------------------------------------------------------------------
// promoteUnreleasedToVersion
//   - extract the [Unreleased] / [未发布] section (heading + sub-sections + bullets)
//   - rewrite it as "## [Next] - YYYY-MM-DD"
//   - prepend it before the first "## [version]" line in that file
//   - leave an empty skeleton back at the top
// -----------------------------------------------------------------------------
function promoteUnreleasedToVersion(changelog, nextVersion, { zh = false } = {}) {
  const heading = zh ? '## [未发布]' : '## [Unreleased]';
  const headingIdx = changelog.indexOf(heading);
  if (headingIdx === -1) {
    throw new Error(`Cannot find ${heading} in CHANGELOG`);
  }

  // Find the next "## [" at the same level — that's where the [Unreleased]
  // section ends (exclusive).
  const afterHeading = changelog.slice(headingIdx + heading.length);
  const nextSectionMatch = afterHeading.match(/^## \[/m);
  const sectionEndRel = nextSectionMatch ? nextSectionMatch.index : afterHeading.length;
  const sectionEnd = headingIdx + heading.length + sectionEndRel;

  const releasedBlock = changelog.slice(headingIdx, sectionEnd).trimEnd();
  const releasedWithVersion =
    releasedBlock.replace(heading, `## [${nextVersion}] - ${dateStr()}`) + '\n';

  const emptySkeleton = zh ? UNRELEASED_ZH : UNRELEASED_EN;

  // Place the freshly-promoted version block immediately before the existing
  // [Unreleased]/[未发布] block, then leave a fresh empty skeleton at the top
  // in its place.
  return (
    changelog.slice(0, headingIdx) +
    releasedWithVersion +
    '\n' +
    emptySkeleton +
    '\n' +
    changelog.slice(sectionEnd)
  );
}

function countBulletsInUnreleased(changelog, { zh = false } = {}) {
  const heading = zh ? '## [未发布]' : '## [Unreleased]';
  const headingIdx = changelog.indexOf(heading);
  if (headingIdx === -1) return 0;
  const after = changelog.slice(headingIdx + heading.length);
  const nextSection = after.search(/^## \[/m);
  const block = nextSection === -1 ? after : after.slice(0, nextSection);
  // A bullet exists when there is at least one "- " line that is NOT a
  // placeholder ("_Nothing yet._" / "_暂无。_").
  const bulletLines = block
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('- '));
  const realBullets = bulletLines.filter((l) => !/^_.*_$/.test(l.slice(2).trim()));
  return realBullets.length;
}

// -----------------------------------------------------------------------------
// Star-history refresh (best-effort)
// -----------------------------------------------------------------------------
function refreshStarHistory() {
  const script = path.join(root, 'scripts', 'gen-star-history.py');
  const res = spawnSync('python3', [script], { stdio: 'inherit' });
  return !res.error && res.status === 0;
}

// -----------------------------------------------------------------------------
// Subcommand: prepare <releaseType>
//   bump version + promote [Unreleased] → [Next] + reset [Unreleased]
//   NEVER commit / tag / push.
// -----------------------------------------------------------------------------
function prepareSubcommand() {
  const releaseArg = rest.find((arg) => !arg.startsWith('--'));
  const dryRun = rest.includes('--dry-run');

  if (!releaseArg) {
    console.error('Usage: npm run release:prepare -- <patch|minor|major|x.y.z> [--dry-run]');
    process.exit(1);
  }

  if (!isWorkingTreeClean()) {
    console.error('Refusing to prepare release: working tree is not clean.');
    console.error('Commit or stash pending changes before running release:prepare.');
    console.error('');
    console.error('Untracked / unstaged files:');
    console.error(git(['status', '--porcelain'], { allowFailure: true }).stdout);
    process.exit(2);
  }

  const pkg = readJson(packagePath);
  const currentVersion = pkg.version;
  const nextVersion = bumpVersion(currentVersion, releaseArg);

  if (nextVersion === currentVersion) {
    console.error(`Refusing to prepare release: next version equals current (${currentVersion}).`);
    process.exit(2);
  }

  // Validate that both CHANGELOGs have at least one real bullet under the
  // [Unreleased] / [未发布] heading — never publish an empty release.
  const enCl = fs.readFileSync(changelogPath, 'utf8');
  const zhCl = fs.readFileSync(changelogZhPath, 'utf8');
  const enBullets = countBulletsInUnreleased(enCl, { zh: false });
  const zhBullets = countBulletsInUnreleased(zhCl, { zh: true });
  if (enBullets === 0 || zhBullets === 0) {
    console.error(
      `Refusing to prepare release: [Unreleased]/[未发布] section must contain at least one real bullet.`,
    );
    console.error(`  CHANGELOG.md  bullets under [Unreleased]: ${enBullets}`);
    console.error(`  CHANGELOG-zh.md bullets under [未发布]:   ${zhBullets}`);
    console.error('Add entries describing the changes before preparing the release.');
    process.exit(2);
  }

  if (dryRun) {
    console.log(`[dry-run] ${currentVersion} -> ${nextVersion}`);
    console.log('[dry-run] Will write to:');
    console.log('  - CHANGELOG.md');
    console.log('  - CHANGELOG-zh.md');
    console.log('  - package.json');
    console.log('  - src-tauri/tauri.conf.json');
    console.log('  - src/i18n/en.json');
    console.log('  - src/i18n/zh.json');
    console.log('  - src/i18n/zh-TW.json');
    console.log('  - assets/star-history.svg (best-effort)');
    return;
  }

  const tauriConf = readJson(tauriConfPath);
  const en = readJson(enI18nPath);
  const zh = readJson(zhI18nPath);
  const zhTw = readJson(zhTwI18nPath);

  pkg.version = nextVersion;
  tauriConf.version = nextVersion;
  updateSettingsVersion(en, nextVersion, 'src/i18n/en.json');
  updateSettingsVersion(zh, nextVersion, 'src/i18n/zh.json');
  updateSettingsVersion(zhTw, nextVersion, 'src/i18n/zh-TW.json');

  const nextEnCl = promoteUnreleasedToVersion(enCl, nextVersion, { zh: false });
  const nextZhCl = promoteUnreleasedToVersion(zhCl, nextVersion, { zh: true });

  writeJson(packagePath, pkg);
  writeJson(tauriConfPath, tauriConf);
  writeJson(enI18nPath, en);
  writeJson(zhI18nPath, zh);
  writeJson(zhTwI18nPath, zhTw);
  fs.writeFileSync(changelogPath, nextEnCl);
  fs.writeFileSync(changelogZhPath, nextZhCl);

  const starOk = refreshStarHistory();

  console.log(`✓ Prepared release ${nextVersion} (not committed)`);
  console.log('');
  console.log('Updated (left in working tree, nothing committed yet):');
  console.log('  - CHANGELOG.md');
  console.log('  - CHANGELOG-zh.md');
  console.log('  - package.json');
  console.log('  - src-tauri/tauri.conf.json');
  console.log('  - src/i18n/en.json');
  console.log('  - src/i18n/zh.json');
  console.log('  - src/i18n/zh-TW.json');
  console.log(
    starOk
      ? '  - assets/star-history.svg'
      : '  - assets/star-history.svg (skipped: refresh failed)',
  );
  console.log('');
  console.log('Next steps:');
  console.log('  1. Review the changes:');
  console.log('       git diff');
  console.log('  2. Commit when satisfied:');
  console.log('       git add CHANGELOG.md CHANGELOG-zh.md package.json src-tauri/tauri.conf.json src/i18n/en.json src/i18n/zh.json src/i18n/zh-TW.json');
  console.log(`       git commit -m "chore(release): bump version to ${nextVersion}"`);
  console.log('  3. Create the local tag (NEVER pushes):');
  console.log(`       npm run release:tag -- ${nextVersion}`);
  console.log('  4. Push to trigger the 4-platform build:');
  console.log('       git push --follow-tags');
}

// -----------------------------------------------------------------------------
// Subcommand: tag <version>
//   Validate, then `git tag -a v<version>`. NEVER pushes.
// -----------------------------------------------------------------------------
function tagSubcommand() {
  const releaseArg = rest.find((arg) => !arg.startsWith('--'));
  if (!releaseArg) {
    console.error('Usage: npm run release:tag -- <version>     # e.g. npm run release:tag -- 1.28.5');
    process.exit(1);
  }
  if (!parseSemver(releaseArg)) {
    console.error(`Invalid version: ${releaseArg} (expected SemVer x.y.z)`);
    process.exit(2);
  }

  const pkg = readJson(packagePath);
  if (pkg.version !== releaseArg) {
    console.error(
      `Refusing to tag: package.json version is ${pkg.version}, requested ${releaseArg}.`,
    );
    console.error('Run `npm run release:prepare -- patch` (or pass the matching version) first.');
    process.exit(2);
  }

  if (!isWorkingTreeClean()) {
    console.error('Refusing to tag: working tree is not clean.');
    console.error('Commit the release:prepare changes before tagging.');
    console.error('');
    console.error('Untracked / unstaged files:');
    console.error(git(['status', '--porcelain'], { allowFailure: true }).stdout);
    process.exit(2);
  }

  const tagName = `v${releaseArg}`;
  if (tagExists(tagName)) {
    console.error(`Refusing to tag: ${tagName} already exists locally.`);
    console.error('Delete it first if you really want to recreate it:');
    console.error(`  git tag -d ${tagName}`);
    process.exit(2);
  }

  // Check the changelog has actually been promoted for this version (i.e.
  // HEAD contains a "## [<version>] - " heading).
  const enCl = fs.readFileSync(changelogPath, 'utf8');
  if (!new RegExp(`^## \\[${releaseArg}\\] - `, 'm').test(enCl)) {
    console.error(
      `Refusing to tag: CHANGELOG.md does not yet contain a "## [${releaseArg}]" entry.`,
    );
    console.error('Run `npm run release:prepare` first.');
    process.exit(2);
  }

  git(['tag', '-a', tagName, '-m', tagName]);
  console.log(`✓ Created local tag ${tagName} (NOT pushed)`);
  console.log('');
  console.log('Next step — push to trigger the 4-platform build:');
  console.log('  git push --follow-tags');
}

// -----------------------------------------------------------------------------
// Subcommand: ensure-unreleased
//   Idempotently insert the [Unreleased]/[未发布] skeleton at the top of each
//   CHANGELOG. Safe to run repeatedly.
// -----------------------------------------------------------------------------
function ensureUnreleasedSubcommand() {
  ensureUnreleasedSection();
}

// -----------------------------------------------------------------------------
// Entry
// -----------------------------------------------------------------------------
function main() {
  if (!subcommand) {
    console.error('Usage:');
    console.error('  npm run release:prepare -- prepare <patch|minor|major|x.y.z> [--dry-run]');
    console.error('  npm run release:tag     -- tag <version>');
    console.error('  npm run release:prepare -- ensure-unreleased');
    process.exit(1);
  }

  switch (subcommand) {
    case 'prepare':
      prepareSubcommand();
      break;
    case 'tag':
      tagSubcommand();
      break;
    case 'ensure-unreleased':
      ensureUnreleasedSubcommand();
      break;
    default:
      console.error(`Unknown subcommand: ${subcommand}`);
      process.exit(1);
  }
}

main();
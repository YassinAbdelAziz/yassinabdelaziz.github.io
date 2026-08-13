#!/usr/bin/env node
// build-ublock.mjs
// Downloads the official uBlock Origin filter lists (EasyList, EasyPrivacy,
// uBlock filters, Peter Lowe's ad server list) and compiles them into a compact
// JSON ruleset that the Android app applies inside its WebView:
//   - blockHosts:      root domains to block (fast host-suffix lookup)
//   - exceptions:      domains whitelisted by @@||domain^ rules
//   - urlPatterns:     URL regexes (with a literal pre-filter gate)
//   - exceptionUrls:   allowlist regexes from @@ rules
//   - cosmeticGeneric: CSS selectors applied to every page
//   - cosmeticDomains: host -> CSS selectors
//
// Usage: node tools/build-ublock.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const SOURCES = [
  { name: 'easylist',  url: 'https://easylist.to/easylist/easylist.txt' },
  { name: 'easyprivacy', url: 'https://easylist.to/easylist/easyprivacy.txt' },
  { name: 'ubo-filters', url: 'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/filters.txt' },
  { name: 'peter-lowe', url: 'https://pgl.yoyo.org/adservers/serverlist.php?hostformat=hosts&showintro=1&mimetype=plaintext' },
];

const MAX_URL_PATTERNS = 30000;
const MAX_GENERIC_COSMETIC = 15000;
const MAX_COSMETIC_PER_HOST = 2000;

const blockHosts = new Set();
const exceptions = new Set();
const urlPatterns = new Set();
const exceptionUrls = new Set();
const cosmeticGeneric = new Set();
const cosmeticDomains = new Map();

// longest plain literal run used as a cheap pre-filter before regex matching
function literalRun(pattern) {
  const m = pattern.replace(/\*/g, ' ')
                   .replace(/\|/g, ' ')
                   .replace(/\^/g, ' ')
                   .match(/[a-z0-9][a-z0-9._\/\-]*[a-z0-9]/g);
  if (!m) return null;
  return m.reduce((a, b) => (b.length > a.length ? b : a));
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Convert a uBO network filter pattern (without options) to a regex source.
function patternToRegex(pattern) {
  let rest = pattern;
  let re = '';
  if (rest.startsWith('||')) {
    rest = rest.slice(2);
    re = '(?:[a-z][a-z0-9+.-]*:)?//(?:[^/]*\\.)?';
  } else if (rest.startsWith('|')) {
    rest = rest.slice(1);
    re = '^';
  }
  let anchorEnd = false;
  if (rest.endsWith('|')) {
    rest = rest.slice(0, -1);
    anchorEnd = true;
  }
  let out = '';
  for (let i = 0; i < rest.length; i++) {
    const c = rest[i];
    if (c === '*') out += '.*';
    else if (c === '^') out += '(?:[^a-zA-Z0-9_.%-]|$)';
    else out += escapeRegex(c);
  }
  return re + out + (anchorEnd ? '$' : '');
}

function hostRoot(pattern) {
  // ||domain^  -> pure root domain (no wildcard, no path, no port)
  let p = pattern;
  if (p.startsWith('||')) p = p.slice(2);
  if (p.endsWith('^')) p = p.slice(0, -1);
  if (!/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(p)) return null;
  if (p.includes('*')) return null;
  return p.toLowerCase();
}

function stripOptions(pattern) {
  const i = pattern.indexOf('$');
  if (i === -1) return { pat: pattern, opts: '' };
  return { pat: pattern.slice(0, i), opts: pattern.slice(i + 1) };
}

function parseNetworkLine(line, blocked) {
  // line starts with @@ for exceptions
  const isException = line.startsWith('@@');
  const body = isException ? line.slice(2) : line;
  const { pat, opts } = stripOptions(body);
  if (!pat) return;
  if (/domain=/.test(opts)) return;        // domain-restricted: complex, skip
  if (/(^|,)~/.test(opts)) return;          // negated options: skip
  if (/^(https?:)?\/\//.test(pat)) return;  // http://example patterns are URLs, skip
  if (/^#/.test(pat) || pat.startsWith('!')) return;

  if (!isException) {
    const host = hostRoot(pat);
    if (host) { blocked.blockHosts.add(host); return; }
    const re = patternToRegex(pat);
    const lit = literalRun(pat);
    if (re && urlPatterns.size < MAX_URL_PATTERNS) {
      urlPatterns.add(JSON.stringify({ lit, re }));
    }
  } else {
    const host = hostRoot(pat);
    if (host) { blocked.exceptions.add(host); return; }
    const re = patternToRegex(pat);
    if (re && exceptionUrls.size < 2000) {
      exceptionUrls.add(JSON.stringify({ lit: literalRun(pat), re }));
    }
  }
}

function parseCosmeticLine(line, blocked) {
  // only plain cosmetic filters: domain1,domain2##selector
  const idx = line.indexOf('##');
  if (idx === -1) return;
  const head = line.slice(0, idx);
  const selector = line.slice(idx + 2);
  if (!selector) return;
  if (selector.startsWith('+js') || selector.startsWith('^')) return; // scriptlet / HTML filtering
  if (selector.startsWith(':-abp')) return;
  // extended cosmetic selectors (need uBO's procedural engine)
  if (/:has-text\(|:nth-ancestor\(|:matches-attr\(|:matches-css\(|:xpath\(|:remove\(|:upward\(|:min-text-length\(|:-abp-has\(/.test(selector)) return;
  const domains = head ? head.split(',').filter(Boolean) : [];
  if (domains.length === 0) {
    if (blocked.cosmeticGeneric.size < MAX_GENERIC_COSMETIC) {
      blocked.cosmeticGeneric.add(selector);
    }
    return;
  }
  if (domains.some((d) => d.startsWith('~'))) return; // negation
  for (const d of domains) {
    const host = d.toLowerCase();
    let arr = blocked.cosmeticDomains.get(host);
    if (!arr) {
      arr = [];
      blocked.cosmeticDomains.set(host, arr);
    }
    if (arr.length < MAX_COSMETIC_PER_HOST) arr.push(selector);
  }
}

async function fetchText(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return await res.text();
}

let linesTotal = 0;
for (const src of SOURCES) {
  console.log(`Fetching ${src.name} ...`);
  let text;
  try {
    text = await fetchText(src.url);
  } catch (e) {
    console.warn(`  !! could not fetch ${src.name}: ${e.message}`);
    continue;
  }
  let blocked = true;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    linesTotal++;
    if (line.startsWith('!')) continue;
    if (line.includes('##')) {
      parseCosmeticLine(line, {
        cosmeticGeneric, cosmeticDomains,
      });
      continue;
    }
    if (line.startsWith('#')) continue; // #@# / #?# / #$# / #%# variants
    parseNetworkLine(line, { blockHosts, exceptions, urlPatterns, exceptionUrls });
  }
  void blocked;
}

console.log('\nCompiled summary:');
console.log(`  blockHosts:      ${blockHosts.size}`);
console.log(`  exceptions:      ${exceptions.size}`);
console.log(`  urlPatterns:     ${urlPatterns.size}`);
console.log(`  exceptionUrls:   ${exceptionUrls.size}`);
console.log(`  cosmeticGeneric: ${cosmeticGeneric.size}`);
console.log(`  cosmeticDomains: ${cosmeticDomains.size} hosts`);
console.log(`  total lines:     ${linesTotal}`);

const rules = {
  blockHosts: [...blockHosts],
  exceptions: [...exceptions],
  urlPatterns: [...urlPatterns].map((s) => JSON.parse(s)),
  exceptionUrls: [...exceptionUrls].map((s) => JSON.parse(s)),
  cosmeticGeneric: [...cosmeticGeneric],
  cosmeticDomains: Object.fromEntries(cosmeticDomains),
};

const outPath = join(__dirname, '..', 'app', 'src', 'main', 'assets', 'ublock', 'rules.json');
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(rules));
const kb = Math.round(Buffer.byteLength(JSON.stringify(rules)) / 1024);
console.log(`\nWrote ${outPath} (${kb} KB)`);

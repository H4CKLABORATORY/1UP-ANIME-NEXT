#!/usr/bin/env node
// 1UP ANIME 2.37.49 — isolated GitHub Actions Machine A.
// Uses only the exact lockfile snapshot; does not install the application.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const VERSION = '2.37.49';
const EXPECTED_LOCK = 'd1a5c0952eca273d3138df357bf8687eb561ba4f1e4cf198fc42465256142a46';
const ZIP = `vendor-bundle-${VERSION}.zip`;
const SIDE = `${ZIP}.sha256`;
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const LOG = `machine-a-${stamp}.log`;
const log = (s = '') => {
  const line = String(s);
  process.stdout.write(line + '\n');
  fs.appendFileSync(LOG, line + '\n');
};
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const sriTokens = (value) => {
  const strength = { sha512: 4, sha384: 3, sha256: 2, sha1: 1 };
  const parsed = String(value).trim().split(/\s+/).flatMap((raw) => {
    const token = raw.split('?', 1)[0];
    const i = token.indexOf('-');
    if (i < 1) return [];
    const algorithm = token.slice(0, i).toLowerCase();
    const digest = token.slice(i + 1);
    return strength[algorithm] && /^[A-Za-z0-9+/]+={0,2}$/.test(digest)
      ? [{ algorithm, digest, strength: strength[algorithm] }] : [];
  });
  if (!parsed.length) throw new Error('integrity sin algoritmo SRI compatible');
  const max = Math.max(...parsed.map(x => x.strength));
  return parsed.filter(x => x.strength === max);
};
const verifySRI = (bytes, integrity) => sriTokens(integrity).some(({algorithm,digest}) =>
  crypto.createHash(algorithm).update(bytes).digest('base64') === digest
);
const run = (command, args, options = {}) => {
  const r = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, ...options });
  if (r.stdout) log(r.stdout.trimEnd());
  if (r.stderr) log(r.stderr.trimEnd());
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${command} terminó con código ${r.status}`);
  return r.stdout || '';
};
function buildManifest(lock) {
  const groups = new Map();
  const locations = [];
  for (const [key, info] of Object.entries(lock.packages || {})) {
    if (!key.startsWith('node_modules/') || info.link || !info.resolved) continue;
    if (!info.integrity || !info.version) throw new Error(`falta integrity/version en ${key}`);
    const u = new URL(info.resolved);
    if (u.protocol !== 'https:' || u.hostname !== 'registry.npmjs.org' || u.username || u.password || u.hash || u.port) {
      throw new Error(`URL no permitida en lockfile: ${info.resolved}`);
    }
    const name = info.name || key.split('node_modules/').at(-1);
    const loc = { key, name, version: info.version, resolved: u.href, integrity: info.integrity };
    locations.push(loc);
    if (!groups.has(info.integrity)) groups.set(info.integrity, []);
    groups.get(info.integrity).push(loc);
  }
  const entries = [...groups.entries()].map(([integrity, items]) => {
    const sorted = items.slice().sort((a,b) => a.key.localeCompare(b.key));
    return {
      name: sorted[0].name,
      version: sorted[0].version,
      resolved: sorted[0].resolved,
      resolvedUrls: [...new Set(sorted.map(x => x.resolved))].sort(),
      integrity,
      keys: sorted.map(x => x.key),
      locations: sorted,
      fileName: `vendor-${sha256(Buffer.from(integrity))}.tgz`
    };
  }).sort((a,b) => a.integrity.localeCompare(b.integrity));
  return {
    schemaVersion: 2,
    lockfileVersion: lock.lockfileVersion,
    locations: locations.length,
    count: entries.length,
    duplicates: locations.length - entries.length,
    entries
  };
}
function audit(lock, manifest, directory, allowChecksum = false) {
  const locked = Object.entries(lock.packages || {}).filter(([k,v]) =>
    k.startsWith('node_modules/') && !v.link && v.resolved && v.integrity
  );
  const byKey = new Map();
  const seenIntegrity = new Set();
  const seenNames = new Set();
  const errors = [];
  if (manifest.schemaVersion !== 2 || manifest.lockfileVersion !== lock.lockfileVersion) errors.push('schema/lockfileVersion no coincide');
  for (const e of manifest.entries || []) {
    if (!e.integrity || !e.fileName || !Array.isArray(e.keys) || !Array.isArray(e.locations)) {
      errors.push('entry incompleta'); continue;
    }
    if (seenIntegrity.has(e.integrity)) errors.push('integrity duplicada');
    seenIntegrity.add(e.integrity);
    if (seenNames.has(e.fileName)) errors.push('filename duplicado');
    seenNames.add(e.fileName);
    const expectedName = `vendor-${sha256(Buffer.from(e.integrity))}.tgz`;
    if (e.fileName !== expectedName) errors.push(`filename no deriva de SRI: ${e.fileName}`);
    const keys = e.locations.map(x => x.key).sort();
    if (JSON.stringify([...e.keys].sort()) !== JSON.stringify(keys)) errors.push(`keys/locations no coinciden: ${e.fileName}`);
    if (JSON.stringify(e.resolvedUrls) !== JSON.stringify([...new Set(e.locations.map(x => x.resolved))].sort())) errors.push(`resolvedUrls incorrectas: ${e.fileName}`);
    const principal = e.locations.slice().sort((a,b) => a.key.localeCompare(b.key))[0]?.resolved;
    if (e.resolved !== principal) errors.push(`resolved principal incorrecto: ${e.fileName}`);
    for (const loc of e.locations) {
      if (byKey.has(loc.key)) errors.push(`ubicación duplicada: ${loc.key}`);
      byKey.set(loc.key, {entry:e,loc});
    }
  }
  for (const [key,pkg] of locked) {
    const found = byKey.get(key);
    const name = pkg.name || key.split('node_modules/').at(-1);
    if (!found) { errors.push(`ubicación ausente: ${key}`); continue; }
    const l = found.loc;
    if (l.name !== name || l.version !== pkg.version || l.resolved !== pkg.resolved ||
        l.integrity !== pkg.integrity || found.entry.integrity !== pkg.integrity) {
      errors.push(`metadata no coincide: ${key}`);
    }
  }
  for (const key of byKey.keys()) if (!locked.some(([k]) => k === key)) errors.push(`ubicación extra: ${key}`);
  if (manifest.locations !== locked.length || byKey.size !== locked.length) errors.push('conteo de ubicaciones incorrecto');
  if (manifest.count !== 97 || manifest.entries.length !== 97 || seenIntegrity.size !== 97) errors.push('conteo SRI únicos incorrecto');
  if (manifest.duplicates !== 1 || locked.length !== 98) errors.push('conteo de duplicados incorrecto');
  let ok = 0;
  for (const e of manifest.entries) {
    const file = path.join(directory, e.fileName);
    if (!fs.existsSync(file)) { errors.push(`falta ${e.fileName}`); continue; }
    const st = fs.lstatSync(file);
    if (!st.isFile() || st.isSymbolicLink()) { errors.push(`archivo no regular ${e.fileName}`); continue; }
    if (!verifySRI(fs.readFileSync(file), e.integrity)) { errors.push(`SRI incorrecto ${e.fileName}`); continue; }
    ok++;
  }
  if (errors.length || ok !== 97) throw new Error('AUDIT FAIL:\n' + errors.join('\n'));
  const expectedFiles = new Set(['manifest.json', ...(allowChecksum ? ['BUNDLE_FILES.sha256'] : []), ...manifest.entries.map(e => e.fileName)]);
  const actualFiles = fs.readdirSync(directory);
  if (actualFiles.length !== expectedFiles.size || actualFiles.some(name => !expectedFiles.has(name))) {
    throw new Error('set físico de vendor no coincide exactamente con manifest');
  }
  log('AUDIT: PASS (98/98 ubicaciones, 97/97 archivos)');
}
async function main() {
  if (process.version !== 'v22.16.0') throw new Error(`Node requerido v22.16.0; actual ${process.version}`);
  const lockPath = path.join(ROOT, 'package-lock.json');
  const lockBytes = fs.readFileSync(lockPath);
  const actualLockHash = sha256(lockBytes);
  if (actualLockHash !== EXPECTED_LOCK) throw new Error(`package-lock SHA-256 no coincide: ${actualLockHash}`);
  const lock = JSON.parse(lockBytes.toString('utf8'));
  const manifest = buildManifest(lock);
  if (manifest.locations !== 98 || manifest.count !== 97 || manifest.duplicates !== 1) {
    throw new Error(`manifest inesperado: locations=${manifest.locations}, count=${manifest.count}, duplicates=${manifest.duplicates}`);
  }
  log('=== 1UP ANIME 2.37.49 — GITHUB ACTIONS MACHINE A ===');
  log(`Node: ${process.version}`);
  log(`package-lock SHA-256: ${actualLockHash}`);
  log('OK: manifest count=97, locations=98, duplicates=1');

  const vendor = path.join(ROOT, 'vendor');
  if (fs.existsSync(vendor)) {
    const st = fs.lstatSync(vendor);
    if (!st.isDirectory() || st.isSymbolicLink()) throw new Error('vendor no es directorio regular');
  } else fs.mkdirSync(vendor);
  fs.writeFileSync(path.join(vendor,'manifest.json'), JSON.stringify(manifest,null,2)+'\n');

  let downloaded = 0, kept = 0;
  for (let i=0; i<manifest.entries.length; i++) {
    const entry = manifest.entries[i];
    const dest = path.join(vendor, entry.fileName);
    if (fs.existsSync(dest)) {
      const st = fs.lstatSync(dest);
      if (!st.isFile() || st.isSymbolicLink()) throw new Error(`destino inseguro: ${entry.fileName}`);
      if (verifySRI(fs.readFileSync(dest), entry.integrity)) { kept++; continue; }
      fs.rmSync(dest);
    }
    let success = false;
    for (const url of entry.resolvedUrls) {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' || parsed.hostname !== 'registry.npmjs.org') throw new Error(`URL fuera del registry autorizado: ${url}`);
      const temp = path.join(vendor, `.${entry.fileName}.${process.pid}.part`);
      try {
        fs.rmSync(temp, {force:true});
        const output = run('curl', [
          '--fail','--location','--silent','--show-error','--noproxy','*',
          '--proto','=https','--proto-redir','=https','--connect-timeout','15',
          '--max-time','120','--max-redirs','5','--output',temp,
          '--write-out','\n%{url_effective}',url
        ]);
        const finalUrl = output.trim().split(/\r?\n/).at(-1);
        const finalParsed = new URL(finalUrl);
        if (finalParsed.protocol !== 'https:' || finalParsed.hostname !== 'registry.npmjs.org') {
          throw new Error(`redirect a host no autorizado: ${finalUrl}`);
        }
        const bytes = fs.readFileSync(temp);
        if (!verifySRI(bytes, entry.integrity)) throw new Error('SRI no coincide');
        fs.renameSync(temp, dest);
        downloaded++;
        success = true;
        break;
      } catch (err) {
        fs.rmSync(temp,{force:true});
        log(`URL fallida ${url}: ${err.message}`);
      }
    }
    if (!success) throw new Error(`descarga fallida: ${entry.name}@${entry.version}`);
    if ((i+1) % 10 === 0 || i+1 === manifest.entries.length) log(`Descargas: ${i+1}/97`);
  }
  log(`descargados=${downloaded} existentes_ok=${kept} archivos_unicos=97`);
  audit(lock, manifest, vendor);

  const checksumLines = manifest.entries.map(e => {
    const file = path.join(vendor,e.fileName);
    return `${sha256(fs.readFileSync(file))}  ${e.fileName}`;
  }).sort();
  fs.writeFileSync(path.join(vendor,'BUNDLE_FILES.sha256'),checksumLines.join('\n')+'\n');

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(),'oneup-machine-a-'));
  try {
    const payload = path.join(tempRoot,'payload');
    fs.mkdirSync(payload);
    for (const name of ['manifest.json','BUNDLE_FILES.sha256',...manifest.entries.map(e=>e.fileName)]) {
      fs.copyFileSync(path.join(vendor,name),path.join(payload,name));
    }
    const names = ['BUNDLE_FILES.sha256','manifest.json',...manifest.entries.map(e=>e.fileName).sort()];
    run('zip',['-X','-q','-9',path.join(ROOT,ZIP),...names],{cwd:payload});
    const zipHash = sha256(fs.readFileSync(path.join(ROOT,ZIP)));
    fs.writeFileSync(path.join(ROOT,SIDE),`${zipHash}  ${ZIP}\n`);
    run('sha256sum',['-c',SIDE],{cwd:ROOT});
    run('unzip',['-tq',path.join(ROOT,ZIP)]);
    const listing = run('unzip',['-Z1',path.join(ROOT,ZIP)],{cwd:ROOT}).trim().split(/\r?\n/);
    const expectedArchive = new Set(['manifest.json','BUNDLE_FILES.sha256',...manifest.entries.map(e => e.fileName)]);
    if (listing.length !== 99 || listing.some(n => !n || n.includes('/') || n.includes('\\') || !expectedArchive.has(n)) ||
        new Set(listing).size !== 99 || listing.filter(n => n.endsWith('.tgz')).length !== 97 ||
        [...expectedArchive].some(n => !listing.includes(n))) {
      throw new Error(`ZIP inválido: entries=\${listing.length}`);
    }
    const extracted = path.join(tempRoot,'verify');
    fs.mkdirSync(extracted);
    run('unzip',['-q',path.join(ROOT,ZIP),'-d',extracted],{cwd:ROOT});
    const extractedManifest = JSON.parse(fs.readFileSync(path.join(extracted,'manifest.json'),'utf8'));
    audit(lock, extractedManifest, extracted, true);
    const sums = fs.readFileSync(path.join(extracted,'BUNDLE_FILES.sha256'),'utf8').trim().split(/\r?\n/);
    const expectedSumNames = new Set(manifest.entries.map(e => e.fileName));
    const seenSumNames = new Set();
    if (sums.length !== 97) throw new Error('BUNDLE_FILES.sha256 no contiene 97 líneas');
    for (const line of sums) {
      const m = /^([a-f0-9]{64})  ([^/\\]+)$/.exec(line);
      if (!m || seenSumNames.has(m[2]) || !expectedSumNames.has(m[2]) ||
          sha256(fs.readFileSync(path.join(extracted,m[2]))) !== m[1]) throw new Error(`checksum ZIP incorrecto: \${line}`);
      seenSumNames.add(m[2]);
    }
    if (seenSumNames.size !== expectedSumNames.size || [...expectedSumNames].some(n => !seenSumNames.has(n))) {
      throw new Error('BUNDLE_FILES.sha256 no cubre exactamente los 97 tarballs');
    }
    log('VEREDICTO: PASS (98/98 ubicaciones, 97/97 archivos, integridad OK)');
    log('=== MÁQUINA A COMPLETADA (PASS real) ===');
    log(`Bundle: ${ZIP}`);
    log(`Sidecar: ${SIDE}`);
    log(`SHA-256: ${zipHash}`);
    log(`Log: ${LOG}`);
  } finally {
    fs.rmSync(tempRoot,{recursive:true,force:true});
  }
}
try {
  await main();
} catch (error) {
  log(`ERROR: ${error?.stack || error}`);
  fs.rmSync(path.join(ROOT,ZIP),{force:true});
  fs.rmSync(path.join(ROOT,SIDE),{force:true});
  process.exitCode = 1;
}

'use strict';
const $ = id => document.getElementById(id);

// ── 설정 (기기에만 저장. 못 쓰면 기본값으로 돈다) ──
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const prefs = Object.assign({ len: 'key', fall: 3, countin: true, offset: 0, mix: 'orig' }, store.get('prefs', {}));
const savePrefs = () => store.set('prefs', prefs);

// ── 곡 파일 (.pcsong) — 구조는 make_song.py 머리말 참고 ──
function parseSong(buf) {
  const dv = new DataView(buf);
  if (new TextDecoder().decode(new Uint8Array(buf, 0, 4)) !== 'PCS1') throw new Error('곡 파일(.pcsong)이 아니에요');
  const n = dv.getUint32(4, true);
  const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, n)));
  const base = 8 + n;
  meta.audioBytes = rate => { const [off, len] = meta.audio[rate]; return buf.slice(base + off, base + off + len); };
  return meta;
}

// ── 곡 보관 (IndexedDB) ──
const dbReady = new Promise((ok, fail) => {
  const req = indexedDB.open('piano-cover-practice', 1);
  req.onupgradeneeded = () => req.result.createObjectStore('songs', { keyPath: 'id', autoIncrement: true });
  req.onsuccess = () => ok(req.result);
  req.onerror = () => fail(req.error);
});
async function tx(mode, fn) {
  const db = await dbReady;
  return new Promise((ok, fail) => {
    const t = db.transaction('songs', mode), r = fn(t.objectStore('songs'));
    t.oncomplete = () => ok(r && r.result); t.onerror = () => fail(t.error);
  });
}
const listSongs = () => tx('readonly', s => s.getAll());
const getSong = id => tx('readonly', s => s.get(id));
const putSong = rec => tx('readwrite', s => s.put(rec));
const deleteSong = id => tx('readwrite', s => s.delete(id));

// ── 곡 목록 화면 ──
const fmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

async function renderLibrary() {
  const songs = (await listSongs()).sort((a, b) => (b.opened || b.added) - (a.opened || a.added));
  $('empty').hidden = songs.length > 0;
  $('songs').replaceChildren(...songs.map(rec => {
    const li = document.createElement('li');
    const pos = store.get(`pos:${rec.id}`, 0);
    li.innerHTML = `<div class="info"><div class="name"></div>
      <div class="sub">${fmt(rec.duration || 0)} · 음 ${rec.noteCount}개 · ${(rec.blob.size / 1e6).toFixed(1)}MB${pos > 1 ? ` · ${fmt(pos)}부터 이어서` : ''}</div></div>
      <button class="btn">삭제</button>`;
    li.querySelector('.name').textContent = rec.title;
    li.querySelector('.info').onclick = () => openSong(rec.id);
    li.querySelector('button').onclick = async () => {
      if (!confirm(`「${rec.title}」을(를) 지울까요?`)) return;
      await deleteSong(rec.id);
      if (rec.remote) {  // 저장소에도 지운다. 안 지우면 다음 동기화 때 다시 받아 온다
        dismissed.add(rec.remote); store.set('dismissed', [...dismissed]);
        removeRemote(`songs/${rec.remote}`).catch(() => {});
      }
      renderLibrary();
    };
    return li;
  }));
}

$('import').onchange = async e => {
  const file = e.target.files[0]; e.target.value = '';
  if (!file) return;
  $('lib-msg').textContent = '불러오는 중…';
  try {
    const meta = parseSong(await file.arrayBuffer());
    await putSong({ title: meta.title, duration: meta.duration, noteCount: meta.notes.length, blob: file, added: Date.now() });
    $('lib-msg').textContent = `「${meta.title}」을(를) 추가했어요.`;
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist();  // 저장 공간이 모자라도 지우지 않게
  } catch (err) {
    $('lib-msg').textContent = `불러오지 못했어요: ${err.message}`;
  }
  renderLibrary();
};

// ── 링크로 추가: 비공개 GitHub 저장소를 대기열로 쓴다 ──
// 폰은 queue/<영상ID>.json 을 넣고, PC 의 worker.py 가 켜질 때 변환해 songs/<영상ID>.pcsong 을 올린다.
// 저장소 구조는 worker.py 머리말 참고
const server = Object.assign({ repo: 'bhj2837/piano-cover-songs', token: '' }, store.get('server', {}));
const dismissed = new Set(store.get('dismissed', []));
let pollTimer = null;

async function api(path, { method = 'GET', body, raw = false } = {}) {
  const r = await fetch(`https://api.github.com/repos/${server.repo}/contents/${path}`, {
    method, cache: 'no-store',
    headers: {
      Authorization: `Bearer ${server.token}`,
      Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
    },
    body: body && JSON.stringify(body),
  });
  if (r.status === 404) return null;
  if (r.status === 401) throw new Error('토큰이 맞지 않아요. 설정에서 다시 넣어 주세요');
  if (!r.ok) throw new Error(`GitHub 응답 ${r.status}`);
  return r;
}
const listDir = async dir => { const r = await api(dir); return r ? r.json() : []; };
const toBase64 = s => btoa(String.fromCharCode(...new TextEncoder().encode(s)));

async function removeRemote(path) {
  const r = await api(path);
  if (r) await api(path, { method: 'DELETE', body: { message: `앱에서 지움 ${path}`, sha: (await r.json()).sha } });
}

function videoId(text) {
  const m = String(text).match(/https?:\/\/\S+/);  // 유튜브 앱 공유는 "제목 + 링크" 로 온다
  if (!m) return null;
  try {
    const u = new URL(m[0]);
    const id = u.hostname.endsWith('youtu.be') ? u.pathname.slice(1)
      : u.searchParams.get('v') || (u.pathname.match(/\/(?:shorts|live|embed)\/([\w-]+)/) || [])[1];
    return /^[\w-]{11}$/.test(id || '') ? id : null;
  } catch { return null; }
}

async function requestSong(text) {
  const msg = $('link-msg');
  const id = videoId(text);
  if (!id) { msg.textContent = '유튜브 링크를 찾지 못했어요'; return; }
  if (!server.token) { msg.textContent = '설정에서 GitHub 토큰을 먼저 넣어 주세요'; return; }
  msg.textContent = '보내는 중…';
  try {
    if (await api(`songs/${id}.pcsong`)) { dismissed.delete(`${id}.pcsong`); store.set('dismissed', [...dismissed]); msg.textContent = '이미 변환된 곡이에요. 받아 올게요'; return syncSongs(); }
    const body = { url: `https://www.youtube.com/watch?v=${id}`, requested: new Date().toISOString() };
    const r = await fetch(`https://api.github.com/repos/${server.repo}/contents/queue/${id}.json`, {
      method: 'PUT', headers: { Authorization: `Bearer ${server.token}` },
      body: JSON.stringify({ message: `대기열 추가 ${id}`, content: toBase64(JSON.stringify(body)) }),
    });
    if (r.status === 422) msg.textContent = '이미 대기열에 있어요';
    else if (!r.ok) throw new Error(`GitHub 응답 ${r.status}`);
    else { msg.textContent = '대기열에 넣었어요. PC 가 켜져 있으면 1~2분 안에 곡이 생겨요'; $('link').value = ''; }
  } catch (err) { msg.textContent = `보내지 못했어요: ${err.message}`; }
  syncSongs();
}

let syncing = null;
// 동시에 두 번 돌면 같은 곡을 두 번 받는다 — 돌고 있으면 그걸 기다린다
const syncSongs = () => syncing || (syncing = doSync().finally(() => (syncing = null)));

async function doSync() {
  clearTimeout(pollTimer);
  if (!server.token) { $('pending').replaceChildren(); return; }
  try {
    const [songs, queue, failed] = await Promise.all(['songs', 'queue', 'failed'].map(listDir));
    const have = new Set((await listSongs()).map(r => r.remote).filter(Boolean));
    for (const f of songs) {
      if (!f.name.endsWith('.pcsong') || have.has(f.name) || dismissed.has(f.name)) continue;
      $('lib-msg').textContent = `새 곡 받는 중… (${(f.size / 1e6).toFixed(1)}MB)`;
      const blob = await (await api(f.path, { raw: true })).blob();
      const meta = parseSong(await blob.arrayBuffer());
      await putSong({ title: meta.title, duration: meta.duration, noteCount: meta.notes.length, blob, added: Date.now(), remote: f.name });
      $('lib-msg').textContent = `「${meta.title}」이(가) 도착했어요.`;
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
    }
    renderPending(queue, failed);
    renderLibrary();
    if (queue.length) pollTimer = setTimeout(syncSongs, 30000);  // 기다리는 곡이 있으면 30초마다 확인
  } catch (err) {
    $('lib-msg').textContent = `저장소를 확인하지 못했어요: ${err.message}`;
  }
}

function renderPending(queue, failed) {
  const items = [
    ...queue.map(f => ({ id: f.name.replace('.json', ''), text: '변환 대기 중 · PC 가 켜지면 변환돼요' })),
    ...failed.map(f => ({ id: f.name.replace('.json', ''), text: '변환 실패', path: f.path })),
  ];
  $('pending').replaceChildren(...items.map(it => {
    const li = document.createElement('li');
    li.innerHTML = `<div class="info"><div class="name"></div><div class="sub"></div></div>`;
    li.querySelector('.name').textContent = `youtu.be/${it.id}`;
    li.querySelector('.sub').textContent = it.text;
    if (it.path) {
      const b = document.createElement('button'); b.className = 'btn'; b.textContent = '지우기';
      b.onclick = async () => { await removeRemote(it.path).catch(() => {}); syncSongs(); };
      li.append(b);
      api(it.path, { raw: true }).then(r => r && r.json()).then(j => { if (j) li.querySelector('.sub').textContent = `변환 실패 · ${j.error}`; }).catch(() => {});
    }
    return li;
  }));
}

$('link-form').onsubmit = e => { e.preventDefault(); requestSong($('link').value); };

// ── 연습 화면: 오디오 ──
// 원음과 변환음을 AudioContext 시계 하나로 돌린다. 막대도 같은 시계를 본다
const ac = new AudioContext();
const master = new DynamicsCompressorNode(ac); master.connect(ac.destination);
const origGain = new GainNode(ac), synthGain = new GainNode(ac);
origGain.connect(master); synthGain.connect(master);
const handGain = [new GainNode(ac), new GainNode(ac)];
handGain.forEach(h => h.connect(synthGain));

let song = null, songId = null, notes = [], buffers = {}, lo = 21, hi = 108;
let rate = 1, playing = false, songPos = 0, startCtx = 0, startSong = 0, src = null;
let voices = [], schedIdx = 0, loopA = null, loopB = null, wakeLock = null;
const show = [true, true];

const duration = () => (buffers['1'] && buffers['1'].duration) || (song && song.duration) || 1;
const latency = () => ac.outputLatency || ac.baseLatency || 0;
// 지금 귀에 들리는 곡 위치. 카운트다운 중에는 시작점보다 작다
const songNow = () => playing ? startSong + (ac.currentTime - latency() - startCtx) * rate : songPos;

function decode(r) {
  if (!buffers[r]) buffers[r] = ac.decodeAudioData(song.audioBytes(r)).then(b => (buffers[r] = b));
  return Promise.resolve(buffers[r]);
}

function applyMix() {
  origGain.gain.value = prefs.mix === 'orig' || prefs.mix === 'both' ? 1 : 0;
  synthGain.gain.value = prefs.mix === 'midi' || prefs.mix === 'both' ? 1 : 0;
}

function scheduleSynth() {
  const horizon = startSong + (ac.currentTime + 1 - startCtx) * rate;  // 1초 앞까지 예약
  while (schedIdx < notes.length && notes[schedIdx][0] < horizon) {
    const [s, , p, v, h, e] = notes[schedIdx++];  // 소리는 늘 페달 포함 길이
    if (s < startSong) continue;
    const t0 = startCtx + (s - startSong) / rate, t1 = startCtx + (e - startSong) / rate;
    const amp = 0.25 * (v / 127) ** 1.5, f = 440 * 2 ** ((p - 69) / 12);
    const env = new GainNode(ac, { gain: 0 }); env.connect(handGain[h]);
    env.gain.setValueAtTime(0, t0);
    env.gain.linearRampToValueAtTime(amp, t0 + 0.005);
    env.gain.setTargetAtTime(amp * 0.3, t0 + 0.005, 0.4);      // 피아노처럼 서서히 줄어듦
    env.gain.setTargetAtTime(0, Math.max(t1, t0 + 0.01), 0.05); // 건반 뗌
    for (const [type, mult, lvl] of [['triangle', 1, 1], ['sine', 2, 0.3]]) {
      const o = new OscillatorNode(ac, { type, frequency: f * mult });
      const lg = new GainNode(ac, { gain: lvl }); o.connect(lg); lg.connect(env);
      o.start(t0); o.stop(t1 + 0.4);
      voices.push([o, t1 + 0.4]);
    }
  }
  voices = voices.filter(([, end]) => end > ac.currentTime);  // 끝난 소리는 목록에서 뺀다
}

// 소리 예약·구간 반복·곡 끝 처리는 화면 그리기와 따로 돈다 (그리기는 화면이 가려지면 멈춘다)
setInterval(() => {
  if (!playing) return;
  scheduleSynth();
  const now = songNow();
  if (loopA != null && loopB != null && now >= loopB) start(loopA);
  else if (now >= duration()) { pause(); songPos = 0; }
}, 50);

function stopAll() {
  if (src) { try { src.stop(); } catch {} src = null; }
  for (const [o] of voices) try { o.stop(); } catch {}
  voices = [];
}

async function start(at, countIn = false) {
  stopAll();
  const buf = await decode(String(rate));
  songPos = Math.max(0, Math.min(at, duration() - 0.1));
  startSong = songPos;
  startCtx = ac.currentTime + (countIn ? 3 : 0.05);
  src = new AudioBufferSourceNode(ac, { buffer: buf });
  src.connect(origGain); src.start(startCtx, songPos / rate);
  schedIdx = 0; playing = true; scheduleSynth();
  setPlayIcon();
}

function pause() {
  if (!playing) return;
  songPos = Math.max(0, songNow()); playing = false; stopAll();
  setPlayIcon(); savePos();
}

function setPlayIcon() {
  $('play').textContent = playing ? '❚❚' : '▶';
  $('play').setAttribute('aria-label', playing ? '정지' : '재생');
  if (playing && navigator.wakeLock && !wakeLock) {  // 연습 중 화면 꺼짐 방지
    navigator.wakeLock.request('screen').then(l => { wakeLock = l; l.onrelease = () => (wakeLock = null); }).catch(() => {});
  } else if (!playing && wakeLock) wakeLock.release();
}

const savePos = () => songId != null && store.set(`pos:${songId}`, songPos);

async function togglePlay() {
  await ac.resume();
  if (playing) pause();
  else start(songPos, prefs.countin);
}

// ── 연습 화면: 곡 열기·닫기 ──
async function openSong(id) {
  const rec = await getSong(id);
  if (!rec) return;
  song = parseSong(await rec.blob.arrayBuffer());
  songId = id; notes = song.notes; buffers = {};
  rec.opened = Date.now(); putSong(rec);
  // 건반은 곡에 쓰인 음역만 보여 준다 (폰에서 88건반은 너무 좁다). 최소 두 옥타브
  const ps = notes.map(n => n[2]);
  lo = Math.max(21, Math.min(...ps) - 1); hi = Math.min(108, Math.max(...ps) + 1);
  while (hi - lo < 24) { if (lo > 21) lo--; if (hi < 108) hi++; }
  while (isBlack(lo)) lo--; while (isBlack(hi)) hi++;
  whites = []; for (let p = lo; p <= hi; p++) if (!isBlack(p)) whites.push(p);

  songPos = store.get(`pos:${id}`, 0); loopA = loopB = null; updateAB();
  $('title').textContent = song.title;
  $('library').hidden = true; $('player').hidden = false;
  $('play').disabled = true; $('loading').hidden = false;
  resize();
  await decode(String(rate));
  $('play').disabled = false; $('loading').hidden = true;
  history.pushState({ player: true }, '');
}

function closeSong() {
  pause(); song = null; songId = null; notes = []; buffers = {};
  $('player').hidden = true; $('library').hidden = false;
  renderLibrary();
}
$('back').onclick = () => history.back();
addEventListener('popstate', () => { if (song) closeSong(); });  // 안드로이드 뒤로 가기
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

// ── 연습 화면: 그리기 ──
const isBlack = p => [1, 3, 6, 8, 10].includes(p % 12);
let whites = [];
const cv = $('c'), g = cv.getContext('2d');

function keyX(p, W) {
  const w = W / whites.length;
  if (!isBlack(p)) return [whites.indexOf(p) * w, w];
  return [whites.indexOf(p - 1) * w + w * 0.65, w * 0.7];
}
function resize() {
  cv.width = cv.clientWidth * devicePixelRatio;
  cv.height = cv.clientHeight * devicePixelRatio;
}
addEventListener('resize', resize);

function draw() {
  requestAnimationFrame(draw);
  if (!song || !cv.width) return;
  if (playing) {
    const left = startCtx - ac.currentTime;
    $('count').hidden = left <= 0;
    if (left > 0) $('count').textContent = Math.ceil(left);
  } else $('count').hidden = true;

  const dpr = devicePixelRatio, W = cv.width, H = cv.height;
  const kbH = Math.min(H * 0.2, W / whites.length * 4.5), rollH = H - kbH;
  const look = +prefs.fall, t = songNow() + prefs.offset / 1000, px = rollH / look, gap = 2 * dpr;
  g.fillStyle = '#111'; g.fillRect(0, 0, W, H);

  // 도(C)마다 세로 안내선, 반복 구간 표시
  g.fillStyle = '#242424';
  for (const p of whites) if (p % 12 === 0) g.fillRect(keyX(p, W)[0], 0, dpr, rollH);
  for (const [mark, label] of [[loopA, 'A'], [loopB, 'B']]) {
    if (mark == null || mark < t || mark > t + look) continue;
    const y = rollH - (mark - t) * px;
    g.fillStyle = '#5b9bff'; g.fillRect(0, y, W, dpr);
    g.font = `${12 * dpr}px system-ui`; g.fillText(label, 4 * dpr, y - 4 * dpr);
  }

  const active = new Map();
  for (const [s, keyEnd, p, v, h, pedEnd] of notes) {
    if (s > t + look) break;
    const e = prefs.len === 'pedal' ? pedEnd : keyEnd;
    if (!show[h] || e < t) continue;
    if (s <= t) active.set(p, h);
    const [x, w] = keyX(p, W);
    const yBot = Math.min(rollH, rollH - (s - t) * px), yTop = Math.max(0, rollH - (e - t) * px + gap);
    g.globalAlpha = 0.55 + 0.45 * v / 127;
    g.fillStyle = h ? (isBlack(p) ? '#2a6bc0' : '#3d8ef3') : (isBlack(p) ? '#c0741f' : '#f39c3d');
    g.beginPath(); g.roundRect(x + dpr, yTop, w - 2 * dpr, Math.max(3 * dpr, yBot - yTop), 3 * dpr); g.fill();
  }
  g.globalAlpha = 1;

  // 건반
  for (const black of [false, true]) for (let p = lo; p <= hi; p++) {
    if (isBlack(p) !== black) continue;
    const [x, w] = keyX(p, W), kh = black ? kbH * 0.62 : kbH;
    g.fillStyle = active.has(p) ? (active.get(p) ? '#3d8ef3' : '#f39c3d') : black ? '#000' : '#eee';
    g.fillRect(x + dpr / 2, rollH, w - dpr, kh);
    if (!black && p % 12 === 0) {  // 도에 옥타브 이름
      g.fillStyle = active.has(p) ? '#fff' : '#888'; g.font = `${Math.min(11 * dpr, w * 0.45)}px system-ui`;
      g.textAlign = 'center'; g.fillText(`C${p / 12 - 1}`, x + w / 2, rollH + kbH - 5 * dpr); g.textAlign = 'left';
    }
  }
  g.fillStyle = '#555'; g.fillRect(0, rollH - dpr, W, 2 * dpr);

  const shown = Math.max(0, songNow());
  $('seek').value = shown / duration();
  $('time').textContent = fmt(shown);
}
requestAnimationFrame(draw);

// ── 연습 화면: 조작 ──
$('play').onclick = togglePlay;
cv.onclick = () => { if (!$('play').disabled) togglePlay(); };  // 화면을 톡 치면 재생/정지
$('seek').oninput = e => { const at = e.target.value * duration(); playing ? start(at) : (songPos = at); };
$('seek').onchange = savePos;
$('rate').onchange = e => { const at = Math.max(0, songNow()); rate = +e.target.value; playing ? start(at) : (songPos = at); };
$('mix').value = prefs.mix;
$('mix').onchange = e => { prefs.mix = e.target.value; savePos(); savePrefs(); applyMix(); };
applyMix();
for (const [id, h] of [['hr', 0], ['hl', 1]]) $(id).onclick = () => {
  show[h] = !show[h]; handGain[h].gain.value = +show[h]; $(id).classList.toggle('on', show[h]);
};

// 구간 반복: 한 번 누르면 A, 두 번째에 B, 세 번째에 해제
function updateAB() {
  $('ab').textContent = loopA == null ? '구간 A' : loopB == null ? '구간 B' : `${fmt(loopA)}–${fmt(loopB)} ✕`;
  $('ab').classList.toggle('on', loopA != null);
}
$('ab').onclick = () => {
  const now = Math.max(0, songNow());
  if (loopA == null) loopA = now;
  else if (loopB == null) { [loopA, loopB] = now > loopA ? [loopA, now] : [now, loopA]; if (playing) start(loopA); }
  else loopA = loopB = null;
  updateAB();
};

// 설정
$('settings-btn').onclick = $('lib-settings').onclick = () => $('settings').showModal();
$('repo').value = server.repo; $('token').value = server.token;
$('repo').onchange = $('token').onchange = () => {
  server.repo = $('repo').value.trim(); server.token = $('token').value.trim();
  store.set('server', server); syncSongs();
};
$('len').value = prefs.len; $('fall').value = prefs.fall; $('countin').checked = prefs.countin;
$('offset').value = prefs.offset; $('offv').textContent = `${prefs.offset}ms`;
$('len').onchange = e => { prefs.len = e.target.value; savePrefs(); };
$('fall').onchange = e => { prefs.fall = +e.target.value; savePrefs(); };
$('countin').onchange = e => { prefs.countin = e.target.checked; savePrefs(); };
$('offset').oninput = e => { prefs.offset = +e.target.value; $('offv').textContent = `${prefs.offset}ms`; savePrefs(); };

// ── 시작 ──
renderLibrary();
// 유튜브 앱 「공유」 → 이 앱 으로 들어오면 주소에 링크가 실려 온다 (manifest 의 share_target)
const shared = new URLSearchParams(location.search);
if (shared.has('share')) {
  history.replaceState(null, '', location.pathname);
  const text = `${shared.get('url') || ''} ${shared.get('text') || ''}`;
  $('link').value = (text.match(/https?:\/\/\S+/) || [''])[0];  // 토큰이 없어 못 보내도 링크는 남겨 둔다
  requestSong(text);
} else syncSongs();
document.addEventListener('visibilitychange', () => { if (!document.hidden && !song) syncSongs(); });
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
  // 새 판이 깔리면 한 번 새로 고친다 (연습 중이면 다음에)
  const hadOld = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadOld && !song) location.reload(); });
}

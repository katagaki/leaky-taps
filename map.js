import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

const RB = "https://rocket-boys.co.jp/security-measures-lab/";
const DAYS_PER_SEC = 4;
const RECENT_DAYS = 7;
const LON0 = 136.5, LAT0 = 35.5, KX = Math.cos((LAT0 * Math.PI) / 180);
const SLAB = 0.08;

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (n) => n.toLocaleString("ja-JP");
const compact = (n) => new Intl.NumberFormat("ja-JP", { notation: "compact", maximumFractionDigits: 1 }).format(n);
const fmtDate = (iso) => { const [y, m, d] = iso.split("-").map(Number); return `${y}年${m}月${d}日`; };
const toUTC = (iso) => { const [y, m, d] = iso.split("-").map(Number); return Date.UTC(y, m - 1, d); };
const toISO = (ms) => new Date(ms).toISOString().slice(0, 10);
const DAY = 86400000;
const project = (lon, lat) => [(lon - LON0) * KX, -(lat - LAT0)];

// ── Data ─────────────────────────────────────────────────────
const all = LEAKS.map((r) => ({ ...r, src: r.src.map((s) => (s.startsWith("rb:") ? RB + s.slice(3) : s)) }));
const START = Math.min(...all.map((r) => toUTC(r.d)));
const END = Math.max(...all.map((r) => toUTC(r.d)));
const SPAN = Math.round((END - START) / DAY);

const placed = all.filter((r) => GEO[r.ja]).sort((a, b) => a.d.localeCompare(b.d));
const missing = all.length - placed.length;

// Leaks sharing a spot fan out in a sunflower pattern so each column stays hoverable.
const seen = new Map();
placed.forEach((r) => {
  const [lat, lon, place] = GEO[r.ja];
  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  const k = seen.get(key) || 0;
  seen.set(key, k + 1);
  const [x, z] = project(lon, lat);
  const rad = 0.09 * Math.sqrt(k), ang = k * 2.39996;
  r.place = place;
  r.day = Math.round((toUTC(r.d) - START) / DAY);
  r.x = x + rad * Math.cos(ang);
  r.z = z + rad * Math.sin(ang);
  r.h = r.n == null ? 0.1 : 0.12 + 0.36 * Math.log10(Math.max(r.n, 1));
});

const perDay = new Array(SPAN + 1).fill(0);
all.forEach((r) => perDay[Math.round((toUTC(r.d) - START) / DAY)]++);

// ── Scene ────────────────────────────────────────────────────
const host = $("#scene");
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
} catch {
  $("#scene-error").hidden = false;
  throw new Error("WebGL unavailable");
}
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setClearColor(0x000000);
host.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x000000, 40, 80);
const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 200);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.screenSpacePanning = false;
controls.maxPolarAngle = 1.25;
controls.minDistance = 2;
controls.maxDistance = 70;

scene.add(new THREE.HemisphereLight(0xffffff, 0x202020, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.4);
sun.position.set(-6, 12, 8);
scene.add(sun);

// Graticule every 5°.
{
  const pts = [];
  for (let lon = 120; lon <= 150; lon += 5) { const [x0, z0] = project(lon, 22); const [x1, z1] = project(lon, 47); pts.push(x0, -0.01, z0, x1, -0.01, z1); }
  for (let lat = 25; lat <= 45; lat += 5) { const [x0, z0] = project(120, lat); const [x1, z1] = project(150, lat); pts.push(x0, -0.01, z0, x1, -0.01, z1); }
  const g = new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  scene.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x1c1c1c })));
}

// Prefectures: one merged extruded slab plus outlines.
{
  const toVecs = (ring) => { const v = []; for (let i = 0; i < ring.length; i += 2) { const [x, z] = project(ring[i], ring[i + 1]); v.push(new THREE.Vector2(x, -z)); } return v; };
  const geoms = [];
  const line = [];
  JAPAN.forEach((pref) => pref.p.forEach(([outer, ...holes]) => {
    const shape = new THREE.Shape(toVecs(outer));
    holes.forEach((h) => shape.holes.push(new THREE.Path(toVecs(h))));
    geoms.push(new THREE.ExtrudeGeometry(shape, { depth: SLAB, bevelEnabled: false }));
    [outer, ...holes].forEach((ring) => {
      for (let i = 0; i < ring.length; i += 2) {
        const j = (i + 2) % ring.length;
        const [ax, az] = project(ring[i], ring[i + 1]);
        const [bx, bz] = project(ring[j], ring[j + 1]);
        line.push(ax, SLAB + 0.002, az, bx, SLAB + 0.002, bz);
      }
    });
  }));
  const land = new THREE.Mesh(mergeGeometries(geoms), new THREE.MeshLambertMaterial({ color: 0x262626 }));
  land.rotation.x = -Math.PI / 2;
  scene.add(land);
  const lg = new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(line, 3));
  scene.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x525252 })));
}

// Columns: one instance per leak, in date order, so `count` reveals them chronologically.
const colGeom = new THREE.CylinderGeometry(1, 1, 1, 12).translate(0, 0.5, 0);
const columns = new THREE.InstancedMesh(colGeom, new THREE.MeshLambertMaterial({ color: 0xffffff }), placed.length);
columns.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
columns.count = 0;
scene.add(columns);

const C_FRESH = new THREE.Color(0xff2e3a), C_OLD = new THREE.Color(0x861219);
const C_UNK_FRESH = new THREE.Color(0xc6c6c6), C_UNK_OLD = new THREE.Color(0x6f6f6f);
const tmpC = new THREE.Color(), tmpM = new THREE.Matrix4();

// Ripples on arrival, driven by wall-clock time so they read at any playback speed.
const ringGeom = new THREE.RingGeometry(0.86, 1, 48).rotateX(-Math.PI / 2);
const ripples = Array.from({ length: 48 }, () => {
  const m = new THREE.Mesh(ringGeom, new THREE.MeshBasicMaterial({ color: 0xff2e3a, transparent: true, depthWrite: false }));
  m.visible = false;
  m.userData.t0 = -1;
  scene.add(m);
  return m;
});
let rippleIdx = 0;
function ripple(r) {
  const m = ripples[rippleIdx++ % ripples.length];
  m.position.set(r.x, SLAB + 0.004, r.z);
  m.userData = { t0: performance.now(), size: 0.35 + 0.22 * Math.log10(Math.max(r.n || 10, 10)) };
  m.material.color.set(r.n == null ? 0xc6c6c6 : 0xff2e3a);
  m.visible = true;
}

const marker = new THREE.Mesh(new THREE.RingGeometry(0.12, 0.16, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff }));
marker.visible = false;
scene.add(marker);

// ── Camera framing ───────────────────────────────────────────
const fly = { from: null, to: null, t: 1 };
function frame() {
  const w = host.clientWidth, h = host.clientHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
  return w / h;
}
function home() {
  const aspect = frame();
  // Wide screens look from the south-east so the archipelago runs across the frame.
  const az = aspect > 1.1 ? 0.7 : 0.15;
  const halfW = aspect > 1.1 ? 9.5 : 7.5;
  const hfov = 2 * Math.atan(Math.tan((camera.fov * Math.PI) / 360) * aspect);
  const dist = Math.min(68, Math.max(halfW / Math.tan(hfov / 2), aspect > 1.1 ? 0 : 30));
  const polar = 0.85;
  const target = new THREE.Vector3(aspect > 1.1 ? 0 : -0.5, 0, aspect > 1.1 ? 0.6 : 1);
  camera.position.set(
    target.x + dist * Math.sin(polar) * Math.sin(az),
    dist * Math.cos(polar),
    target.z + dist * Math.sin(polar) * Math.cos(az),
  );
  controls.target.copy(target);
  controls.update();
}
function flyTo(r) {
  const offset = camera.position.clone().sub(controls.target);
  const len = Math.min(offset.length(), 22);
  offset.setLength(len);
  const target = new THREE.Vector3(r.x, 0, r.z);
  fly.from = { pos: camera.position.clone(), tgt: controls.target.clone() };
  fly.to = { pos: target.clone().add(offset), tgt: target };
  fly.t = 0;
}
new ResizeObserver(() => frame()).observe(host);
home();
renderer.domElement.addEventListener("dblclick", home);

// ── Timeline UI ──────────────────────────────────────────────
const scrub = $("#scrub");
scrub.max = String(SPAN);
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const state = { t: reduceMotion ? SPAN : 0, playing: false, speed: 1, lastDay: -1, prevCount: 0 };

const spark = $("#spark");
const maxDay = Math.max(...perDay);
spark.innerHTML = perDay.map((n) => `<i style="--h:${n ? Math.max(0.08, Math.sqrt(n / maxDay)) : 0}"></i>`).join("");
const sparkBars = [...spark.children];

const months = $("#months");
for (let ms = START; ms <= END; ms += DAY) {
  const d = new Date(ms);
  if (d.getUTCDate() === 1 || ms === START) {
    const left = ((ms - START) / DAY / SPAN) * 100;
    if (ms !== START || d.getUTCDate() < 20) months.insertAdjacentHTML("beforeend", `<span style="left:${left}%">${d.getUTCMonth() + 1}月</span>`);
  }
}

const playBtn = $("#play");
function setPlaying(on) {
  if (on && state.t >= SPAN) state.t = 0;
  state.playing = on;
  playBtn.classList.toggle("on", on);
  playBtn.setAttribute("aria-label", on ? "一時停止" : "再生");
}
playBtn.addEventListener("click", () => setPlaying(!state.playing));
$("#speed").addEventListener("change", (e) => { state.speed = Number(e.target.value); });
scrub.addEventListener("input", () => { state.t = Number(scrub.value); setPlaying(false); });
addEventListener("keydown", (e) => {
  if (e.code === "Space" && !e.target.closest("input, select, button")) { e.preventDefault(); setPlaying(!state.playing); }
});

const recent = $("#recent");
function updateDay(day) {
  const iso = toISO(START + day * DAY);
  $("#hud-date").textContent = fmtDate(iso);
  const upto = all.filter((r) => r.d <= iso);
  $("#hud-count").textContent = fmt(upto.length);
  $("#hud-total").textContent = compact(upto.reduce((s, r) => s + (r.n || 0), 0));
  sparkBars.forEach((b, i) => b.classList.toggle("past", i <= day));

  const from = toISO(START + (day - RECENT_DAYS + 1) * DAY);
  const list = placed.filter((r) => r.d <= iso && r.d >= from).reverse();
  recent.innerHTML = list.length
    ? list.map((r) => `<li><button type="button" data-i="${placed.indexOf(r)}">
        <span class="r-name">${esc(r.ja.replace(/（.+）$/, ""))}</span>
        <span class="r-meta">${fmtDate(r.d).slice(5)} · ${esc(r.place)}${r.n != null ? ` · ${compact(r.n)}` : ""}</span>
      </button></li>`).join("")
    : `<li class="r-empty">この期間の公表はありません。</li>`;
}

// ── Hover / select ───────────────────────────────────────────
const tip = $("#tooltip");
const ray = new THREE.Raycaster();
const ptr = new THREE.Vector2();
let hovered = -1, pinned = -1;

function tipHTML(r) {
  const sources = r.src.map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(new URL(u).hostname.replace(/^www\d?\./, "") === "rocket-boys.co.jp" ? "セキュリティ対策Lab" : new URL(u).hostname.replace(/^www\d?\./, ""))} ↗</a>`).join("");
  return `<strong>${esc(r.ja)}</strong>
    <span class="t-row">${fmtDate(r.d)} · ${esc(r.place)}</span>
    <span class="t-row">${esc(r.nl)} · ${esc(r.cause)}</span>
    <span class="t-info">${esc(r.info)}</span>
    ${pinned >= 0 ? `<span class="t-src">${sources}</span>` : ""}`;
}
function showTip(i, x, y) {
  const r = placed[i];
  tip.innerHTML = tipHTML(r);
  tip.hidden = false;
  tip.classList.toggle("pinned", pinned >= 0);
  const tw = tip.offsetWidth, th = tip.offsetHeight;
  tip.style.left = `${Math.max(8, Math.min(x + 14, innerWidth - tw - 8))}px`;
  tip.style.top = `${y + 14 + th > innerHeight - 8 ? y - th - 14 : y + 14}px`;
  marker.position.set(r.x, SLAB + 0.006, r.z);
  marker.visible = true;
}
function hideTip() { tip.hidden = true; marker.visible = false; hovered = -1; }

function pick(e) {
  const rect = renderer.domElement.getBoundingClientRect();
  ptr.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
  ray.setFromCamera(ptr, camera);
  const hit = ray.intersectObject(columns)[0];
  return hit ? hit.instanceId : -1;
}
renderer.domElement.addEventListener("pointermove", (e) => {
  if (pinned >= 0 || e.pointerType !== "mouse") return;
  const i = pick(e);
  if (i === hovered) { if (i >= 0) showTip(i, e.clientX, e.clientY); return; }
  hovered = i;
  renderer.domElement.style.cursor = i >= 0 ? "pointer" : "";
  if (i >= 0) showTip(i, e.clientX, e.clientY); else hideTip();
});
renderer.domElement.addEventListener("pointerleave", () => { if (pinned < 0) hideTip(); });

let down = null;
renderer.domElement.addEventListener("pointerdown", (e) => { down = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener("pointerup", (e) => {
  if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
  const i = pick(e);
  pinned = i;
  if (i >= 0) { tip.style.pointerEvents = "auto"; showTip(i, e.clientX, e.clientY); } else { tip.style.pointerEvents = ""; hideTip(); }
});
document.addEventListener("pointerdown", (e) => {
  if (pinned >= 0 && !e.target.closest("#tooltip, canvas, #recent")) { pinned = -1; tip.style.pointerEvents = ""; hideTip(); }
});

recent.addEventListener("click", (e) => {
  const b = e.target.closest("button[data-i]");
  if (!b) return;
  const i = Number(b.dataset.i);
  flyTo(placed[i]);
  pinned = i;
  tip.style.pointerEvents = "auto";
  const rc = b.getBoundingClientRect();
  showTip(i, rc.left, rc.top);
  if (innerWidth > 900) tip.style.left = `${Math.max(8, rc.left - tip.offsetWidth - 8)}px`;
});
recent.addEventListener("pointerover", (e) => {
  const b = e.target.closest("button[data-i]");
  if (b && pinned < 0) { const r = placed[Number(b.dataset.i)]; marker.position.set(r.x, SLAB + 0.006, r.z); marker.visible = true; }
});
recent.addEventListener("pointerout", () => { if (pinned < 0) marker.visible = false; });

// ── Loop ─────────────────────────────────────────────────────
const easeOut = (x) => 1 - Math.pow(1 - x, 3);
let last = performance.now();
function tick(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  if (state.playing) {
    state.t = Math.min(SPAN, state.t + dt * DAYS_PER_SEC * state.speed);
    scrub.value = String(state.t);
    if (state.t >= SPAN) setPlaying(false);
  }

  const t = state.t;
  let count = 0;
  while (count < placed.length && placed[count].day <= t) count++;
  for (let i = 0; i < count; i++) {
    const r = placed[i];
    const age = t - r.day;
    const grow = easeOut(Math.min(1, age / 0.8 + 0.05));
    const w = 0.055;
    tmpM.makeScale(w, r.h * grow, w).setPosition(r.x, SLAB, r.z);
    columns.setMatrixAt(i, tmpM);
    const fade = Math.min(1, Math.max(0, (age - RECENT_DAYS) / 30));
    if (r.n == null) tmpC.copy(C_UNK_FRESH).lerp(C_UNK_OLD, fade);
    else tmpC.copy(C_FRESH).lerp(C_OLD, fade);
    columns.setColorAt(i, tmpC);
  }
  if (state.playing) for (let i = state.prevCount; i < count; i++) ripple(placed[i]);
  state.prevCount = count;
  columns.count = count;
  columns.instanceMatrix.needsUpdate = true;
  if (columns.instanceColor) columns.instanceColor.needsUpdate = true;

  const day = Math.floor(t);
  if (day !== state.lastDay) { state.lastDay = day; updateDay(day); }

  ripples.forEach((m) => {
    if (!m.visible) return;
    const p = (now - m.userData.t0) / 1400;
    if (p >= 1) { m.visible = false; return; }
    const s = m.userData.size * easeOut(p);
    m.scale.set(s, 1, s);
    m.material.opacity = 0.9 * (1 - p);
  });

  if (fly.t < 1) {
    fly.t = Math.min(1, fly.t + dt / 0.8);
    const k = easeOut(fly.t);
    camera.position.lerpVectors(fly.from.pos, fly.to.pos, k);
    controls.target.lerpVectors(fly.from.tgt, fly.to.tgt, k);
  }
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}

scrub.value = String(state.t);
$("#geo-note").textContent = `${fmt(all.length)}件中${fmt(placed.length)}件を地図に表示しています${missing ? `（所在地不明の${missing}件を除く）` : ""}。`;
requestAnimationFrame(tick);
if (!reduceMotion) setTimeout(() => setPlaying(true), 600);

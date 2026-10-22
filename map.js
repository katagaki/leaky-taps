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
const easeOut = (x) => 1 - Math.pow(1 - x, 3);
const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
// Slight overshoot so a new column pops up rather than just appearing.
const easeOutBack = (x) => 1 + 2.70158 * Math.pow(x - 1, 3) + 1.70158 * Math.pow(x - 1, 2);
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

// ── Data ─────────────────────────────────────────────────────
const all = LEAKS.map((r) => ({ ...r, src: r.src.map((s) => (s.startsWith("rb:") ? RB + s.slice(3) : s)) }));
const START = Math.min(...all.map((r) => toUTC(r.d)));
const END = Math.max(...all.map((r) => toUTC(r.d)));
const SPAN = Math.round((END - START) / DAY);
// The timeline runs to the end of the last day, so leaks staggered within it still appear.
const T_END = SPAN + 0.99;
const STAGGER = 0.85;

const placed = all.filter((r) => GEO[r.ja]).sort((a, b) => a.d.localeCompare(b.d));
const missing = all.length - placed.length;
const sameDay = new Map();
placed.forEach((r) => sameDay.set(r.d, (sameDay.get(r.d) || 0) + 1));

// Leaks sharing a spot fan out in a sunflower pattern so each column stays hoverable.
const seen = new Map();
const nthOfDay = new Map();
placed.forEach((r, i) => {
  const [lat, lon, place] = GEO[r.ja];
  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  const k = seen.get(key) || 0;
  seen.set(key, k + 1);
  const [x, z] = project(lon, lat);
  const rad = 0.09 * Math.sqrt(k), ang = k * 2.39996;
  r.place = place;
  r.i = i;
  // Busy days announce dozens at once; spreading them across the day lets them arrive one by one.
  const nth = nthOfDay.get(r.d) || 0;
  nthOfDay.set(r.d, nth + 1);
  r.day = Math.round((toUTC(r.d) - START) / DAY) + (STAGGER * nth) / sameDay.get(r.d);
  r.x = x + rad * Math.cos(ang);
  r.z = z + rad * Math.sin(ang);
  r.h = r.n == null ? 0.1 : 0.12 + 0.36 * Math.log10(Math.max(r.n, 1));
});

// ── Relationships: leaks that came through a shared vendor or platform ──
const shortName = (ja) => ja.replace(/（.+）$/, "");
const byJa = new Map(placed.map((r) => [r.ja, r]));
const groups = new Map();
placed.forEach((r) => {
  if (!r.via) return;
  let g = groups.get(r.via);
  if (!g) {
    const hub = byJa.get(r.via) || null;
    let x, z, place;
    if (hub) ({ x, z, place } = hub);
    else if (GEO[r.via]) { const [lat, lon, pl] = GEO[r.via]; [x, z] = project(lon, lat); place = pl; }
    else return;
    g = { key: r.via, name: shortName(r.via), hub, x, z, place, members: [] };
    groups.set(r.via, g);
    if (hub) hub.hubOf = g;
  }
  g.members.push(r);
  r.group = g;
});
const groupList = [...groups.values()].sort((a, b) => b.members.length - a.members.length || a.name.localeCompare(b.name, "ja"));
// A member can itself be the hub of a further chain (IDCF → futureshop → its shops), so focus follows it downstream.
function downstream(g, set = new Set()) {
  if (set.has(g)) return set;
  set.add(g);
  g.members.forEach((m) => m.hubOf && downstream(m.hubOf, set));
  return set;
}

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

// Arcs from each vendor/platform to the organisations its incident reached.
const ARC_N = 48;
const PULSE_SPEED = 2.5; // scene units per second
const arcs = [];
groupList.forEach((g) => g.members.forEach((r) => {
  const a = new THREE.Vector3(g.x, SLAB, g.z), b = new THREE.Vector3(r.x, SLAB, r.z);
  const mid = a.clone().lerp(b, 0.5);
  mid.y = SLAB + 0.35 + a.distanceTo(b) * 0.35;
  const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
  const geom = new THREE.BufferGeometry().setFromPoints(curve.getPoints(ARC_N));
  const line = new THREE.Line(geom, new THREE.LineBasicMaterial({ color: 0xffb3b8, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
  line.visible = false;
  scene.add(line);
  // Pulses travel at a steady speed, so longer arcs take longer to cross.
  const period = Math.max(700, (curve.getLength() / PULSE_SPEED) * 1000);
  arcs.push({ r, g, curve, line, period, phase: Math.random(), op: 0, glow: 0 });
}));

const dotTex = (() => {
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const ctx = c.getContext("2d");
  const grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.4, "rgba(255,215,217,0.8)");
  grad.addColorStop(1, "rgba(255,131,137,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
})();
const pulsePos = new Float32Array(Math.max(1, arcs.length) * 3);
// Additive blending, so a black vertex colour makes a pulse invisible.
const pulseCol = new Float32Array(Math.max(1, arcs.length) * 3);
const pulses = new THREE.Points(
  new THREE.BufferGeometry()
    .setAttribute("position", new THREE.BufferAttribute(pulsePos, 3))
    .setAttribute("color", new THREE.BufferAttribute(pulseCol, 3)),
  new THREE.PointsMaterial({ map: dotTex, size: 10, sizeAttenuation: false, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
);
pulses.frustumCulled = false;
scene.add(pulses);

// Vendors that appear only as a source (no leak entry of their own) get a floating diamond.
const hubMeshes = groupList.filter((g) => !g.hub).map((g) => {
  const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.1), new THREE.MeshBasicMaterial({ color: 0xffd7d9 }));
  m.position.set(g.x, SLAB + 0.25, g.z);
  m.userData.group = g;
  m.userData.dim = 0;
  m.visible = false;
  g.firstDay = Math.min(...g.members.map((r) => r.day));
  scene.add(m);
  return m;
});

const marker = new THREE.Mesh(new THREE.RingGeometry(0.12, 0.16, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff }));
marker.visible = false;
scene.add(marker);

// ── Camera framing ───────────────────────────────────────────
const FLY_SEC = 0.9;
const fly = { from: null, to: null, t: 1 };
// Grabbing the map mid-flight hands control straight back to the user.
controls.addEventListener("start", () => { fly.t = 1; });
function frame() {
  const w = host.clientWidth, h = host.clientHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
  return w / h;
}
function homePose() {
  const aspect = frame();
  // Wide screens look from the south-east so the archipelago runs across the frame.
  const az = aspect > 1.1 ? 0.7 : 0.15;
  const halfW = aspect > 1.1 ? 9.5 : 7.5;
  const hfov = 2 * Math.atan(Math.tan((camera.fov * Math.PI) / 360) * aspect);
  const dist = Math.min(68, Math.max(halfW / Math.tan(hfov / 2), aspect > 1.1 ? 0 : 30));
  const polar = 0.85;
  const tgt = new THREE.Vector3(aspect > 1.1 ? 0 : -0.5, 0, aspect > 1.1 ? 0.6 : 1);
  const off = new THREE.Vector3(
    dist * Math.sin(polar) * Math.sin(az),
    dist * Math.cos(polar),
    dist * Math.sin(polar) * Math.cos(az),
  );
  return { tgt, off };
}
// Target and viewing offset are interpolated separately, so the camera swings round
// rather than cutting a straight line that dips towards the map.
function flyToPose(to) {
  fly.from = { tgt: controls.target.clone(), off: camera.position.clone().sub(controls.target) };
  fly.to = to;
  fly.t = 0;
}
function flyTo(r, maxDist = 22) {
  const off = camera.position.clone().sub(controls.target);
  off.setLength(Math.min(off.length(), maxDist));
  flyToPose({ tgt: new THREE.Vector3(r.x, 0, r.z), off });
}
const tmpOff = new THREE.Vector3(), tmpDir = new THREE.Vector3();
function stepFly(dt) {
  if (fly.t >= 1) return;
  fly.t = reduceMotion ? 1 : Math.min(1, fly.t + dt / FLY_SEC);
  const k = easeInOut(fly.t);
  const len = THREE.MathUtils.lerp(fly.from.off.length(), fly.to.off.length(), k);
  tmpDir.copy(fly.to.off).normalize();
  tmpOff.copy(fly.from.off).normalize().lerp(tmpDir, k).setLength(len);
  controls.target.lerpVectors(fly.from.tgt, fly.to.tgt, k);
  camera.position.copy(controls.target).add(tmpOff);
}
new ResizeObserver(() => frame()).observe(host);
{
  const { tgt, off } = homePose();
  controls.target.copy(tgt);
  camera.position.copy(tgt).add(off);
  controls.update();
}
renderer.domElement.addEventListener("dblclick", () => flyToPose(homePose()));

// ── Timeline UI ──────────────────────────────────────────────
const scrub = $("#scrub");
scrub.max = String(T_END);
const state = { t: reduceMotion ? T_END : 0, playing: false, speed: 1, lastDay: -1, prevCount: 0, links: true };

const spark = $("#spark");
const maxDay = Math.max(...perDay);
spark.innerHTML = perDay.map((n) => `<i style="--h:${n ? Math.max(0.08, Math.sqrt(n / maxDay)) : 0}"></i>`).join("");
const sparkBars = [...spark.children];

const months = $("#months");
for (let ms = START; ms <= END; ms += DAY) {
  const d = new Date(ms);
  if (d.getUTCDate() === 1 || ms === START) {
    const left = ((ms - START) / DAY / (SPAN + 1)) * 100;
    if (ms !== START || d.getUTCDate() < 20) months.insertAdjacentHTML("beforeend", `<span style="left:${left}%">${d.getUTCMonth() + 1}月</span>`);
  }
}

const playBtn = $("#play");
function setPlaying(on) {
  if (on && state.t >= T_END) state.t = 0;
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
$("#links").addEventListener("change", (e) => { state.links = e.target.checked; if (!state.links) setFocus(null); });

// ── Side panel ───────────────────────────────────────────────
const recent = $("#recent");
const groupsEl = $("#groups");
document.querySelectorAll(".side-tabs [role=tab]").forEach((tab) => tab.addEventListener("click", () => {
  document.querySelectorAll(".side-tabs [role=tab]").forEach((t) => t.setAttribute("aria-selected", String(t === tab)));
  recent.hidden = tab.dataset.tab !== "recent";
  groupsEl.hidden = tab.dataset.tab !== "groups";
}));

const md = (iso) => fmtDate(iso).slice(5);
const span = (g) => { const a = g.members[0].d, b = g.members.at(-1).d; return a === b ? md(a) : `${md(a)}〜${md(b)}`; };

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
    ? list.map((r) => `<li><button type="button" data-i="${r.i}">
        <span class="r-name">${esc(shortName(r.ja))}</span>
        <span class="r-meta">${fmtDate(r.d).slice(5)} · ${esc(r.place)}${r.n != null ? ` · ${compact(r.n)}` : ""}${r.group ? ` · ${esc(r.group.name)}経由` : ""}</span>
      </button></li>`).join("")
    : `<li class="r-empty">この期間の公表はありません。</li>`;

  groupsEl.innerHTML = groupList.map((g, gi) => {
    const seen = g.members.filter((r) => r.d <= iso).length;
    return `<li><button type="button" data-g="${gi}" class="${state.pinGroup === g ? "active" : ""}"${seen ? "" : " disabled"}>
        <span class="r-name">${esc(g.name)}<span class="r-count">${seen}<small>/${g.members.length}</small></span></span>
        <span class="r-meta">${esc(g.place)} · ${span(g)}</span>
      </button></li>`;
  }).join("");
}

// ── Hover / select ───────────────────────────────────────────
const tip = $("#tooltip");
const ray = new THREE.Raycaster();
const ptr = new THREE.Vector2();
let hovered = null, pinned = null;

const hostLabel = (u) => { const h = new URL(u).hostname.replace(/^www\d?\./, ""); return h === "rocket-boys.co.jp" ? "セキュリティ対策Lab" : h; };
function leakHTML(r) {
  const sources = r.src.map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(hostLabel(u))} ↗</a>`).join("");
  return `<strong>${esc(r.ja)}</strong>
    <span class="t-row">${fmtDate(r.d)} · ${esc(r.place)}</span>
    <span class="t-row">${esc(r.nl)} · ${esc(r.cause)}</span>
    ${r.group ? `<span class="t-via">↖ ${esc(r.group.name)}を経由</span>` : ""}
    ${r.hubOf ? `<span class="t-via">↘ ${r.hubOf.members.length}件の事案に波及</span>` : ""}
    <span class="t-info">${esc(r.info)}</span>
    ${pinned ? `<span class="t-src">${sources}</span>` : ""}`;
}
function groupHTML(g) {
  const names = g.members.slice(0, 10).map((r) => `<li>${esc(shortName(r.ja))}</li>`).join("");
  const more = g.members.length > 10 ? `<li>ほか${g.members.length - 10}件</li>` : "";
  return `<strong>${esc(g.name)}</strong>
    <span class="t-row">${esc(g.place)}</span>
    <span class="t-via">↘ ${g.members.length}件の事案に波及</span>
    <ul>${names}${more}</ul>`;
}

// Target is { r } for a leak column or { g } for a vendor-only diamond.
function showTip(target, x, y) {
  tip.innerHTML = target.r ? leakHTML(target.r) : groupHTML(target.g);
  tip.hidden = false;
  tip.classList.toggle("pinned", !!pinned);
  tip.style.pointerEvents = pinned ? "auto" : "";
  const tw = tip.offsetWidth, th = tip.offsetHeight;
  tip.style.left = `${Math.max(8, Math.min(x + 14, innerWidth - tw - 8))}px`;
  tip.style.top = `${Math.max(8, y + 14 + th > innerHeight - 8 ? y - th - 14 : y + 14)}px`;
  const p = target.r || target.g;
  marker.position.set(p.x, SLAB + 0.006, p.z);
  marker.visible = true;
}
function hideTip() { tip.hidden = true; tip.style.pointerEvents = ""; marker.visible = false; }

// Hovering or pinning anything that belongs to a chain lights up the whole chain.
let focus = null;
function setFocus(g) { focus = g && state.links ? downstream(g) : null; }
const groupOf = (target) => target && (target.g || target.r.hubOf || target.r.group) || null;
function refreshFocus() { setFocus(state.pinGroup || groupOf(pinned) || groupOf(hovered)); }

function pick(e) {
  const rect = renderer.domElement.getBoundingClientRect();
  ptr.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
  ray.setFromCamera(ptr, camera);
  const hits = ray.intersectObjects([columns, ...hubMeshes.filter((m) => m.visible)]);
  const hit = hits[0];
  if (!hit) return null;
  return hit.object === columns ? { r: placed[hit.instanceId] } : { g: hit.object.userData.group };
}
const same = (a, b) => (a && b ? a.r === b.r && a.g === b.g : a === b);

renderer.domElement.addEventListener("pointermove", (e) => {
  if (pinned || e.pointerType !== "mouse") return;
  const target = pick(e);
  renderer.domElement.style.cursor = target ? "pointer" : "";
  if (!same(target, hovered)) { hovered = target; refreshFocus(); }
  if (target) showTip(target, e.clientX, e.clientY); else hideTip();
});
renderer.domElement.addEventListener("pointerleave", () => { if (!pinned) { hovered = null; hideTip(); refreshFocus(); } });

let down = null;
renderer.domElement.addEventListener("pointerdown", (e) => { down = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener("pointerup", (e) => {
  if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
  pinned = pick(e);
  hovered = null;
  if (pinned) { state.pinGroup = null; showTip(pinned, e.clientX, e.clientY); } else hideTip();
  refreshFocus();
});
function unpin() { pinned = null; state.pinGroup = null; hideTip(); refreshFocus(); groupsEl.querySelector(".active")?.classList.remove("active"); }
document.addEventListener("pointerdown", (e) => {
  if ((pinned || state.pinGroup) && !e.target.closest("#tooltip, canvas, .map-side")) unpin();
});

function tipBeside(el, target) {
  if (innerWidth <= 900) {
    // Stacked layout: the list sits below the map, so bring the map back into view first.
    hideTip();
    const stage = $(".map-stage");
    stage.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    setTimeout(() => {
      if (!same(pinned, target)) return;
      const rc = stage.getBoundingClientRect();
      showTip(target, rc.left, rc.top);
      tip.style.top = `${Math.max(56, rc.bottom - tip.offsetHeight - 8)}px`;
    }, 700);
    return;
  }
  const rc = el.getBoundingClientRect();
  showTip(target, rc.left, rc.top);
  if (innerWidth > 900) tip.style.left = `${Math.max(8, rc.left - tip.offsetWidth - 8)}px`;
}
recent.addEventListener("click", (e) => {
  const b = e.target.closest("button[data-i]");
  if (!b) return;
  const r = placed[Number(b.dataset.i)];
  flyTo(r);
  state.pinGroup = null;
  pinned = { r };
  tipBeside(b, pinned);
  refreshFocus();
});
groupsEl.addEventListener("click", (e) => {
  const b = e.target.closest("button[data-g]");
  if (!b) return;
  const g = groupList[Number(b.dataset.g)];
  if (state.pinGroup === g) { unpin(); return; }
  groupsEl.querySelector(".active")?.classList.remove("active");
  b.classList.add("active");
  state.pinGroup = g;
  pinned = { g };
  if (!state.links) { state.links = true; $("#links").checked = true; }
  flyTo(g, 26);
  tipBeside(b, pinned);
  refreshFocus();
});
[recent, groupsEl].forEach((el) => {
  el.addEventListener("pointerover", (e) => {
    const b = e.target.closest("button[data-i], button[data-g]");
    if (!b || pinned) return;
    const p = b.dataset.i ? placed[Number(b.dataset.i)] : groupList[Number(b.dataset.g)];
    marker.position.set(p.x, SLAB + 0.006, p.z);
    marker.visible = true;
    hovered = b.dataset.i ? { r: p } : { g: p };
    refreshFocus();
  });
  el.addEventListener("pointerout", () => { if (!pinned) { marker.visible = false; hovered = null; refreshFocus(); } });
});

// ── Loop ─────────────────────────────────────────────────────
// Growth, arc drawing and highlight fades run on wall-clock time so they read the same at any playback speed.
const GROW_MS = 450, ARC_MS = 700, FADE_SEC = 0.09;
const COL_W = 0.035;
const C_HUB = new THREE.Color(0xffd7d9), C_HUB_DIM = new THREE.Color(0x3a2a2b);
const inFocus = (r) => focus && ((r.group && focus.has(r.group)) || (r.hubOf && focus.has(r.hubOf)));
const dimTarget = (r) => (focus && !inFocus(r) ? 1 : 0);
const clamp01 = (x) => Math.min(1, Math.max(0, x));
let last = performance.now();
function tick(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const smooth = reduceMotion ? 1 : 1 - Math.exp(-dt / FADE_SEC);

  if (state.playing) {
    state.t = Math.min(T_END, state.t + dt * DAYS_PER_SEC * state.speed);
    scrub.value = String(state.t);
    if (state.t >= T_END) setPlaying(false);
  }

  const t = state.t;
  let count = 0;
  while (count < placed.length && placed[count].day <= t) count++;
  // Leaks arriving during playback animate in; ones revealed by scrubbing appear fully grown.
  const animate = state.playing && !reduceMotion;
  for (let i = state.prevCount; i < count; i++) {
    const r = placed[i];
    r.born = animate ? now : -Infinity;
    r.dim = dimTarget(r);
    if (animate) ripple(r);
  }
  state.prevCount = count;

  for (let i = 0; i < count; i++) {
    const r = placed[i];
    const age = t - r.day;
    const grow = easeOutBack(Math.min(1, (now - r.born) / GROW_MS));
    tmpM.makeScale(COL_W, r.h * grow, COL_W).setPosition(r.x, SLAB, r.z);
    columns.setMatrixAt(i, tmpM);
    const fade = clamp01((age - RECENT_DAYS) / 30);
    if (r.n == null) tmpC.copy(C_UNK_FRESH).lerp(C_UNK_OLD, fade);
    else tmpC.copy(C_FRESH).lerp(C_OLD, fade);
    r.dim += (dimTarget(r) - r.dim) * smooth;
    tmpC.multiplyScalar(1 - 0.82 * r.dim);
    columns.setColorAt(i, tmpC);
  }
  columns.count = count;
  columns.instanceMatrix.needsUpdate = true;
  if (columns.instanceColor) columns.instanceColor.needsUpdate = true;

  // Arcs draw themselves from the vendor outwards as each affected leak is announced.
  let np = 0;
  arcs.forEach((a) => {
    const age = t - a.r.day;
    const on = state.links && age >= 0;
    a.line.visible = on;
    if (!on) { a.op = a.glow = 0; return; }
    const since = now - a.r.born;
    const prog = Math.min(1, since / ARC_MS);
    a.line.geometry.setDrawRange(0, Math.ceil(prog * (ARC_N + 1)));
    const lit = focus && focus.has(a.g);
    const fade = clamp01((age - RECENT_DAYS) / 30);
    a.op += ((focus ? (lit ? 0.95 : 0.03) : 0.55 - 0.35 * fade) - a.op) * smooth;
    a.line.material.opacity = a.op;

    a.glow += ((!reduceMotion && (lit || (!focus && age < RECENT_DAYS)) ? 1 : 0) - a.glow) * smooth;
    if (a.glow < 0.01) return;
    // While drawing, the pulse rides the tip. Afterwards it loops from the vendor,
    // fading in and out at the ends so it never visibly jumps back.
    let pos = prog, env = 1;
    if (prog >= 1) {
      pos = Number.isFinite(since) ? ((since - ARC_MS) / a.period) % 1 : (now / a.period + a.phase) % 1;
      env = Math.min(1, pos / 0.12, (1 - pos) / 0.12);
    }
    const p = a.curve.getPoint(pos);
    const b = env * a.glow;
    pulsePos.set([p.x, p.y, p.z], np * 3);
    pulseCol.set([b, b, b], np * 3);
    np++;
  });
  pulses.geometry.setDrawRange(0, np);
  pulses.geometry.attributes.position.needsUpdate = true;
  pulses.geometry.attributes.color.needsUpdate = true;
  hubMeshes.forEach((m) => {
    const g = m.userData.group;
    m.visible = state.links && t >= g.firstDay;
    if (!reduceMotion) m.rotation.y = now / 1200;
    m.userData.dim += ((focus && !focus.has(g) ? 1 : 0) - m.userData.dim) * smooth;
    m.material.color.copy(C_HUB).lerp(C_HUB_DIM, m.userData.dim);
  });

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

  stepFly(dt);
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}

scrub.value = String(state.t);
const linked = groupList.reduce((s, g) => s + g.members.length, 0);
$("#geo-note").textContent = `${fmt(all.length)}件中${fmt(placed.length)}件を地図に表示しています${missing ? `（所在地不明の${missing}件を除く）` : ""}。関係線は${groupList.length}の事業者・基盤から${linked}件の事案に引いています。`;
requestAnimationFrame(tick);
if (!reduceMotion) setTimeout(() => setPlaying(true), 600);

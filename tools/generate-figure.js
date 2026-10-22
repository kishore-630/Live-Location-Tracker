/* ==========================================================================
   ORIGINAL ARTWORK GENERATOR — public/assets/figure.svg
   Live Location Intelligence (Kishore Kumar)

   Builds the faceted, low-poly hooded figure used as the hero artwork.
   The asset is generated from scratch here: a hand-authored silhouette,
   a Delaunay mesh over it, and a lighting model that produces the
   black-navy / hot-magenta rim-lit look. No third-party image, no
   watermark, no placeholder typography, no external URL.

   Deterministic: the same seed always yields the same artwork, so the
   file can be regenerated at any time with `node tools/generate-figure.js`.

   Output is presentation only. Nothing here touches application logic.
   ========================================================================== */
const fs = require("fs")
const path = require("path")

const OUT = path.join(__dirname, "..", "public", "assets", "figure.svg")

/* ---------- deterministic PRNG (mulberry32) ---------- */
let _s = 20241017
function rnd() {
    _s = (_s + 0x6D2B79F5) >>> 0
    let t = _s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const range = (a, b) => a + rnd() * (b - a)

/* ---------- palette (matches the design tokens in magenta.css) ---------- */
const C_VOID = "#05040B"
const C_SHADOW = [11, 7, 19]     // #0B0713
const C_MID = [48, 16, 56]        // deep violet plane
const C_CRIM = [183, 13, 85]      // #B70D55
const C_MAGENTA = [255, 22, 139]  // #FF168B
const C_HOT = [255, 47, 159]      // #FF2F9F

/* ---------- silhouette: hooded bust, three-quarter, facing right ----------
   A wide, angular cowl over a dark face void, pinched at the neck, then
   flaring into broad shoulders that run off the bottom of the frame. */
const SILHOUETTE = [
    [344, 78],   // crown of the hood
    [436, 112],
    [498, 182],
    [528, 266],
    [538, 348],  // widest part of the cowl
    [528, 428],
    [502, 496],
    [466, 546],  // neck, right side
    [700, 624],  // shoulder line — far wider than the hood
    [800, 720],
    [856, 880],
    [862, 1180], // bottom right (runs off frame, below the viewBox)
    [-62, 1180], // bottom left  (runs off frame, below the viewBox)
    [-46, 860],
    [96, 700],
    [214, 624],  // shoulder line, left
    [292, 546],  // neck, left side
    [248, 496],
    [208, 436],
    [180, 356],
    [178, 266],
    [208, 182],
    [266, 112]
]

/* the shadowed opening where the face sits — carved out of the mesh */
const VOID = [
    [384, 288],
    [446, 318],
    [480, 392],
    [462, 470],
    [414, 528],
    [352, 508],
    [320, 434],
    [330, 336]
]

const W = 800, H = 1010

/* ---------- geometry helpers ---------- */
function inside(poly, x, y) {
    let hit = false
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[i], [xj, yj] = poly[j]
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit
    }
    return hit
}

function segDist(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay
    const l2 = dx * dx + dy * dy
    let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0
    t = Math.max(0, Math.min(1, t))
    const qx = ax + t * dx, qy = ay + t * dy
    return Math.hypot(px - qx, py - qy)
}

function distToPolyline(poly, x, y) {
    let d = Infinity
    for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length]
        d = Math.min(d, segDist(x, y, a[0], a[1], b[0], b[1]))
    }
    return d
}

function area(poly) {
    let a = 0
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += (poly[j][0] + poly[i][0]) * (poly[j][1] - poly[i][1])
    return Math.abs(a / 2)
}

/* ---------- 1. densify the boundary rings (angular, not smooth) ---------- */
function densify(poly, step, jitter) {
    const out = []
    for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length]
        const len = Math.hypot(b[0] - a[0], b[1] - a[1])
        const n = Math.max(1, Math.round(len / step))
        const nx = -(b[1] - a[1]) / len, ny = (b[0] - a[0]) / len
        for (let k = 0; k < n; k++) {
            const t = k / n
            const j = k === 0 ? 0 : range(-jitter, jitter)
            out.push([a[0] + (b[0] - a[0]) * t + nx * j, a[1] + (b[1] - a[1]) * t + ny * j])
        }
    }
    return out
}

const outer = densify(SILHOUETTE, 64, 8)
const inner = densify(VOID, 58, 5)

/* ---------- 2. interior point cloud ----------
   Deliberately sparse: big, readable planes are what makes the artwork read
   as low-poly rather than as a rendered mesh. */
const points = outer.concat(inner)
const STEP = 68
for (let y = 120; y < 1180; y += STEP) {
    for (let x = 90; x < W; x += STEP) {
        const px = x + range(-20, 20), py = y + range(-20, 20)
        if (!inside(SILHOUETTE, px, py)) continue
        if (inside(VOID, px, py)) continue
        if (distToPolyline(SILHOUETTE, px, py) < 24) continue
        if (distToPolyline(VOID, px, py) < 16) continue
        let ok = true
        for (let i = 0; i < points.length; i++) {
            if (Math.hypot(points[i][0] - px, points[i][1] - py) < 54) { ok = false; break }
        }
        if (ok) points.push([px, py])
    }
}

/* ---------- 3. Delaunay (Bowyer–Watson, incremental) ---------- */
function circum(a, b, c) {
    const ax = a[0], ay = a[1], bx = b[0], by = b[1], cx = c[0], cy = c[1]
    const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by))
    if (Math.abs(d) < 1e-9) return null
    const a2 = ax * ax + ay * ay, b2 = bx * bx + by * by, c2 = cx * cx + cy * cy
    const ux = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d
    const uy = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d
    const dx = ux - ax, dy = uy - ay
    return { x: ux, y: uy, r2: dx * dx + dy * dy }
}

function delaunay(pts) {
    const minX = Math.min(...pts.map(p => p[0])), maxX = Math.max(...pts.map(p => p[0]))
    const minY = Math.min(...pts.map(p => p[1])), maxY = Math.max(...pts.map(p => p[1]))
    const d = Math.max(maxX - minX, maxY - minY) * 20
    const mid = [(minX + maxX) / 2, (minY + maxY) / 2]

    const seedTri = [[mid[0] - d, mid[1] - d], [mid[0] + d, mid[1] - d], [mid[0], mid[1] + d]]
    const sc = circum(seedTri[0], seedTri[1], seedTri[2])

    /* a triangle is [i, j, k, circumcircle] over the pool below */
    const pool = seedTri.map(p => ({ p }))
    let tris = [[0, 1, 2, sc]]

    for (let n = 0; n < pts.length; n++) {
        const p = { p: pts[n] }
        pool.push(p)
        const ni = pool.length - 1
        const px = pts[n][0], py = pts[n][1]

        const doomed = []
        for (let t = 0; t < tris.length; t++) {
            const c = tris[t][3]
            const dx = px - c.x, dy = py - c.y
            if (dx * dx + dy * dy <= c.r2) doomed.push(t)
        }

        /* boundary of the removed cavity = edges used exactly once
           (keys are canonicalised so (a,b) and (b,a) cancel out) */
        const edges = new Map()
        for (const t of doomed) {
            const tri = tris[t]
            for (const e of [[tri[0], tri[1]], [tri[1], tri[2]], [tri[2], tri[0]]]) {
                const k = Math.min(e[0], e[1]) + ":" + Math.max(e[0], e[1])
                if (edges.has(k)) edges.delete(k)
                else edges.set(k, e)
            }
        }
        const kept = tris.filter((_, i) => !doomed.includes(i))
        const fresh = []
        for (const e of edges.values()) {
            const c = circum(pool[e[0]].p, pool[e[1]].p, pts[n])
            if (c) fresh.push([e[0], e[1], ni, c])
        }
        tris = kept.concat(fresh)
    }

    return tris
        .filter(t => t[0] >= 3 && t[1] >= 3 && t[2] >= 3)
        .map(t => [pool[t[0]].p, pool[t[1]].p, pool[t[2]].p])
}

/* ---------- 4. lighting ----------
   Deliberately harsh. The key light is almost side-on (very little z), so a
   facet facing the camera stays near-black and only steeply tilted planes
   catch light. That contrast is what produces the reference look: an almost
   black figure with fire along its edges. */
const DOME = (x, y, cx, cy, rx, ry) =>
    Math.sqrt(Math.max(0, 1 - ((x - cx) / rx) ** 2 - ((y - cy) / ry) ** 2))

function height(x, y) {
    let h = 0
    h += 172 * DOME(x, y, 344, 288, 254, 276)   // hood + skull
    h += 120 * DOME(x, y, 352, 520, 150, 120)   // neck / collar swell
    h += 156 * DOME(x, y, 206, 866, 424, 340)   // left shoulder mass
    h += 146 * DOME(x, y, 626, 890, 418, 330)   // right shoulder mass
    h += 72 * DOME(x, y, 410, 716, 260, 210)    // chest plane
    /* carved hollows: the neck, and cloth valleys down both sides */
    h -= 158 * Math.exp(-(((x - 378) / 88) ** 2 + ((y - 566) / 62) ** 2))
    h -= 82 * Math.exp(-(((x - 214) / 122) ** 2 + ((y - 730) / 155) ** 2))
    h -= 60 * Math.exp(-(((x - 646) / 112) ** 2 + ((y - 752) / 145) ** 2))
    /* the face itself is a hollow inside the cowl */
    h -= 126 * Math.exp(-(((x - 402) / 94) ** 2 + ((y - 404) / 128) ** 2))
    return Math.max(0, h)
}

const norm = v => {
    const l = Math.hypot(v[0], v[1], v[2]) || 1
    return [v[0] / l, v[1] / l, v[2] / l]
}
const KEY = norm([0.80, -0.72, 0.15])     // hot rim from upper right
const BACK = norm([-0.66, -0.30, 0.20])   // cooler kicker from upper left
const FILL = norm([-0.50, 0.40, 0.55])    // very dim bounce from lower left

function normal(x, y) {
    const e = 5
    const dx = (height(x + e, y) - height(x - e, y)) / (2 * e)
    const dy = (height(x, y + e) - height(x, y - e)) / (2 * e)
    return norm([-dx * 3.4, -dy * 3.4, 1])
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
const mix = (a, b, t) => a + (b - a) * t
const mixRGB = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)]
const hex = c => "#" + c.map(v => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, "0")).join("")

/* ---------- 5. shade each facet ---------- */
const tris = delaunay(points)
const RIM_BAND = 54

const facets = tris.map(t => {
    const cx = (t[0][0] + t[1][0] + t[2][0]) / 3
    const cy = (t[0][1] + t[1][1] + t[2][1]) / 3
    const n = normal(cx, cy)

    const key = Math.max(0, n[0] * KEY[0] + n[1] * KEY[1] + n[2] * KEY[2])
    const back = Math.max(0, n[0] * BACK[0] + n[1] * BACK[1] + n[2] * BACK[2])
    const fill = Math.max(0, n[0] * FILL[0] + n[1] * FILL[1] + n[2] * FILL[2])

    /* base plane: almost black, lifting only where the key light bites */
    let c = mixRGB(C_SHADOW, C_MID, Math.pow(key, 1.35) * 0.92)
    c = mixRGB(c, C_CRIM, clamp((key - 0.62) / 0.26, 0, 1) * 0.62)
    c = mixRGB(c, C_MAGENTA, clamp((key - 0.88) / 0.12, 0, 1) * 0.75)
    /* the upper-left kicker stays in the crimson family, never hot pink */
    c = mixRGB(c, [96, 16, 62], Math.pow(back, 1.6) * 0.42)
    c = mixRGB(c, [22, 13, 36], fill * 0.30)

    /* --- rim light: facets hugging the silhouette burn along the edge --- */
    const dOut = distToPolyline(SILHOUETTE, cx, cy)
    const dIn = distToPolyline(VOID, cx, cy)
    const rim = Math.pow(clamp(1 - dOut / RIM_BAND, 0, 1), 1.6)
    /* right of the figure burns hot pink, the left falls back to crimson */
    const side = mixRGB(C_CRIM, C_HOT, clamp((cx - 250) / 330, 0, 1) * 0.75 + 0.25)
    c = mixRGB(c, side, rim * 0.9)
    /* the hood opening gets its own tighter, dimmer halo */
    c = mixRGB(c, [120, 18, 74], Math.pow(clamp(1 - dIn / 34, 0, 1), 2) * 0.5)

    const a = Math.abs((t[1][0] - t[0][0]) * (t[2][1] - t[0][1]) - (t[2][0] - t[0][0]) * (t[1][1] - t[0][1])) / 2
    return { t, cx, cy, c, rim, a, key }
})

/* keep the figure deep: the page background must stay the darkest thing */
for (const f of facets) f.c = f.c.map(v => v * 0.8)

const poly = pts => pts.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ")

/* ---------- 6. emit ---------- */
const spark = []
facets
    .filter(f => f.a > 900 && f.a < 5200 && f.rim < 0.25 && f.key > 0.34 && f.key < 0.66)
    .sort((a, b) => b.a - a.a)
    .forEach((f, i) => {
        if (i > 26) return
        spark.push(`<polygon class="mg-spark" style="--i:${i % 9}" points="${poly(f.t)}"/>`)
    })

const body = facets.map(f => {
    const edge = f.rim > 0.5
        ? `fill-opacity="1" stroke="rgba(255,79,175,0.42)" stroke-width="0.9"`
        : `fill-opacity="1" stroke="rgba(232,214,255,0.045)" stroke-width="0.7"`
    return `<polygon points="${poly(f.t)}" fill="${hex(f.c)}" ${edge}/>`
}).join("\n      ")

const outline = poly(SILHOUETTE)
const voidPts = poly(VOID)

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Faceted low-poly illustration of a hooded figure lit by hot magenta rim light">
  <title>Hooded figure — low-poly magenta</title>
  <defs>
    <linearGradient id="mgFade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff"/>
      <stop offset="0.55" stop-color="#fff"/>
      <stop offset="0.88" stop-color="#4a4a4a"/>
      <stop offset="1" stop-color="#000"/>
    </linearGradient>
    <mask id="mgMask" maskUnits="userSpaceOnUse" x="-200" y="0" width="${W + 400}" height="${H}">
      <rect x="-200" y="0" width="${W + 400}" height="${H}" fill="url(#mgFade)"/>
    </mask>
    <radialGradient id="mgHalo" cx="0.42" cy="0.34" r="0.55">
      <stop offset="0" stop-color="#FF168B" stop-opacity="0.30"/>
      <stop offset="0.55" stop-color="#B70D55" stop-opacity="0.10"/>
      <stop offset="1" stop-color="#05040B" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="mgVoid" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#05040B"/>
      <stop offset="1" stop-color="#12061C"/>
    </linearGradient>
    <linearGradient id="mgVisor" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#FF2F9F" stop-opacity="0"/>
      <stop offset="0.45" stop-color="#FF2F9F" stop-opacity="0.85"/>
      <stop offset="1" stop-color="#FF168B" stop-opacity="0.15"/>
    </linearGradient>
    <filter id="mgGlow" x="-25%" y="-25%" width="150%" height="150%">
      <feGaussianBlur stdDeviation="7" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="mgSoft" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="18"/>
    </filter>
    <style>
      .mg-spark{
        fill:none;
        stroke:#FF2F9F;
        stroke-width:1.1;
        opacity:0;
        animation:mgSpark 7.5s ease-in-out infinite;
        animation-delay:calc(var(--i) * .83s);
      }
      @keyframes mgSpark{
        0%,74%,100%{opacity:0}
        78%{opacity:.85}
        86%{opacity:.12}
        91%{opacity:.55}
      }
      .mg-breathe{animation:mgBreathe 11s ease-in-out infinite}
      @keyframes mgBreathe{0%,100%{opacity:.42}50%{opacity:.66}}
      @media (prefers-reduced-motion: reduce){
        .mg-spark,.mg-breathe{animation:none}
        .mg-spark{opacity:.08}
      }
    </style>
  </defs>

  <!-- ambient bloom behind the hood -->
  <ellipse cx="348" cy="360" rx="360" ry="400" fill="url(#mgHalo)"/>
  <g mask="url(#mgMask)">
    <g>
      ${body}
    </g>
    <g class="mg-breathe">
      ${spark.join("\n      ")}
    </g>

    <!-- shadowed face opening -->
    <polygon points="${voidPts}" fill="url(#mgVoid)"/>
    <polygon points="${voidPts}" fill="none" stroke="#FF2F9F" stroke-opacity="0.26" stroke-width="1.1"/>
    <!-- one shard of visor light inside the hood shadow -->
    <polygon points="340,398 468,370 472,392 344,418" fill="url(#mgVisor)" filter="url(#mgGlow)" opacity="0.8"/>
    <polygon points="352,436 430,418 434,430 356,446" fill="#B70D55" opacity="0.28"/>

    <!-- rim light along the silhouette -->
    <polygon points="${outline}" fill="none" stroke="#FF2F9F" stroke-width="7" stroke-opacity="0.30" filter="url(#mgSoft)"/>
    <polygon points="${outline}" fill="none" stroke="#FF7AC4" stroke-width="1.5" stroke-opacity="0.72"/>
  </g>
</svg>
`

fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, svg)

console.log(`figure.svg written -> ${OUT}`)
console.log(`  silhouette area : ${area(SILHOUETTE).toFixed(0)} px^2`)
console.log(`  mesh points      : ${points.length}`)
console.log(`  facets           : ${facets.length}`)
console.log(`  animated sparks  : ${spark.length}`)
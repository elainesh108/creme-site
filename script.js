(function () {
  "use strict";

  /* ---------------- RNG ---------------- */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function uniform(rng, lo, hi) { return lo + (hi - lo) * rng(); }

  const LAMBDA_STEPS = 120;   // resolution of the lambda grid
  const TRUE_N = 2000;        // reference sample for the "true" curve

  /* ---------------- Colours & small drawing helpers ---------------- */
  const ACCENT = "#24425a", BRASS = "#b07f31", BRASS_DARK = "#8a611f", RISK = "#a4402f",
    SAFE = "#3c6b4f", SAFE_DARK = "#2b4d38", MUTED = "#57666a", INK = "#17232a", PREF = "#7a4b7c";
  const FONT_UI = "IBM Plex Sans, sans-serif", FONT_MONO = "IBM Plex Mono, monospace";

  // Sequential ramp for the objective value: low (best) -> high (worst).
  const RAMP = ["#1e3a50", "#3f6a86", "#8fb0bf", "#d6d9cf", "#f3efe4"].map(hexToRgb);
  function hexToRgb(h) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }
  function rampColor(t) {
    t = Math.min(1, Math.max(0, isFinite(t) ? t : 0));
    const seg = t * (RAMP.length - 1), i = Math.min(RAMP.length - 2, Math.floor(seg)), f = seg - i;
    const c = RAMP[i].map((v, k) => Math.round(v + (RAMP[i + 1][k] - v) * f));
    return "rgb(" + c.join(",") + ")";
  }

  function dot(ctx, x, y, r, fill, stroke) {
    ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI);
    ctx.fillStyle = fill; ctx.fill();
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1.2; ctx.stroke(); }
  }
  function roundRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
  }
  function ring(ctx, x, y, r, stroke) {
    ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI);
    ctx.fillStyle = "rgba(251,251,247,0.85)"; ctx.fill();
    ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.stroke();
  }
  function diamond(ctx, x, y, r, fill, stroke) {
    ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath();
    ctx.fillStyle = fill; ctx.fill();
    ctx.strokeStyle = stroke; ctx.lineWidth = 1.2; ctx.stroke();
  }
  function label(ctx, text, x, y, color, align, font) {
    ctx.fillStyle = color || INK; ctx.font = font || ("10px " + FONT_UI); ctx.textAlign = align || "center";
    ctx.fillText(text, x, y);
  }
  // Like label(), but shifted horizontally so the text stays inside the canvas.
  function labelClamped(ctx, text, x, y, color, align, font, w) {
    ctx.font = font || ("10px " + FONT_UI);
    const tw = ctx.measureText(text).width, m = 4;
    let left = align === "right" ? x - tw : align === "left" ? x : x - tw / 2;
    left = Math.max(m, Math.min(w - m - tw, left));
    label(ctx, text, left, y, color, "left", font);
  }

  /* ---------------- LaTeX labels on canvas / SVG ----------------
     MathJax (SVG output, fontCache "none") renders a TeX string to a
     self-contained <svg>; we draw it into the canvases as an image and embed
     it directly inside the frontier SVG. Until MathJax is ready, or while an
     image is still decoding, a plain-text fallback is drawn instead. */
  let texReady = false;
  const texCache = new Map();
  let rerenderQueued = false;
  function queueRerender() {
    if (rerenderQueued) return;
    rerenderQueued = true;
    // setTimeout rather than requestAnimationFrame: the latter stalls in background tabs
    setTimeout(() => { rerenderQueued = false; renderAll(); }, 0);
  }
  function texSvg(tex, color, px) {
    if (!texReady) return null;
    let svg;
    try { svg = MathJax.tex2svg(tex, { display: false }).querySelector("svg"); } catch (e) { return null; }
    if (!svg) return null;
    const ex = px * 0.45; // MathJax sizes its output in ex units
    const w = parseFloat(svg.getAttribute("width")) * ex, h = parseFloat(svg.getAttribute("height")) * ex;
    const vaMatch = (svg.getAttribute("style") || "").match(/vertical-align:\s*(-?[\d.]+)ex/);
    const va = (vaMatch ? parseFloat(vaMatch[1]) : 0) * ex; // bottom of the box relative to the baseline
    svg.setAttribute("width", w.toFixed(2)); svg.setAttribute("height", h.toFixed(2));
    svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    svg.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
    svg.removeAttribute("style");
    const xml = new XMLSerializer().serializeToString(svg).split("currentColor").join(color);
    return { xml, w, h, baseline: h + va };
  }
  function texImage(tex, color, px) {
    const key = tex + "|" + color + "|" + px;
    let entry = texCache.get(key);
    if (entry) return entry;
    const r = texSvg(tex, color, px);
    if (!r) return null;
    entry = { img: new Image(), w: r.w, h: r.h, baseline: r.baseline, ready: false };
    entry.img.onload = () => { entry.ready = true; queueRerender(); };
    entry.img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(r.xml);
    texCache.set(key, entry);
    return entry;
  }
  // Draw TeX with its baseline at y. `w` (canvas width) enables horizontal clamping.
  function drawTex(ctx, tex, fallback, x, y, opts) {
    const o = opts || {};
    const color = o.color || INK, px = o.px || 11, align = o.align || "left", w = o.w;
    const entry = texImage(tex, color, px);
    if (!entry || !entry.ready) {
      const font = (o.bold ? "600 " : "") + px + "px " + FONT_UI;
      if (w) labelClamped(ctx, fallback, x, y, color, align, font, w); else label(ctx, fallback, x, y, color, align, font);
      return;
    }
    let left = align === "right" ? x - entry.w : align === "center" ? x - entry.w / 2 : x;
    if (w && o.flip !== undefined && left + entry.w > w - 4) left = o.flip - entry.w; // mirror to the other side of the anchor
    if (w) left = Math.max(4, Math.min(w - 4 - entry.w, left));
    if (o.plate) { ctx.fillStyle = "rgba(251,251,247,0.85)"; ctx.fillRect(left - 3, y - entry.baseline - 2, entry.w + 6, entry.h + 4); }
    ctx.drawImage(entry.img, left, y - entry.baseline, entry.w, entry.h);
  }
  // Same for the SVG frontier: returns markup for a nested <svg> (or a <text> fallback).
  function texMarkup(tex, fallback, x, y, opts) {
    const o = opts || {};
    const color = o.color || INK, px = o.px || 10, anchor = o.anchor || "start", rotate = o.rotate || 0;
    const r = texSvg(tex, color, px);
    let inner;
    if (!r) {
      inner = `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="IBM Plex Sans" font-size="${px}" fill="${color}">${fallback}</text>`;
    } else {
      const left = anchor === "end" ? x - r.w : anchor === "middle" ? x - r.w / 2 : x;
      inner = r.xml.replace("<svg ", `<svg x="${left.toFixed(1)}" y="${(y - r.baseline).toFixed(1)}" `);
    }
    return rotate ? `<g transform="rotate(${rotate} ${x} ${y})">${inner}</g>` : inner;
  }

  /* One-dimensional decision space: objective curve + gradient strip + minimiser. */
  function draw1DDecision(ctx, w, h, opts) {
    const { zMin, zMax, objective, zStar, candidate, bounds, xLabel, objLabel, ticks, fmtTick } = opts;
    const padL = 36, padR = 22, curveTop = 30, curveBot = 172, stripY = 206, stripH = 26;
    const sx = (z) => padL + ((z - zMin) / (zMax - zMin)) * (w - padL - padR);
    const N = 240, vals = [];
    for (let i = 0; i <= N; i++) { const z = zMin + ((zMax - zMin) * i) / N; vals.push([z, objective(z)]); }
    let lo = Infinity, hi = -Infinity;
    vals.forEach(([, v]) => { lo = Math.min(lo, v); hi = Math.max(hi, v); });
    const span = hi - lo || 1;
    const sy = (v) => curveBot - ((v - lo) / span) * (curveBot - curveTop);

    // gradient strip along the decision axis
    for (let i = 0; i < N; i++) {
      ctx.fillStyle = rampColor((vals[i][1] - lo) / span);
      ctx.fillRect(sx(vals[i][0]), stripY, sx(vals[i + 1][0]) - sx(vals[i][0]) + 0.6, stripH);
    }
    // infeasible parts of the axis (outside the draggable limits) are greyed out
    const [bLo, bHi] = bounds;
    ctx.fillStyle = "rgba(238,240,233,0.82)";
    if (bLo > zMin) ctx.fillRect(sx(zMin), stripY, sx(bLo) - sx(zMin), stripH);
    if (bHi < zMax) ctx.fillRect(sx(bHi), stripY, sx(zMax) - sx(bHi), stripH);
    ctx.strokeStyle = "rgba(36,66,90,0.5)"; ctx.lineWidth = 1;
    ctx.strokeRect(sx(zMin), stripY, sx(zMax) - sx(zMin), stripH);
    // limit grips: a tall rounded bar with a ridged knob, easy to grab
    const gripTop = stripY - 8, gripBot = stripY + stripH + 8;
    [bLo, bHi].forEach((b) => {
      const x = sx(b);
      ctx.fillStyle = "#fbfbf7"; ctx.strokeStyle = ACCENT; ctx.lineWidth = 1.6;
      roundRectPath(ctx, x - 5, gripTop, 10, gripBot - gripTop, 4); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = "rgba(36,66,90,0.55)"; ctx.lineWidth = 1;
      [-3, 0, 3].forEach((d) => { ctx.beginPath(); ctx.moveTo(x - 2, stripY + stripH / 2 + d); ctx.lineTo(x + 2, stripY + stripH / 2 + d); ctx.stroke(); });
    });
    ticks.forEach((t) => {
      ctx.beginPath(); ctx.moveTo(sx(t), stripY + stripH); ctx.lineTo(sx(t), stripY + stripH + 4); ctx.stroke();
      label(ctx, fmtTick ? fmtTick(t) : String(t), sx(t), stripY + stripH + 15, MUTED, "center", "10px " + FONT_MONO);
    });
    drawTex(ctx, xLabel[0], xLabel[1], (sx(zMin) + sx(zMax)) / 2, h - 8, { color: MUTED, px: 10, align: "center", w });

    // objective curve
    ctx.strokeStyle = "rgba(87,102,106,0.35)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(padL, curveBot + 0.5); ctx.lineTo(w - padR, curveBot + 0.5); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(padL + 0.5, curveTop); ctx.lineTo(padL + 0.5, curveBot); ctx.stroke();
    drawTex(ctx, objLabel[0], objLabel[1], padL + 4, curveTop - 8, { color: MUTED, px: 10, align: "left", w });
    // objective: solid where feasible, faint elsewhere
    const seg = (from, to, style, width) => {
      ctx.beginPath(); let started = false;
      vals.forEach(([z, v]) => { if (z < from - 1e-9 || z > to + 1e-9) return; started ? ctx.lineTo(sx(z), sy(v)) : ctx.moveTo(sx(z), sy(v)); started = true; });
      ctx.strokeStyle = style; ctx.lineWidth = width; ctx.stroke();
    };
    seg(zMin, zMax, "rgba(36,66,90,0.28)", 1.4);
    seg(bLo, bHi, ACCENT, 2);
    ctx.setLineDash([3, 3]); ctx.strokeStyle = "rgba(36,66,90,0.45)"; ctx.lineWidth = 1;
    [bLo, bHi].forEach((b) => { ctx.beginPath(); ctx.moveTo(sx(b), curveTop); ctx.lineTo(sx(b), curveBot); ctx.stroke(); });
    ctx.setLineDash([]);

    // draggable candidate decision
    if (candidate !== undefined) {
      const cx = sx(candidate), cv = objective(candidate);
      ctx.setLineDash([2, 3]); ctx.strokeStyle = PREF; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(cx, sy(cv)); ctx.lineTo(cx, stripY + stripH); ctx.stroke();
      ctx.setLineDash([]);
      ring(ctx, cx, sy(cv), 5, PREF);
      ring(ctx, cx, stripY + stripH / 2, 7, PREF);
    }

    // minimiser (draggable: sets lambda)
    const vStar = objective(zStar);
    ctx.setLineDash([3, 3]); ctx.strokeStyle = BRASS_DARK; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(sx(zStar), sy(vStar)); ctx.lineTo(sx(zStar), stripY + stripH); ctx.stroke();
    ctx.setLineDash([]);
    dot(ctx, sx(zStar), sy(vStar), 6, BRASS, BRASS_DARK);
    dot(ctx, sx(zStar), stripY + stripH / 2, 7, BRASS, BRASS_DARK);
    const iz = (px) => Math.min(zMax, Math.max(zMin, zMin + ((px - padL) / (w - padL - padR)) * (zMax - zMin)));
    return { sx, sy, iz, stripY, stripH, curveTop, curveBot, padL, padR, candidateY: stripY + stripH / 2, gripTop, gripBot, zMin, zMax, zStar, zStarCurveY: sy(vStar) };
  }

  // Hit tolerances are given in screen pixels; the canvas is drawn at 360 logical
  // px but displayed narrower or wider, so convert with the current scale.
  function hitR(screenPx) { return screenPx * (state.pointerScale || 1); }

  // Shared interaction for the one-dimensional decision panels.
  function hitTest1D(problem, p, g, scope) {
    const near = (x, y, r) => Math.hypot(x - p[0], y - p[1]) <= hitR(r);
    if (scope.candidate && near(g.sx(problem.toScalar(scope.candidate)), g.candidateY, 12)) return { type: "candidate" };
    // the robust decision itself: dragging it sets lambda
    if (near(g.sx(g.zStar), g.candidateY, 11) || near(g.sx(g.zStar), g.zStarCurveY, 11)) return { type: "zstar" };
    const [lo, hi] = problem.bounds;
    const onGrip = (b) => Math.abs(g.sx(b) - p[0]) <= hitR(9) && p[1] >= g.gripTop - hitR(4) && p[1] <= g.gripBot + hitR(4);
    if (onGrip(hi)) return { type: "hi" };
    if (onGrip(lo)) return { type: "lo" };
    return null;
  }
  function drag1D(problem, hit, p, g, scope) {
    const t = g.iz(p[0]);
    if (hit.type === "candidate") { scope.candidate = problem.fromScalar(clamp(t, problem.bounds[0], problem.bounds[1])); return "candidate"; }
    if (hit.type === "zstar") { scope.lambda = problem.lambdaFor(t); return "lambda"; }
    const gap = (g.zMax - g.zMin) * 0.04;
    if (hit.type === "lo") problem.bounds[0] = Math.min(t, problem.bounds[1] - gap);
    else problem.bounds[1] = Math.max(t, problem.bounds[0] + gap);
    problem.bounds[0] = Math.max(g.zMin, problem.bounds[0]); problem.bounds[1] = Math.min(g.zMax, problem.bounds[1]);
    scope.candidate = problem.fromScalar(clamp(problem.toScalar(scope.candidate), problem.bounds[0], problem.bounds[1]));
    return "recompute";
  }
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  /* ---------------- Problem: Linear programming ---------------- */
  // Feasible region Z = conv{v_1, ..., v_m} in the positive quadrant. The vertices
  // are draggable in the decision panel; the hull is recomputed whenever they move.
  const LP_Z_MAX = 1.15, LP_PLOT_MAX = 1.22;
  function defaultVertices(m) {
    const pts = [[0, 0]];
    for (let k = 0; k <= m - 2; k++) {
      const a = ((Math.PI / 2) * k) / (m - 2);
      pts.push([Math.round(Math.cos(a) * 100) / 100, Math.round(Math.sin(a) * 100) / 100]);
    }
    return pts;
  }
  // Andrew's monotone chain; returns CCW indices into `points`.
  function convexHull(points) {
    const pts = points.map((p, i) => ({ p, i })).sort((u, v) => (u.p[0] - v.p[0]) || (u.p[1] - v.p[1]));
    if (pts.length < 3) return pts.map((q) => q.i);
    const cross = (o, u, v) => (u.p[0] - o.p[0]) * (v.p[1] - o.p[1]) - (u.p[1] - o.p[1]) * (v.p[0] - o.p[0]);
    const lower = [];
    pts.forEach((q) => { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 1e-12) lower.pop(); lower.push(q); });
    const upper = [];
    for (let i = pts.length - 1; i >= 0; i--) { const q = pts[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 1e-12) upper.pop(); upper.push(q); }
    lower.pop(); upper.pop();
    return lower.concat(upper).map((q) => q.i);
  }
  function pointInPolygon(p, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  function nearestOnSegment(p, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.min(1, Math.max(0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
    return [a[0] + t * dx, a[1] + t * dy];
  }
  function clampToPolygon(p, poly) {
    if (poly.length >= 3 && pointInPolygon(p, poly)) return p;
    let best = poly[0] || [0, 0], bestD = Infinity;
    for (let i = 0; i < poly.length; i++) {
      const q = poly.length > 1 ? nearestOnSegment(p, poly[i], poly[(i + 1) % poly.length]) : poly[i];
      const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (d < bestD) { bestD = d; best = q; }
    }
    return best;
  }

  const LP = {
    id: "lp", label: "Linear programming",
    lambdaMax: 1,
    mu: [-1.1, -1],
    dims: 2,
    support: [[-2.1, -0.1], [-2, 0]],
    axisLabels: [["y_1", "y1"], ["y_2", "y2"]],
    pdf(a, b) { return (a >= -2.1 && a <= -0.1 && b >= -2 && b <= 0) ? 1 : 0; },
    sampleY(rng) { return { vec: [uniform(rng, -2.1, -0.1), uniform(rng, -2, 0)] }; },
    // worst case of y^T z over the box mu +- lambda, for z >= 0
    robustObjective(z, lambda) { return (LP.mu[0] + lambda) * z[0] + (LP.mu[1] + lambda) * z[1]; },
    worstCase(lambda) { return [LP.mu[0] + lambda, LP.mu[1] + lambda]; },
    vertices: defaultVertices(6),
    hullIdx: [],
    updateHull() { LP.hullIdx = convexHull(LP.vertices); },
    hull() { return LP.hullIdx.map((i) => LP.vertices[i]); },
    setVertexCount(m) { LP.vertices = defaultVertices(m); LP.updateHull(); },
    reset() { LP.setVertexCount(parseInt(els["ctrl-vertices"].value, 10) || 6); },
    solve(lambda) {
      const hull = LP.hull();
      let best = hull[0], bestVal = Infinity;
      hull.forEach((v) => {
        const val = LP.robustObjective(v, lambda);
        if (val < bestVal) { bestVal = val; best = v; }
      });
      return best;
    },
    costOfDecision(z, y) { return y.vec[0] * z[0] + y.vec[1] * z[1]; },
    oracleCost(y) {
      let best = Infinity;
      LP.hull().forEach((v) => { const val = y.vec[0] * v[0] + y.vec[1] * v[1]; if (val < best) best = val; });
      return best;
    },
    formatZ(z) { return "(" + z[0].toFixed(2) + ", " + z[1].toFixed(2) + ")"; },
    objectiveHTML: "\\[ \\min_{z}\\ \\max_{y\\in\\mathcal U_\\lambda} y^\\top z = \\min_z\\ (\\mu+\\lambda\\mathbf 1)^\\top z \\quad \\text{s.t.}\\quad z \\in \\mathcal Z = \\operatorname{conv}\\{v_1,\\dots,v_m\\} \\subset \\mathbb R^2_+ \\]",
    decisionSubtitle: "Drag a vertex \\(v_i\\) to reshape \\(\\mathcal Z\\), or drag the hollow marker to test a candidate \\(z\\). \\(z^*_\\lambda\\) is the vertex minimising \\(\\max_{y\\in\\mathcal U_\\lambda} y^\\top z\\).",
    drawDecision(ctx, w, h, state) {
      const padL = 34, padR = 16, padT = 16, padB = 30;
      const hull = LP.hull();
      const maxX = LP_PLOT_MAX, maxY = LP_PLOT_MAX;
      const sx = (x) => padL + (x / maxX) * (w - padL - padR);
      const sy = (y) => h - padB - (y / maxY) * (h - padT - padB);
      const ix = (px) => ((px - padL) / (w - padL - padR)) * maxX;
      const iy = (py) => ((h - padB - py) / (h - padT - padB)) * maxY;
      ctx.clearRect(0, 0, w, h);

      // objective gradient, clipped to the feasible polygon (linear => extremes at vertices)
      const lambda = state.lambda;
      let lo = Infinity, hi = -Infinity;
      hull.forEach((v) => { const o = LP.robustObjective(v, lambda); lo = Math.min(lo, o); hi = Math.max(hi, o); });
      const span = hi - lo || 1;
      ctx.save();
      ctx.beginPath();
      hull.forEach((v, i) => { const x = sx(v[0]), y = sy(v[1]); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); });
      ctx.closePath(); ctx.clip();
      const cell = 3;
      for (let px = sx(0); px < sx(maxX); px += cell) {
        for (let py = sy(maxY); py < sy(0); py += cell) {
          const o = LP.robustObjective([ix(px + cell / 2), iy(py + cell / 2)], lambda);
          ctx.fillStyle = rampColor((o - lo) / span);
          ctx.fillRect(px, py, cell + 0.5, cell + 0.5);
        }
      }
      ctx.restore();

      ctx.beginPath();
      hull.forEach((v, i) => { const x = sx(v[0]), y = sy(v[1]); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); });
      ctx.closePath();
      ctx.strokeStyle = "rgba(36,66,90,0.7)"; ctx.lineWidth = 1.3; ctx.stroke();

      // axes
      ctx.strokeStyle = "rgba(87,102,106,0.4)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(padL, h - padB + 0.5); ctx.lineTo(w - padR, h - padB + 0.5); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(padL + 0.5, padT); ctx.lineTo(padL + 0.5, h - padB); ctx.stroke();
      [0, 0.5, 1].forEach((t) => {
        label(ctx, String(t), sx(t), h - padB + 14, MUTED, "center", "10px " + FONT_MONO);
        label(ctx, String(t), padL - 6, sy(t) + 3, MUTED, "right", "10px " + FONT_MONO);
      });
      drawTex(ctx, "z_1", "z1", w - padR, h - padB + 14, { color: MUTED, px: 10, align: "right" });
      drawTex(ctx, "z_2", "z2", padL + 8, padT + 6, { color: MUTED, px: 10, align: "left" });

      // vertex handles (interior vertices are faded: they do not shape the hull)
      LP.vertices.forEach((v, i) => {
        const onHull = LP.hullIdx.includes(i);
        const x = sx(v[0]), y = sy(v[1]);
        ctx.fillStyle = onHull ? "#fbfbf7" : "rgba(251,251,247,0.6)";
        ctx.strokeStyle = onHull ? ACCENT : "rgba(87,102,106,0.6)"; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.rect(x - 4.5, y - 4.5, 9, 9); ctx.fill(); ctx.stroke();
      });

      // candidate decision
      const c = state.candidate;
      if (c) ring(ctx, sx(c[0]), sy(c[1]), 7, PREF);

      const z = state.z;
      dot(ctx, sx(z[0]), sy(z[1]), 6, BRASS, BRASS_DARK);
      drawTex(ctx, "z^\\star_\\lambda=(" + z[0].toFixed(2) + ",\\," + z[1].toFixed(2) + ")", "z*(λ) = (" + z[0].toFixed(2) + ", " + z[1].toFixed(2) + ")",
        sx(z[0]) + 9, sy(z[1]) - 9, { color: BRASS_DARK, px: 11, align: "left", w, flip: sx(z[0]) - 9, plate: true });
      return { sx, sy, ix, iy };
    },
    hitTest(p, g, state) {
      const c = state.candidate;
      if (c && Math.hypot(g.sx(c[0]) - p[0], g.sy(c[1]) - p[1]) <= hitR(12)) return { type: "candidate" };
      for (let i = 0; i < LP.vertices.length; i++) {
        const v = LP.vertices[i];
        if (Math.hypot(g.sx(v[0]) - p[0], g.sy(v[1]) - p[1]) <= hitR(11)) return { type: "vertex", index: i };
      }
      return null;
    },
    // centroid of the hull: an interior point, clearly distinct from any vertex
    defaultCandidate() {
      const hull = LP.hull();
      const c = hull.reduce((acc, v) => [acc[0] + v[0], acc[1] + v[1]], [0, 0]);
      return [c[0] / hull.length, c[1] / hull.length];
    },
    drag(hit, p, g, state) {
      const q = [Math.min(LP_Z_MAX, Math.max(0, g.ix(p[0]))), Math.min(LP_Z_MAX, Math.max(0, g.iy(p[1])))];
      if (hit.type === "vertex") {
        LP.vertices[hit.index] = q;
        LP.updateHull();
        state.candidate = clampToPolygon(state.candidate, LP.hull());
        return "recompute";
      }
      state.candidate = clampToPolygon(q, LP.hull());
      return "candidate";
    },
    legendHTML: '<span><i class="legend-grad"></i>objective (low &rarr; high) on \\(\\mathcal Z\\)</span><span><i class="legend-dot lambda"></i>Robust decision \\(z^*_\\lambda\\)</span><span><i class="legend-square"></i>Vertex \\(v_i\\) (drag)</span><span><i class="legend-dot candidate"></i>Candidate \\(z\\) (drag)</span>'
  };
  LP.updateHull();

  /* ---------------- Problem: Newsvendor ---------------- */
  const NEWS = {
    id: "newsvendor", label: "Newsvendor",
    lambdaMax: 1,
    mu: [2],
    dims: 1,
    p: 4, c: 2, v: 0,
    support: [[1, 3]],
    axisLabels: [["\\text{demand } y", "demand y"]],
    pdf(a) { return (a >= 1 && a <= 3) ? 1 : 0; },
    sampleY(rng) { return { vec: [uniform(rng, 1, 3)] }; },
    // feasible order quantities z in [z_min, z_max]; the limits are draggable
    range: [0, 3.2],
    bounds: [0, 3.2],
    reset() { NEWS.bounds = [0, 3.2]; },
    toScalar(z) { return z[0]; },
    fromScalar(t) { return [t]; },
    // inverse of z* = mu - lambda, so the amber marker can be dragged to choose lambda
    lambdaFor(t) { return clamp(NEWS.mu[0] - t, 0, NEWS.lambdaMax); },
    // cost is decreasing in y, so the worst case in [mu-lambda, mu+lambda] is the low end
    robustObjective(z, lambda) { return NEWS.costOfDecision(z, { vec: [NEWS.mu[0] - lambda] }); },
    worstCase(lambda) { return [NEWS.mu[0] - lambda]; },
    solve(lambda) { return [clamp(NEWS.mu[0] - lambda, NEWS.bounds[0], NEWS.bounds[1])]; },
    costOfDecision(z, y) {
      const Y = y.vec[0], zz = z[0];
      return -NEWS.p * Math.min(Y, zz) + NEWS.c * zz - NEWS.v * Math.max(zz - Y, 0);
    },
    // with p > c the cost is minimised at z = y, clamped to the feasible interval
    oracleCost(y) { return NEWS.costOfDecision([clamp(y.vec[0], NEWS.bounds[0], NEWS.bounds[1])], y); },
    objectiveHTML: "\\[ \\min_{z_{\\min}\\le z\\le z_{\\max}}\\ \\max_{y\\in\\mathcal U_\\lambda}\\big[-p\\min(y,z)+cz-v(z-y)^+\\big],\\quad (p,c,v)=(4,2,0) \\]",
    decisionSubtitle: "Worst-case cost as a function of the order quantity \\(z\\), minimised at \\(z^*_\\lambda\\) (\\(\\mu-\\lambda\\) clamped to the feasible interval). Drag the amber marker to choose the order and set \\(\\lambda\\), the tall grips to set \\(z_{\\min}, z_{\\max}\\), or the hollow marker to test a candidate \\(z\\).",
    formatZ(z) { return z[0].toFixed(2); },
    defaultCandidate() { return [clamp(NEWS.mu[0], NEWS.bounds[0], NEWS.bounds[1])]; },
    drawDecision(ctx, w, h, state) {
      ctx.clearRect(0, 0, w, h);
      const z = state.z[0];
      const g = draw1DDecision(ctx, w, h, {
        zMin: NEWS.range[0], zMax: NEWS.range[1], objective: (zz) => NEWS.robustObjective([zz], state.lambda), zStar: z,
        candidate: state.candidate ? state.candidate[0] : undefined, bounds: NEWS.bounds,
        xLabel: ["\\text{order quantity } z", "order quantity z"],
        objLabel: ["\\max_{y\\in\\mathcal U_\\lambda} f(y,z)", "worst-case cost"], ticks: [0, 1, 2, 3]
      });
      const bind = z <= NEWS.bounds[0] + 1e-9 ? "\\ (z_{\\min}\\text{ binds})" : z >= NEWS.bounds[1] - 1e-9 ? "\\ (z_{\\max}\\text{ binds})" : "";
      drawTex(ctx, "z^\\star_\\lambda = " + z.toFixed(2) + bind, "z*(λ) = " + z.toFixed(2), g.sx(z) + 10, g.stripY - 14, { color: BRASS_DARK, px: 11, align: "left", w, flip: g.sx(z) - 10, plate: true });
      return g;
    },
    hitTest(p, g, st) { return hitTest1D(NEWS, p, g, st); },
    drag(hit, p, g, st) { return drag1D(NEWS, hit, p, g, st); },
    legendHTML: '<span><i class="legend-grad"></i>worst-case cost (low &rarr; high) along \\(z\\)</span><span><i class="legend-dot lambda"></i>Order quantity \\(z^*_\\lambda\\) (drag to set \\(\\lambda\\))</span><span><i class="legend-grip"></i>Limits \\(z_{\\min}, z_{\\max}\\) (drag)</span><span><i class="legend-dot candidate"></i>Candidate \\(z\\) (drag)</span>'
  };

  /* ---------------- Problem: Portfolio selection ---------------- */
  const PORT = {
    id: "portfolio", label: "Portfolio selection",
    lambdaMax: 1,
    mu: [2.15, 1.85],
    dims: 2,
    support: [[1.15, 3.15], [0.85, 2.85]],
    axisLabels: [["\\text{return } y_1", "return y1"], ["\\text{return } y_2", "return y2"]],
    pdf(a, b) { return (a >= 1.15 && a <= 3.15 && b >= 0.85 && b <= 2.85) ? 1 : 0; },
    sampleY(rng) { return { vec: [uniform(rng, 1.15, 3.15), uniform(rng, 0.85, 2.85)] }; },
    // position limits l <= z_1 <= u on the simplex; the limits are draggable
    range: [0, 1],
    bounds: [0, 1],
    reset() { PORT.bounds = [0, 1]; },
    toScalar(z) { return z[0]; },
    fromScalar(t) { return [t, 1 - t]; },
    // z_1*(lambda) is monotone where it moves; pick the grid lambda whose optimum is closest
    lambdaFor(t) {
      let best = 0, bestD = Infinity;
      state.lambdaGrid.forEach((l, i) => { const d = Math.abs(state.zCache[i][0] - t); if (d < bestD - 1e-12) { bestD = d; best = l; } });
      return best;
    },
    robustObjective(z, lambda) {
      const ret = PORT.mu[0] * z[0] + PORT.mu[1] * z[1];
      return -ret + lambda * (z[0] * z[0] + z[1] * z[1]) / 3;
    },
    // cost -y^T z is maximised at the lowest returns in the box
    worstCase(lambda) { return [PORT.mu[0] - lambda, PORT.mu[1] - lambda]; },
    solve(lambda) {
      const [lo, hi] = PORT.bounds;
      let best = lo, bestVal = Infinity;
      for (let i = 0; i <= 200; i++) {
        const z1 = lo + ((hi - lo) * i) / 200;
        const val = PORT.robustObjective([z1, 1 - z1], lambda);
        if (val < bestVal) { bestVal = val; best = z1; }
      }
      return [best, 1 - best];
    },
    costOfDecision(z, y) { return -(y.vec[0] * z[0] + y.vec[1] * z[1]); },
    // linear in z_1, so the feasible optimum sits at one of the two limits
    oracleCost(y) {
      const [lo, hi] = PORT.bounds;
      return Math.min(PORT.costOfDecision([lo, 1 - lo], y), PORT.costOfDecision([hi, 1 - hi], y));
    },
    objectiveHTML: "\\[ \\min_{z_1+z_2=1,\\ \\ell\\le z_1\\le u}\\ -\\mu^\\top z + \\lambda\\Big(\\tfrac{z_1^2+z_2^2}{3}\\Big),\\quad \\mu=(2.15,1.85) \\]",
    decisionSubtitle: "Objective along the two-asset simplex; \\(z^*_\\lambda\\) is its minimiser within the position limits \\(\\ell\\le z_1\\le u\\). Drag the amber marker to choose a split and set \\(\\lambda\\), the tall grips to set the limits, or the hollow marker to test a candidate split.",
    formatZ(z) { return "(" + z[0].toFixed(2) + ", " + z[1].toFixed(2) + ")"; },
    defaultCandidate() { const t = clamp(0.5, PORT.bounds[0], PORT.bounds[1]); return [t, 1 - t]; },
    drawDecision(ctx, w, h, state) {
      ctx.clearRect(0, 0, w, h);
      const z1 = state.z[0];
      const g = draw1DDecision(ctx, w, h, {
        zMin: 0, zMax: 1, objective: (t) => PORT.robustObjective([t, 1 - t], state.lambda), zStar: z1,
        candidate: state.candidate ? state.candidate[0] : undefined, bounds: PORT.bounds,
        xLabel: ["z_1 \\text{ (weight on asset 1)},\\quad z_2 = 1 - z_1", "z1 (weight on asset 1); z2 = 1 - z1"],
        objLabel: ["-\\mu^\\top z + \\lambda\\,\\|z\\|^2/3", "objective"],
        ticks: [0, 0.25, 0.5, 0.75, 1], fmtTick: (t) => t.toFixed(2)
      });
      const bind = z1 <= PORT.bounds[0] + 1e-9 ? "\\ (\\ell\\text{ binds})" : z1 >= PORT.bounds[1] - 1e-9 ? "\\ (u\\text{ binds})" : "";
      drawTex(ctx, "z^\\star_\\lambda=(" + z1.toFixed(2) + ",\\," + (1 - z1).toFixed(2) + ")" + bind,
        "z*(λ) = (" + z1.toFixed(2) + ", " + (1 - z1).toFixed(2) + ")", g.sx(z1) + 10, g.stripY - 14, { color: BRASS_DARK, px: 11, align: "left", w, flip: g.sx(z1) - 10, plate: true });
      return g;
    },
    hitTest(p, g, st) { return hitTest1D(PORT, p, g, st); },
    drag(hit, p, g, st) { return drag1D(PORT, hit, p, g, st); },
    legendHTML: '<span><i class="legend-grad"></i>objective (low &rarr; high) along the simplex</span><span><i class="legend-dot lambda"></i>Weight split \\(z^*_\\lambda\\)</span><span><i class="legend-grip"></i>Position limits \\(\\ell, u\\) (drag)</span><span><i class="legend-dot candidate"></i>Candidate \\(z\\) (drag)</span>'
  };

  /* ---------------- Problem: Shortest path ---------------- */
  // Three source-to-sink routes: A is one winding road (drag its bulge), B has
  // one intermediate node, C has two. Each edge's mean cost is its drawn length
  // (SP_PX_PER_UNIT pixels per cost unit) and its realised cost is uniform
  // within +-SP_EDGE_HALF of that, so a path with more edges is more uncertain.
  const SP_NAMES = ["A", "B", "C"];
  const SP_W = [1, 2, 3];
  const SP_PX_PER_UNIT = 120, SP_EDGE_HALF = 0.2;
  const SP_SOURCE = [40, 150], SP_SINK = [320, 150];
  function tri(x, lo, hi) { const m = (lo + hi) / 2; return Math.max(0, 1 - Math.abs(x - m) / (m - lo)); }
  function quadPoints(p0, c, p2, n) {
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, u = 1 - t;
      pts.push([u * u * p0[0] + 2 * u * t * c[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * c[1] + t * t * p2[1]]);
    }
    return pts;
  }
  function polylineLength(pts) { let l = 0; for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return l; }
  const SP = {
    id: "shortestpath", label: "Shortest path",
    lambdaMax: 3 * SP_EDGE_HALF,
    mu: [0, 0, 0],
    dims: 3,
    support: [[0, 1], [0, 1]],
    axisLabels: [["\\text{cost of path } A", "cost of path A"], ["\\text{cost of path } B", "cost of path B"]],
    // draggable geometry (canvas pixels): the midpoint of road A, B's node, C's two nodes
    nodes: null,
    reset() { SP.nodes = { aMid: [180, 250], b: [180, 95], c1: [130, 160], c2: [230, 160] }; SP.updateGeometry(); },
    // control point of the quadratic road A that passes through aMid at t = 1/2
    aControl() { const m = SP.nodes.aMid; return [2 * m[0] - (SP_SOURCE[0] + SP_SINK[0]) / 2, 2 * m[1] - (SP_SOURCE[1] + SP_SINK[1]) / 2]; },
    aPolyline() { return quadPoints(SP_SOURCE, SP.aControl(), SP_SINK, 40); },
    // per-path list of edge lengths, in cost units
    edgeLengths() {
      const n = SP.nodes, d = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]) / SP_PX_PER_UNIT;
      return [
        [polylineLength(SP.aPolyline()) / SP_PX_PER_UNIT],
        [d(SP_SOURCE, n.b), d(n.b, SP_SINK)],
        [d(SP_SOURCE, n.c1), d(n.c1, n.c2), d(n.c2, SP_SINK)]
      ];
    },
    updateGeometry() {
      const L = SP.edgeLengths();
      SP.mu = L.map((edges) => edges.reduce((a, b) => a + b, 0));
      SP.support = [
        [SP.mu[0] - SP_EDGE_HALF, SP.mu[0] + SP_EDGE_HALF],
        [SP.mu[1] - 2 * SP_EDGE_HALF, SP.mu[1] + 2 * SP_EDGE_HALF]
      ];
    },
    // A is one uniform edge; B is the sum of two equal-width uniforms (triangular)
    pdf(a, b) {
      const s = SP.support;
      return ((a >= s[0][0] && a <= s[0][1]) ? 1 : 0) * tri(b, s[1][0], s[1][1]);
    },
    sampleY(rng) {
      const vec = SP.edgeLengths().map((edges) => edges.reduce((sum, l) => sum + uniform(rng, l - SP_EDGE_HALF, l + SP_EDGE_HALF), 0));
      return { vec };
    },
    robustObjective(z, lambda) { return SP.mu[z[0]] + lambda * SP_W[z[0]]; },
    // only the chosen path's cost matters: push it to the top of the box
    worstCase(lambda, z) { return SP.mu.map((m, i) => (i === z[0] ? m + lambda : m)); },
    solve(lambda) {
      let best = 0, bestVal = Infinity;
      SP.mu.forEach((m, i) => {
        const val = SP.robustObjective([i], lambda);
        if (val < bestVal) { bestVal = val; best = i; }
      });
      return [best];
    },
    costOfDecision(z, y) { return y.vec[z[0]]; },
    oracleCost(y) { return Math.min(...y.vec); },
    objectiveHTML: "\\[ \\min_{i\\in\\{A,B,C\\}}\\ \\mu_i + \\lambda\\, w_i,\\qquad \\mu_i = \\text{length of path } i,\\quad w=(1,2,3)\\ \\text{edges per path},\\quad \\text{each edge } \\pm 0.2 \\]",
    decisionSubtitle: "Each path coloured by its robust objective \\(\\mu_i+\\lambda w_i\\); \\(z^*_\\lambda\\) is the cheapest. Drag the grey nodes (or the bulge of road A) to change the path lengths; click a path to test it as a candidate.",
    formatZ(z) { return "path " + SP_NAMES[z[0]]; },
    defaultCandidate() { return SP.solve(0); },
    drawDecision(ctx, w, h, state) {
      ctx.clearRect(0, 0, w, h);
      const n = SP.nodes;
      const chosen = state.z[0];
      const cand = state.candidate ? state.candidate[0] : -1;
      const objs = SP_NAMES.map((_, i) => SP.robustObjective([i], state.lambda));
      const lo = Math.min(...objs), hi = Math.max(...objs), span = hi - lo || 1;
      const colorOf = (i) => rampColor(0.7 * (objs[i] - lo) / span);
      const routes = [
        { path: 0, pts: SP.aPolyline() },
        { path: 1, pts: [SP_SOURCE, n.b, SP_SINK] },
        { path: 2, pts: [SP_SOURCE, n.c1, n.c2, SP_SINK] }
      ];
      const trace = (pts) => { ctx.beginPath(); pts.forEach((q, i) => (i === 0 ? ctx.moveTo(q[0], q[1]) : ctx.lineTo(q[0], q[1]))); };
      routes.forEach((r) => {
        ctx.lineCap = "round"; ctx.lineJoin = "round";
        if (r.path === cand) {
          trace(r.pts); ctx.strokeStyle = PREF; ctx.lineWidth = 7; ctx.setLineDash([0.5, 9]); ctx.stroke(); ctx.setLineDash([]);
        }
        if (r.path === chosen) { trace(r.pts); ctx.strokeStyle = "rgba(176,127,49,0.45)"; ctx.lineWidth = 11; ctx.stroke(); }
        trace(r.pts); ctx.strokeStyle = colorOf(r.path); ctx.lineWidth = r.path === chosen ? 4 : 3; ctx.stroke();
      });
      // fixed terminals and draggable nodes
      dot(ctx, SP_SOURCE[0], SP_SOURCE[1], 5, ACCENT);
      dot(ctx, SP_SINK[0], SP_SINK[1], 5, ACCENT);
      [n.b, n.c1, n.c2].forEach((q) => dot(ctx, q[0], q[1], 6, "#8a9990", "#fbfbf7"));
      // grip for road A: a square at its midpoint
      ctx.fillStyle = "#fbfbf7"; ctx.strokeStyle = ACCENT; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.rect(n.aMid[0] - 4.5, n.aMid[1] - 4.5, 9, 9); ctx.fill(); ctx.stroke();
      label(ctx, "source", SP_SOURCE[0], SP_SOURCE[1] - 12);
      label(ctx, "sink", SP_SINK[0], SP_SINK[1] - 12);
      // objective value per path, next to each route
      const mids = [[n.aMid[0], n.aMid[1] + 20], [n.b[0], n.b[1] - 12], [(n.c1[0] + n.c2[0]) / 2, Math.max(n.c1[1], n.c2[1]) + 20]];
      SP_NAMES.forEach((name, i) => {
        const tex = "\\mu_" + name + "+\\lambda w_" + name + " = " + objs[i].toFixed(2) + (i === chosen ? "\\ \\leftarrow z^\\star_\\lambda" : "");
        const txt = name + ": " + objs[i].toFixed(2) + (i === chosen ? "  <- z*" : "");
        drawTex(ctx, tex, txt, mids[i][0], mids[i][1], { color: i === chosen ? BRASS_DARK : MUTED, px: 11, align: "center", bold: i === chosen, w, plate: true });
      });
      const segments = [];
      routes.forEach((r) => { for (let i = 1; i < r.pts.length; i++) segments.push({ a: r.pts[i - 1], b: r.pts[i], path: r.path }); });
      return { segments };
    },
    hitTest(p, g) {
      const n = SP.nodes;
      const near = (q, r) => Math.hypot(q[0] - p[0], q[1] - p[1]) <= hitR(r);
      if (near(n.aMid, 12)) return { type: "node", key: "aMid" };
      for (const key of ["b", "c1", "c2"]) if (near(n[key], 12)) return { type: "node", key };
      let best = null, bestD = hitR(10);
      g.segments.forEach((sg) => {
        const q = nearestOnSegment(p, sg.a, sg.b);
        const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
        if (d < bestD) { bestD = d; best = { type: "candidate", path: sg.path }; }
      });
      return best;
    },
    drag(hit, p, g, state) {
      if (hit.type === "node") {
        SP.nodes[hit.key] = [clamp(p[0], 20, CANVAS_W - 20), clamp(p[1], 24, CANVAS_H - 24)];
        SP.updateGeometry();
        return "recompute";
      }
      const h2 = SP.hitTest(p, g);
      state.candidate = [h2 && h2.type === "candidate" ? h2.path : hit.path];
      return "candidate";
    },
    legendHTML: '<span><i class="legend-grad"></i>objective \\(\\mu_i+\\lambda w_i\\) (low &rarr; high)</span><span><i class="legend-dot lambda"></i>Selected path \\(z^*_\\lambda\\)</span><span><i class="legend-dot node"></i>Node (drag)</span><span><i class="legend-square"></i>Bulge of road A (drag)</span><span><i class="legend-dot candidate"></i>Candidate path (click)</span>'
  };
  SP.reset();

  const PROBLEMS = { lp: LP, newsvendor: NEWS, portfolio: PORT, shortestpath: SP };

  /* ---------------- Generic risk engine ---------------- */
  function miscoverage(y, mu, lambda) {
    for (let i = 0; i < mu.length; i++) if (Math.abs(y.vec[i] - mu[i]) > lambda) return 1;
    return 0;
  }
  function regretOf(problem, z, y) {
    if (y.oracle === undefined) y.oracle = problem.oracleCost(y);
    return Math.max(0, problem.costOfDecision(z, y) - y.oracle);
  }
  function correctedAlpha(sumLoss, count, B) {
    if (count === 0) return B;
    const mean = sumLoss / count;
    return (count / (count + 1)) * mean + B / (count + 1);
  }
  function drawSamples(problem, rng, count) {
    return Array.from({ length: count }, () => { const y = problem.sampleY(rng); y.oracle = problem.oracleCost(y); return y; });
  }

  function estimateRegretBound(problem, rng) {
    let maxR = 0;
    for (let l = 0; l <= LAMBDA_STEPS; l += 4) {
      const lambda = (l / LAMBDA_STEPS) * problem.lambdaMax;
      const z = problem.solve(lambda);
      for (let s = 0; s < 80; s++) {
        const y = problem.sampleY(rng);
        maxR = Math.max(maxR, regretOf(problem, z, y));
      }
    }
    return Math.max(maxR, 1e-6);
  }

  function buildLambdaGrid(problem) {
    const grid = [];
    for (let l = 0; l <= LAMBDA_STEPS; l++) grid.push((l / LAMBDA_STEPS) * problem.lambdaMax);
    return grid;
  }

  // (alpha_I, alpha_R) at one lambda from a sample; conformal correction unless `plain`.
  function estimateAt(problem, samples, lambda, z, Br, plain) {
    let sumI = 0, sumR = 0;
    samples.forEach((y) => { sumI += miscoverage(y, problem.mu, lambda); sumR += regretOf(problem, z, y); });
    if (plain) return { lambda, aI: sumI / samples.length, aR: sumR / samples.length };
    return { lambda, aI: correctedAlpha(sumI, samples.length, 1), aR: correctedAlpha(sumR, samples.length, Br) };
  }

  function curveFromSamples(problem, samples, plain) {
    return state.lambdaGrid.map((lambda, idx) => estimateAt(problem, samples, lambda, state.zCache[idx], state.Br, plain));
  }

  function pruneDominated(points) {
    // Pareto set: sort by miscoverage ascending (ties: regret ascending); keep a
    // point only if it strictly lowers regret over everything already kept.
    const sorted = [...points].sort((a, b) => (a.aI - b.aI) || (a.aR - b.aR));
    const out = [];
    let bestR = Infinity;
    sorted.forEach((p) => { if (p.aR < bestR - 1e-12) { out.push(p); bestR = p.aR; } });
    return out;
  }

  /* ---------------- App state & wiring ---------------- */
  const state = {
    problemId: "lp",
    lambda: 0.3,
    n: 20,
    delta: 0.1,
    pref: 0.5,
    seed: 20260914,
    lambdaGrid: null, zCache: null,
    trueCurve: null, preHoc: null, postHoc: null,
    rScale: 1,
    Br: 1,
    calibD1: [], calibD2: [],
    selection: null,
    densityLayer: null,
    candidate: {},      // per problem id: the user's candidate decision
    decisionGeom: null, // geometry of the last decision-panel draw, for hit-testing
    drag: null
  };

  const els = {};
  function cacheEls() {
    ["ctrl-lambda", "ctrl-lambda-value", "ctrl-n", "ctrl-n-value", "ctrl-delta", "ctrl-delta-value",
      "ctrl-pref", "ctrl-pref-value", "btn-select", "btn-resample", "decision-canvas", "outcome-canvas",
      "frontier-svg", "stat-alpha-i", "stat-alpha-r", "stat-epsilon", "stat-post-ai", "stat-post-ar", "stat-pre-ai", "stat-pre-ar",
      "stat-lambda-hat", "demo-objective", "decision-heading", "decision-subtitle", "decision-legend",
      "outcome-subtitle", "ro-z", "ro-obj", "ro-obj-star", "ro-reg", "ro-reg-star", "lp-vertex-ctl", "ctrl-vertices", "btn-reset-z"].forEach((id) => { els[id] = document.getElementById(id); });
  }

  function currentProblem() { return PROBLEMS[state.problemId]; }
  function candidateFor(problem) {
    if (!state.candidate[problem.id]) state.candidate[problem.id] = problem.defaultCandidate();
    return state.candidate[problem.id];
  }

  function snapToGrid(lambda) {
    const problem = currentProblem();
    const step = problem.lambdaMax / LAMBDA_STEPS;
    return Math.min(problem.lambdaMax, Math.max(0, Math.round(lambda / step) * step));
  }

  // Everything that depends on the problem and seed but not on n.
  function recomputeReference() {
    const problem = currentProblem();
    const rng = mulberry32(state.seed);
    state.lambdaGrid = buildLambdaGrid(problem);
    state.zCache = state.lambdaGrid.map((l) => problem.solve(l));
    state.Br = estimateRegretBound(problem, rng);

    const trueSamples = drawSamples(problem, mulberry32(state.seed + 777), TRUE_N);
    state.trueCurve = curveFromSamples(problem, trueSamples, true);
  }

  // Calibration split and the two certified curves (depends on n).
  function recomputeCalibration() {
    const problem = currentProblem();
    const calRng = mulberry32(state.seed + 3);
    const n1 = Math.ceil(state.n / 2), n2 = state.n - n1;
    state.calibD1 = drawSamples(problem, calRng, n1);
    state.calibD2 = drawSamples(problem, calRng, n2);
    state.preHoc = curveFromSamples(problem, state.calibD1, false);
    state.postHoc = curveFromSamples(problem, state.calibD2, false);
    const allR = [].concat(state.trueCurve, state.preHoc, state.postHoc).map((p) => p.aR);
    state.rScale = Math.max(...allR, 0.05) * 1.12;
    computeSelection();
  }

  // The decision-maker's linear preference picks lambda-hat off the pre-hoc
  // Pareto set; that lambda is then re-scored on the untouched split D2.
  function computeSelection() {
    const problem = currentProblem();
    const pruned = pruneDominated(state.preHoc);
    const theta = state.pref * Math.PI / 2;
    const wI = Math.cos(theta), wR = Math.sin(theta);
    let best = pruned[0], bestScore = Infinity;
    pruned.forEach((p) => {
      const score = wI * p.aI + wR * (p.aR / state.rScale);
      if (score < bestScore - 1e-12) { bestScore = score; best = p; }
    });
    const idx = state.lambdaGrid.indexOf(best.lambda);
    const post = estimateAt(problem, state.calibD2, best.lambda, state.zCache[idx], state.Br, false);
    state.selection = { lambda: best.lambda, pre: best, post, wI, wR, score: bestScore };
  }

  function currentEstimate() {
    const problem = currentProblem();
    const z = problem.solve(state.lambda);
    return estimateAt(problem, state.calibD1, state.lambda, z, state.Br, false);
  }

  function finiteSampleEpsilon(B, n, delta) {
    if (n <= 0) return B;
    return (B / (n + 1)) * (Math.sqrt((n / 2) * Math.log(2 / delta)) + 2 + 1 / B);
  }

  /* ---------------- Rendering ---------------- */
  function renderObjective() {
    const problem = currentProblem();
    els["demo-objective"].innerHTML = problem.objectiveHTML;
    els["decision-heading"].textContent = "Decision space";
    els["decision-subtitle"].innerHTML = problem.decisionSubtitle;
    els["decision-legend"].innerHTML = problem.legendHTML;
    els["outcome-subtitle"].innerHTML = problem.dims > 1
      ? "Data density, calibration draws, \\(\\mathcal U_\\lambda\\), and the worst case \\(y^*\\) that \\(z^*_\\lambda\\) hedges against (first two coordinates of \\(Y\\))."
      : "Data density, calibration draws, \\(\\mathcal U_\\lambda\\), and the worst case \\(y^*\\) that \\(z^*_\\lambda\\) hedges against, on the demand line.";
    if (window.MathJax && MathJax.typesetPromise) {
      MathJax.typesetPromise([els["demo-objective"], els["decision-subtitle"], els["decision-legend"], els["outcome-subtitle"]]).catch(() => {});
    }
  }

  const CANVAS_W = 360, CANVAS_H = 300, DPR = 2;
  function canvasContext(canvas) {
    if (canvas.width !== CANVAS_W * DPR) { canvas.width = CANVAS_W * DPR; canvas.height = CANVAS_H * DPR; }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    return ctx;
  }

  function renderDecision() {
    const problem = currentProblem();
    const ctx = canvasContext(els["decision-canvas"]);
    const z = problem.solve(state.lambda);
    state.decisionGeom = problem.drawDecision(ctx, CANVAS_W, CANVAS_H, { z, lambda: state.lambda, candidate: candidateFor(problem) });
    renderReadout();
  }

  // Candidate decision vs. the robust optimum: objective value and certified regret on D1.
  function renderReadout() {
    const problem = currentProblem();
    const c = candidateFor(problem), z = problem.solve(state.lambda);
    els["ro-z"].textContent = problem.formatZ(c);
    els["ro-obj"].textContent = problem.robustObjective(c, state.lambda).toFixed(3);
    els["ro-obj-star"].textContent = problem.robustObjective(z, state.lambda).toFixed(3);
    if (state.calibD1.length) {
      els["ro-reg"].textContent = estimateAt(problem, state.calibD1, state.lambda, c, state.Br, false).aR.toFixed(3);
      els["ro-reg-star"].textContent = estimateAt(problem, state.calibD1, state.lambda, z, state.Br, false).aR.toFixed(3);
    }
  }

  function outcomeGeometry(problem, w, h) {
    const padL = 40, padR = 16, padT = 16, padB = 34;
    const mu = problem.mu;
    function range(dim) {
      const s = problem.support[dim];
      const lo = Math.min(s[0], mu[dim] - problem.lambdaMax), hi = Math.max(s[1], mu[dim] + problem.lambdaMax);
      const padv = (hi - lo) * 0.08;
      return [lo - padv, hi + padv];
    }
    const xr = range(0), yr = problem.dims > 1 ? range(1) : [0, 1];
    return {
      padL, padR, padT, padB, xr, yr,
      sx: (v) => padL + ((v - xr[0]) / (xr[1] - xr[0])) * (w - padL - padR),
      sy: (v) => h - padB - ((v - yr[0]) / (yr[1] - yr[0])) * (h - padT - padB),
      ix: (px) => xr[0] + ((px - padL) / (w - padL - padR)) * (xr[1] - xr[0]),
      iy: (py) => yr[0] + ((h - padB - py) / (h - padT - padB)) * (yr[1] - yr[0])
    };
  }

  // Shaded data distribution, rendered once per problem into an offscreen canvas.
  function buildDensityLayer(problem, w, h, g) {
    const layer = document.createElement("canvas");
    layer.width = w; layer.height = h;
    const ctx = layer.getContext("2d");
    const img = ctx.createImageData(w, h);
    const data = img.data;
    const twoD = problem.dims > 1;
    const y0 = h / 2, bandH = 64;
    const x0 = Math.ceil(g.padL), x1 = Math.floor(w - g.padR);
    const yTop = twoD ? Math.ceil(g.padT) : Math.round(y0 - bandH / 2);
    const yBot = twoD ? Math.floor(h - g.padB) : Math.round(y0 + bandH / 2);
    const vals = new Float32Array(w * h);
    let pmax = 0;
    for (let px = x0; px < x1; px++) {
      const a = g.ix(px + 0.5);
      const p1 = twoD ? 0 : problem.pdf(a);
      for (let py = yTop; py < yBot; py++) {
        const p = twoD ? problem.pdf(a, g.iy(py + 0.5)) : p1;
        if (p > 0) { vals[py * w + px] = p; if (p > pmax) pmax = p; }
      }
    }
    if (pmax > 0) {
      for (let i = 0; i < vals.length; i++) {
        if (vals[i] > 0) {
          const o = i * 4;
          data[o] = 36; data[o + 1] = 66; data[o + 2] = 90; data[o + 3] = Math.round(255 * 0.26 * vals[i] / pmax);
        }
      }
    }
    ctx.putImageData(img, 0, 0);
    return layer;
  }

  function renderOutcome() {
    const problem = currentProblem();
    const ctx = canvasContext(els["outcome-canvas"]);
    const w = CANVAS_W, h = CANVAS_H;
    ctx.clearRect(0, 0, w, h);
    const g = outcomeGeometry(problem, w, h);
    const mu = problem.mu, lambda = state.lambda, twoD = problem.dims > 1;
    const y0 = h / 2;

    if (!state.densityLayer) state.densityLayer = buildDensityLayer(problem, w, h, g);
    ctx.drawImage(state.densityLayer, 0, 0);

    // uncertainty box U_lambda
    const bx0 = g.sx(mu[0] - lambda), bx1 = g.sx(mu[0] + lambda);
    ctx.fillStyle = "rgba(176,127,49,0.10)";
    ctx.strokeStyle = "rgba(138,97,31,0.8)";
    ctx.lineWidth = 1.4;
    if (twoD) {
      const by0 = g.sy(mu[1] + lambda), by1 = g.sy(mu[1] - lambda);
      ctx.fillRect(bx0, by0, bx1 - bx0, by1 - by0);
      ctx.strokeRect(bx0, by0, bx1 - bx0, by1 - by0);
    } else {
      ctx.fillRect(bx0, y0 - 18, bx1 - bx0, 36);
      ctx.strokeRect(bx0, y0 - 18, bx1 - bx0, 36);
    }

    // axes with ticks
    ctx.strokeStyle = "rgba(87,102,106,0.4)"; ctx.lineWidth = 1;
    const axisY = twoD ? h - g.padB : y0;
    ctx.beginPath(); ctx.moveTo(g.padL, axisY + 0.5); ctx.lineTo(w - g.padR, axisY + 0.5); ctx.stroke();
    if (twoD) { ctx.beginPath(); ctx.moveTo(g.padL + 0.5, g.padT); ctx.lineTo(g.padL + 0.5, h - g.padB); ctx.stroke(); }
    function ticks(lo, hi) {
      const raw = (hi - lo) / 4, mag = Math.pow(10, Math.floor(Math.log10(raw)));
      const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || raw;
      const out = [];
      for (let t = Math.ceil(lo / step) * step; t <= hi + 1e-9; t += step) out.push(Math.round(t * 1000) / 1000);
      return out;
    }
    ticks(g.xr[0], g.xr[1]).forEach((t) => {
      ctx.beginPath(); ctx.moveTo(g.sx(t), axisY); ctx.lineTo(g.sx(t), axisY + 4); ctx.stroke();
      label(ctx, String(t), g.sx(t), axisY + 15, MUTED, "center", "10px " + FONT_MONO);
    });
    if (twoD) {
      ticks(g.yr[0], g.yr[1]).forEach((t) => {
        ctx.beginPath(); ctx.moveTo(g.padL - 4, g.sy(t)); ctx.lineTo(g.padL, g.sy(t)); ctx.stroke();
        label(ctx, String(t), g.padL - 6, g.sy(t) + 3, MUTED, "right", "10px " + FONT_MONO);
      });
      drawTex(ctx, problem.axisLabels[1][0], problem.axisLabels[1][1], g.padL + 6, g.padT + 6, { color: MUTED, px: 10, align: "left", w });
    }
    drawTex(ctx, problem.axisLabels[0][0], problem.axisLabels[0][1], w - g.padR, axisY + 28, { color: MUTED, px: 10, align: "right", w });

    // samples: filled = D1 (frontier), hollow = D2 (recalibration)
    const jitter = (i) => ((i * 37) % 21) - 10;
    const drawSet = (set, hollow, offset) => set.forEach((y, i) => {
      const inside = miscoverage(y, mu, lambda) === 0;
      const px = g.sx(y.vec[0]);
      const py = twoD ? g.sy(y.vec[1]) : y0 + jitter(i + offset);
      const col = inside ? ACCENT : RISK;
      ctx.globalAlpha = 0.85;
      ctx.beginPath(); ctx.arc(px, py, 3.2, 0, 2 * Math.PI);
      if (hollow) { ctx.fillStyle = "#fbfbf7"; ctx.fill(); ctx.strokeStyle = col; ctx.lineWidth = 1.4; ctx.stroke(); }
      else { ctx.fillStyle = col; ctx.fill(); }
      ctx.globalAlpha = 1;
    });
    drawSet(state.calibD1, false, 0);
    drawSet(state.calibD2, true, 7);

    // mu and the worst-case realisation y*
    const z = problem.solve(lambda);
    const ystar = problem.worstCase(lambda, z);
    const muX = g.sx(mu[0]), muY = twoD ? g.sy(mu[1]) : y0;
    dot(ctx, muX, muY, 3.5, ACCENT, "#fbfbf7");
    drawTex(ctx, "\\mu", "μ", muX + 6, muY - 6, { color: ACCENT, px: 12, align: "left", bold: true, w });
    const yx = g.sx(ystar[0]), yy = twoD ? g.sy(ystar[1]) : y0;
    diamond(ctx, yx, yy, 6.5, RISK, "#fbfbf7");
    const overlapsMu = Math.hypot(yx - muX, yy - muY) < 4; // e.g. shortest path when y* only moves a hidden coordinate
    drawTex(ctx, "y^\\star", "y*", yx + 8, yy + (overlapsMu ? 15 : 4), { color: RISK, px: 12, align: "left", bold: true, w });
  }

  function renderFrontier() {
    const svg = els["frontier-svg"];
    const w = 360, h = 300, padL = 46, padR = 14, padT = 14, padB = 38;
    const rScale = state.rScale;
    const sx = (aI) => padL + aI * (w - padL - padR);
    const sy = (aR) => h - padB - (aR / rScale) * (h - padB - padT);
    const fmt = (v) => v.toFixed(1);

    function pathFor(points) {
      return points.map((p, i) => (i === 0 ? "M" : "L") + fmt(sx(p.aI)) + " " + fmt(sy(p.aR))).join(" ");
    }

    const parts = [];
    // axes and ticks
    parts.push(`<line x1="${padL}" y1="${h - padB}" x2="${w - padR}" y2="${h - padB}" stroke="${MUTED}" stroke-width="1"/>`);
    parts.push(`<line x1="${padL}" y1="${h - padB}" x2="${padL}" y2="${padT}" stroke="${MUTED}" stroke-width="1"/>`);
    [0, 0.25, 0.5, 0.75, 1].forEach((t) => {
      parts.push(`<line x1="${fmt(sx(t))}" y1="${h - padB}" x2="${fmt(sx(t))}" y2="${h - padB + 4}" stroke="${MUTED}" stroke-width="1"/>`);
      parts.push(`<text x="${fmt(sx(t))}" y="${h - padB + 14}" text-anchor="middle" font-family="IBM Plex Mono" font-size="9" fill="${MUTED}">${t}</text>`);
    });
    [0, 0.5, 1].forEach((f) => {
      const v = f * rScale;
      parts.push(`<line x1="${padL - 4}" y1="${fmt(sy(v))}" x2="${padL}" y2="${fmt(sy(v))}" stroke="${MUTED}" stroke-width="1"/>`);
      parts.push(`<text x="${padL - 6}" y="${fmt(sy(v) + 3)}" text-anchor="end" font-family="IBM Plex Mono" font-size="9" fill="${MUTED}">${v.toFixed(2)}</text>`);
    });
    parts.push(texMarkup("\\text{miscoverage } \\hat\\alpha_I(\\lambda)", "miscoverage αI(λ)", (w + padL) / 2, h - 6, { color: MUTED, px: 10, anchor: "middle" }));
    parts.push(texMarkup("\\text{regret } \\hat\\alpha_R(\\lambda)", "regret αR(λ)", 14, (h - padB) / 2, { color: MUTED, px: 10, anchor: "middle", rotate: -90 }));

    // conformal floor: the certified miscoverage can never go below B/(n+1) = 1/(n1+1)
    const floor = 1 / (state.calibD1.length + 1);
    parts.push(`<line x1="${fmt(sx(floor))}" y1="${padT}" x2="${fmt(sx(floor))}" y2="${h - padB}" stroke="${MUTED}" stroke-width="1" stroke-dasharray="1.5 3" stroke-opacity="0.7"/>`);
    parts.push(texMarkup("\\tfrac{1}{n_1+1}", "1/(n1+1)", sx(floor) + 5, padT + 10, { color: MUTED, px: 10 }));

    // curves
    parts.push(`<path d="${pathFor(state.trueCurve)}" fill="none" stroke="#9aa79a" stroke-width="1.6" stroke-dasharray="4 3"/>`);
    parts.push(`<path d="${pathFor(state.postHoc)}" fill="none" stroke="${SAFE}" stroke-width="1.5" stroke-opacity="0.85"/>`);
    parts.push(`<path d="${pathFor(state.preHoc)}" fill="none" stroke="${ACCENT}" stroke-width="2.2"/>`);

    // preference line: wI*u + wR*v = s in normalised coordinates, clipped to the plot
    const sel = state.selection;
    if (sel) {
      const ends = clipLine(sel.wI, sel.wR, sel.score, 0, 1, 0, 1);
      if (ends) {
        parts.push(`<line x1="${fmt(sx(ends[0][0]))}" y1="${fmt(sy(ends[0][1] * rScale))}" x2="${fmt(sx(ends[1][0]))}" y2="${fmt(sy(ends[1][1] * rScale))}" stroke="${PREF}" stroke-width="1.4" stroke-dasharray="6 3"/>`);
      }
      // recalibration shift, pre-hoc (hollow) -> post-hoc (filled)
      parts.push(`<line x1="${fmt(sx(sel.pre.aI))}" y1="${fmt(sy(sel.pre.aR))}" x2="${fmt(sx(sel.post.aI))}" y2="${fmt(sy(sel.post.aR))}" stroke="${SAFE}" stroke-width="1" stroke-dasharray="2 2"/>`);
    }

    // current lambda on the pre-hoc curve (exact estimate, not a grid lookup)
    const cur = currentEstimate();
    parts.push(`<circle cx="${fmt(sx(cur.aI))}" cy="${fmt(sy(cur.aR))}" r="5.5" fill="${BRASS}" stroke="${BRASS_DARK}" stroke-width="1.2"/>`);

    if (sel) {
      parts.push(`<circle cx="${fmt(sx(sel.pre.aI))}" cy="${fmt(sy(sel.pre.aR))}" r="5" fill="#fbfbf7" stroke="${PREF}" stroke-width="1.8"/>`);
      parts.push(`<circle cx="${fmt(sx(sel.post.aI))}" cy="${fmt(sy(sel.post.aR))}" r="5" fill="${SAFE}" stroke="${SAFE_DARK}" stroke-width="1.2"/>`);
      const lt = "\\hat\\lambda = " + sel.lambda.toFixed(2), lf = "λ^ = " + sel.lambda.toFixed(2);
      const box = texSvg(lt, PREF, 11) || { w: 6 * lf.length, h: 12, baseline: 10 };
      const px0 = sx(sel.pre.aI), py0 = sy(sel.pre.aR);
      // above-right of the marker, or above-left near the right edge; a translucent
      // plate keeps it legible where the tangent or the recalibration link pass under it
      const lx = px0 + 10 + box.w > w - padR ? px0 - 10 - box.w : px0 + 10;
      const ly = py0 - 10;
      parts.push(`<rect x="${fmt(lx - 3)}" y="${fmt(ly - box.baseline - 2)}" width="${fmt(box.w + 6)}" height="${fmt(box.h + 4)}" rx="2" fill="#fbfbf7" fill-opacity="0.88"/>`);
      parts.push(texMarkup(lt, lf, lx, ly, { color: PREF, px: 11 }));
    }

    svg.setAttribute("viewBox", "0 0 " + w + " " + h);
    svg.innerHTML = parts.join("");
  }

  // Intersect the line a*u + b*v = s with the rectangle [u0,u1]x[v0,v1].
  function clipLine(a, b, s, u0, u1, v0, v1) {
    const pts = [];
    const eps = 1e-9;
    if (Math.abs(b) > eps) {
      [u0, u1].forEach((u) => { const v = (s - a * u) / b; if (v >= v0 - eps && v <= v1 + eps) pts.push([u, Math.min(v1, Math.max(v0, v))]); });
    }
    if (Math.abs(a) > eps) {
      [v0, v1].forEach((v) => { const u = (s - b * v) / a; if (u >= u0 - eps && u <= u1 + eps) pts.push([Math.min(u1, Math.max(u0, u)), v]); });
    }
    if (pts.length < 2) return null;
    // pick the two most distant intersection points
    let best = [pts[0], pts[1]], bestD = -1;
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
      const d = Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]);
      if (d > bestD) { bestD = d; best = [pts[i], pts[j]]; }
    }
    return best;
  }

  function renderStats() {
    const cur = currentEstimate();
    els["stat-alpha-i"].textContent = cur.aI.toFixed(3);
    els["stat-alpha-r"].textContent = cur.aR.toFixed(3);
    const eps = finiteSampleEpsilon(state.Br, state.n, state.delta);
    els["stat-epsilon"].textContent = eps.toFixed(3);
    const s = state.selection;
    if (s) {
      els["stat-lambda-hat"].textContent = s.lambda.toFixed(3);
      els["stat-post-ai"].textContent = s.post.aI.toFixed(3);
      els["stat-post-ar"].textContent = s.post.aR.toFixed(3);
      els["stat-pre-ai"].textContent = s.pre.aI.toFixed(3);
      els["stat-pre-ar"].textContent = s.pre.aR.toFixed(3);
    }
  }

  function setStep(n) {
    document.querySelectorAll(".step").forEach((el) => {
      el.classList.toggle("is-active", Number(el.dataset.step) === n);
    });
  }

  function renderAll(stepHint) {
    renderDecision();
    renderOutcome();
    renderFrontier();
    renderStats();
    if (stepHint) setStep(stepHint);
  }

  /* ---------------- Events ---------------- */
  let stepTimer = null;
  function updatePrefLabel() {
    const t = state.pref;
    const word = t < 0.4 ? "favor low miscoverage" : t > 0.6 ? "favor low regret" : "balanced";
    els["ctrl-pref-value"].textContent = word;
  }

  function setLambda(lambda) {
    state.lambda = snapToGrid(lambda);
    els["ctrl-lambda"].value = String(state.lambda);
    els["ctrl-lambda-value"].textContent = state.lambda.toFixed(2);
  }

  function onPreferenceChange() {
    computeSelection();
    renderAll(4);
    clearTimeout(stepTimer);
    stepTimer = setTimeout(() => setStep(5), 260);
  }

  function switchProblem(id) {
    state.problemId = id;
    const problem = PROBLEMS[id];
    els["ctrl-lambda"].max = String(problem.lambdaMax);
    els["ctrl-lambda"].step = String(problem.lambdaMax / LAMBDA_STEPS);
    setLambda(problem.lambdaMax * 0.3);
    document.querySelectorAll(".demo-tab").forEach((tab) => {
      const active = tab.dataset.problem === id;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", String(active));
    });
    renderObjective();
    state.densityLayer = null;
    els["lp-vertex-ctl"].hidden = id !== "lp";
    recomputeReference();
    recomputeCalibration();
    renderAll(2);
  }

  /* ---------------- Dragging in the decision panel ---------------- */
  function canvasPoint(canvas, e) {
    const r = canvas.getBoundingClientRect();
    state.pointerScale = CANVAS_W / r.width; // logical px per screen px
    return [((e.clientX - r.left) / r.width) * CANVAS_W, ((e.clientY - r.top) / r.height) * CANVAS_H];
  }
  let interactiveTimer = null, needsRecompute = false, needsFullRender = false;
  // Coalesce pointer events: one update per tick. A full recompute only if the
  // feasible region changed (that shifts z*, the regret bound and every curve);
  // a full re-render if lambda changed; otherwise just the decision panel.
  function scheduleInteractive(mode) {
    needsRecompute = needsRecompute || mode === true;
    needsFullRender = needsFullRender || mode === "lambda";
    if (interactiveTimer) return;
    interactiveTimer = setTimeout(() => {
      interactiveTimer = null;
      if (needsRecompute) { needsRecompute = needsFullRender = false; state.densityLayer = null; recomputeReference(); recomputeCalibration(); renderAll(); }
      else if (needsFullRender) { needsFullRender = false; renderAll(2); }
      else renderDecision();
    }, 0);
  }
  function wireDecisionCanvas() {
    const canvas = els["decision-canvas"];
    const hitAt = (e) => {
      const problem = currentProblem();
      if (!problem.hitTest || !state.decisionGeom) return null;
      const scope = { candidate: candidateFor(problem) };
      return { hit: problem.hitTest(canvasPoint(canvas, e), state.decisionGeom, scope), scope };
    };
    const applyDrag = (e) => {
      const problem = currentProblem();
      const scope = { candidate: candidateFor(problem) };
      const kind = problem.drag(state.drag, canvasPoint(canvas, e), state.decisionGeom, scope);
      state.candidate[problem.id] = scope.candidate;
      if (kind === "lambda") { setLambda(scope.lambda); scheduleInteractive("lambda"); return; }
      scheduleInteractive(kind === "recompute");
    };
    canvas.addEventListener("pointerdown", (e) => {
      const r = hitAt(e);
      if (!r || !r.hit) return;
      e.preventDefault();
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* keep dragging without capture */ }
      state.drag = r.hit;
      canvas.style.cursor = "grabbing";
      applyDrag(e);
    });
    canvas.addEventListener("pointermove", (e) => {
      if (state.drag) { applyDrag(e); return; }
      const r = hitAt(e);
      canvas.style.cursor = r && r.hit ? "grab" : "default";
    });
    const release = () => { state.drag = null; canvas.style.cursor = "default"; };
    canvas.addEventListener("pointerup", release);
    canvas.addEventListener("pointercancel", release);
    canvas.addEventListener("lostpointercapture", release);

    els["ctrl-vertices"].addEventListener("change", (e) => {
      LP.setVertexCount(parseInt(e.target.value, 10));
      state.candidate.lp = null;
      recomputeReference(); recomputeCalibration(); renderAll();
    });
    els["btn-reset-z"].addEventListener("click", () => {
      const problem = currentProblem();
      problem.reset();
      state.candidate[problem.id] = null;
      state.densityLayer = null;
      recomputeReference(); recomputeCalibration(); renderAll();
    });
  }

  /* ---------------- Page tabs: Demo | Explanation ---------------- */
  // Section ids that live on the explanation panel; any other hash means the demo.
  const EXPLANATION_IDS = ["explanation", "idea", "method", "citation"];
  function panelForHash(hash) { return EXPLANATION_IDS.includes(hash.replace("#", "")) ? "explanation" : "demo"; }
  function showPanel(name, scrollToId) {
    document.querySelectorAll(".page-panel").forEach((el) => { el.hidden = el.id !== "panel-" + name; });
    document.querySelectorAll(".page-tab").forEach((tab) => {
      const active = tab.dataset.panel === name;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", String(active));
    });
    // jump (not smooth-scroll) when the visible panel changes, so the new panel starts at its top
    const target = scrollToId && document.getElementById(scrollToId);
    if (target && scrollToId !== "explanation" && scrollToId !== "demo") target.scrollIntoView({ block: "start", behavior: "instant" });
    else window.scrollTo({ top: 0, behavior: "instant" });
  }
  function wirePageTabs() {
    const apply = () => { const id = location.hash.replace("#", ""); showPanel(panelForHash(location.hash), id); };
    window.addEventListener("hashchange", apply);
    apply();
  }

  function init() {
    cacheEls();
    wirePageTabs();
    document.querySelectorAll(".demo-tab").forEach((tab) => {
      tab.addEventListener("click", () => switchProblem(tab.dataset.problem));
    });

    els["ctrl-lambda"].addEventListener("input", (e) => {
      setLambda(parseFloat(e.target.value));
      renderAll(2);
    });
    els["ctrl-n"].addEventListener("input", (e) => {
      state.n = parseInt(e.target.value, 10);
      els["ctrl-n-value"].textContent = String(state.n);
      recomputeCalibration();
      renderAll(1);
    });
    els["ctrl-delta"].addEventListener("input", (e) => {
      state.delta = parseFloat(e.target.value);
      els["ctrl-delta-value"].textContent = state.delta.toFixed(2);
      renderStats();
    });
    els["ctrl-pref"].addEventListener("input", (e) => {
      state.pref = parseFloat(e.target.value);
      updatePrefLabel();
      onPreferenceChange();
    });
    els["btn-select"].addEventListener("click", () => {
      if (!state.selection) return;
      setLambda(state.selection.lambda);
      renderAll(5);
    });
    els["btn-resample"].addEventListener("click", () => {
      state.seed = Math.floor(Math.random() * 1e9);
      recomputeReference();
      recomputeCalibration();
      renderAll(1);
    });

    wireDecisionCanvas();
    updatePrefLabel();
    switchProblem(state.problemId);

    // once MathJax has started, redraw the panels with real LaTeX labels
    if (window.MathJax && MathJax.startup && MathJax.startup.promise) {
      MathJax.startup.promise.then(() => {
        texReady = typeof MathJax.tex2svg === "function";
        if (texReady) queueRerender();
      }).catch(() => {});
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

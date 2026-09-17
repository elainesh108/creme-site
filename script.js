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

  /* One-dimensional decision space: objective curve + gradient strip + minimiser. */
  function draw1DDecision(ctx, w, h, opts) {
    const { zMin, zMax, objective, zStar, xLabel, ticks, fmtTick } = opts;
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
    ctx.strokeStyle = "rgba(36,66,90,0.5)"; ctx.lineWidth = 1;
    ctx.strokeRect(sx(zMin), stripY, sx(zMax) - sx(zMin), stripH);
    ticks.forEach((t) => {
      ctx.beginPath(); ctx.moveTo(sx(t), stripY + stripH); ctx.lineTo(sx(t), stripY + stripH + 4); ctx.stroke();
      label(ctx, fmtTick ? fmtTick(t) : String(t), sx(t), stripY + stripH + 15, MUTED, "center", "10px " + FONT_MONO);
    });
    label(ctx, xLabel, (sx(zMin) + sx(zMax)) / 2, h - 8, MUTED);

    // objective curve
    ctx.strokeStyle = "rgba(87,102,106,0.35)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(padL, curveBot + 0.5); ctx.lineTo(w - padR, curveBot + 0.5); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(padL + 0.5, curveTop); ctx.lineTo(padL + 0.5, curveBot); ctx.stroke();
    label(ctx, "objective", padL + 4, curveTop - 8, MUTED, "left");
    ctx.beginPath();
    vals.forEach(([z, v], i) => { i === 0 ? ctx.moveTo(sx(z), sy(v)) : ctx.lineTo(sx(z), sy(v)); });
    ctx.strokeStyle = ACCENT; ctx.lineWidth = 2; ctx.stroke();

    // minimiser
    const vStar = objective(zStar);
    ctx.setLineDash([3, 3]); ctx.strokeStyle = BRASS_DARK; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(sx(zStar), sy(vStar)); ctx.lineTo(sx(zStar), stripY + stripH); ctx.stroke();
    ctx.setLineDash([]);
    dot(ctx, sx(zStar), sy(vStar), 5.5, BRASS, BRASS_DARK);
    dot(ctx, sx(zStar), stripY + stripH / 2, 5.5, BRASS, BRASS_DARK);
    return { sx, sy, stripY, stripH, curveTop, curveBot, padL, padR };
  }

  /* ---------------- Problem: Linear programming ---------------- */
  const lpPolygon = (function () {
    // 32-gon: cos(2*pi*i/32) x + sin(2*pi*i/32) y <= 1, i = 1..32, intersected with x>=0, y>=0.
    const halfPlanes = [];
    for (let i = 1; i <= 32; i++) {
      const a = Math.cos((2 * Math.PI * i) / 32);
      const b = Math.sin((2 * Math.PI * i) / 32);
      halfPlanes.push([a, b, 1]);
    }
    halfPlanes.push([-1, 0, 0]); // x >= 0
    halfPlanes.push([0, -1, 0]); // y >= 0

    let poly = [[-2, -2], [2, -2], [2, 2], [-2, 2]];
    halfPlanes.forEach(([a, b, c]) => {
      const out = [];
      for (let i = 0; i < poly.length; i++) {
        const cur = poly[i], prev = poly[(i - 1 + poly.length) % poly.length];
        const curIn = a * cur[0] + b * cur[1] <= c + 1e-9;
        const prevIn = a * prev[0] + b * prev[1] <= c + 1e-9;
        if (curIn) {
          if (!prevIn) out.push(intersect(prev, cur, a, b, c));
          out.push(cur);
        } else if (prevIn) {
          out.push(intersect(prev, cur, a, b, c));
        }
      }
      poly = out;
    });
    function intersect(p, q, a, b, c) {
      const dx = q[0] - p[0], dy = q[1] - p[1];
      const denom = a * dx + b * dy;
      const t = denom !== 0 ? (c - a * p[0] - b * p[1]) / denom : 0;
      return [p[0] + t * dx, p[1] + t * dy];
    }
    return poly;
  })();

  const LP = {
    id: "lp", label: "Linear programming",
    lambdaMax: 1,
    mu: [-1.1, -1],
    dims: 2,
    support: [[-2.1, -0.1], [-2, 0]],
    axisLabels: ["y₁", "y₂"],
    pdf(a, b) { return (a >= -2.1 && a <= -0.1 && b >= -2 && b <= 0) ? 1 : 0; },
    sampleY(rng) { return { vec: [uniform(rng, -2.1, -0.1), uniform(rng, -2, 0)] }; },
    // worst case of y^T z over the box mu +- lambda, for z >= 0
    robustObjective(z, lambda) { return (LP.mu[0] + lambda) * z[0] + (LP.mu[1] + lambda) * z[1]; },
    worstCase(lambda) { return [LP.mu[0] + lambda, LP.mu[1] + lambda]; },
    solve(lambda) {
      let best = lpPolygon[0], bestVal = Infinity;
      lpPolygon.forEach((v) => {
        const val = LP.robustObjective(v, lambda);
        if (val < bestVal) { bestVal = val; best = v; }
      });
      return best;
    },
    costOfDecision(z, y) { return y.vec[0] * z[0] + y.vec[1] * z[1]; },
    oracleCost(y) {
      let best = Infinity;
      lpPolygon.forEach((v) => { const val = y.vec[0] * v[0] + y.vec[1] * v[1]; if (val < best) best = val; });
      return best;
    },
    objectiveHTML: "\\[ \\min_{z}\\ \\max_{y\\in\\mathcal U_\\lambda} y^\\top z = \\min_z\\ (\\mu+\\lambda\\mathbf 1)^\\top z \\quad \\text{s.t.}\\quad z \\in \\text{32-gon} \\cap \\mathbb R^2_+ \\]",
    decisionSubtitle: "Robust objective \\(\\max_{y\\in\\mathcal U_\\lambda} y^\\top z\\) over the 32-gon; \\(z^*_\\lambda\\) is its minimising vertex.",
    drawDecision(ctx, w, h, state) {
      const padL = 34, padR = 16, padT = 16, padB = 30;
      const xs = lpPolygon.map((v) => v[0]), ys = lpPolygon.map((v) => v[1]);
      const maxX = Math.max(...xs) * 1.06, maxY = Math.max(...ys) * 1.06;
      const sx = (x) => padL + (x / maxX) * (w - padL - padR);
      const sy = (y) => h - padB - (y / maxY) * (h - padT - padB);
      const ix = (px) => ((px - padL) / (w - padL - padR)) * maxX;
      const iy = (py) => ((h - padB - py) / (h - padT - padB)) * maxY;
      ctx.clearRect(0, 0, w, h);

      // objective gradient, clipped to the feasible polygon (linear => extremes at vertices)
      const lambda = state.lambda;
      let lo = Infinity, hi = -Infinity;
      lpPolygon.forEach((v) => { const o = LP.robustObjective(v, lambda); lo = Math.min(lo, o); hi = Math.max(hi, o); });
      const span = hi - lo || 1;
      ctx.save();
      ctx.beginPath();
      lpPolygon.forEach((v, i) => { const x = sx(v[0]), y = sy(v[1]); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); });
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
      lpPolygon.forEach((v, i) => { const x = sx(v[0]), y = sy(v[1]); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); });
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
      label(ctx, "z₁", w - padR, h - padB + 14, MUTED, "right");
      label(ctx, "z₂", padL + 8, padT + 4, MUTED, "left");

      const z = state.z;
      dot(ctx, sx(z[0]), sy(z[1]), 6, BRASS, BRASS_DARK);
      labelClamped(ctx, "z*(λ) = (" + z[0].toFixed(2) + ", " + z[1].toFixed(2) + ")", sx(z[0]) + 9, sy(z[1]) - 9, BRASS_DARK, "left", "11px " + FONT_UI, w);
    },
    legendHTML: '<span><i class="legend-grad"></i>objective (low &rarr; high) on \\(\\mathcal Z\\)</span><span><i class="legend-dot lambda"></i>Robust decision \\(z^*_\\lambda\\)</span>'
  };

  /* ---------------- Problem: Newsvendor ---------------- */
  const NEWS = {
    id: "newsvendor", label: "Newsvendor",
    lambdaMax: 1,
    mu: [2],
    dims: 1,
    p: 4, c: 2, v: 0,
    support: [[1, 3]],
    axisLabels: ["demand y"],
    pdf(a) { return (a >= 1 && a <= 3) ? 1 : 0; },
    sampleY(rng) { return { vec: [uniform(rng, 1, 3)] }; },
    // cost is decreasing in y, so the worst case in [mu-lambda, mu+lambda] is the low end
    robustObjective(z, lambda) { return NEWS.costOfDecision(z, { vec: [NEWS.mu[0] - lambda] }); },
    worstCase(lambda) { return [NEWS.mu[0] - lambda]; },
    solve(lambda) { return [Math.max(NEWS.mu[0] - lambda, 0)]; },
    costOfDecision(z, y) {
      const Y = y.vec[0], zz = z[0];
      return -NEWS.p * Math.min(Y, zz) + NEWS.c * zz - NEWS.v * Math.max(zz - Y, 0);
    },
    oracleCost(y) { const Y = y.vec[0]; return (NEWS.c - NEWS.p) * Y; },
    objectiveHTML: "\\[ \\min_{z\\ge 0}\\ \\max_{y\\in\\mathcal U_\\lambda}\\big[-p\\min(y,z)+cz-v(z-y)^+\\big],\\quad (p,c,v)=(4,2,0) \\]",
    decisionSubtitle: "Worst-case cost as a function of the order quantity \\(z\\); minimised at \\(z^*_\\lambda=\\max(\\mu-\\lambda,0)\\).",
    drawDecision(ctx, w, h, state) {
      ctx.clearRect(0, 0, w, h);
      const z = state.z[0];
      const g = draw1DDecision(ctx, w, h, {
        zMin: 0, zMax: 3.2, objective: (zz) => NEWS.robustObjective([zz], state.lambda), zStar: z,
        xLabel: "order quantity z", ticks: [0, 1, 2, 3]
      });
      labelClamped(ctx, "z*(λ) = " + z.toFixed(2), g.sx(z) + 8, g.stripY - 8, BRASS_DARK, "left", "11px " + FONT_UI, w);
    },
    legendHTML: '<span><i class="legend-grad"></i>worst-case cost (low &rarr; high) along \\(z\\)</span><span><i class="legend-dot lambda"></i>Order quantity \\(z^*_\\lambda\\)</span>'
  };

  /* ---------------- Problem: Portfolio selection ---------------- */
  const PORT = {
    id: "portfolio", label: "Portfolio selection",
    lambdaMax: 1,
    mu: [2.15, 1.85],
    dims: 2,
    support: [[1.15, 3.15], [0.85, 2.85]],
    axisLabels: ["return y₁", "return y₂"],
    pdf(a, b) { return (a >= 1.15 && a <= 3.15 && b >= 0.85 && b <= 2.85) ? 1 : 0; },
    sampleY(rng) { return { vec: [uniform(rng, 1.15, 3.15), uniform(rng, 0.85, 2.85)] }; },
    robustObjective(z, lambda) {
      const ret = PORT.mu[0] * z[0] + PORT.mu[1] * z[1];
      return -ret + lambda * (z[0] * z[0] + z[1] * z[1]) / 3;
    },
    // cost -y^T z is maximised at the lowest returns in the box
    worstCase(lambda) { return [PORT.mu[0] - lambda, PORT.mu[1] - lambda]; },
    solve(lambda) {
      let best = 0.5, bestVal = Infinity;
      for (let i = 0; i <= 200; i++) {
        const z1 = i / 200;
        const val = PORT.robustObjective([z1, 1 - z1], lambda);
        if (val < bestVal) { bestVal = val; best = z1; }
      }
      return [best, 1 - best];
    },
    costOfDecision(z, y) { return -(y.vec[0] * z[0] + y.vec[1] * z[1]); },
    oracleCost(y) { return -Math.max(y.vec[0], y.vec[1]); },
    objectiveHTML: "\\[ \\min_{z_1+z_2=1,\\ z\\ge0}\\ -\\mu^\\top z + \\lambda\\Big(\\tfrac{z_1^2+z_2^2}{3}\\Big),\\quad \\mu=(2.15,1.85) \\]",
    decisionSubtitle: "Objective along the two-asset simplex \\(z_1\\in[0,1]\\); \\(z^*_\\lambda\\) is its minimiser.",
    drawDecision(ctx, w, h, state) {
      ctx.clearRect(0, 0, w, h);
      const z1 = state.z[0];
      const g = draw1DDecision(ctx, w, h, {
        zMin: 0, zMax: 1, objective: (t) => PORT.robustObjective([t, 1 - t], state.lambda), zStar: z1,
        xLabel: "z₁ (weight on asset 1); z₂ = 1 − z₁", ticks: [0, 0.25, 0.5, 0.75, 1], fmtTick: (t) => t.toFixed(2)
      });
      labelClamped(ctx, "z*(λ): asset 1 " + (z1 * 100).toFixed(0) + "% · asset 2 " + ((1 - z1) * 100).toFixed(0) + "%",
        g.sx(z1) + 8, g.stripY - 8, BRASS_DARK, "left", "11px " + FONT_UI, w);
    },
    legendHTML: '<span><i class="legend-grad"></i>objective (low &rarr; high) along the simplex</span><span><i class="legend-dot lambda"></i>Weight split \\(z^*_\\lambda\\)</span>'
  };

  /* ---------------- Problem: Shortest path ---------------- */
  const SP_EDGES = {
    A: [[2.2, 2.8]],
    B: [[0.9, 1.3], [0.9, 1.3]],
    C: [[0.55, 0.85], [0.55, 0.85], [0.55, 0.85]]
  };
  const SP_NAMES = ["A", "B", "C"];
  const SP_W = [1, 2, 3];
  function tri(x, lo, hi) { const m = (lo + hi) / 2; return Math.max(0, 1 - Math.abs(x - m) / (m - lo)); }
  const SP = {
    id: "shortestpath", label: "Shortest path",
    lambdaMax: 0.5,
    mu: [2.5, 2.2, 2.1],
    dims: 3,
    support: [[2.2, 2.8], [1.8, 2.6]],
    axisLabels: ["cost of path A", "cost of path B"],
    // A is uniform; B is a sum of two uniforms (triangular)
    pdf(a, b) { return ((a >= 2.2 && a <= 2.8) ? 1 : 0) * tri(b, 1.8, 2.6); },
    sampleY(rng) {
      const vec = SP_NAMES.map((k) => SP_EDGES[k].reduce((s, [lo, hi]) => s + uniform(rng, lo, hi), 0));
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
    objectiveHTML: "\\[ \\min_{i\\in\\{A,B,C\\}}\\ \\mu_i + \\lambda\\, w_i,\\quad w=(1,2,3)\\ \\text{edges per path} \\]",
    decisionSubtitle: "Each path coloured by its robust objective \\(\\mu_i+\\lambda w_i\\); \\(z^*_\\lambda\\) is the cheapest.",
    drawDecision(ctx, w, h, state) {
      ctx.clearRect(0, 0, w, h);
      const nodes = {
        0: [34, h / 2], 1: [w * 0.42, h * 0.2], 2: [w * 0.42, h * 0.8],
        3: [w * 0.7, h * 0.8], 4: [w - 34, h / 2]
      };
      const edges = [
        { from: 0, to: 4, path: 0 },
        { from: 0, to: 1, path: 1 }, { from: 1, to: 4, path: 1 },
        { from: 0, to: 2, path: 2 }, { from: 2, to: 3, path: 2 }, { from: 3, to: 4, path: 2 }
      ];
      const chosen = state.z[0];
      const objs = SP_NAMES.map((_, i) => SP.robustObjective([i], state.lambda));
      const lo = Math.min(...objs), hi = Math.max(...objs), span = hi - lo || 1;
      const colorOf = (i) => rampColor(0.7 * (objs[i] - lo) / span);

      edges.forEach((e) => {
        const [x1, y1] = nodes[e.from], [x2, y2] = nodes[e.to];
        if (e.path === chosen) {
          ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
          ctx.strokeStyle = "rgba(176,127,49,0.45)"; ctx.lineWidth = 11; ctx.lineCap = "round"; ctx.stroke();
        }
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
        ctx.strokeStyle = colorOf(e.path); ctx.lineWidth = e.path === chosen ? 4 : 3; ctx.lineCap = "round"; ctx.stroke();
      });
      Object.entries(nodes).forEach(([k, [x, y]]) => {
        dot(ctx, x, y, 5, (k === "0" || k === "4") ? ACCENT : "#8a9990");
      });
      label(ctx, "source", nodes[0][0], nodes[0][1] - 12);
      label(ctx, "sink", nodes[4][0], nodes[4][1] - 12);
      // objective value per path
      const mids = [[w / 2, h / 2 - 10], [w * 0.42, h * 0.2 - 12], [w * 0.56, h * 0.8 + 18]];
      SP_NAMES.forEach((name, i) => {
        const txt = name + ": " + objs[i].toFixed(2) + (i === chosen ? "  ← z*(λ)" : "");
        label(ctx, txt, mids[i][0], mids[i][1], i === chosen ? BRASS_DARK : MUTED, "center", (i === chosen ? "600 " : "") + "11px " + FONT_UI);
      });
    },
    legendHTML: '<span><i class="legend-grad"></i>objective \\(\\mu_i+\\lambda w_i\\) (low &rarr; high)</span><span><i class="legend-dot lambda"></i>Selected path \\(z^*_\\lambda\\)</span><span>&nbsp;A = 1 edge &middot; B = 2 edges &middot; C = 3 edges</span>'
  };

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
    densityLayer: null
  };

  const els = {};
  function cacheEls() {
    ["ctrl-lambda", "ctrl-lambda-value", "ctrl-n", "ctrl-n-value", "ctrl-delta", "ctrl-delta-value",
      "ctrl-pref", "ctrl-pref-value", "btn-select", "btn-resample", "decision-canvas", "outcome-canvas",
      "frontier-svg", "stat-alpha-i", "stat-alpha-r", "stat-epsilon", "stat-posthoc", "stat-posthoc-sub",
      "stat-lambda-hat", "demo-objective", "decision-heading", "decision-subtitle", "decision-legend",
      "outcome-subtitle"].forEach((id) => { els[id] = document.getElementById(id); });
  }

  function currentProblem() { return PROBLEMS[state.problemId]; }

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
    state.densityLayer = null;
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

  function renderDecision() {
    const problem = currentProblem();
    const canvas = els["decision-canvas"];
    const ctx = canvas.getContext("2d");
    const z = problem.solve(state.lambda);
    problem.drawDecision(ctx, canvas.width, canvas.height, { z, lambda: state.lambda });
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
    const canvas = els["outcome-canvas"];
    const ctx = canvas.getContext("2d");
    const w = canvas.width, h = canvas.height;
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
      label(ctx, problem.axisLabels[1], g.padL + 6, g.padT + 4, MUTED, "left");
    }
    label(ctx, problem.axisLabels[0], w - g.padR, axisY + 28, MUTED, "right");

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
    label(ctx, "μ", muX + 6, muY - 6, ACCENT, "left", "600 11px " + FONT_UI);
    const yx = g.sx(ystar[0]), yy = twoD ? g.sy(ystar[1]) : y0;
    diamond(ctx, yx, yy, 6.5, RISK, "#fbfbf7");
    label(ctx, "y*", yx + 8, yy + 4, RISK, "left", "600 11px " + FONT_UI);
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
    parts.push(`<text x="${(w + padL) / 2}" y="${h - 8}" text-anchor="middle" font-family="IBM Plex Mono" font-size="9" fill="${MUTED}">miscoverage α&#770;ᵢ(λ)</text>`);
    parts.push(`<text x="12" y="${(h - padB) / 2}" text-anchor="middle" font-family="IBM Plex Mono" font-size="9" fill="${MUTED}" transform="rotate(-90 12 ${(h - padB) / 2})">regret α&#770;ᵣ(λ)</text>`);

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
      parts.push(`<text x="${fmt(sx(sel.pre.aI) + 8)}" y="${fmt(sy(sel.pre.aR) - 8)}" font-family="IBM Plex Sans" font-size="10" font-weight="600" fill="${PREF}">λ&#770; = ${sel.lambda.toFixed(2)}</text>`);
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
      els["stat-posthoc"].textContent = "αᵢ=" + s.post.aI.toFixed(3) + ", αᵣ=" + s.post.aR.toFixed(3);
      els["stat-posthoc-sub"].textContent = "recalibrated on held-out D₂ (pre-hoc on D₁: αᵢ=" + s.pre.aI.toFixed(3) + ", αᵣ=" + s.pre.aR.toFixed(3) + ")";
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
    recomputeReference();
    recomputeCalibration();
    renderAll(2);
  }

  function init() {
    cacheEls();
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

    updatePrefLabel();
    switchProblem(state.problemId);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

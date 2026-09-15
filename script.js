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

  const LAMBDA_STEPS = 26;

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
    sampleY(rng) { return { vec: [uniform(rng, -2.1, -0.1), uniform(rng, -2, 0)] }; },
    solve(lambda) {
      const c = [LP.mu[0] + lambda, LP.mu[1] + lambda];
      let best = lpPolygon[0], bestVal = Infinity;
      lpPolygon.forEach((v) => {
        const val = c[0] * v[0] + c[1] * v[1];
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
    objectiveHTML: "\\[ \\min_{z}\\ \\mu^\\top z + \\lambda\\, \\mathbf 1^\\top z \\quad \\text{s.t.}\\quad z \\in \\text{32-gon} \\cap \\mathbb R^2_+ \\]",
    decisionSubtitle: "The robust vertex \\(z^*_\\lambda\\) of a 32-gon feasible region.",
    drawDecision(ctx, w, h, state) {
      const pad = 26;
      const xs = lpPolygon.map((v) => v[0]), ys = lpPolygon.map((v) => v[1]);
      const minX = 0, maxX = Math.max(...xs) * 1.05, minY = 0, maxY = Math.max(...ys) * 1.05;
      const sx = (x) => pad + ((x - minX) / (maxX - minX)) * (w - 2 * pad);
      const sy = (y) => h - pad - ((y - minY) / (maxY - minY)) * (h - 2 * pad);
      ctx.clearRect(0, 0, w, h);
      ctx.beginPath();
      lpPolygon.forEach((v, i) => { const x = sx(v[0]), y = sy(v[1]); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); });
      ctx.closePath();
      ctx.fillStyle = "rgba(36,66,90,0.08)";
      ctx.strokeStyle = "rgba(36,66,90,0.55)";
      ctx.lineWidth = 1.3;
      ctx.fill(); ctx.stroke();
      const z = state.z;
      ctx.beginPath(); ctx.arc(sx(z[0]), sy(z[1]), 5, 0, 2 * Math.PI);
      ctx.fillStyle = "#b07f31"; ctx.fill();
      ctx.strokeStyle = "#8a611f"; ctx.lineWidth = 1.2; ctx.stroke();
    },
    legendHTML: '<span><i class="legend-swatch set" style="background:rgba(36,66,90,0.08);border-color:rgba(36,66,90,0.5)"></i>Feasible region \\(\\mathcal Z\\)</span><span><i class="legend-dot lambda"></i>Robust decision \\(z^*_\\lambda\\)</span>'
  };

  /* ---------------- Problem: Newsvendor ---------------- */
  const NEWS = {
    id: "newsvendor", label: "Newsvendor",
    lambdaMax: 1,
    mu: [2],
    dims: 1,
    p: 3, c: 2, v: 0,
    sampleY(rng) { return { vec: [uniform(rng, 1, 3)] }; },
    solve(lambda) { return [Math.max(NEWS.mu[0] - lambda, 0)]; },
    costOfDecision(z, y) {
      const Y = y.vec[0], zz = z[0];
      return -NEWS.p * Math.min(Y, zz) + NEWS.c * zz - NEWS.v * Math.max(zz - Y, 0);
    },
    oracleCost(y) { const Y = y.vec[0]; return (NEWS.c - NEWS.p) * Y; },
    objectiveHTML: "\\[ \\min_{z\\ge 0}\\ \\max_{y\\in\\mathcal U_\\lambda}\\big[-p\\min(y,z)+cz-v(z-y)^+\\big],\\quad (p,c,v)=(3,2,0) \\]",
    decisionSubtitle: "Order quantity \\(z^*_\\lambda=\\max(\\mu-\\lambda,0)\\) on the demand line.",
    drawDecision(ctx, w, h, state) {
      ctx.clearRect(0, 0, w, h);
      const pad = 30, y0 = h / 2;
      const minX = 0, maxX = 3.2;
      const sx = (x) => pad + (x / maxX) * (w - 2 * pad);
      ctx.strokeStyle = "rgba(87,102,106,0.5)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(sx(minX), y0); ctx.lineTo(sx(maxX), y0); ctx.stroke();
      [0, 1, 2, 3].forEach((t) => {
        ctx.beginPath(); ctx.moveTo(sx(t), y0 - 5); ctx.lineTo(sx(t), y0 + 5); ctx.stroke();
        ctx.fillStyle = "#57666a"; ctx.font = "10px IBM Plex Mono, monospace"; ctx.textAlign = "center";
        ctx.fillText(String(t), sx(t), y0 + 18);
      });
      // demand support [1,3]
      ctx.fillStyle = "rgba(36,66,90,0.08)";
      ctx.fillRect(sx(1), y0 - 14, sx(3) - sx(1), 28);
      ctx.strokeStyle = "rgba(36,66,90,0.4)"; ctx.strokeRect(sx(1), y0 - 14, sx(3) - sx(1), 28);
      ctx.fillStyle = "#17232a"; ctx.font = "10px IBM Plex Sans, sans-serif";
      ctx.fillText("demand support", sx(2), y0 - 22);
      const z = state.z[0];
      ctx.beginPath(); ctx.arc(sx(z), y0, 6, 0, 2 * Math.PI);
      ctx.fillStyle = "#b07f31"; ctx.fill(); ctx.strokeStyle = "#8a611f"; ctx.stroke();
      ctx.fillStyle = "#8a611f"; ctx.textAlign = "center";
      ctx.fillText("z* = " + z.toFixed(2), sx(z), y0 + 34);
    },
    legendHTML: '<span><i class="legend-swatch set" style="background:rgba(36,66,90,0.08);border-color:rgba(36,66,90,0.4)"></i>Demand support</span><span><i class="legend-dot lambda"></i>Order quantity \\(z^*_\\lambda\\)</span>'
  };

  /* ---------------- Problem: Portfolio selection ---------------- */
  const PORT = {
    id: "portfolio", label: "Portfolio selection",
    lambdaMax: 1,
    mu: [2.15, 1.85],
    dims: 2,
    sampleY(rng) { return { vec: [uniform(rng, 1, 3), uniform(rng, 1, 3)] }; },
    solve(lambda) {
      let best = 0.5, bestVal = Infinity;
      for (let i = 0; i <= 200; i++) {
        const z1 = i / 200, z2 = 1 - z1;
        const ret = PORT.mu[0] * z1 + PORT.mu[1] * z2;
        const variance = (z1 * z1 + z2 * z2) / 3;
        const val = -ret + lambda * variance;
        if (val < bestVal) { bestVal = val; best = z1; }
      }
      return [best, 1 - best];
    },
    costOfDecision(z, y) { return -(y.vec[0] * z[0] + y.vec[1] * z[1]); },
    oracleCost(y) { return -Math.max(y.vec[0], y.vec[1]); },
    objectiveHTML: "\\[ \\min_{z_1+z_2=1,\\ z\\ge0}\\ -\\mu^\\top z + \\lambda\\Big(\\tfrac{z_1^2+z_2^2}{3}\\Big),\\quad \\mu=(2.15,1.85) \\]",
    decisionSubtitle: "Weight split \\(z^*_\\lambda\\) on the two-asset simplex.",
    drawDecision(ctx, w, h, state) {
      ctx.clearRect(0, 0, w, h);
      const barX = 30, barW = w - 60, barY = h / 2 - 18, barH = 36;
      const z1 = state.z[0];
      ctx.strokeStyle = "rgba(36,66,90,0.5)"; ctx.lineWidth = 1.3;
      ctx.strokeRect(barX, barY, barW, barH);
      ctx.fillStyle = "rgba(36,66,90,0.28)";
      ctx.fillRect(barX, barY, barW * z1, barH);
      ctx.fillStyle = "rgba(176,127,49,0.28)";
      ctx.fillRect(barX + barW * z1, barY, barW * (1 - z1), barH);
      const divX = barX + barW * z1;
      ctx.beginPath(); ctx.moveTo(divX, barY - 8); ctx.lineTo(divX, barY + barH + 8);
      ctx.strokeStyle = "#8a611f"; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = "#17232a"; ctx.font = "11px IBM Plex Sans, sans-serif"; ctx.textAlign = "left";
      ctx.fillText("Asset 1: " + (z1 * 100).toFixed(0) + "%", barX, barY - 14);
      ctx.textAlign = "right";
      ctx.fillText("Asset 2: " + ((1 - z1) * 100).toFixed(0) + "%", barX + barW, barY - 14);
      ctx.textAlign = "center"; ctx.fillStyle = "#57666a"; ctx.font = "10px IBM Plex Mono, monospace";
      ctx.fillText("z1 + z2 = 1, z >= 0", w / 2, barY + barH + 26);
    },
    legendHTML: '<span><i class="legend-swatch set" style="background:rgba(36,66,90,0.28);border-color:rgba(36,66,90,0.5)"></i>Asset 1 weight</span><span><i class="legend-swatch set" style="background:rgba(176,127,49,0.28);border-color:rgba(176,127,49,0.5)"></i>Asset 2 weight</span>'
  };

  /* ---------------- Problem: Shortest path ---------------- */
  const SP_EDGES = {
    A: [[2.2, 2.8]],
    B: [[0.9, 1.3], [0.9, 1.3]],
    C: [[0.55, 0.85], [0.55, 0.85], [0.55, 0.85]]
  };
  const SP_NAMES = ["A", "B", "C"];
  const SP_W = [1, 2, 3];
  const SP = {
    id: "shortestpath", label: "Shortest path",
    lambdaMax: 0.5,
    mu: [2.5, 2.2, 2.1],
    dims: 3,
    sampleY(rng) {
      const vec = SP_NAMES.map((k) => SP_EDGES[k].reduce((s, [lo, hi]) => s + uniform(rng, lo, hi), 0));
      return { vec };
    },
    solve(lambda) {
      let best = 0, bestVal = Infinity;
      SP.mu.forEach((m, i) => {
        const val = m + lambda * SP_W[i];
        if (val < bestVal) { bestVal = val; best = i; }
      });
      return [best];
    },
    costOfDecision(z, y) { return y.vec[z[0]]; },
    oracleCost(y) { return Math.min(...y.vec); },
    objectiveHTML: "\\[ \\min_{i\\in\\{A,B,C\\}}\\ \\mu_i + \\lambda\\, w_i,\\quad w=(1,2,3)\\ \\text{edges per path} \\]",
    decisionSubtitle: "The cheapest source \\(\\to\\) sink path \\(z^*_\\lambda\\) under robustness \\(\\lambda\\).",
    drawDecision(ctx, w, h, state) {
      ctx.clearRect(0, 0, w, h);
      const nodes = {
        0: [30, h / 2], 1: [w * 0.42, h * 0.22], 2: [w * 0.42, h * 0.78],
        3: [w * 0.7, h * 0.78], 4: [w - 30, h / 2]
      };
      const edges = [
        { from: 0, to: 4, path: 0, label: "e1" },
        { from: 0, to: 1, path: 1, label: "e2" }, { from: 1, to: 4, path: 1, label: "e3" },
        { from: 0, to: 2, path: 2, label: "e4" }, { from: 2, to: 3, path: 2, label: "e5" }, { from: 3, to: 4, path: 2, label: "e6" }
      ];
      const chosen = state.z[0];
      edges.forEach((e) => {
        const [x1, y1] = nodes[e.from], [x2, y2] = nodes[e.to];
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
        ctx.strokeStyle = e.path === chosen ? "#b07f31" : "rgba(87,102,106,0.4)";
        ctx.lineWidth = e.path === chosen ? 3 : 1.5;
        ctx.stroke();
      });
      Object.entries(nodes).forEach(([k, [x, y]]) => {
        ctx.beginPath(); ctx.arc(x, y, 5, 0, 2 * Math.PI);
        ctx.fillStyle = (k === "0" || k === "4") ? "#24425a" : "#8a9990";
        ctx.fill();
      });
      ctx.fillStyle = "#17232a"; ctx.font = "10px IBM Plex Sans, sans-serif"; ctx.textAlign = "center";
      ctx.fillText("source", nodes[0][0], nodes[0][1] - 12);
      ctx.fillText("sink", nodes[4][0], nodes[4][1] - 12);
      ctx.fillStyle = "#8a611f"; ctx.font = "11px IBM Plex Sans, sans-serif";
      ctx.fillText("path " + SP_NAMES[chosen] + " selected", w / 2, h - 12);
    },
    legendHTML: '<span><i class="legend-dot lambda"></i>Selected path</span><span>&nbsp;A = 1 edge &middot; B = 2 edges &middot; C = 3 edges</span>'
  };

  const PROBLEMS = { lp: LP, newsvendor: NEWS, portfolio: PORT, shortestpath: SP };

  /* ---------------- Generic risk engine ---------------- */
  function miscoverage(y, mu, lambda) {
    for (let i = 0; i < mu.length; i++) if (Math.abs(y.vec[i] - mu[i]) > lambda) return 1;
    return 0;
  }
  function regretOf(problem, z, y) {
    return Math.max(0, problem.costOfDecision(z, y) - problem.oracleCost(y));
  }
  function correctedAlpha(sumLoss, count, B) {
    if (count === 0) return B;
    const mean = sumLoss / count;
    return (count / (count + 1)) * mean + B / (count + 1);
  }

  function estimateRegretBound(problem, rng) {
    let maxR = 0;
    for (let l = 0; l <= LAMBDA_STEPS; l++) {
      const lambda = (l / LAMBDA_STEPS) * problem.lambdaMax;
      const z = problem.solve(lambda);
      for (let s = 0; s < 60; s++) {
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

  function frontierFromSamples(problem, samples, lambdaGrid, Bi, Br, zCache) {
    return lambdaGrid.map((lambda, idx) => {
      const z = zCache[idx];
      let sumI = 0, sumR = 0;
      samples.forEach((y) => {
        sumI += miscoverage(y, problem.mu, lambda);
        sumR += regretOf(problem, z, y);
      });
      return {
        lambda,
        aI: correctedAlpha(sumI, samples.length, 1),
        aR: correctedAlpha(sumR, samples.length, Br)
      };
    });
  }

  function pruneDominated(points) {
    // Sort by miscoverage ascending (= robustness lambda descending). A valid
    // frontier point must strictly improve (lower) regret over every point
    // with equal-or-lower miscoverage seen so far; otherwise it is dominated.
    const sorted = [...points].sort((a, b) => a.aI - b.aI);
    const out = [];
    let bestR = Infinity;
    sorted.forEach((p) => { if (p.aR < bestR - 1e-9) { out.push(p); bestR = p.aR; } });
    return out.sort((a, b) => a.lambda - b.lambda);
  }

  /* ---------------- App state & wiring ---------------- */
  const state = {
    problemId: "lp",
    lambda: 0.3,
    n: 20,
    delta: 0.1,
    pref: 0.5,
    seed: 20260914,
    rawLambdaGrid: null,
    trueFrontier: null,
    Br: 1,
    calibD1: [], calibD2: [],
    selected: null
  };

  const els = {};
  function cacheEls() {
    ["ctrl-lambda", "ctrl-lambda-value", "ctrl-n", "ctrl-n-value", "ctrl-delta", "ctrl-delta-value",
      "ctrl-pref", "ctrl-pref-value", "btn-select", "btn-resample", "decision-canvas", "outcome-canvas",
      "frontier-svg", "stat-alpha-i", "stat-alpha-r", "stat-epsilon", "stat-posthoc-card", "stat-posthoc",
      "stat-lambda-hat", "demo-objective", "decision-heading", "decision-subtitle", "decision-legend",
      "outcome-subtitle"].forEach((id) => { els[id] = document.getElementById(id); });
  }

  function currentProblem() { return PROBLEMS[state.problemId]; }

  function recomputeReferenceData() {
    const problem = currentProblem();
    const rng = mulberry32(state.seed);
    state.Br = estimateRegretBound(problem, rng);
    state.rawLambdaGrid = buildLambdaGrid(problem);
    state.zCache = state.rawLambdaGrid.map((l) => problem.solve(l));

    // large reference sample for "true" frontier
    const trueRng = mulberry32(state.seed + 777);
    const trueSamples = [];
    for (let i = 0; i < 1600; i++) trueSamples.push(problem.sampleY(trueRng));
    state.trueFrontier = state.rawLambdaGrid.map((lambda, idx) => {
      const z = state.zCache[idx];
      let sumI = 0, sumR = 0;
      trueSamples.forEach((y) => { sumI += miscoverage(y, problem.mu, lambda); sumR += regretOf(problem, z, y); });
      return { lambda, aI: sumI / trueSamples.length, aR: sumR / trueSamples.length };
    });

    // baseline: smallest lambda achieving <=5% true miscoverage
    let baseline = state.trueFrontier[state.trueFrontier.length - 1];
    for (const p of state.trueFrontier) { if (p.aI <= 0.05) { baseline = p; break; } }
    state.baseline = baseline;

    // calibration draws, split into two halves
    const calRng = mulberry32(state.seed + 3);
    const n1 = Math.ceil(state.n / 2), n2 = state.n - n1;
    state.calibD1 = Array.from({ length: n1 }, () => problem.sampleY(calRng));
    state.calibD2 = Array.from({ length: n2 }, () => problem.sampleY(calRng));

    state.selected = null;
    els["stat-posthoc-card"].hidden = true;
  }

  function currentPreHocFrontier() {
    const problem = currentProblem();
    return frontierFromSamples(problem, state.calibD1, state.rawLambdaGrid, 1, state.Br, state.zCache);
  }

  function nearestGridIndex(lambda) {
    let best = 0, bestDiff = Infinity;
    state.rawLambdaGrid.forEach((l, i) => { const d = Math.abs(l - lambda); if (d < bestDiff) { bestDiff = d; best = i; } });
    return best;
  }

  function currentPointAt(frontier, lambda) { return frontier[nearestGridIndex(lambda)]; }

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
    if (window.MathJax && MathJax.typesetPromise) {
      MathJax.typesetPromise([els["demo-objective"], els["decision-subtitle"], els["decision-legend"]]).catch(() => {});
    }
  }

  function renderDecision() {
    const problem = currentProblem();
    const canvas = els["decision-canvas"];
    const ctx = canvas.getContext("2d");
    const w = canvas.width, h = canvas.height;
    const z = problem.solve(state.lambda);
    problem.drawDecision(ctx, w, h, { z });
  }

  function renderOutcome() {
    const problem = currentProblem();
    const canvas = els["outcome-canvas"];
    const ctx = canvas.getContext("2d");
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    const pad = 34;
    const mu = problem.mu;
    let dimX = 0, dimY = problem.dims > 1 ? 1 : 0;
    const allSamples = state.calibD1.concat(state.calibD2);
    const spanX = Math.max(0.6, ...allSamples.map((s) => Math.abs(s.vec[dimX] - mu[dimX]))) * 1.5 + 0.2;
    const spanY = problem.dims > 1 ? Math.max(0.6, ...allSamples.map((s) => Math.abs(s.vec[dimY] - mu[dimY]))) * 1.5 + 0.2 : spanX;
    const sx = (v) => pad + ((v - (mu[dimX] - spanX)) / (2 * spanX)) * (w - 2 * pad);
    const sy = (v) => h - pad - ((v - (mu[dimY] - spanY)) / (2 * spanY)) * (h - 2 * pad);

    // uncertainty box
    const lambda = state.lambda;
    const bx0 = sx(mu[dimX] - lambda), bx1 = sx(mu[dimX] + lambda);
    const by0 = problem.dims > 1 ? sy(mu[dimY] + lambda) : sy(0.5);
    const by1 = problem.dims > 1 ? sy(mu[dimY] - lambda) : sy(-0.5);
    ctx.fillStyle = "rgba(36,66,90,0.09)";
    ctx.strokeStyle = "rgba(36,66,90,0.55)";
    ctx.lineWidth = 1.3;
    if (problem.dims > 1) {
      ctx.fillRect(bx0, by0, bx1 - bx0, by1 - by0);
      ctx.strokeRect(bx0, by0, bx1 - bx0, by1 - by0);
    } else {
      ctx.fillRect(bx0, h / 2 - 16, bx1 - bx0, 32);
      ctx.strokeRect(bx0, h / 2 - 16, bx1 - bx0, 32);
    }

    // axes
    ctx.strokeStyle = "rgba(87,102,106,0.35)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pad, h - pad); ctx.lineTo(w - pad, h - pad); ctx.stroke();
    if (problem.dims > 1) { ctx.beginPath(); ctx.moveTo(pad, pad); ctx.lineTo(pad, h - pad); ctx.stroke(); }

    // mu marker
    ctx.beginPath();
    ctx.arc(sx(mu[dimX]), problem.dims > 1 ? sy(mu[dimY]) : h / 2, 3.5, 0, 2 * Math.PI);
    ctx.fillStyle = "#24425a"; ctx.fill();

    // samples
    allSamples.forEach((y) => {
      const inside = miscoverage(y, mu, lambda) === 0;
      const px = sx(y.vec[dimX]);
      const py = problem.dims > 1 ? sy(y.vec[dimY]) : h / 2 + (y === allSamples[0] ? 0 : ((y.vec[dimX] * 37) % 20) - 10);
      ctx.beginPath(); ctx.arc(px, py, 3.2, 0, 2 * Math.PI);
      ctx.fillStyle = inside ? "#24425a" : "#a4402f";
      ctx.globalAlpha = 0.8;
      ctx.fill();
      ctx.globalAlpha = 1;
    });

    els["outcome-subtitle"].innerHTML = problem.dims > 1
      ? "Calibration draws vs. \\(\\mathcal U_\\lambda\\) (first two coordinates of \\(Y\\))."
      : "Calibration draws vs. \\(\\mathcal U_\\lambda\\) on the demand line.";
    if (window.MathJax && MathJax.typesetPromise) MathJax.typesetPromise([els["outcome-subtitle"]]).catch(() => {});
  }

  function renderFrontier(preHoc) {
    const svg = els["frontier-svg"];
    const w = 360, h = 300, pad = 40;
    const maxR = Math.max(...state.trueFrontier.map((p) => p.aR), ...preHoc.map((p) => p.aR), 0.05) * 1.12;
    const sx = (aI) => pad + aI * (w - pad - 16);
    const sy = (aR) => h - pad - (aR / maxR) * (h - pad - 16);

    function pathFor(points) {
      const pruned = pruneDominated(points);
      return pruned.map((p, i) => (i === 0 ? "M" : "L") + sx(p.aI).toFixed(1) + " " + sy(p.aR).toFixed(1)).join(" ");
    }

    const parts = [];
    parts.push(`<line x1="${pad}" y1="${h - pad}" x2="${w - 10}" y2="${h - pad}" stroke="#57666a" stroke-width="1"/>`);
    parts.push(`<line x1="${pad}" y1="${h - pad}" x2="${pad}" y2="10" stroke="#57666a" stroke-width="1"/>`);
    parts.push(`<text x="${(w + pad) / 2}" y="${h - 10}" text-anchor="middle" font-family="IBM Plex Mono" font-size="9" fill="#57666a">miscoverage α&#770;ᵢ(λ)</text>`);
    parts.push(`<text x="14" y="${(h - pad) / 2}" text-anchor="middle" font-family="IBM Plex Mono" font-size="9" fill="#57666a" transform="rotate(-90 14 ${(h - pad) / 2})">regret α&#770;ᵣ(λ)</text>`);
    parts.push(`<path d="${pathFor(state.trueFrontier)}" fill="none" stroke="#9aa79a" stroke-width="1.6" stroke-dasharray="4 3"/>`);
    parts.push(`<path d="${pathFor(preHoc)}" fill="none" stroke="#24425a" stroke-width="2.2"/>`);

    // baseline marker
    const bx = sx(state.baseline.aI), by = sy(state.baseline.aR);
    parts.push(`<line x1="${bx}" y1="${h - pad}" x2="${bx}" y2="10" stroke="#3b6ea5" stroke-width="1" stroke-dasharray="2 2"/>`);
    parts.push(`<circle cx="${bx}" cy="${by}" r="3.5" fill="#3b6ea5"/>`);

    // current lambda marker on preHoc
    const cur = currentPointAt(preHoc, state.lambda);
    parts.push(`<circle cx="${sx(cur.aI)}" cy="${sy(cur.aR)}" r="5.5" fill="#b07f31" stroke="#8a611f" stroke-width="1.2"/>`);

    // post-hoc marker
    if (state.selected) {
      const s = state.selected;
      parts.push(`<circle cx="${sx(s.aI)}" cy="${sy(s.aR)}" r="5" fill="#3c6b4f" stroke="#2b4d38" stroke-width="1.2"/>`);
    }

    svg.setAttribute("viewBox", "0 0 " + w + " " + h);
    svg.innerHTML = parts.join("");
  }

  function renderStats(preHoc) {
    const problem = currentProblem();
    const cur = currentPointAt(preHoc, state.lambda);
    els["stat-alpha-i"].textContent = cur.aI.toFixed(3);
    els["stat-alpha-r"].textContent = cur.aR.toFixed(3);
    const eps = finiteSampleEpsilon(state.Br, state.n, state.delta);
    els["stat-epsilon"].textContent = eps.toFixed(3);
    if (state.selected) {
      els["stat-posthoc-card"].hidden = false;
      els["stat-lambda-hat"].textContent = state.selected.lambda.toFixed(3);
      els["stat-posthoc"].textContent = "αᵢ=" + state.selected.aI.toFixed(3) + ", αᵣ=" + state.selected.aR.toFixed(3);
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
    const preHoc = currentPreHocFrontier();
    renderFrontier(preHoc);
    renderStats(preHoc);
    if (stepHint) setStep(stepHint);
  }

  /* ---------------- Events ---------------- */
  function updatePrefLabel() {
    const t = state.pref;
    const label = t < 0.4 ? "favor low risk" : t > 0.6 ? "favor low cost" : "balanced";
    els["ctrl-pref-value"].textContent = label;
  }

  function selectLambdaHat() {
    const problem = currentProblem();
    const preHoc = currentPreHocFrontier();
    const pruned = pruneDominated(preHoc);
    const iVals = pruned.map((p) => p.aI), rVals = pruned.map((p) => p.aR);
    const iMax = Math.max(...iVals, 1e-9), rMax = Math.max(...rVals, 1e-9);
    let best = pruned[0], bestScore = Infinity;
    pruned.forEach((p) => {
      const score = (1 - state.pref) * (p.aI / iMax) + state.pref * (p.aR / rMax);
      if (score < bestScore) { bestScore = score; best = p; }
    });
    state.lambda = best.lambda;
    els["ctrl-lambda"].value = String(best.lambda);
    els["ctrl-lambda-value"].textContent = best.lambda.toFixed(2);
    setStep(4);

    // post-hoc recalibration on D2
    const idx = nearestGridIndex(best.lambda);
    const z = state.zCache[idx];
    let sumI = 0, sumR = 0;
    state.calibD2.forEach((y) => { sumI += miscoverage(y, problem.mu, best.lambda); sumR += regretOf(problem, z, y); });
    state.selected = {
      lambda: best.lambda,
      aI: correctedAlpha(sumI, state.calibD2.length, 1),
      aR: correctedAlpha(sumR, state.calibD2.length, state.Br)
    };
    setTimeout(() => { renderAll(5); }, 260);
  }

  function switchProblem(id) {
    state.problemId = id;
    state.lambda = Math.round((PROBLEMS[id].lambdaMax * 0.3) * 1000) / 1000;
    els["ctrl-lambda"].max = String(PROBLEMS[id].lambdaMax);
    els["ctrl-lambda"].step = String(PROBLEMS[id].lambdaMax / 200);
    els["ctrl-lambda"].value = String(state.lambda);
    els["ctrl-lambda-value"].textContent = state.lambda.toFixed(2);
    document.querySelectorAll(".demo-tab").forEach((tab) => {
      const active = tab.dataset.problem === id;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", String(active));
    });
    renderObjective();
    recomputeReferenceData();
    renderAll(2);
  }

  function init() {
    cacheEls();
    document.querySelectorAll(".demo-tab").forEach((tab) => {
      tab.addEventListener("click", () => switchProblem(tab.dataset.problem));
    });

    els["ctrl-lambda"].addEventListener("input", (e) => {
      state.lambda = parseFloat(e.target.value);
      els["ctrl-lambda-value"].textContent = state.lambda.toFixed(2);
      renderAll(2);
    });
    els["ctrl-n"].addEventListener("input", (e) => {
      state.n = parseInt(e.target.value, 10);
      els["ctrl-n-value"].textContent = String(state.n);
      recomputeReferenceData();
      renderAll(1);
    });
    els["ctrl-delta"].addEventListener("input", (e) => {
      state.delta = parseFloat(e.target.value);
      els["ctrl-delta-value"].textContent = state.delta.toFixed(2);
      renderAll();
    });
    els["ctrl-pref"].addEventListener("input", (e) => {
      state.pref = parseFloat(e.target.value);
      updatePrefLabel();
    });
    els["btn-select"].addEventListener("click", selectLambdaHat);
    els["btn-resample"].addEventListener("click", () => {
      state.seed = Math.floor(Math.random() * 1e9);
      recomputeReferenceData();
      renderAll(1);
    });

    updatePrefLabel();
    renderObjective();
    recomputeReferenceData();
    renderAll(2);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

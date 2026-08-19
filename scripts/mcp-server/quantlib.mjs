// src/lib/quantlib.ts
var f = {
  // ===== 收益与风险 =====
  returns: (c) => c.map((v, i) => i === 0 ? NaN : v / c[i - 1] - 1),
  logReturns: (c) => c.map((v, i) => i === 0 ? NaN : Math.log(v / c[i - 1])),
  cumReturn: (c) => c.length < 2 ? NaN : c[c.length - 1] / c[0] - 1,
  annReturn: (c, ppy = 252) => {
    const r = f.cumReturn(c);
    if (Number.isNaN(r) || r <= -1) return NaN;
    return Math.pow(1 + r, ppy / (c.length - 1)) - 1;
  },
  annVol: (c, ppy = 252) => f.stdev(f.returns(c).filter((x) => !Number.isNaN(x))) * Math.sqrt(ppy),
  sharpe: (c, rf = 0, ppy = 252) => {
    const r = f.returns(c).filter((x) => !Number.isNaN(x));
    const sd = f.stdev(r);
    if (!sd) return NaN;
    return (f.mean(r) - rf / ppy) / sd * Math.sqrt(ppy);
  },
  maxDrawdown: (c) => {
    let peak = -Infinity, mdd = 0, pi = 0, ti = 0, curPeak = 0;
    c.forEach((v, i) => {
      if (v > peak) {
        peak = v;
        curPeak = i;
      }
      const dd = peak > 0 ? v / peak - 1 : 0;
      if (dd < mdd) {
        mdd = dd;
        pi = curPeak;
        ti = i;
      }
    });
    return { mdd, peak: pi, trough: ti };
  },
  calmar: (c, ppy = 252) => {
    const ar = f.annReturn(c, ppy);
    const { mdd } = f.maxDrawdown(c);
    return mdd === 0 ? NaN : ar / Math.abs(mdd);
  },
  // ===== 统计 =====
  mean: (xs) => xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN,
  stdev: (xs) => {
    const n = xs.length;
    if (n < 2) return NaN;
    const m = f.mean(xs);
    return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (n - 1));
  },
  covariance: (x, y) => {
    const n = Math.min(x.length, y.length);
    if (n < 2) return NaN;
    const mx = f.mean(x.slice(0, n)), my = f.mean(y.slice(0, n));
    let s = 0;
    for (let i = 0; i < n; i++) s += (x[i] - mx) * (y[i] - my);
    return s / (n - 1);
  },
  correlation: (x, y) => {
    const sx = f.stdev(x), sy = f.stdev(y);
    if (!sx || !sy) return NaN;
    return f.covariance(x, y) / (sx * sy);
  },
  /** 秩次（平均秩处理并列），1-based */
  rank: (xs) => {
    const idx = xs.map((v, i2) => [v, i2]).sort((a, b) => a[0] - b[0]);
    const r = new Array(xs.length).fill(NaN);
    let i = 0;
    while (i < idx.length) {
      let j = i;
      while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
      i = j + 1;
    }
    return r;
  },
  /** 皮尔逊 IC（因子值 vs 未来收益） */
  ic: (factor, fwdRet) => {
    const pairs = factor.map((v, i) => [v, fwdRet[i]]).filter(([a, b]) => !Number.isNaN(a) && !Number.isNaN(b));
    if (pairs.length < 3) return NaN;
    return f.correlation(pairs.map((p) => p[0]), pairs.map((p) => p[1]));
  },
  /** 斯皮尔曼秩 IC */
  rankIC: (factor, fwdRet) => {
    const pairs = factor.map((v, i) => [v, fwdRet[i]]).filter(([a, b]) => !Number.isNaN(a) && !Number.isNaN(b));
    if (pairs.length < 3) return NaN;
    return f.correlation(f.rank(pairs.map((p) => p[0])), f.rank(pairs.map((p) => p[1])));
  },
  linreg: (x, y) => {
    const n = Math.min(x.length, y.length);
    if (n < 2) return { slope: NaN, intercept: NaN, r2: NaN };
    const xs = x.slice(0, n), ys = y.slice(0, n);
    const mx = f.mean(xs), my = f.mean(ys);
    let sxy = 0, sxx = 0;
    for (let i = 0; i < n; i++) {
      sxy += (xs[i] - mx) * (ys[i] - my);
      sxx += (xs[i] - mx) ** 2;
    }
    const slope = sxx === 0 ? NaN : sxy / sxx;
    const intercept = my - slope * mx;
    const r = f.correlation(xs, ys);
    return { slope, intercept, r2: r * r };
  },
  zscore: (xs, n) => xs.map((_, i) => {
    if (i < n - 1) return NaN;
    const w = xs.slice(i - n + 1, i + 1);
    const m = f.mean(w), sd = f.stdev(w);
    return sd ? (xs[i] - m) / sd : NaN;
  }),
  // ===== 均线与趋势 =====
  sma: (xs, n) => xs.map((_, i) => i < n - 1 ? NaN : f.mean(xs.slice(i - n + 1, i + 1))),
  ema: (xs, n) => {
    const a = 2 / (n + 1);
    const out = [];
    xs.forEach((v, i) => out.push(i === 0 ? v : a * v + (1 - a) * out[i - 1]));
    return out;
  },
  wma: (xs, n) => xs.map((_, i) => {
    if (i < n - 1) return NaN;
    let s = 0, w = 0;
    for (let k = 0; k < n; k++) {
      s += xs[i - k] * (n - k);
      w += n - k;
    }
    return s / w;
  }),
  macd: (c, fast = 12, slow = 26, sig = 9) => {
    const ef = f.ema(c, fast), es = f.ema(c, slow);
    const dif = c.map((_, i) => ef[i] - es[i]);
    const dea = f.ema(dif, sig);
    return { dif, dea, hist: dif.map((v, i) => 2 * (v - dea[i])) };
  },
  rsi: (c, n = 14) => {
    const out = new Array(c.length).fill(NaN);
    let up = 0, dn = 0;
    for (let i = 1; i < c.length; i++) {
      const ch = c[i] - c[i - 1];
      const u = Math.max(ch, 0), d = Math.max(-ch, 0);
      if (i <= n) {
        up += u;
        dn += d;
        if (i === n) {
          up /= n;
          dn /= n;
          out[i] = dn === 0 ? 100 : 100 - 100 / (1 + up / dn);
        }
      } else {
        up = (up * (n - 1) + u) / n;
        dn = (dn * (n - 1) + d) / n;
        out[i] = dn === 0 ? 100 : 100 - 100 / (1 + up / dn);
      }
    }
    return out;
  },
  boll: (c, n = 20, k = 2) => {
    const mid = f.sma(c, n);
    const up = [], dn = [];
    c.forEach((_, i) => {
      if (i < n - 1) {
        up.push(NaN);
        dn.push(NaN);
        return;
      }
      const sd = f.stdev(c.slice(i - n + 1, i + 1));
      up.push(mid[i] + k * sd);
      dn.push(mid[i] - k * sd);
    });
    return { mid, up, dn };
  },
  kdj: (h, l, c, n = 9) => {
    const K = [], D = [];
    c.forEach((_, i) => {
      if (i < n - 1) {
        K.push(NaN);
        D.push(NaN);
        return;
      }
      const hh = Math.max(...h.slice(i - n + 1, i + 1));
      const ll = Math.min(...l.slice(i - n + 1, i + 1));
      const rsv = hh === ll ? 50 : (c[i] - ll) / (hh - ll) * 100;
      const k = i === n - 1 ? 2 / 3 * 50 + 1 / 3 * rsv : 2 / 3 * K[i - 1] + 1 / 3 * rsv;
      const d = i === n - 1 ? 2 / 3 * 50 + 1 / 3 * k : 2 / 3 * D[i - 1] + 1 / 3 * k;
      K.push(k);
      D.push(d);
    });
    return { k: K, d: D, j: K.map((v, i) => 3 * v - 2 * D[i]) };
  },
  atr: (h, l, c, n = 14) => {
    const tr = c.map((_, i) => i === 0 ? h[0] - l[0] : Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1])));
    const out = new Array(c.length).fill(NaN);
    let a = 0;
    for (let i = 0; i < tr.length; i++) {
      if (i < n) {
        a += tr[i];
        if (i === n - 1) {
          a /= n;
          out[i] = a;
        }
      } else {
        a = (a * (n - 1) + tr[i]) / n;
        out[i] = a;
      }
    }
    return out;
  },
  // ===== 动量 =====
  roc: (c, n) => c.map((v, i) => i < n ? NaN : v / c[i - n] - 1),
  momentum: (c, n) => c.map((v, i) => i < n ? NaN : v - c[i - n]),
  // ===== 扩充：下行风险与相对表现 =====
  /** 下行波动率（只统计负收益） */
  downsideVol: (c, ppy = 252) => {
    const dn = f.returns(c).filter((x) => !Number.isNaN(x) && x < 0);
    return f.stdev(dn) * Math.sqrt(ppy);
  },
  sortino: (c, rf = 0, ppy = 252) => {
    const dv = f.downsideVol(c, ppy);
    if (!dv) return NaN;
    return (f.annReturn(c, ppy) - rf) / dv;
  },
  /** 对基准的 beta 与 alpha（日化 alpha 年化后返回） */
  betaAlpha: (c, bench, ppy = 252) => {
    const rc = f.returns(c), rb = f.returns(bench);
    const pairs = rc.map((v, i) => [v, rb[i]]).filter(([a, b]) => !Number.isNaN(a) && !Number.isNaN(b));
    if (pairs.length < 5) return { beta: NaN, alpha: NaN };
    const xs = pairs.map((p) => p[1]), ys = pairs.map((p) => p[0]);
    const { slope, intercept } = f.linreg(xs, ys);
    return { beta: slope, alpha: intercept * ppy };
  },
  // ===== 扩充：通达信式序列工具 =====
  hhv: (xs, n) => xs.map((_, i) => i < n - 1 ? NaN : Math.max(...xs.slice(i - n + 1, i + 1))),
  llv: (xs, n) => xs.map((_, i) => i < n - 1 ? NaN : Math.min(...xs.slice(i - n + 1, i + 1))),
  ref: (xs, n) => xs.map((_, i) => i < n ? NaN : xs[i - n]),
  /** 上穿：a 从下方穿越 b（同长序列） */
  crossUp: (a, b) => a.map((v, i) => i > 0 && !Number.isNaN(v) && !Number.isNaN(b[i]) && a[i - 1] <= b[i - 1] && v > b[i]),
  crossDown: (a, b) => a.map((v, i) => i > 0 && !Number.isNaN(v) && !Number.isNaN(b[i]) && a[i - 1] >= b[i - 1] && v < b[i]),
  /** 最近 n 日内条件成立次数 */
  count: (conds, n) => conds.map((_, i) => i < n - 1 ? NaN : conds.slice(i - n + 1, i + 1).filter(Boolean).length),
  /** 距上次条件成立的周期数（从未成立为 NaN） */
  barsSince: (conds) => {
    let last = -1;
    return conds.map((c, i) => {
      if (c) last = i;
      return last < 0 ? NaN : i - last;
    });
  },
  // ===== 趋势增强 =====
  /** 双指数均线 DEMA：2·EMA − EMA(EMA)，滞后更小 */
  dema: (xs, n) => {
    const e1 = f.ema(xs, n), e2 = f.ema(e1, n);
    return xs.map((_, i) => 2 * e1[i] - e2[i]);
  },
  /** 三指数均线 TEMA */
  tema: (xs, n) => {
    const e1 = f.ema(xs, n), e2 = f.ema(e1, n), e3 = f.ema(e2, n);
    return xs.map((_, i) => 3 * e1[i] - 3 * e2[i] + e3[i]);
  },
  /** 三角均线 TRIMA：双重 SMA */
  trima: (xs, n) => f.sma(f.sma(xs, Math.ceil((n + 1) / 2)), Math.floor((n + 1) / 2)),
  /** 考夫曼自适应均线 KAMA：趋势强时快、震荡时慢 */
  kama: (xs, n = 10, fast = 2, slow = 30) => {
    const out = new Array(xs.length).fill(NaN);
    const fsc = 2 / (fast + 1), ssc = 2 / (slow + 1);
    let prev = NaN;
    for (let i = n; i < xs.length; i++) {
      const change = Math.abs(xs[i] - xs[i - n]);
      let vol = 0;
      for (let k = i - n + 1; k <= i; k++) vol += Math.abs(xs[k] - xs[k - 1]);
      const er = vol === 0 ? 0 : change / vol;
      const sc = (er * (fsc - ssc) + ssc) ** 2;
      const base = Number.isNaN(prev) ? xs[i - 1] : prev;
      prev = base + sc * (xs[i] - base);
      out[i] = prev;
    }
    return out;
  },
  /** 赫尔均线 HMA：WMA(2·WMA(n/2) − WMA(n), √n)，低滞后 */
  hma: (xs, n) => {
    const half = Math.max(1, Math.round(n / 2)), sq = Math.max(1, Math.round(Math.sqrt(n)));
    const w1 = f.wma(xs, half), w2 = f.wma(xs, n);
    const diff = xs.map((_, i) => Number.isNaN(w1[i]) || Number.isNaN(w2[i]) ? NaN : 2 * w1[i] - w2[i]);
    return f.wma(diff.map((x) => Number.isNaN(x) ? 0 : x), sq).map((v, i) => i < n - 1 + sq - 1 ? NaN : v);
  },
  /** 量加权均线 VWMA */
  vwma: (c, v, n) => c.map((_, i) => {
    if (i < n - 1) return NaN;
    let s = 0, w = 0;
    for (let k = i - n + 1; k <= i; k++) {
      s += c[k] * v[k];
      w += v[k];
    }
    return w === 0 ? NaN : s / w;
  }),
  /** 滚动 VWAP：典型价的量加权均值 */
  vwap: (h, l, c, v, n = 20) => f.vwma(f.typprice(h, l, c), v, n),
  /** 滚动线性回归斜率 / 截距 / 下一周期拟合值 TSF */
  linregSlope: (xs, n) => xs.map((_, i) => i < n - 1 ? NaN : f.linreg(Array.from({ length: n }, (_2, k) => k), xs.slice(i - n + 1, i + 1)).slope),
  linregIntercept: (xs, n) => xs.map((_, i) => i < n - 1 ? NaN : f.linreg(Array.from({ length: n }, (_2, k) => k), xs.slice(i - n + 1, i + 1)).intercept),
  tsf: (xs, n) => xs.map((_, i) => {
    if (i < n - 1) return NaN;
    const { slope, intercept } = f.linreg(Array.from({ length: n }, (_2, k) => k), xs.slice(i - n + 1, i + 1));
    return intercept + slope * n;
  }),
  /** 中点：(HHV + LLV) / 2 */
  midpoint: (xs, n) => xs.map((_, i) => i < n - 1 ? NaN : (Math.max(...xs.slice(i - n + 1, i + 1)) + Math.min(...xs.slice(i - n + 1, i + 1))) / 2),
  /** 抛物线转向 SAR */
  sar: (h, l, af = 0.02, maxAf = 0.2) => {
    const n = h.length;
    const out = new Array(n).fill(NaN);
    if (n < 2) return out;
    let long = h[1] >= h[0], afNow = af;
    let ep = long ? h[0] : l[0];
    let sarNow = long ? l[0] : h[0];
    out[0] = sarNow;
    for (let i = 1; i < n; i++) {
      sarNow = sarNow + afNow * (ep - sarNow);
      if (long) {
        sarNow = Math.min(sarNow, l[i - 1], i > 1 ? l[i - 2] : l[i - 1]);
        if (l[i] < sarNow) {
          long = false;
          sarNow = ep;
          ep = l[i];
          afNow = af;
        } else if (h[i] > ep) {
          ep = h[i];
          afNow = Math.min(afNow + af, maxAf);
        }
      } else {
        sarNow = Math.max(sarNow, h[i - 1], i > 1 ? h[i - 2] : h[i - 1]);
        if (h[i] > sarNow) {
          long = true;
          sarNow = ep;
          ep = h[i];
          afNow = af;
        } else if (l[i] < ep) {
          ep = l[i];
          afNow = Math.min(afNow + af, maxAf);
        }
      }
      out[i] = sarNow;
    }
    return out;
  },
  /** 超级趋势：返回趋势线与方向（1 多 / -1 空） */
  supertrend: (h, l, c, n = 10, mult = 3) => {
    const a = f.atr(h, l, c, n);
    const st = new Array(c.length).fill(NaN);
    const dir = new Array(c.length).fill(NaN);
    let up = NaN, dn = NaN, d = 1;
    for (let i = 0; i < c.length; i++) {
      if (Number.isNaN(a[i])) continue;
      const mid = (h[i] + l[i]) / 2;
      const rawUp = mid + mult * a[i], rawDn = mid - mult * a[i];
      up = Number.isNaN(up) ? rawUp : rawUp < up || c[i - 1] > up ? rawUp : up;
      dn = Number.isNaN(dn) ? rawDn : rawDn > dn || c[i - 1] < dn ? rawDn : dn;
      if (c[i] > up) d = 1;
      else if (c[i] < dn) d = -1;
      st[i] = d === 1 ? dn : up;
      dir[i] = d;
    }
    return { st, dir };
  },
  /** 吊灯止损线（多头）：HHV(n) − mult·ATR(n) */
  chandelier: (h, l, c, n = 22, mult = 3) => {
    const a = f.atr(h, l, c, n), hh = f.hhv(h, n);
    return c.map((_, i) => Number.isNaN(a[i]) || Number.isNaN(hh[i]) ? NaN : hh[i] - mult * a[i]);
  },
  // ===== 动量增强 =====
  /** 未成熟随机值 %K：收盘价在 n 日区间中的位置 ×100 */
  stoch: (h, l, c, n = 14) => c.map((_, i) => {
    if (i < n - 1) return NaN;
    const hh = Math.max(...h.slice(i - n + 1, i + 1)), ll = Math.min(...l.slice(i - n + 1, i + 1));
    return hh === ll ? 50 : (c[i] - ll) / (hh - ll) * 100;
  }),
  /** 慢速随机指标：%K 与其 m 周期均值 %D */
  stochSlow: (h, l, c, n = 14, m = 3) => {
    const k = f.stoch(h, l, c, n);
    return { k, d: f.sma(k.map((x) => Number.isNaN(x) ? NaN : x), m) };
  },
  /** 随机 RSI：对 RSI 再做随机化（0~100） */
  stochRsi: (c, rsiN = 14, stochN = 14) => {
    const r = f.rsi(c, rsiN);
    return r.map((v, i) => {
      if (i < stochN) return NaN;
      const win = r.slice(i - stochN + 1, i + 1);
      if (win.some((x) => Number.isNaN(x))) return NaN;
      const hh = Math.max(...win), ll = Math.min(...win);
      return hh === ll ? 50 : (v - ll) / (hh - ll) * 100;
    });
  },
  /** 顺势指标 CCI：典型价偏离均值的程度 */
  cci: (h, l, c, n = 20) => {
    const tp = f.typprice(h, l, c);
    return tp.map((v, i) => {
      if (i < n - 1) return NaN;
      const win = tp.slice(i - n + 1, i + 1);
      const m = f.mean(win);
      const md = f.mean(win.map((x) => Math.abs(x - m)));
      return md === 0 ? 0 : (v - m) / (0.015 * md);
    });
  },
  /** 威廉指标 WR（-100~0，低于 -80 超卖） */
  wr: (h, l, c, n = 14) => c.map((_, i) => {
    if (i < n - 1) return NaN;
    const hh = Math.max(...h.slice(i - n + 1, i + 1)), ll = Math.min(...l.slice(i - n + 1, i + 1));
    return hh === ll ? -50 : (hh - c[i]) / (hh - ll) * -100;
  }),
  /** 三重平滑均线变化率 TRIX（%） */
  trix: (c, n = 15) => {
    const e3 = f.ema(f.ema(f.ema(c, n), n), n);
    return e3.map((v, i) => i === 0 || e3[i - 1] === 0 ? NaN : (v / e3[i - 1] - 1) * 100);
  },
  /** 百分比价格振荡器 PPO（%） */
  ppo: (c, fast = 12, slow = 26, sig = 9) => {
    const ef = f.ema(c, fast), es = f.ema(c, slow);
    const p = c.map((_, i) => es[i] === 0 ? NaN : (ef[i] - es[i]) / es[i] * 100);
    const s = f.ema(p, sig);
    return { ppo: p, signal: s, hist: p.map((v, i) => v - s[i]) };
  },
  /** 钱德动量振荡器 CMO（-100~100） */
  cmo: (c, n = 14) => c.map((_, i) => {
    if (i < n) return NaN;
    let up = 0, dn = 0;
    for (let k = i - n + 1; k <= i; k++) {
      const ch = c[k] - c[k - 1];
      if (ch > 0) up += ch;
      else dn -= ch;
    }
    const s = up + dn;
    return s === 0 ? 0 : (up - dn) / s * 100;
  }),
  /** 终极振荡器 UO（7/14/28 三周期加权） */
  uo: (h, l, c, s = 7, m = 14, ln = 28) => {
    const bp = c.map((_, i) => i === 0 ? NaN : c[i] - Math.min(l[i], c[i - 1]));
    const tr = c.map((_, i) => i === 0 ? NaN : Math.max(h[i], c[i - 1]) - Math.min(l[i], c[i - 1]));
    const avg = (n, i) => {
      let sb = 0, st = 0;
      for (let k = i - n + 1; k <= i; k++) {
        sb += bp[k];
        st += tr[k];
      }
      return st === 0 ? NaN : sb / st;
    };
    return c.map((_, i) => {
      if (i < ln) return NaN;
      const a7 = avg(s, i), a14 = avg(m, i), a28 = avg(ln, i);
      if (Number.isNaN(a7) || Number.isNaN(a14) || Number.isNaN(a28)) return NaN;
      return 100 * (4 * a7 + 2 * a14 + a28) / 7;
    });
  },
  /** 阿隆指标：n+1 根 K 线内最高/最低价距今的远近（今日新高 = 100） */
  aroon: (h, l, n = 25) => {
    const up = [], dn = [];
    for (let i = 0; i < h.length; i++) {
      if (i < n) {
        up.push(NaN);
        dn.push(NaN);
        continue;
      }
      const winH = h.slice(i - n, i + 1), winL = l.slice(i - n, i + 1);
      up.push(winH.lastIndexOf(Math.max(...winH)) / n * 100);
      dn.push(winL.lastIndexOf(Math.min(...winL)) / n * 100);
    }
    return { up, dn, osc: up.map((v, i) => Number.isNaN(v) ? NaN : v - dn[i]) };
  },
  /** 趋向指标 DMI：+DI / −DI / ADX / ADXR（Wilder 平滑） */
  dmi: (h, l, c, n = 14) => {
    const len = c.length;
    const pdi = new Array(len).fill(NaN), mdi = new Array(len).fill(NaN);
    const adx = new Array(len).fill(NaN), adxr = new Array(len).fill(NaN);
    if (len < 2) return { pdi, mdi, adx, adxr };
    let trS = 0, pdmS = 0, mdmS = 0;
    const dx = new Array(len).fill(NaN);
    for (let i = 1; i < len; i++) {
      const upMove = h[i] - h[i - 1], dnMove = l[i - 1] - l[i];
      const pdm = upMove > dnMove && upMove > 0 ? upMove : 0;
      const mdm = dnMove > upMove && dnMove > 0 ? dnMove : 0;
      const tr = Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]));
      if (i <= n) {
        trS += tr;
        pdmS += pdm;
        mdmS += mdm;
      } else {
        trS = trS - trS / n + tr;
        pdmS = pdmS - pdmS / n + pdm;
        mdmS = mdmS - mdmS / n + mdm;
      }
      if (i >= n) {
        pdi[i] = trS === 0 ? 0 : pdmS / trS * 100;
        mdi[i] = trS === 0 ? 0 : mdmS / trS * 100;
        const s = pdi[i] + mdi[i];
        dx[i] = s === 0 ? 0 : Math.abs(pdi[i] - mdi[i]) / s * 100;
      }
    }
    let adxS = 0, cnt = 0, prev = NaN;
    for (let i = 0; i < len; i++) {
      if (Number.isNaN(dx[i])) continue;
      if (cnt < n) {
        adxS += dx[i];
        cnt++;
        if (cnt === n) {
          prev = adxS / n;
          adx[i] = prev;
        }
      } else {
        prev = (prev * (n - 1) + dx[i]) / n;
        adx[i] = prev;
        adxr[i] = Number.isNaN(adx[i - n]) ? NaN : (adx[i] + adx[i - n]) / 2;
      }
    }
    return { pdi, mdi, adx, adxr };
  },
  /** 心理线 PSY：n 日内上涨天数占比 ×100 */
  psy: (c, n = 12) => c.map((_, i) => {
    if (i < n) return NaN;
    let up = 0;
    for (let k = i - n + 1; k <= i; k++) if (c[k] > c[k - 1]) up++;
    return up / n * 100;
  }),
  /** 动量振荡 AO：中位价 5/34 均线差 */
  ao: (h, l) => {
    const mp = f.medprice(h, l);
    const s5 = f.sma(mp, 5), s34 = f.sma(mp, 34);
    return mp.map((_, i) => Number.isNaN(s5[i]) || Number.isNaN(s34[i]) ? NaN : s5[i] - s34[i]);
  },
  /** 变动率（百分比口径） */
  rocr: (c, n) => f.roc(c, n).map((x) => Number.isNaN(x) ? NaN : x * 100),
  /** 乖离率 BIAS（%） */
  bias: (c, n) => {
    const m = f.sma(c, n);
    return c.map((v, i) => Number.isNaN(m[i]) || m[i] === 0 ? NaN : (v / m[i] - 1) * 100);
  },
  /** 确然指标 KST：四档 ROC 平滑加权和 */
  kst: (c, n1 = 10, n2 = 15, n3 = 20, n4 = 30) => {
    const r1 = f.sma(f.rocr(c, n1), 10), r2 = f.sma(f.rocr(c, n2), 10);
    const r3 = f.sma(f.rocr(c, n3), 10), r4 = f.sma(f.rocr(c, n4), 15);
    const k = c.map((_, i) => {
      const vs = [r1[i], r2[i], r3[i], r4[i]];
      if (vs.some((x) => Number.isNaN(x))) return NaN;
      return r1[i] + 2 * r2[i] + 3 * r3[i] + 4 * r4[i];
    });
    const sig = f.sma(k.map((x) => Number.isNaN(x) ? 0 : x), 9);
    const warm = n4 + 15 - 1 + 9 - 1;
    return { kst: k, signal: sig.map((v, i) => i < warm ? NaN : v) };
  },
  /** Fisher 变换：把价格在区间中的位置高斯化，signal 为前一根值 */
  fisher: (h, l, n = 9) => {
    const mp = f.medprice(h, l);
    const fish = new Array(mp.length).fill(NaN);
    const sig = new Array(mp.length).fill(NaN);
    let prevX = 0, prevF = 0;
    for (let i = n - 1; i < mp.length; i++) {
      const win = mp.slice(i - n + 1, i + 1);
      const hh = Math.max(...win), ll = Math.min(...win);
      let x = hh === ll ? 0 : 2 * ((mp[i] - ll) / (hh - ll) - 0.5);
      x = 0.33 * x + 0.67 * prevX;
      x = Math.max(-0.999, Math.min(0.999, x));
      const fv = 0.5 * Math.log((1 + x) / (1 - x)) + 0.5 * prevF;
      fish[i] = fv;
      sig[i] = i > n - 1 ? prevF : NaN;
      prevX = x;
      prevF = fv;
    }
    return { fish, signal: sig };
  },
  /** 涡旋指标 Vortex：VI+ / VI− */
  vortex: (h, l, c, n = 14) => {
    const viP = new Array(c.length).fill(NaN), viM = new Array(c.length).fill(NaN);
    for (let i = n; i < c.length; i++) {
      let sp = 0, sm = 0, str = 0;
      for (let k = i - n + 1; k <= i; k++) {
        sp += Math.abs(h[k] - l[k - 1]);
        sm += Math.abs(l[k] - h[k - 1]);
        str += Math.max(h[k] - l[k], Math.abs(h[k] - c[k - 1]), Math.abs(l[k] - c[k - 1]));
      }
      if (str !== 0) {
        viP[i] = sp / str;
        viM[i] = sm / str;
      }
    }
    return { viP, viM };
  },
  /** 去趋势价格振荡 DPO：shift 周期前的价格 − 今日均线 */
  dpo: (c, n = 20) => {
    const m = f.sma(c, n), shift = Math.floor(n / 2) + 1;
    return c.map((_, i) => i < shift || Number.isNaN(m[i]) ? NaN : c[i - shift] - m[i]);
  },
  /** 震荡指数 Choppiness：≈61.8 以上盘整，≈38.2 以下趋势 */
  choppiness: (h, l, c, n = 14) => {
    const tr = f.trange(h, l, c);
    return c.map((_, i) => {
      if (i < n) return NaN;
      const win = tr.slice(i - n + 1, i + 1);
      if (win.some((x) => Number.isNaN(x))) return NaN;
      const sum = win.reduce((s, x) => s + x, 0);
      const hh = Math.max(...h.slice(i - n + 1, i + 1)), ll = Math.min(...l.slice(i - n + 1, i + 1));
      return hh === ll ? 100 : 100 * Math.log10(sum / (hh - ll)) / Math.log10(n);
    });
  },
  /** 垂直水平滤波 VHF：趋势/震荡辨识度 */
  vhf: (c, n = 28) => c.map((_, i) => {
    if (i < n) return NaN;
    const win = c.slice(i - n, i + 1);
    let num = 0;
    for (let k = i - n + 1; k <= i; k++) num += Math.abs(c[k] - c[k - 1]);
    return num === 0 ? NaN : (Math.max(...win) - Math.min(...win)) / num;
  }),
  /** 估波曲线 Coppock：ROC14+ROC11 的 10 周期 WMA（万得口径） */
  coppock: (c, n = 10) => {
    const r = c.map((_, i) => {
      const a = f.roc(c, 14)[i], b = f.roc(c, 11)[i];
      return Number.isNaN(a) || Number.isNaN(b) ? NaN : (a + b) * 100;
    });
    const w = f.wma(r.map((x) => Number.isNaN(x) ? 0 : x), n);
    return w.map((v, i) => i < 14 + n - 1 ? NaN : v);
  },
  // ===== 量能 =====
  /** 能量潮 OBV：涨加量、跌减量 */
  obv: (c, v) => {
    const out = [0];
    for (let i = 1; i < c.length; i++) out.push(out[i - 1] + (c[i] > c[i - 1] ? v[i] : c[i] < c[i - 1] ? -v[i] : 0));
    return out;
  },
  /** 蔡金累积/派发线 ADL */
  adl: (h, l, c, v) => {
    const out = [];
    let s = 0;
    for (let i = 0; i < c.length; i++) {
      const rng = h[i] - l[i];
      const mfm = rng === 0 ? 0 : (c[i] - l[i] - (h[i] - c[i])) / rng;
      s += mfm * v[i];
      out.push(s);
    }
    return out;
  },
  /** 蔡金振荡器 ADOSC：ADL 的快慢 EMA 差 */
  adosc: (h, l, c, v, fast = 3, slow = 10) => {
    const a = f.adl(h, l, c, v);
    const ef = f.ema(a, fast), es = f.ema(a, slow);
    return a.map((_, i) => ef[i] - es[i]);
  },
  /** 资金流量指标 MFI：量能加权的 RSI（0~100） */
  mfi: (h, l, c, v, n = 14) => {
    const tp = f.typprice(h, l, c);
    return c.map((_, i) => {
      if (i < n) return NaN;
      let pos = 0, neg = 0;
      for (let k = i - n + 1; k <= i; k++) {
        const flow = tp[k] * v[k];
        if (tp[k] > tp[k - 1]) pos += flow;
        else if (tp[k] < tp[k - 1]) neg += flow;
      }
      return neg === 0 ? 100 : 100 - 100 / (1 + pos / neg);
    });
  },
  /** 价量趋势 PVT：收益率 × 成交量 的累积 */
  pvt: (c, v) => {
    const out = [0];
    for (let i = 1; i < c.length; i++) out.push(out[i - 1] + (c[i] / c[i - 1] - 1) * v[i]);
    return out;
  },
  /** 简易波动指标 EOM（量级随成交量纲，相对比较用） */
  eom: (h, l, v, n = 14) => {
    const raw = h.map((_, i) => {
      if (i === 0) return NaN;
      const mm = (h[i] + l[i]) / 2 - (h[i - 1] + l[i - 1]) / 2;
      const rng = h[i] - l[i];
      return v[i] === 0 ? 0 : mm * rng / v[i];
    });
    const s = f.sma(raw.map((x) => Number.isNaN(x) ? 0 : x), n);
    return s.map((val, i) => i < n ? NaN : val);
  },
  /** 量变动率 VROC */
  vroc: (v, n) => v.map((x, i) => i < n || v[i - n] === 0 ? NaN : x / v[i - n] - 1),
  /** 成交量比率 VR（国内常用：上涨量+平盘量/2 对 下跌量+平盘量/2） */
  vr: (c, v, n = 26) => c.map((_, i) => {
    if (i < n) return NaN;
    let up = 0, dn = 0, flat = 0;
    for (let k = i - n + 1; k <= i; k++) {
      if (c[k] > c[k - 1]) up += v[k];
      else if (c[k] < c[k - 1]) dn += v[k];
      else flat += v[k];
    }
    const denom = dn + flat / 2;
    return denom === 0 ? NaN : (up + flat / 2) / denom * 100;
  }),
  /** CR 能量指标：与前一交易日中间价的强弱对比 */
  cr: (h, l, c, n = 26) => {
    const mid = f.typprice(h, l, c);
    return c.map((_, i) => {
      if (i < n + 1) return NaN;
      let up = 0, dn = 0;
      for (let k = i - n + 1; k <= i; k++) {
        up += Math.max(0, h[k] - mid[k - 1]);
        dn += Math.max(0, mid[k - 1] - l[k]);
      }
      return dn === 0 ? NaN : up / dn * 100;
    });
  },
  /** 量均线 */
  vma: (v, n) => f.sma(v, n),
  // ===== 波动增强 =====
  /** 归一化 ATR（占收盘价 %） */
  natr: (h, l, c, n = 14) => {
    const a = f.atr(h, l, c, n);
    return a.map((x, i) => Number.isNaN(x) || c[i] === 0 ? NaN : x / c[i] * 100);
  },
  /** 真实波幅 TR */
  trange: (h, l, c) => c.map((_, i) => i === 0 ? h[0] - l[0] : Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]))),
  /** 滚动标准差 / 方差 */
  rollingStd: (xs, n) => xs.map((_, i) => i < n - 1 ? NaN : f.stdev(xs.slice(i - n + 1, i + 1))),
  rollingVar: (xs, n) => xs.map((_, i) => {
    if (i < n - 1) return NaN;
    const w = xs.slice(i - n + 1, i + 1), m = f.mean(w);
    return f.mean(w.map((x) => (x - m) ** 2));
  }),
  /** 滚动历史波动率（年化） */
  hv: (c, n = 20, ppy = 252) => {
    const r = f.returns(c);
    return r.map((_, i) => {
      if (i < n) return NaN;
      const w = r.slice(i - n + 1, i + 1);
      if (w.some((x) => Number.isNaN(x))) return NaN;
      return f.stdev(w) * Math.sqrt(ppy);
    });
  },
  /** 肯特纳通道：EMA ± mult·ATR */
  keltner: (h, l, c, n = 20, mult = 2) => {
    const mid = f.ema(c, n), a = f.atr(h, l, c, n);
    return {
      mid,
      up: c.map((_, i) => Number.isNaN(a[i]) ? NaN : mid[i] + mult * a[i]),
      dn: c.map((_, i) => Number.isNaN(a[i]) ? NaN : mid[i] - mult * a[i])
    };
  },
  /** 唐奇安通道：n 日最高 / 最低 / 中轨 */
  donchian: (h, l, n = 20) => {
    const up = f.hhv(h, n), dn = f.llv(l, n);
    return { up, dn, mid: up.map((x, i) => Number.isNaN(x) ? NaN : (x + dn[i]) / 2) };
  },
  /** 溃疡指数 Ulcer Index：回撤深度的均方根 */
  ulcer: (c, n = 14) => {
    const dd = f.drawdownSeries(c);
    return c.map((_, i) => {
      if (i < n - 1) return NaN;
      const w = dd.slice(i - n + 1, i + 1).map((x) => x * 100);
      return Math.sqrt(f.mean(w.map((x) => x * x)));
    });
  },
  // ===== 价格变换 =====
  /** 平均价 (O+H+L+C)/4 */
  avgprice: (o, h, l, c) => c.map((_, i) => (o[i] + h[i] + l[i] + c[i]) / 4),
  /** 中位价 (H+L)/2 */
  medprice: (h, l) => h.map((x, i) => (x + l[i]) / 2),
  /** 典型价 (H+L+C)/3 */
  typprice: (h, l, c) => c.map((x, i) => (h[i] + l[i] + x) / 3),
  /** 加权收盘 (H+L+2C)/4 */
  wclprice: (h, l, c) => c.map((x, i) => (h[i] + l[i] + 2 * x) / 4),
  // ===== 统计与风险增强 =====
  /** 滚动偏度 */
  skew: (xs, n) => xs.map((_, i) => {
    if (i < n - 1) return NaN;
    const w = xs.slice(i - n + 1, i + 1), m = f.mean(w), sd = f.stdev(w);
    return sd === 0 ? NaN : f.mean(w.map((x) => ((x - m) / sd) ** 3));
  }),
  /** 滚动超额峰度（正态 = 0） */
  kurt: (xs, n) => xs.map((_, i) => {
    if (i < n - 1) return NaN;
    const w = xs.slice(i - n + 1, i + 1), m = f.mean(w), sd = f.stdev(w);
    return sd === 0 ? NaN : f.mean(w.map((x) => ((x - m) / sd) ** 4)) - 3;
  }),
  /** 滞后 lag 阶自相关（单值，>0 趋势性 / <0 均值回复倾向） */
  autocorr: (xs, lag = 1) => {
    const clean = xs.filter((x) => !Number.isNaN(x));
    if (clean.length <= lag + 2) return NaN;
    return f.correlation(clean.slice(0, clean.length - lag), clean.slice(lag));
  },
  /** 滚动百分位：当前值在近 n 日窗口中的分位（0~1） */
  percentileRank: (xs, n) => xs.map((v, i) => {
    if (i < n - 1) return NaN;
    const w = xs.slice(i - n + 1, i + 1);
    return w.filter((x) => x <= v).length / n;
  }),
  /** 回撤序列：距历史峰值的比例（≤0） */
  drawdownSeries: (c) => {
    let peak = -Infinity;
    return c.map((v) => {
      if (v > peak) peak = v;
      return peak > 0 ? v / peak - 1 : NaN;
    });
  },
  /** 历史法 VaR：收益序列的 α 分位（负数表示亏损） */
  histVar: (rets, alpha = 0.05) => {
    const clean = rets.filter((x) => !Number.isNaN(x)).sort((a, b) => a - b);
    if (clean.length < 5) return NaN;
    return clean[Math.max(0, Math.floor(alpha * clean.length) - 1)];
  },
  /** 历史法 CVaR（期望亏损）：α 尾部的均值 */
  histCVar: (rets, alpha = 0.05) => {
    const clean = rets.filter((x) => !Number.isNaN(x)).sort((a, b) => a - b);
    if (clean.length < 5) return NaN;
    const k = Math.max(1, Math.floor(alpha * clean.length));
    return f.mean(clean.slice(0, k));
  },
  /** Omega 比率：阈值以上收益和 / 以下亏损和 */
  omegaRatio: (rets, threshold = 0) => {
    const clean = rets.filter((x) => !Number.isNaN(x));
    if (!clean.length) return NaN;
    let up = 0, dn = 0;
    for (const x of clean) {
      if (x > threshold) up += x - threshold;
      else dn += threshold - x;
    }
    return dn === 0 ? NaN : up / dn;
  },
  /** 盈亏比（收益序列口径）：平均盈利 / 平均亏损绝对值 */
  gainLossRatio: (rets) => {
    const w = rets.filter((x) => !Number.isNaN(x) && x > 0), l = rets.filter((x) => !Number.isNaN(x) && x < 0);
    if (!w.length || !l.length) return NaN;
    return f.mean(w) / Math.abs(f.mean(l));
  },
  /** 尾部比 |P95| / |P5|：右尾厚 > 1 有利 */
  tailRatio: (rets) => {
    const clean = rets.filter((x) => !Number.isNaN(x)).sort((a, b) => a - b);
    if (clean.length < 20) return NaN;
    const p5 = clean[Math.floor(0.05 * clean.length)], p95 = clean[Math.floor(0.95 * clean.length)];
    return p5 === 0 ? NaN : Math.abs(p95 / p5);
  },
  /** 信息比率：超额收益均值 / 跟踪误差（年化） */
  informationRatio: (c, bench, ppy = 252) => {
    const rc = f.returns(c), rb = f.returns(bench);
    const ex = rc.map((x, i) => Number.isNaN(x) || Number.isNaN(rb[i]) ? NaN : x - rb[i]).filter((x) => !Number.isNaN(x));
    if (ex.length < 5) return NaN;
    const te = f.stdev(ex);
    return te === 0 ? NaN : f.mean(ex) / te * Math.sqrt(ppy);
  },
  /** 跟踪误差（年化） */
  trackingError: (c, bench, ppy = 252) => {
    const rc = f.returns(c), rb = f.returns(bench);
    const ex = rc.map((x, i) => Number.isNaN(x) || Number.isNaN(rb[i]) ? NaN : x - rb[i]).filter((x) => !Number.isNaN(x));
    return ex.length < 5 ? NaN : f.stdev(ex) * Math.sqrt(ppy);
  },
  /** 上行/下行捕获率（%）：基准涨/跌区间里组合的累积收益占比 */
  captureRatio: (c, bench) => {
    const rc = f.returns(c), rb = f.returns(bench);
    let cUp = 1, bUp = 1, cDn = 1, bDn = 1, nUp = 0, nDn = 0;
    for (let i = 0; i < rc.length; i++) {
      if (Number.isNaN(rc[i]) || Number.isNaN(rb[i])) continue;
      if (rb[i] > 0) {
        cUp *= 1 + rc[i];
        bUp *= 1 + rb[i];
        nUp++;
      } else if (rb[i] < 0) {
        cDn *= 1 + rc[i];
        bDn *= 1 + rb[i];
        nDn++;
      }
    }
    return {
      up: nUp && bUp !== 1 ? (cUp - 1) / (bUp - 1) * 100 : NaN,
      down: nDn && bDn !== 1 ? (cDn - 1) / (bDn - 1) * 100 : NaN
    };
  },
  /** 当前值在近 n 日区间的位置（0~1，追涨杀跌扫描同款口径） */
  rangePos: (xs, n) => xs.map((v, i) => {
    if (i < n - 1) return NaN;
    const hh = Math.max(...xs.slice(i - n + 1, i + 1)), ll = Math.min(...xs.slice(i - n + 1, i + 1));
    return hh === ll ? 0.5 : (v - ll) / (hh - ll);
  }),
  // ===== K 线形态 =====
  /** 跳空高开 / 低开（开盘 vs 前收，th 为阈值比例） */
  gapUp: (o, c, th = 0) => o.map((v, i) => i > 0 && v > c[i - 1] * (1 + th)),
  gapDown: (o, c, th = 0) => o.map((v, i) => i > 0 && v < c[i - 1] * (1 - th)),
  /** K 线实体幅度（%）：(C−O)/O */
  bodyPct: (o, c) => c.map((v, i) => o[i] === 0 ? NaN : (v - o[i]) / o[i] * 100),
  /** 上影线幅度（%） */
  upperShadow: (o, h, c) => c.map((_, i) => o[i] === 0 ? NaN : (h[i] - Math.max(o[i], c[i])) / o[i] * 100),
  /** 下影线幅度（%） */
  lowerShadow: (o, l, c) => c.map((_, i) => o[i] === 0 ? NaN : (Math.min(o[i], c[i]) - l[i]) / o[i] * 100),
  /** 连续成立计数（中断归零） */
  consecutive: (conds) => {
    let s = 0;
    return conds.map((x) => s = x ? s + 1 : 0);
  },
  // ===== 横截面工具（多标的逐日对齐） =====
  /** 横截面秩：逐日归一到 0~1（最高 = 1） */
  xsRank: (byCode) => {
    const codes = Object.keys(byCode);
    if (!codes.length) return {};
    const len = Math.min(...codes.map((cd) => byCode[cd].length));
    const out = {};
    for (const cd of codes) out[cd] = new Array(byCode[cd].length).fill(NaN);
    for (let t = 0; t < len; t++) {
      const vals = codes.map((cd) => byCode[cd][t]);
      if (vals.some((x) => Number.isNaN(x))) continue;
      const r = f.rank(vals), n = codes.length;
      codes.forEach((cd, k) => {
        out[cd][t] = n > 1 ? (r[k] - 1) / (n - 1) : 0.5;
      });
    }
    return out;
  },
  /** 横截面 z-score：逐日去均值、除标准差 */
  xsZscore: (byCode) => {
    const codes = Object.keys(byCode);
    if (!codes.length) return {};
    const len = Math.min(...codes.map((cd) => byCode[cd].length));
    const out = {};
    for (const cd of codes) out[cd] = new Array(byCode[cd].length).fill(NaN);
    for (let t = 0; t < len; t++) {
      const vals = codes.map((cd) => byCode[cd][t]);
      if (vals.some((x) => Number.isNaN(x))) continue;
      const m = f.mean(vals), sd = f.stdev(vals);
      if (sd === 0) continue;
      codes.forEach((cd, k) => {
        out[cd][t] = (vals[k] - m) / sd;
      });
    }
    return out;
  },
  /** 横截面去均值：逐日减当日均值（中性化第一步） */
  xsDemean: (byCode) => {
    const codes = Object.keys(byCode);
    if (!codes.length) return {};
    const len = Math.min(...codes.map((cd) => byCode[cd].length));
    const out = {};
    for (const cd of codes) out[cd] = new Array(byCode[cd].length).fill(NaN);
    for (let t = 0; t < len; t++) {
      const vals = codes.map((cd) => byCode[cd][t]);
      if (vals.some((x) => Number.isNaN(x))) continue;
      const m = f.mean(vals);
      codes.forEach((cd, k) => {
        out[cd][t] = vals[k] - m;
      });
    }
    return out;
  },
  // ===== 杂项工具 =====
  /** 前向填充 NaN（首个有效值之前保持 NaN） */
  fillNaN: (xs) => {
    let last = NaN;
    return xs.map((x) => {
      if (!Number.isNaN(x)) last = x;
      return Number.isNaN(x) ? last : x;
    });
  },
  /** 截断到 [lo, hi] */
  clip: (xs, lo, hi) => xs.map((x) => Number.isNaN(x) ? NaN : Math.max(lo, Math.min(hi, x))),
  /** min-max 缩放到 [lo, hi]（常数序列 → 区间中点） */
  rescale: (xs, lo = 0, hi = 1) => {
    const clean = xs.filter((x) => !Number.isNaN(x));
    if (!clean.length) return xs.map(() => NaN);
    const mn = Math.min(...clean), mx = Math.max(...clean);
    return xs.map((x) => Number.isNaN(x) ? NaN : mx === mn ? (lo + hi) / 2 : lo + (x - mn) / (mx - mn) * (hi - lo));
  }
};
function forwardReturns(c, horizon) {
  return c.map((_, i) => i + horizon >= c.length ? NaN : c[i + horizon] / c[i] - 1);
}
function icBench(factor, closes, horizon = 5) {
  const fwd = forwardReturns(closes, horizon);
  const pairs = factor.map((v, i) => [v, fwd[i]]).filter(([a, b]) => !Number.isNaN(a) && !Number.isNaN(b));
  if (pairs.length < 30) return { ic: NaN, rankIC: NaN, icir: NaN, positiveRate: NaN, days: pairs.length };
  const fv = pairs.map((p) => p[0]), rv = pairs.map((p) => p[1]);
  const ic = f.ic(fv, rv);
  const rankIC = f.rankIC(fv, rv);
  const win = 20;
  const roll = [];
  for (let i = win; i <= pairs.length; i++) {
    const segF = fv.slice(i - win, i), segR = rv.slice(i - win, i);
    const r = f.rankIC(segF, segR);
    if (!Number.isNaN(r)) roll.push(r);
  }
  const m = f.mean(roll), sd = f.stdev(roll);
  return {
    ic,
    rankIC,
    icir: sd ? m / sd : NaN,
    positiveRate: roll.length ? roll.filter((x) => x > 0).length / roll.length : NaN,
    days: pairs.length
  };
}
function crossSectionalIC(factorByCode, closeByCode, horizon = 5) {
  const codes = Object.keys(factorByCode).filter((c) => closeByCode[c]);
  if (codes.length < 3) return { ic: NaN, rankIC: NaN, icir: NaN, positiveRate: NaN, days: 0, series: [] };
  const len = Math.min(...codes.map((c) => factorByCode[c].length));
  const fwdByCode = {};
  for (const c of codes) fwdByCode[c] = forwardReturns(closeByCode[c], horizon);
  const series = [];
  for (let t = 0; t < len; t++) {
    const fv = [], rv = [];
    for (const c of codes) {
      const a = factorByCode[c][t], b = fwdByCode[c][t];
      if (!Number.isNaN(a) && !Number.isNaN(b)) {
        fv.push(a);
        rv.push(b);
      }
    }
    if (fv.length >= 3) {
      const r = f.rankIC(fv, rv);
      if (!Number.isNaN(r)) series.push(r);
    }
  }
  if (series.length < 10) return { ic: NaN, rankIC: NaN, icir: NaN, positiveRate: NaN, days: series.length, series };
  const m = f.mean(series), sd = f.stdev(series);
  return {
    ic: m,
    rankIC: m,
    icir: sd ? m / sd : NaN,
    positiveRate: series.filter((x) => x > 0).length / series.length,
    days: series.length,
    series
  };
}
function quantlibSelfTest() {
  const eq = (a, b2, eps = 1e-9) => Math.abs(a - b2) < eps;
  const tests = [];
  const t = (name, pass) => tests.push({ name, pass });
  t("returns \u6536\u76CA\u7387", eq(f.returns([100, 110, 99])[1], 0.1) && eq(f.returns([100, 110, 99])[2], -0.1));
  t("cumReturn \u7D2F\u8BA1\u6536\u76CA", eq(f.cumReturn([100, 121]), 0.21));
  t("sma \u7B80\u5355\u5747\u7EBF", eq(f.sma([1, 2, 3, 4], 2)[3], 3.5) && Number.isNaN(f.sma([1, 2, 3, 4], 2)[0]));
  t("ema \u6307\u6570\u5747\u7EBF", eq(f.ema([5, 5, 5], 3)[2], 5));
  const md = f.maxDrawdown([100, 120, 60, 130, 65]);
  t("maxDrawdown \u6700\u5927\u56DE\u64A4", eq(md.mdd, -0.5) && md.peak === 1 && md.trough === 2);
  t("correlation \u76F8\u5173", eq(f.correlation([1, 2, 3], [2, 4, 6]), 1));
  t("rank \u79E9\u6B21", JSON.stringify(f.rank([30, 10, 20])) === "[3,1,2]");
  t("rankIC \u5355\u8C03\u6B63\u76F8\u5173", eq(f.rankIC([1, 2, 3, 4, 5], [0.01, 0.02, 0.03, 0.04, 0.05]), 1));
  const up = Array.from({ length: 30 }, (_, i) => 100 + i);
  t("rsi \u5355\u8FB9\u4E0A\u6DA8\u2192100", eq(f.rsi(up, 14)[29], 100));
  const mc = f.macd([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  t("macd \u591A\u5934\u6392\u5217 dif>0", mc.dif[9] > 0 && mc.dif.length === 10);
  const b = f.boll([5, 5, 5, 5, 5], 3, 2);
  t("boll \u96F6\u6CE2\u52A8\u5E26\u5BBD=0", eq(b.up[4], 5) && eq(b.dn[4], 5));
  t("sharpe \u5E38\u6570\u5E8F\u5217\u2192NaN", Number.isNaN(f.sharpe([100, 100, 100])));
  t("hhv/llv \u533A\u95F4\u6781\u503C", eq(f.hhv([1, 3, 2], 2)[2], 3) && eq(f.llv([1, 3, 2], 2)[2], 2));
  t("crossUp \u4E0A\u7A7F", JSON.stringify(f.crossUp([1, 3], [2, 2])) === "[false,true]");
  t("barsSince \u5468\u671F\u8BA1\u6570", eq(f.barsSince([false, true, false, false])[3], 2));
  const mk = (r) => Array.from({ length: 12 }, (_, i) => 10 * Math.pow(1 + r, i));
  const cs = crossSectionalIC(
    { A: new Array(12).fill(1), B: new Array(12).fill(2), C: new Array(12).fill(3) },
    { A: mk(0.01), B: mk(0.02), C: mk(0.03) },
    1
  );
  t("\u6A2A\u622A\u9762 IC \u5B8C\u7F8E\u5355\u8C03\u21921", eq(cs.rankIC, 1) && cs.days === 11);
  const bullH = up.map((v) => v + 1), bullL = up.map((v) => v - 1);
  t("dema \u6BD4 sma \u6EDE\u540E\u66F4\u5C0F", f.dema(up, 10)[29] > f.sma(up, 10)[29]);
  t("kama \u4E0A\u6DA8\u8D8B\u52BF\u672B\u7AEF\u62AC\u5347", f.kama(up, 10)[29] > f.kama(up, 10)[20]);
  t("hma \u4E0A\u6DA8\u8D8B\u52BF\u672B\u7AEF\u9AD8\u4E8E wma", f.hma(up, 10)[29] > f.wma(up, 10)[29] - 1e-9);
  t("vwma \u7B49\u6743= sma", eq(f.vwma([1, 2, 3, 4], [7, 7, 7, 7], 2)[3], 3.5));
  t("linregSlope \u5B8C\u7F8E\u7EBF\u6027", eq(f.linregSlope([2, 4, 6, 8], 4)[3], 2));
  t("tsf \u9884\u6D4B\u4E0B\u4E00\u70B9", eq(f.tsf([1, 2, 3], 3)[2], 4));
  t("sar \u5355\u8FB9\u4E0A\u6DA8 sar<\u6536\u76D8", f.sar(bullH, bullL)[29] < bullH[29]);
  t("supertrend \u5355\u8FB9\u4E0A\u6DA8\u65B9\u5411=1", f.supertrend(bullH, bullL, up, 10).dir[29] === 1);
  const bear = Array.from({ length: 30 }, (_, i) => 100 - i);
  const bearC = bear.map((v) => v - 1);
  t("wr \u5355\u8FB9\u4E0B\u8DCC\u6536\u6700\u4F4E=-100", eq(f.wr(bear.map((v) => v + 1), bear.map((v) => v - 1), bearC, 14)[29], -100));
  t("cci \u5355\u8FB9\u4E0A\u6DA8>100", f.cci(bullH, bullL, up, 20)[29] > 100);
  t("stoch \u6536\u5728\u533A\u95F4\u6700\u9AD8=100", eq(f.stoch([5, 5, 5], [1, 1, 1], [5, 5, 5], 3)[2], 100));
  t("stochRsi \u754C\u5185", (() => {
    const r = f.stochRsi(up, 14, 14)[29];
    return r >= 0 && r <= 100;
  })());
  t("trix \u52A0\u901F\u4E0A\u6DA8>0", f.trix(Array.from({ length: 40 }, (_, i) => 100 * Math.pow(1.02, i)), 15)[39] > 0);
  t("cmo \u5355\u8FB9\u4E0A\u6DA8\u2192100", eq(f.cmo(up, 14)[29], 100));
  t("aroon \u4ECA\u65E5\u65B0\u9AD8 up=100", eq(f.aroon(bullH, bullL, 25).up[29], 100));
  const dmiR = f.dmi(bullH, bullL, up, 14);
  t("dmi \u5355\u8FB9\u4E0A\u6DA8 pdi>mdi", dmiR.pdi[29] > dmiR.mdi[29] && dmiR.mdi[29] === 0);
  t("psy \u5355\u8FB9\u4E0A\u6DA8=100", eq(f.psy(up, 12)[29], 100));
  t("obv \u5355\u8FB9\u4E0A\u6DA8=\u91CF\u4E4B\u548C", eq(f.obv([1, 2, 3], [10, 20, 30])[2], 50));
  t("adl \u6536\u5728\u6700\u9AD8 mfm=1", eq(f.adl([10], [8], [10], [100])[0], 100));
  t("mfi \u5355\u8FB9\u4E0A\u6DA8=100", eq(f.mfi(bullH, bullL, up, new Array(30).fill(100), 14)[29], 100));
  t("vr \u53EA\u6DA8\u4E0D\u8DCC\u2192\u221E\u9632\u62A4", Number.isNaN(f.vr(up, new Array(30).fill(100), 26)[29]));
  t("natr \u5E38\u6570\u5E8F\u5217\u21920", eq(f.natr([5, 5, 5], [5, 5, 5], [5, 5, 5], 2)[2], 0));
  t("donchian \u4E0A\u4E0B\u8F68", eq(f.donchian([1, 3, 2], [1, 1, 1], 2).up[2], 3) && eq(f.donchian([1, 3, 2], [1, 1, 1], 2).dn[2], 1));
  const ddS = f.drawdownSeries([100, 120, 60, 130, 65]);
  t("drawdownSeries \u8C37\u503C=mdd", eq(Math.min(...ddS), -0.5));
  t("histVar \u6392\u5E8F\u5206\u4F4D", eq(f.histVar([-0.05, -0.04, -0.03, -0.02, -0.01, 0.01, 0.02, 0.03, 0.04, 0.05], 0.1), -0.05));
  t("percentileRank \u5F53\u524D\u503C\u6700\u5927=1", eq(f.percentileRank([1, 3, 9], 3)[2], 1));
  t("rangePos \u9876\u90E8=1", eq(f.rangePos([1, 2, 9], 3)[2], 1));
  t("gapUp \u8DF3\u7A7A\u8BC6\u522B", JSON.stringify(f.gapUp([100, 112], [100, 100], 0.05)) === "[false,true]");
  t("consecutive \u8FDE\u7EED\u8BA1\u6570", JSON.stringify(f.consecutive([true, true, false, true])) === "[1,2,0,1]");
  const xsR = f.xsRank({ A: [1, 1], B: [2, 2], C: [3, 3] });
  t("xsRank \u5F52\u4E00", eq(xsR.A[0], 0) && eq(xsR.C[0], 1) && eq(xsR.B[0], 0.5));
  const xD = f.xsDemean({ A: [1], B: [2], C: [3] });
  t("xsDemean \u548C\u4E3A0", eq(xD.A[0] + xD.B[0] + xD.C[0], 0));
  t("fillNaN \u524D\u5411\u586B\u5145", JSON.stringify(f.fillNaN([NaN, 1, NaN, 3])) === "[null,1,1,3]");
  t("rescale \u7AEF\u70B9", eq(f.rescale([0, 10])[0], 0) && eq(f.rescale([0, 10])[1], 1));
  t("fisher signal \u6EDE\u540E\u4E00\u6839", (() => {
    const fr = f.fisher(bullH, bullL, 9);
    return eq(fr.signal[20], fr.fish[19]);
  })());
  return tests;
}
export {
  crossSectionalIC,
  f,
  forwardReturns,
  icBench,
  quantlibSelfTest
};

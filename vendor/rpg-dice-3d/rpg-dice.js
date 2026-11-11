/* rpg-dice-3d 1.0.0 (031bbde), https://github.com/stories-with-dice/rpg-dice-3d (MIT).
 * Vendored copy: do not edit here. Change the library, then run its scripts/vendor.js. */
/* rpg-dice.js — dice formula parser and roller (part of rpg-dice-3d).
 *
 * A classic script and a CommonJS module: in a browser it sets
 * window.RpgDice; in Node, require() returns the same object. No dependencies.
 *
 * Grammar (case-insensitive, spaces ignored):
 *   formula := sum [cmp number]          cmp: < <= > >= =
 *   sum     := product (('+' | '-') product)*
 *   product := unary (('*' | '/') unary)*
 *   unary   := '-' unary | '(' sum ')' | dice | number
 *   dice    := [count] 'd' (sides | '%' | 'F') modifier*
 *   modifier:= kh[n] | kl[n] | k[n] | dh[n] | dl[n]   keep / drop
 *            | ! [cmp n]                              explode (default: on max)
 *            | r[o] [cmp] n                           reroll (o = only once)
 *
 * A comparison after one dice group of two or more dice ("6d10>=8") counts
 * successes per die. Any other comparison ("2d6+1>=8", "1d100<50") tests the total.
 *
 * roll(parse(f), random) -> { total, sum, groups: [{ sides, kind, sign, dice: [{ value, kept, ... }] }], detail, text, ... }
 * toDice3D(result) -> the dice list for RpgDice3D.throwDice(), dropped dice included (kept: false).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RpgDice = api;
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';

const MAX_COUNT = 100;
const MAX_SIDES = 10000;
const MAX_EXPLODE = 100;
const MAX_TOTAL_DICE = 300;

class ParseError extends Error {}

function test(op, value, target) {
  switch (op) {
    case '<': return value < target;
    case '<=': return value <= target;
    case '>': return value > target;
    case '>=': return value >= target;
    default: return value === target;
  }
}

function faceValues(d) {
  if (d.kind === 'fudge') return [-1, 0, 1];
  const out = [];
  for (let v = 1; v <= d.sides; v++) out.push(v);
  return out;
}

function parse(source) {
  const s = String(source).replace(/\s+/g, '').toLowerCase();
  let i = 0;
  if (!s) throw new ParseError('Empty formula');

  const rest = () => s.slice(i);
  const err = (msg) => {
    throw new ParseError(i < s.length ? `${msg} at "${rest()}"` : msg);
  };
  const num = () => {
    const m = /^\d+/.exec(rest());
    if (!m) return null;
    i += m[0].length;
    if (m[0].length > 6) err('Number too large');
    return parseInt(m[0], 10);
  };
  const needNum = (what) => {
    const n = num();
    if (n === null) err(`Expected ${what}`);
    return n;
  };
  const cmpOp = () => {
    const m = /^(<=|>=|<|>|=)/.exec(rest());
    if (!m) return null;
    i += m[0].length;
    return m[0];
  };

  function dice(count) {
    let sides;
    let kind = 'std';
    if (s[i] === '%') { i++; sides = 100; }
    else if (s[i] === 'f') { i++; sides = 3; kind = 'fudge'; }
    else sides = needNum('the number of sides after "d"');

    if (count < 1) err('Roll at least one die');
    if (count > MAX_COUNT) err(`At most ${MAX_COUNT} dice per group`);
    if (sides < 1) err('A die needs at least one side');
    if (sides > MAX_SIDES) err(`At most ${MAX_SIDES} sides`);

    const d = { t: 'dice', count, sides, kind, keep: null, explode: null, reroll: null };
    const faces = faceValues(d);
    const maxFace = faces[faces.length - 1];

    for (;;) {
      const m = /^(kh|kl|dh|dl|k)/.exec(rest());
      if (m) {
        if (d.keep) err('Only one keep or drop per dice group');
        i += m[0].length;
        const n = num();
        const mode = m[0] === 'k' ? 'kh' : m[0];
        d.keep = { mode, n: n === null ? 1 : n };
        continue;
      }
      if (s[i] === '!') {
        if (d.explode) err('Only one explode per dice group');
        i++;
        const op = cmpOp();
        d.explode = op ? { op, n: needNum(`a number after "!${op}"`) } : { op: '=', n: maxFace };
        if (faces.every((v) => test(d.explode.op, v, d.explode.n))) err('That die would explode forever');
        continue;
      }
      if (s[i] === 'r') {
        if (d.reroll) err('Only one reroll per dice group');
        i++;
        const once = s[i] === 'o';
        if (once) i++;
        const op = cmpOp() || '=';
        d.reroll = { op, n: needNum('a number after "r"'), once };
        if (!once && faces.every((v) => test(d.reroll.op, v, d.reroll.n))) err('That die would reroll forever');
        continue;
      }
      break;
    }
    return d;
  }

  function atom() {
    if (s[i] === '(') {
      i++;
      const node = sum();
      if (s[i] !== ')') err('Missing ")"');
      i++;
      node.paren = true;
      return node;
    }
    const n = num();
    if (s[i] === 'd') {
      i++;
      return dice(n === null ? 1 : n);
    }
    if (n === null) err('Expected a number or dice');
    return { t: 'num', v: n };
  }

  function unary() {
    if (s[i] === '-') { i++; return { t: 'neg', a: unary() }; }
    if (s[i] === '+') { i++; return unary(); }
    return atom();
  }

  function product() {
    let left = unary();
    while (s[i] === '*' || s[i] === '/') {
      const op = s[i++];
      left = { t: 'bin', op, a: left, b: unary() };
    }
    return left;
  }

  function sum() {
    let left = product();
    while (s[i] === '+' || s[i] === '-') {
      const op = s[i++];
      left = { t: 'bin', op, a: left, b: product() };
    }
    return left;
  }

  const node = sum();
  let cmp = null;
  const op = cmpOp();
  if (op) {
    let sign = 1;
    if (s[i] === '-') { sign = -1; i++; }
    cmp = { op, target: sign * needNum(`a number after "${op}"`) };
  }
  if (i < s.length) err('Unexpected text');
  // One plain die ("1d100<50") tests its value; a pool ("6d10>=8") counts successes.
  const pool = !!cmp && node.t === 'dice' && !node.paren && (node.count > 1 || !!node.explode);
  return { source: String(source).trim(), node, cmp, pool };
}

// Finds the formula inside a query that may carry a label before or after it,
// for example "2d20kh1 advantage" or "stealth 1d20+5".
function parseQuery(query) {
  const tokens = String(query).trim().split(/\s+/).filter(Boolean);
  let firstError = null;
  for (let k = tokens.length; k >= 1; k--) {
    try {
      return { formula: parse(tokens.slice(0, k).join(' ')), label: tokens.slice(k).join(' ') };
    } catch (e) {
      if (!(e instanceof ParseError)) throw e;
      if (!firstError) firstError = e;
    }
  }
  for (let k = 1; k < tokens.length; k++) {
    try {
      return { formula: parse(tokens.slice(k).join(' ')), label: tokens.slice(0, k).join(' ') };
    } catch (e) {
      if (!(e instanceof ParseError)) throw e;
    }
  }
  return { error: firstError ? firstError.message : 'Empty formula' };
}

// ---------- rolling ----------

// A uniform integer 1..sides: the Web Crypto API when there is one (browsers,
// Node 19+), else Math.random. Pass your own `random(sides)` to roll() to
// script the dice (tests) or to use another source.
const webCrypto = typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.getRandomValues ? globalThis.crypto : null;
function defaultRandom(sides) {
  if (webCrypto) {
    const limit = Math.floor(0x100000000 / sides) * sides; // no modulo bias
    const buf = new Uint32Array(1);
    do webCrypto.getRandomValues(buf); while (buf[0] >= limit);
    return 1 + (buf[0] % sides);
  }
  return 1 + Math.floor(Math.random() * sides);
}

function roll(parsed, random) {
  if (typeof parsed === 'string') parsed = parse(parsed);
  random = random || defaultRandom;
  const groups = [];
  let diceCount = 0;

  const rollFace = (d) => (d.kind === 'fudge' ? random(3) - 2 : random(d.sides));

  function evalDice(d, sign) {
    const dice = [];
    const add = (die) => {
      if (++diceCount > MAX_TOTAL_DICE) throw new ParseError(`Too many dice (more than ${MAX_TOTAL_DICE})`);
      dice.push(die);
    };
    for (let k = 0; k < d.count; k++) {
      let v = rollFace(d);
      const rerolled = [];
      if (d.reroll) {
        let guard = 0;
        while (test(d.reroll.op, v, d.reroll.n) && guard++ < 100) {
          rerolled.push(v);
          v = rollFace(d);
          if (d.reroll.once) break;
        }
      }
      add({ value: v, kept: true, rerolled, exploded: false });
      if (d.explode) {
        let cur = v;
        let guard = 0;
        while (test(d.explode.op, cur, d.explode.n) && guard++ < MAX_EXPLODE) {
          cur = rollFace(d);
          add({ value: cur, kept: true, rerolled: [], exploded: true });
        }
      }
    }
    if (d.keep) {
      const order = dice.map((die, idx) => idx).sort((a, b) => dice[a].value - dice[b].value || a - b);
      const n = Math.min(d.keep.n, dice.length);
      let dropped;
      if (d.keep.mode === 'kh') dropped = order.slice(0, dice.length - n);
      else if (d.keep.mode === 'kl') dropped = order.slice(n);
      else if (d.keep.mode === 'dl') dropped = order.slice(0, n);
      else dropped = order.slice(dice.length - n);
      for (const idx of dropped) dice[idx].kept = false;
    }
    if (parsed.pool) {
      for (const die of dice) die.success = die.kept ? test(parsed.cmp.op, die.value, parsed.cmp.target) : null;
    }
    const group = { sides: d.sides, kind: d.kind, sign, dice };
    groups.push(group);
    d._group = group;
    return dice.filter((x) => x.kept).reduce((acc, x) => acc + x.value, 0);
  }

  // sign: +1 or -1, whether this part adds to or subtracts from the total
  // (only exact for + and - chains; * and / keep the sign of their left side).
  function ev(node, sign) {
    switch (node.t) {
      case 'num': return node.v;
      case 'dice': return evalDice(node, sign);
      case 'neg': return -ev(node.a, -sign);
      default: {
        const a = ev(node.a, sign);
        const b = ev(node.b, node.op === '-' ? -sign : sign);
        if (node.op === '+') return a + b;
        if (node.op === '-') return a - b;
        if (node.op === '*') return a * b;
        if (b === 0) throw new ParseError('Division by zero');
        return Math.floor(a / b);
      }
    }
  }

  const sum = ev(parsed.node, 1);
  let total = sum;
  let outcome = null;
  let successes = null;
  if (parsed.pool) {
    successes = groups[0].dice.filter((x) => x.success).length;
    total = successes;
  } else if (parsed.cmp) {
    outcome = test(parsed.cmp.op, sum, parsed.cmp.target) ? 'success' : 'failure';
  }

  const detail = `${formatNode(parsed.node, parsed.pool)}${parsed.node.t === 'num' ? '' : ` = ${sum}`}`;
  const compact = formatNode(parsed.node, parsed.pool, true);
  const result = { formula: parsed.source, groups, sum, total, outcome, successes, detail, compact, pool: parsed.pool, cmp: parsed.cmp };
  result.text = resultText(result);
  clearGroups(parsed.node);
  return result;
}

function clearGroups(node) {
  if (!node) return;
  delete node._group;
  clearGroups(node.a);
  clearGroups(node.b);
}

function formatDie(die, pool) {
  let s = String(die.value);
  if (pool && die.success) s += '*';
  if (die.exploded) s += '!';
  return die.kept ? s : `(${s})`;
}

// compact: no spaces, and a group of one plain die shows its bare value ("6+1").
function formatNode(node, pool, compact = false) {
  let out;
  switch (node.t) {
    case 'num': out = String(node.v); break;
    case 'dice': {
      const ds = node._group.dice;
      if (compact && ds.length === 1 && ds[0].kept && !ds[0].exploded && !pool) out = String(ds[0].value);
      else out = `[${ds.map((d) => formatDie(d, pool)).join(compact ? ',' : ', ')}]`;
      break;
    }
    case 'neg': out = `-${formatNode(node.a, pool, compact)}`; break;
    default: {
      const sep = compact ? '' : ' ';
      out = `${formatNode(node.a, pool, compact)}${sep}${node.op}${sep}${formatNode(node.b, pool, compact)}`;
    }
  }
  return node.paren ? `(${out})` : out;
}

// One-line Markdown summary, e.g. "Attack: `2d20kh1+5 -> [(8),17]+5 -> 22`".
function toMarkdown(result, label) {
  let end;
  if (result.pool) end = `${result.successes} success${result.successes === 1 ? '' : 'es'}`;
  else if (result.outcome) end = `${result.sum} (${result.outcome})`;
  else end = String(result.total);
  const parts = [result.formula.replace(/\s+/g, '')];
  // skip the middle step when it adds nothing ("d20 -> 13", "1d100<50 -> 37 (success)")
  if (result.compact !== parts[0] && result.compact !== String(result.sum)) parts.push(result.compact);
  parts.push(end);
  const code = `\`${parts.join(' -> ')}\``;
  return label ? `${label}: ${code}` : code;
}

function resultText(r) {
  if (r.pool) return `${r.formula}: ${r.detail} → ${r.successes} success${r.successes === 1 ? '' : 'es'}`;
  if (r.outcome) return `${r.formula}: ${r.detail} → ${r.outcome}`;
  return `${r.formula}: ${r.detail}`;
}

// ---------- description ----------

function keptCount(d) {
  if (!d.keep) return d.count;
  const n = Math.min(d.keep.n, d.count);
  return d.keep.mode[0] === 'k' ? n : d.count - n;
}

function range(node) {
  switch (node.t) {
    case 'num': return [node.v, node.v];
    case 'dice': {
      const k = keptCount(node);
      if (node.kind === 'fudge') return [node.explode ? -Infinity : -k, node.explode ? Infinity : k];
      return [k, node.explode ? Infinity : k * node.sides];
    }
    case 'neg': {
      const [a, b] = range(node.a);
      return [-b, -a];
    }
    default: {
      const [a1, a2] = range(node.a);
      const [b1, b2] = range(node.b);
      if (node.op === '+') return [a1 + b1, a2 + b2];
      if (node.op === '-') return [a1 - b2, a2 - b1];
      const combos = [];
      for (const x of [a1, a2]) for (const y of [b1, b2]) {
        let v;
        if (node.op === '*') v = x === 0 || y === 0 ? 0 : x * y;
        else v = y === 0 ? NaN : Math.floor(x / y);
        if (!Number.isNaN(v)) combos.push(v);
      }
      return combos.length ? [Math.min(...combos), Math.max(...combos)] : [NaN, NaN];
    }
  }
}

function describe(parsed) {
  const cmp = parsed.cmp;
  if (parsed.pool) {
    return `Count dice ${cmp.op} ${cmp.target} (successes, 0–${parsed.node.explode ? '∞' : keptCount(parsed.node)})`;
  }
  const [lo, hi] = range(parsed.node);
  const fmt = (v) => (v === Infinity ? '∞' : v === -Infinity ? '−∞' : String(v));
  const span = Number.isNaN(lo) ? 'open range' : lo === hi ? `always ${lo}` : `range ${fmt(lo)}–${fmt(hi)}`;
  const text = span[0].toUpperCase() + span.slice(1);
  return cmp ? `Success if total ${cmp.op} ${cmp.target} · ${span}` : text;
}

// ---------- 3D dice ----------

// Sizes with a 3D body (the DCC dice chain). Others show as a coin ("token").
const SHAPES = [3, 4, 5, 6, 7, 8, 10, 12, 14, 16, 20, 24, 30];

// One die -> its 3D dice: [{ shape, top, sides, pair? }]. A d100 is two
// d10s: tens "00"-"90" and units "0"-"9" (100 = "00" + "0"). A Fate die
// (sides 'F' or kind 'fudge') shows "+", "−" or a blank face.
function dieToDice3D(sides, value, fudge) {
  const v = Number(value);
  if (fudge || sides === 'F') return [{ shape: 'dF', top: v > 0 ? '+' : v < 0 ? '−' : ' ', sides: 3 }];
  if (sides === 100) {
    const tens = Math.floor((v % 100) / 10);
    return [
      { shape: 'd10t', top: tens === 0 ? '00' : `${tens}0`, pair: true, sides: 100 },
      { shape: 'd10u', top: String(v % 10), pair: true, sides: 100 },
    ];
  }
  if (SHAPES.indexOf(sides) !== -1) return [{ shape: `d${sides}`, top: String(v), sides }];
  if (Number(sides) >= 1) return [{ shape: 'token', top: String(v), sides: Number(sides) }];
  return [];
}

// A roll's dice for RpgDice3D.throwDice(). Every rolled die shows, dropped
// ones too (kept: false: they show dim after the landing). `group` is the
// dice group index (one color per group, if the app wants it).
//   toDice3D(roll('2d20kh1+2')) -> [{ shape: 'd20', top: '8', kept: false, ... }, { shape: 'd20', top: '17', kept: true, ... }]
function toDice3D(result) {
  const out = [];
  result.groups.forEach((g, gi) => {
    for (const die of g.dice) {
      const base = { kept: die.kept, success: die.success === undefined ? null : die.success, exploded: die.exploded, group: gi };
      dieToDice3D(g.sides, die.value, g.kind === 'fudge').forEach((d) => out.push(Object.assign({}, base, d)));
    }
  });
  return out;
}

return {
  parse, parseQuery, roll, describe, range, toDice3D, dieToDice3D, toMarkdown, ParseError, SHAPES, defaultRandom,
  overlayDice: toDice3D, // the Wox plugin's older name
};
});

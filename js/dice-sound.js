/* js/dice-sound.js — the sounds of the 3D dice (Web Audio API, no audio files).
 *
 * Ported from the owner's Wox dice roller (overlay/sound.js). js/dice3d.js
 * simulates the throw and records sound events; OSR.diceSound.play() then
 * schedules one short sound per event:
 *   impact: a die lands or bounces on the table (die click + table thud)
 *   clack:  two dice hit each other (two bright clicks, no thud)
 *   roll:   a die tips onto its next face while it rolls (soft click)
 * OSR.diceSound.land() is the short click when the result shows.
 * Each die gets its own pitch from its size; the sound pans with its x position.
 * Settings → "Dice sound" (localStorage osr_roll_sound, js/dice.js) turns it off.
 */
(function (OSR) {
  'use strict';

  // Resonance ratios and levels of a small hard plastic body.
  const MODES = [[1, 1], [1.59, 0.55], [2.41, 0.32], [3.33, 0.18]];
  // Base pitch per body; small dice ring higher.
  const PITCH = { d3: 3300, d4: 3900, d5: 3000, d6: 3300, dF: 3300, d7: 2900, d8: 3500, d10: 3000, d10t: 3000, d10u: 3000, d12: 2800, d14: 2700, d16: 2600, d20: 2600, d24: 2500, d30: 2400, token: 4200 };
  const VOLUME = 0.7;

  let ctx = null;
  let noise = null;

  // The AudioContext, made on first use. Call it in the click that rolls:
  // a browser starts sound only after a user action.
  function context() {
    if (ctx) {
      if (ctx.state === 'suspended' && ctx.resume) ctx.resume();
      return ctx;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC({ latencyHint: 'interactive' });
      noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    } catch (e) { ctx = null; }
    return ctx;
  }

  const rand = (a, b) => a + (b - a) * Math.random();

  function envGain(when, peak, decay) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.linearRampToValueAtTime(peak, when + 0.0015);
    g.gain.exponentialRampToValueAtTime(0.0001, when + decay);
    return g;
  }

  function noiseBurst(when, out, peak, decay, type, freq, q) {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.playbackRate.value = rand(0.8, 1.2);
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const g = envGain(when, peak, decay);
    src.connect(filter).connect(g).connect(out);
    src.start(when, rand(0, 0.9), decay + 0.02);
  }

  // The die body: a click of filtered noise plus a few decaying resonances.
  function dieClick(when, out, s, f0, bright) {
    noiseBurst(when, out, 0.5 * s, 0.006 + 0.006 * s, 'bandpass', f0 * (bright ? 2.0 : 1.5), 0.9);
    const decay = (bright ? 0.035 : 0.025) * (0.6 + 0.6 * s);
    for (const [ratio, level] of MODES) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f0 * ratio * rand(0.97, 1.03);
      const g = envGain(when, 0.16 * s * level, decay / Math.sqrt(ratio));
      osc.connect(g).connect(out);
      osc.start(when);
      osc.stop(when + decay + 0.03);
    }
  }

  // The table: a short low knock.
  function tableThud(when, out, s) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(rand(150, 210), when);
    osc.frequency.exponentialRampToValueAtTime(rand(80, 110), when + 0.07);
    const g = envGain(when, 0.45 * s, 0.08);
    osc.connect(g).connect(out);
    osc.start(when);
    osc.stop(when + 0.1);
    noiseBurst(when, out, 0.35 * s, 0.03, 'lowpass', 700, 0.7);
  }

  function panner(out, x, width) {
    if (!ctx.createStereoPanner) return out;
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, ((x / width) * 2 - 1) * 0.7));
    p.connect(out);
    return p;
  }

  function masterOut() {
    const master = ctx.createGain();
    master.gain.value = VOLUME;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 6;
    master.connect(comp).connect(ctx.destination);
    return master;
  }

  // events: from js/dice3d.js's throw (t in seconds from the start of the
  // throw). pitchOf(k): base pitch of die k. width: the window width (pan).
  // Returns true when the sounds are scheduled.
  function play(events, pitchOf, width) {
    if (!context()) return false;
    try {
      const master = masterOut();
      // Keep the loudest events if there are very many dice.
      const list = events.length > 400 ? events.slice().sort((a, b) => b.s - a.s).slice(0, 400) : events;
      const start = ctx.currentTime + 0.03;
      for (const e of list) {
        const when = start + e.t + rand(0, 0.004);
        const out = panner(master, e.x, width);
        const s = Math.max(0.03, e.s);
        if (e.type === 'impact') {
          dieClick(when, out, s, pitchOf(e.k), false);
          tableThud(when, out, s);
        } else if (e.type === 'clack') {
          dieClick(when, out, s * 0.8, pitchOf(e.k), true);
          dieClick(when + rand(0.0005, 0.002), out, s * 0.7, pitchOf(e.k2), true);
        } else {
          dieClick(when, out, s, pitchOf(e.k), false);
          tableThud(when, out, s * 0.25);
        }
      }
      return true;
    } catch (e) {
      return false; // no audio: the roll still works
    }
  }

  // The result shows: two quick bright clicks, a little apart.
  function land() {
    if (!context()) return false;
    try {
      const master = masterOut();
      const now = ctx.currentTime + 0.01;
      dieClick(now, master, 0.55, 3600, true);
      dieClick(now + 0.07, master, 0.4, 4300, true);
      return true;
    } catch (e) {
      return false;
    }
  }

  OSR.diceSound = { context, play, land, PITCH };
})(window.OSR = window.OSR || {});

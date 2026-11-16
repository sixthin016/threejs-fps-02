// Effects: tracers, impact sparks and the whole soundscape. Sounds are synthesized with
// WebAudio (oscillators + filtered noise) — no audio files, no network, nothing to load.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export function createAudio() {
  let ctx = null;
  let master = null;
  let enabled = true;
  function ensure() {
    if (ctx) return ctx;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = 0.35;
      master.connect(ctx.destination);
    } catch {
      ctx = null;
    }
    return ctx;
  }
  function noiseBurst(duration, filterFreq, gain, type = 'lowpass') {
    if (!enabled || !ensure()) return;
    const t = ctx.currentTime;
    const len = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = filterFreq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    src.connect(filter).connect(g).connect(master);
    src.start(t);
  }
  function tone(freq, duration, gain, type = 'sine', slideTo = null) {
    if (!enabled || !ensure()) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + duration);
  }
  return {
    unlock() { ensure(); if (ctx && ctx.state === 'suspended') ctx.resume(); },
    setEnabled(v) { enabled = v; },
    shot(kind) {
      if (kind === 'longshot') { noiseBurst(0.22, 900, 0.9); tone(140, 0.18, 0.5, 'sine', 55); }
      else if (kind === 'raptor') { noiseBurst(0.09, 2400, 0.5); tone(220, 0.07, 0.25, 'square', 120); }
      else { noiseBurst(0.12, 1600, 0.65); tone(180, 0.1, 0.35, 'sine', 70); }
    },
    enemyShot() { noiseBurst(0.1, 1200, 0.28); },
    hit() { tone(1200, 0.06, 0.3, 'sine'); },
    kill() { tone(880, 0.09, 0.35, 'sine'); tone(1320, 0.12, 0.3, 'sine'); },
    hurt() { noiseBurst(0.15, 500, 0.5); tone(90, 0.15, 0.4, 'sawtooth', 60); },
    reload() { tone(500, 0.05, 0.25, 'square'); setTimeout(() => tone(700, 0.05, 0.25, 'square'), 260); },
    dry() { tone(900, 0.04, 0.2, 'square'); },
    plant() { tone(660, 0.12, 0.3, 'sine'); setTimeout(() => tone(660, 0.12, 0.3, 'sine'), 180); },
    beep() { tone(990, 0.08, 0.25, 'sine'); },
    defuse() { tone(520, 0.1, 0.3, 'sine'); setTimeout(() => tone(780, 0.14, 0.3, 'sine'), 160); },
    roundWin() { [523, 659, 784].forEach((f, i) => setTimeout(() => tone(f, 0.22, 0.3, 'triangle'), i * 130)); },
    roundLose() { [392, 330, 262].forEach((f, i) => setTimeout(() => tone(f, 0.22, 0.28, 'triangle'), i * 130)); },
    buy() { tone(1040, 0.07, 0.28, 'sine'); setTimeout(() => tone(1560, 0.09, 0.25, 'sine'), 90); },
    click() { tone(1400, 0.03, 0.18, 'sine'); },
  };
}

export function createEffects(scene) {
  const tracerMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.85, depthWrite: false,
  });
  const tracerGeo = new THREE.CylinderGeometry(0.012, 0.012, 1, 5, 1, true);
  const tracers = [];
  const sparks = [];
  const sparkGeo = new THREE.BoxGeometry(0.05, 0.05, 0.05);
  const sparkMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd27a'), transparent: true, opacity: 0.95, depthWrite: false });
  const up = new THREE.Vector3(0, 1, 0);
  const tmp = new THREE.Vector3();

  function addTracer(from, to) {
    const mesh = new THREE.Mesh(tracerGeo, tracerMaterial);
    const mid = tmp.copy(from).add(to).multiplyScalar(0.5);
    mesh.position.copy(mid);
    const dir = new THREE.Vector3().subVectors(to, from);
    const len = dir.length();
    mesh.scale.set(1, len, 1);
    mesh.quaternion.setFromUnitVectors(up, dir.normalize());
    mesh.userData.life = 0.09;
    scene.add(mesh);
    tracers.push(mesh);
  }

  function addSparks(point, count = 8) {
    for (let i = 0; i < count; i += 1) {
      const m = new THREE.Mesh(sparkGeo, sparkMat);
      m.position.copy(point);
      m.userData.vel = new THREE.Vector3((Math.random() - 0.5) * 4, Math.random() * 3, (Math.random() - 0.5) * 4);
      m.userData.life = 0.3 + Math.random() * 0.25;
      scene.add(m);
      sparks.push(m);
    }
  }

  function step(dt) {
    for (let i = tracers.length - 1; i >= 0; i -= 1) {
      const t = tracers[i];
      t.userData.life -= dt;
      if (t.userData.life <= 0) {
        scene.remove(t);
        tracers.splice(i, 1);
      } else {
        t.material.opacity = Math.max(0, t.userData.life / 0.09) * 0.85;
      }
    }
    for (let i = sparks.length - 1; i >= 0; i -= 1) {
      const s = sparks[i];
      s.userData.life -= dt;
      s.userData.vel.y -= 9 * dt;
      s.position.addScaledVector(s.userData.vel, dt);
      if (s.userData.life <= 0) {
        scene.remove(s);
        sparks.splice(i, 1);
      }
    }
  }

  return { addTracer, addSparks, step };
}

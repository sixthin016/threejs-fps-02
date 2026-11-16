// SABLE LINE — boot and the one loop. A fixed 60 Hz simulation feeds a render at the
// display's rate; the simulation (player, bots, rounds, grenades) never reads the DOM
// except through hud.js, and the render only reads simulation state. The loop owns the
// ray and the damage: weapons own their numbers, bots own their behaviour, rounds own
// the match — main.js is the wire between them.
// ?shot=start|play|end with &seed=N sets up a deterministic frame for a capture, renders
// it twice, then freezes it and sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createWorld } from './world.js';
import { createMover } from './player.js';
import { createInput } from './input.js';
import { createWeapons } from './weapons.js';
import { createAudio, createEffects } from './effects.js';
import { createBots } from './bots.js';
import { createRounds, BUY_TIME } from './rounds.js';
import { createGrenades } from './grenades.js';
import { createHud } from './hud.js';

const FIXED_STEP = 1 / 60;
const EYE = 1.5;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;

function mulberry32(initial) {
  let a = initial;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(seed);

// ---- renderer / scene -------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), 18, 46);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 140);
scene.add(camera);

const world = createWorld(scene);
const audio = createAudio();
const effects = createEffects(scene);
const hud = createHud();
const rounds = createRounds(scene, world, { audio, rng });
const bots = createBots(scene, world, { effects, audio, rng });
const weapons = createWeapons(camera);
const grenades = createGrenades(scene, world, { effects, audio, rng });
const playerMover = createMover(world.colliders, 0, 12, 0);
bots.setMovers(createMover);
const input = createInput(renderer.domElement, onLockChange);

const body = playerMover.state;
const raycaster = new THREE.Raycaster();
raycaster.far = 120;
// reused temporaries: the hot loop allocates nothing
const _origin = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _point = new THREE.Vector3();
const _from = new THREE.Vector3();

const player = {
  alive: true,
  team: 'sable',
  position: body.position,
  health: 100,
  armor: 0,
  kills: 0,
};
const grenadesEl = document.getElementById('grenades');
let time = 0;
let elapsed = 0;
let started = false;
let matchStarted = false;
let frozen = false;
let defuseProgress = 0;
let accumulator = 0;
let lastTime = performance.now();
let targetFov = 74;

// ---- the game object: what bots and rounds call back into ------------------
const game = {
  player,
  get playerAlive() { return player.alive; },
  bots,
  get bomb() { return rounds.state.bomb; },
  shoot,
  damageBot,
  damagePlayer,
  onPlant(bot) {
    rounds.onPlant(bot, time);
    rounds.awardPlant();
    hud.banner('SPIKE PLANTED', `${bot.name} planted on site ${rounds.state.bomb.site} — defuse it`);
    hud.toast('Spike planted — defuse it');
  },
  onDefuse() {
    rounds.onDefuse();
    rounds.endRound(game, 'sable', 'Spike defused');
  },
  onPickup(bot) {
    hud.toast(`${bot.name} picked up the spike`);
  },
  onRoundStart(state) {
    // first round has no carrier yet: pick one ember bot to carry the spike
    if (!state.bomb.carrierId) {
      const ember = bots.list.filter((b) => b.team === 'ember');
      state.bomb.carrierId = ember[Math.floor(rng() * ember.length)].id;
    }
    bots.equipRound(state.round, state.site, state.bomb.carrierId);
    grenades.reset();
    weapons.refill();
    player.health = 100;
    player.armor = state.round >= 2 ? 50 : 0;
    player.alive = true;
    defuseProgress = 0;
    playerMover.teleport(world.spawns.sable[0][0], world.spawns.sable[0][1], 0);
    hud.setHealth(player.health, player.armor);
    hud.setScore(state.scoreSable, state.scoreEmber, state.round);
    hud.setMoney(state.money);
    hud.banner(`ROUND ${state.round}`, `Defend site ${state.site} — ${world.sites[state.site].name}`);
    if (!shot) hud.showBuy(true);
    rebuildBuyMenu();
    syncCamera();
  },
  onLiveStart(state) {
    hud.showBuy(false);
    hud.banner('ROUND LIVE', `First to ${5} rounds takes the match`);
    hud.setTimer(state.timer, 'live');
  },
  onRoundEnd(state, winner, reason) {
    hud.showBuy(false);
    hud.setScore(state.scoreSable, state.scoreEmber, state.round);
    hud.setMoney(state.money);
    hud.banner(winner === 'sable' ? 'ROUND WON' : 'ROUND LOST', reason, 3200);
    hud.toast(winner === 'sable' ? `+$3250 — ${reason}` : `+$1900 — ${reason}`);
  },
  onMatchEnd(state) {
    if (document.pointerLockElement) document.exitPointerLock();
    const title = state.winner === 'sable' ? 'SABLE WINS THE MATCH'
      : state.winner === 'ember' ? 'EMBER WINS THE MATCH' : 'DRAW';
    hud.showOverlay('match', { title, copy: `Final score ${state.scoreSable} – ${state.scoreEmber} after ${state.round} rounds`, action: 'Play again' });
  },
};

// ---- damage -----------------------------------------------------------------
function damageBot(bot, amount, part, killer) {
  if (!bot.alive) return false;
  const killed = bots.damage(bot, amount, part, killer);
  if (!killed) return false;
  const killerName = killer === player ? 'YOU' : killer.name;
  const killerClass = killer === player || killer.team === 'sable' ? 'kf-sable' : 'kf-ember';
  const victimClass = bot.team === 'sable' ? 'kf-sable' : 'kf-ember';
  hud.killfeed(`<span class="${killerClass}">${killerName}</span> ✕ <span class="${victimClass}">${bot.name}</span>${part === 'head' ? ' ◎' : ''}`);
  if (killer === player) {
    player.kills += 1;
    rounds.awardKill();
    audio.kill();
    hud.toast(`+$300 — ${bot.name} down`);
  }
  if (bot.role === 'carrier') rounds.onCarrierDeath(bot);
  return true;
}

function damagePlayer(amount, fromPos) {
  if (!player.alive) return;
  let rest = amount;
  if (player.armor > 0) {
    const absorbed = Math.min(player.armor, rest * 0.5);
    player.armor -= absorbed;
    rest -= absorbed;
  }
  player.health -= rest;
  audio.hurt();
  hud.setHealth(player.health, player.armor);
  if (fromPos) {
    const dx = fromPos.x - body.position.x;
    const dz = fromPos.z - body.position.z;
    const worldAngle = Math.atan2(dx, dz);
    const rel = worldAngle + body.yaw;
    hud.damageFrom((rel * 180) / Math.PI);
  }
  if (player.health <= 0) {
    player.health = 0;
    player.alive = false;
    hud.setHealth(0, player.armor);
    hud.banner('YOU ARE DOWN', 'Your squad fights on', 2600);
    if (document.pointerLockElement) document.exitPointerLock();
  }
}

// Ray from origin along dir: nearest of bot meshes, world surfaces and (for bot
// shooters) the player's capsule. Returns null or {kind, bot, part, point, dist}.
function rayHit(origin, dir, maxDist, shooter) {
  raycaster.set(origin, dir);
  raycaster.far = maxDist;
  const meshes = [];
  for (const mesh of bots.hitMeshes()) {
    if (shooter && mesh.userData.bot === shooter) continue;
    meshes.push(mesh);
  }
  for (const mesh of world.shootables) meshes.push(mesh);
  const hits = raycaster.intersectObjects(meshes, false);
  let best = null;
  if (hits.length) {
    const hit = hits[0];
    best = {
      kind: hit.object.userData.bot ? 'bot' : 'world',
      bot: hit.object.userData.bot ?? null,
      part: hit.object.userData.part ?? null,
      point: hit.point.clone(),
      dist: hit.distance,
    };
  }
  // player capsule: vertical segment, radius 0.42, only when the shooter is a bot
  if (shooter && player.alive) {
    const px = body.position.x, pz = body.position.z, py = body.position.y;
    const ox = origin.x, oy = origin.y, oz = origin.z;
    const dx = dir.x, dy = dir.y, dz = dir.z;
    const denom = dx * dx + dz * dz;
    if (denom > 1e-9) {
      const t = ((px - ox) * dx + (pz - oz) * dz) / denom;
      if (t > 0 && t < maxDist) {
        const hx = ox + dx * t, hy = oy + dy * t, hz = oz + dz * t;
        const radial = Math.hypot(hx - px, hz - pz);
        if (radial < 0.42 && hy >= py && hy <= py + 1.72 && (!best || t < best.dist)) {
          best = { kind: 'player', bot: null, part: hy > py + 1.45 ? 'head' : 'torso', point: _point.set(hx, hy, hz).clone(), dist: t };
        }
      }
    }
  }
  return best;
}

// One shot from anyone: trace the ray, apply damage, draw the tracer. Silent —
// the caller plays its own sound (player: shot, bot: enemyShot, in bots.js).
function shoot(shooter, origin, dir, def, opts = {}) {
  const maxDist = def.range;
  const hit = rayHit(origin, dir, maxDist, shooter === player ? null : shooter);
  const end = hit ? hit.point : _from.copy(origin).addScaledVector(dir, maxDist);
  effects.addTracer(origin, end);
  if (!hit) return { hit: null, killed: false };
  // friendly fire is off: a teammate in the line of fire stops the bullet, no damage
  if (hit.kind === 'bot' && hit.bot.team === shooter.team) return { hit: 'block', killed: false };
  if (hit.kind === 'world') {
    effects.addSparks(hit.point, 8);
    return { hit: 'world', killed: false };
  }
  const amount = def.damage * (hit.part === 'head' ? def.headMult : 1);
  if (hit.kind === 'bot') {
    const killed = damageBot(hit.bot, amount, hit.part, shooter);
    return { hit: 'bot', killed, part: hit.part };
  }
  damagePlayer(amount, origin);
  return { hit: 'player', killed: !player.alive, part: hit.part };
}

function playerShoot() {
  if (!player.alive) return;
  if (!weapons.ready()) return;
  if (!weapons.takeRound()) {
    audio.dry();
    weapons.reload();
    return;
  }
  const def = weapons.current();
  camera.getWorldDirection(_dir);
  const spread = weapons.spread(playerMover.groundSpeed()) * (input.state.aiming ? 0.6 : 1);
  _dir.x += (rng() * 2 - 1) * spread;
  _dir.y += (rng() * 2 - 1) * spread;
  _dir.z += (rng() * 2 - 1) * spread;
  _dir.normalize();
  scene.updateMatrixWorld(true);
  _origin.copy(camera.position);
  const result = shoot(player, _origin, _dir, def);
  weapons.pullTrigger();
  playerMover.recoil(0.009 + rng() * 0.006, (rng() * 2 - 1) * 0.004);
  audio.shot(def.id);
  hud.setAmmo(weapons.ammo().mag, weapons.ammo().reserve, def.name);
  if (result.hit === 'bot' || result.hit === 'player') {
    hud.hitMarker(result.killed, shot ? 4000 : 90);
    if (result.hit === 'bot') audio.hit();
  }
}

// ---- HUD wiring ---------------------------------------------------------------
function rebuildBuyMenu() {
  hud.buildBuyMenu(rounds.shop, rounds.state.money, (id) => id === 'armor' ? player.armor >= 50 : weapons.owned(id), (id) => {
    if (id === 'armor' && player.armor >= 50) { hud.toast('Already armored'); return; }
    if (id !== 'armor' && weapons.owned(id)) { hud.toast('Already owned'); return; }
    if (!rounds.buy(id)) { hud.toast('Not enough money'); audio.dry(); return; }
    if (id === 'armor') {
      player.armor = 50;
      hud.setHealth(player.health, player.armor);
    } else {
      weapons.buy(id);
      weapons.equip(id);
    }
    audio.buy();
    hud.setMoney(rounds.state.money);
    hud.setAmmo(weapons.ammo().mag, weapons.ammo().reserve, weapons.current().name);
    rebuildBuyMenu();
  });
}

function syncCamera() {
  camera.position.set(body.position.x, body.position.y + body.eye, body.position.z);
  camera.rotation.set(body.pitch, body.yaw, 0, 'YXZ');
}

function aimAt(point) {
  const dx = point.x - body.position.x;
  const dy = point.y - (body.position.y + body.eye);
  const dz = point.z - body.position.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  body.yaw = Math.atan2(-dx, -dz);
  body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / length)));
  syncCamera();
}

function nearestVisibleBot() {
  const eyeY = body.position.y + EYE;
  let best = null;
  let bestD = Infinity;
  for (const bot of bots.list) {
    if (!bot.alive || bot.team !== 'ember') continue;
    const p = bot.mover.state.position;
    const d = Math.hypot(p.x - body.position.x, p.z - body.position.z);
    if (d >= bestD) continue;
    if (!world.hasLineOfSight(body.position.x, eyeY, body.position.z, p.x, p.y + 1.3, p.z)) continue;
    best = bot;
    bestD = d;
  }
  return best;
}

hud.onPlay(() => {
  if (shot) return;
  audio.unlock();
  if (rounds.state.phase === 'match') {
    rounds.startMatch(game);
    matchStarted = true;
  }
  if (!matchStarted) {
    rounds.startMatch(game);
    matchStarted = true;
  }
  input.requestLock();
});

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    started = true;
    hud.hideOverlay();
  } else if (rounds.state.phase !== 'match' && started) {
    hud.showOverlay('paused');
  }
}

// ---- simulation ---------------------------------------------------------------
function simStep(dt) {
  time += dt;
  elapsed += dt;
  const move = shot ? { forward: 0, strafe: 0, jump: false, crouch: false } : input.moveVector();
  if (player.alive) playerMover.step(dt, move);
  weapons.step(dt, playerMover.groundSpeed());
  grenades.step(dt, time, game);
  bots.step(dt, time, game);
  rounds.step(dt, time, game);
  effects.step(dt);

  // player defuse: hold E inside the planted site
  if (!shot && player.alive && rounds.state.phase === 'live' && rounds.state.bomb.state === 'planted') {
    const site = world.sites[rounds.state.bomb.site];
    const near = Math.hypot(body.position.x - site.x, body.position.z - site.z) < 2.6;
    if (near && input.state.keys.has('KeyE')) {
      defuseProgress += dt / 5;
      hud.setPlant(Math.min(1, defuseProgress), 'DEFUSING SPIKE');
      if (defuseProgress >= 1) {
        defuseProgress = 0;
        hud.setPlant(null);
        game.onDefuse();
      }
    } else {
      if (defuseProgress > 0) hud.setPlant(null);
      defuseProgress = 0;
    }
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (frozen) {
    renderer.render(scene, camera);
    return;
  }
  const look = input.takeLook();
  playerMover.look(look.x, look.y);
  if (player.alive && input.state.firing && weapons.ready()) playerShoot();
  for (const code of input.takePressed()) {
    if (code === 'KeyR') { weapons.reload(); audio.reload(); }
    else if (code === 'KeyB' && rounds.state.phase === 'buy') { hud.showBuy(!hud.buyOpen()); audio.click(); }
    else if (code === 'KeyG') { if (grenades.throwFrom(player, camera)) audio.shot('raptor'); }
    else if (code === 'Digit1') weapons.equip('p9');
    else if (code === 'Digit2') weapons.equip('vk47');
    else if (code === 'Digit3') weapons.equip('raptor');
    else if (code === 'Digit4') weapons.equip('longshot');
  }
  accumulator += dt;
  let steps = 0;
  while (accumulator >= FIXED_STEP && steps < 5) {
    simStep(FIXED_STEP);
    accumulator -= FIXED_STEP;
    steps += 1;
  }
  if (accumulator > FIXED_STEP * 5) accumulator = 0;

  // ADS zoom for the scoped rifle
  targetFov = input.state.aiming && weapons.current().id === 'longshot' ? 74 / 2.4 : 74;
  if (Math.abs(camera.fov - targetFov) > 0.05) {
    camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 10);
    camera.updateProjectionMatrix();
  }
  syncCamera();

  // HUD sync
  const ammo = weapons.ammo();
  hud.setAmmo(ammo.mag, ammo.reserve, weapons.current().name);
  hud.setMoney(rounds.state.money);
  hud.setTimer(rounds.state.timer, rounds.state.phase);
  hud.setScore(rounds.state.scoreSable, rounds.state.scoreEmber, rounds.state.round);
  const spreadPx = 5 + weapons.spread(playerMover.groundSpeed()) * 2600;
  hud.setCrosshairSpread(Math.min(46, spreadPx));
  if (grenadesEl) grenadesEl.textContent = grenades.count > 0 ? '◉ GRENADE ×1' : '○ GRENADE ×0';
  hud.drawMinimap(world, body.position, body.yaw, bots.list, rounds.state.bomb);
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let i = 0; i < steps; i += 1) simStep(FIXED_STEP);
}

function shootAtBotOrMid() {
  const bot = nearestVisibleBot();
  if (bot) {
    const p = bot.mover.state.position;
    aimAt(new THREE.Vector3(p.x, p.y + 1.25, p.z));
  } else {
    aimAt(new THREE.Vector3(0, 1.3, -6));
  }
  playerShoot();
}

function runShot(name) {
  hud.hideOverlay();
  hud.showBuy(false);
  body.pitch = 0;
  body.yaw = 0;
  if (!matchStarted) {
    rounds.startMatch(game);
    matchStarted = true;
  }
  if (name === 'start') {
    settle(20);
    hud.showOverlay('start');
  } else if (name === 'play') {
    settle(500); // past the 8 s buy phase, into the live round
    for (let i = 0; i < 3; i += 1) { shootAtBotOrMid(); settle(11); }
    settle(12);
    shootAtBotOrMid();
    settle(1);
  } else {
    // end: run the round until it ends (cap: 200 s of simulation)
    let guard = 0;
    while (rounds.state.phase !== 'end' && rounds.state.phase !== 'match' && guard < 12000) {
      if (guard % 45 === 0 && player.alive) shootAtBotOrMid();
      simStep(FIXED_STEP);
      guard += 1;
    }
    settle(30);
    if (rounds.state.phase === 'match') {
      const s = rounds.state;
      const title = s.winner === 'sable' ? 'SABLE WINS THE MATCH' : s.winner === 'ember' ? 'EMBER WINS THE MATCH' : 'DRAW';
      hud.showOverlay('match', { title, copy: `Final score ${s.scoreSable} – ${s.scoreEmber} after ${s.round} rounds`, action: 'Play again' });
    } else {
      const s = rounds.state;
      hud.showOverlay('roundEnd', {
        title: s.scoreSable > s.scoreEmber ? 'ROUND WON' : 'ROUND LOST',
        copy: s.lastReason || '',
        action: 'Next round',
      });
    }
  }
  hud.setAmmo(weapons.ammo().mag, weapons.ammo().reserve, weapons.current().name);
  hud.setMoney(rounds.state.money);
  hud.setScore(rounds.state.scoreSable, rounds.state.scoreEmber, rounds.state.round);
  hud.setTimer(rounds.state.timer, rounds.state.phase);
  hud.setHealth(player.health, player.armor);
  hud.drawMinimap(world, body.position, body.yaw, bots.list, rounds.state.bomb);
  paintTwiceThenReady();
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

syncCamera();
hud.setHealth(player.health, player.armor);
hud.setAmmo(weapons.ammo().mag, weapons.ammo().reserve, weapons.current().name);
hud.setMoney(rounds.state.money);
hud.setScore(0, 0, 1);
hud.setTimer(BUY_TIME, 'buy');
if (shot) {
  hud.showOverlay('start');
  runShot(shot);
} else {
  hud.showOverlay('start');
  requestAnimationFrame(frame);
}

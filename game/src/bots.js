// Bots: two teams of five, one of them the player. Each bot runs a small state machine —
// advance along the waypoint graph, hold an angle, engage what it can see, plant or defuse
// the spike — with reaction times, burst fire and aim error that make them feel human
// rather than aimbots. Teammates are SABLE (teal), enemies EMBER (orange-red).
import * as THREE from 'three';
import { WEAPONS } from './weapons.js';

const SABLE_NAMES = ['VEX', 'ION', 'MIRA', 'DUSK'];
const EMBER_NAMES = ['ASH', 'COAL', 'SLAG', 'CINDER', 'FLINT'];
const EYE_HEIGHT = 1.5;
const PLANT_TIME = 3;
const DEFUSE_TIME = 5;

function makeLabel(name, colour) {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 40;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sprite.scale.set(1.5, 0.47, 1);
  function draw(health) {
    const g = c.getContext('2d');
    g.clearRect(0, 0, 128, 40);
    g.fillStyle = 'rgba(0,0,0,0.45)';
    g.fillRect(14, 20, 100, 7);
    g.fillStyle = health > 50 ? colour : '#ff4444';
    g.fillRect(14, 20, Math.max(0, health), 7);
    g.fillStyle = '#fff';
    g.font = 'bold 15px system-ui, sans-serif';
    g.textAlign = 'center';
    g.fillText(name, 64, 14);
    tex.needsUpdate = true;
  }
  draw(100);
  return { sprite, draw };
}

function buildBody(teamColour, isCarrier) {
  const group = new THREE.Group();
  const suit = new THREE.MeshStandardMaterial({ color: new THREE.Color(teamColour), roughness: 0.6, metalness: 0.15 });
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color('#1c1a17'), roughness: 0.8 });
  const skin = new THREE.MeshStandardMaterial({ color: new THREE.Color('#c9a184'), roughness: 0.7 });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.78, 0.32), suit);
  torso.position.y = 1.02;
  torso.castShadow = true;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 14, 10), skin);
  head.position.y = 1.56;
  head.castShadow = true;
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.185, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), dark);
  helmet.position.y = 1.58;
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.62, 0.22), dark);
  legL.position.set(-0.15, 0.31, 0);
  const legR = legL.clone();
  legR.position.x = 0.15;
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.62), dark);
  gun.position.set(0.28, 1.15, -0.25);
  group.add(torso, head, helmet, legL, legR, gun);
  if (isCarrier) {
    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.5, 0.18), new THREE.MeshStandardMaterial({ color: new THREE.Color('#ff9a3c'), emissive: new THREE.Color('#ff7a18'), emissiveIntensity: 0.9, roughness: 0.5 }));
    pack.position.set(0, 1.05, 0.26);
    group.add(pack);
  }
  torso.userData.part = 'torso';
  head.userData.part = 'head';
  return { group, torso, head, gun };
}

export function createBots(scene, world, deps) {
  const { effects, audio, rng } = deps;
  const bots = [];

  function spawnBot(team, name, index, spawn) {
    const colour = team === 'sable' ? '#37c8ab' : '#ff5a3c';
    const body = buildBody(colour, false);
    body.group.position.set(spawn[0], 0, spawn[1]);
    scene.add(body.group);
    const label = makeLabel(name, team === 'sable' ? '#37c8ab' : '#ff5a3c');
    label.sprite.position.set(0, 2.05, 0);
    body.group.add(label.sprite);
    // mover is set later by setMovers(createMover) once main.js wires player.js in
    const bot = {
      id: `${team}-${index}`, name, team, index,
      group: body.group, torso: body.torso, head: body.head,
      label, mover: null, spawn,
      health: 100, armor: 0, alive: true,
      weaponId: 'vk47', skill: 0.55 + rng() * 0.2,
      state: 'advance', path: [], pathIndex: 0, repathAt: 0,
      target: null, targetPos: new THREE.Vector3(), reactAt: 0,
      burstLeft: 0, burstPause: 0, shotGap: 0, strafeDir: 1, strafeAt: 0,
      site: null, role: 'attack', plantProgress: 0, defuseProgress: 0,
      fallT: 0, holdUntil: 0, lastX: spawn[0], lastZ: spawn[1], stuckAt: 0,
    };
    body.torso.userData.bot = bot;
    body.head.userData.bot = bot;
    bots.push(bot);
    return bot;
  }

  for (let i = 0; i < 4; i += 1) spawnBot('sable', SABLE_NAMES[i], i, world.spawns.sable[i + 1]);
  for (let i = 0; i < 5; i += 1) spawnBot('ember', EMBER_NAMES[i], i, world.spawns.ember[i]);

  function setMovers(createMover) {
    for (const bot of bots) {
      bot.mover = createMover(world.colliders, bot.spawn[0], bot.spawn[1], bot.team === 'sable' ? Math.PI : 0);
    }
  }

  function equipRound(round, site, carrierId) {
    // reset everyone: health, position, weapon by budget, objective
    for (const bot of bots) {
      bot.health = 100;
      bot.armor = round >= 2 && bot.team === 'sable' ? 50 : 0;
      bot.alive = true;
      bot.fallT = 0;
      bot.group.rotation.set(0, 0, 0);
      bot.group.position.y = 0;
      bot.label.draw(100);
      bot.label.sprite.visible = true;
      bot.plantProgress = 0;
      bot.defuseProgress = 0;
      bot.target = null;
      bot.burstLeft = 0;
      bot.burstPause = 0;
      bot.state = 'advance';
      bot.site = site;
      const isCarrier = bot.id === carrierId;
      if (isCarrier) {
        bot.role = 'carrier';
        bot.weaponId = 'vk47';
      } else if (bot.team === 'ember') {
        bot.role = bot.index % 3 === 0 ? 'flank' : 'escort';
        bot.weaponId = bot.index === 4 ? 'longshot' : bot.index % 2 === 0 ? 'raptor' : 'vk47';
      } else {
        bot.role = bot.index < 2 ? 'hold' : 'roam';
        bot.weaponId = bot.index === 3 ? 'longshot' : bot.index === 1 ? 'raptor' : 'vk47';
      }
      const s = bot.spawn;
      bot.mover.teleport(s[0], s[1], bot.team === 'sable' ? Math.PI : 0);
      bot.path = [];
      bot.pathIndex = 0;
      bot.repathAt = 0;
    }
    // carrier gets the orange spike pack on its back
    for (const bot of bots) {
      const hasPack = bot.group.children.some((c) => c.userData.isPack);
      if (bot.role === 'carrier' && !hasPack) {
        const pack = new THREE.Mesh(
          new THREE.BoxGeometry(0.4, 0.5, 0.18),
          new THREE.MeshStandardMaterial({ color: new THREE.Color('#ff9a3c'), emissive: new THREE.Color('#ff7a18'), emissiveIntensity: 0.9, roughness: 0.5 }),
        );
        pack.position.set(0, 1.05, 0.26);
        pack.userData.isPack = true;
        bot.group.add(pack);
      } else if (bot.role !== 'carrier' && hasPack) {
        const pack = bot.group.children.find((c) => c.userData.isPack);
        bot.group.remove(pack);
      }
    }
  }

  function objectivePoint(bot, bomb) {
    // where this bot wants to be right now
    if (bomb.state === 'planted') {
      if (bot.team === 'ember') {
        // defend the planted site: hold near it
        const s = world.sites[bomb.site];
        return { x: s.x + (bot.index - 2) * 2.4, z: s.z + 3.5 + (bot.index % 2) * 2 };
      }
      const s = world.sites[bomb.site];
      return { x: s.x, z: s.z };
    }
    if (bot.team === 'ember') {
      if (bot.role === 'carrier') {
        const s = world.sites[bot.site];
        return { x: s.x, z: s.z };
      }
      if (bot.role === 'flank') {
        const other = bot.site === 'A' ? 'B' : 'A';
        const s = world.sites[other];
        return { x: s.x, z: s.z + 5 };
      }
      // escort: stay near the carrier
      const carrier = bots.find((b) => b.role === 'carrier');
      if (carrier) return { x: carrier.mover.state.position.x + (bot.index - 1) * 1.6, z: carrier.mover.state.position.z + 1.5 };
      const s = world.sites[bot.site];
      return { x: s.x, z: s.z };
    }
    // SABLE defence
    if (bot.role === 'hold') {
      const s = world.sites[bot.index === 0 ? 'A' : 'B'];
      return { x: s.x + (bot.index === 0 ? 2.5 : -2.5), z: s.z + 4.5 };
    }
    return { x: 0, z: 2 }; // roam mid
  }

  function nearestVisibleEnemy(bot, game) {
    const eye = bot.mover.state.position;
    const eyeY = eye.y + EYE_HEIGHT;
    let best = null;
    let bestD = Infinity;
    const candidates = [];
    if (game.player.alive && game.player.team !== bot.team) {
      candidates.push({ kind: 'player', pos: game.player.position, ref: null });
    }
    for (const other of bots) {
      if (!other.alive || other.team === bot.team) continue;
      candidates.push({ kind: 'bot', pos: other.mover.state.position, ref: other });
    }
    for (const c of candidates) {
      const dx = c.pos.x - eye.x;
      const dz = c.pos.z - eye.z;
      const d = Math.hypot(dx, dz);
      if (d > 48 || d >= bestD) continue;
      const ty = c.pos.y + 1.3;
      if (!world.hasLineOfSight(eye.x, eyeY, eye.z, c.pos.x, ty, c.pos.z)) continue;
      // field of view: bots notice what is in front of them (or very close)
      const yaw = bot.mover.state.yaw;
      const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
      const dot = (dx * fx + dz * fz) / (d || 1);
      if (d > 6 && dot < 0.35) continue;
      best = c;
      bestD = d;
    }
    return best ? { target: best, dist: bestD } : null;
  }

  function damage(bot, amount, part, killer) {
    if (!bot.alive) return false;
    let rest = amount;
    if (bot.armor > 0) {
      const absorbed = Math.min(bot.armor, rest * 0.5);
      bot.armor -= absorbed;
      rest -= absorbed;
    }
    bot.health -= rest;
    bot.label.draw(Math.max(0, Math.round(bot.health)));
    if (bot.health <= 0) {
      bot.health = 0;
      bot.alive = false;
      bot.fallT = 0;
      bot.plantProgress = 0;
      bot.defuseProgress = 0;
      bot.label.sprite.visible = false;
      return true;
    }
    return false;
  }

  function step(dt, time, game) {
    for (const bot of bots) {
      const mv = bot.mover.state;
      if (!bot.alive) {
        // fall over, then lie still
        bot.fallT = Math.min(1, bot.fallT + dt / 0.45);
        bot.group.rotation.x = -bot.fallT * 1.5;
        bot.group.position.y = -bot.fallT * 0.1;
        continue;
      }
      const bomb = game.bomb;
      const seen = nearestVisibleEnemy(bot, game);
      // --- perception: first sight starts a reaction timer ---
      if (seen) {
        if (!bot.target || bot.target.ref !== seen.target.ref || bot.target.kind !== seen.target.kind) {
          bot.target = seen.target;
          bot.reactAt = time + 0.28 + rng() * 0.35;
        }
      } else {
        bot.target = null;
      }

      // --- objective channels: plant / defuse ---
      const atSite = (site) => {
        const s = world.sites[site];
        return Math.hypot(mv.position.x - s.x, mv.position.z - s.z) < 2.6;
      };
      let busy = false;
      if (bot.role === 'carrier' && bomb.state === 'carried' && atSite(bot.site) && !seen) {
        bot.plantProgress += dt;
        busy = true;
        if (bot.plantProgress >= PLANT_TIME) {
          bot.plantProgress = 0;
          game.onPlant(bot);
        }
      } else {
        bot.plantProgress = 0;
      }
      if (bot.team === 'sable' && bomb.state === 'planted' && atSite(bomb.site)) {
        bot.defuseProgress += dt;
        busy = true;
        if (bot.defuseProgress >= DEFUSE_TIME) {
          bot.defuseProgress = 0;
          game.onDefuse(bot);
        }
      } else {
        bot.defuseProgress = 0;
      }

      // --- movement ---
      let move = { forward: 0, strafe: 0, jump: false, crouch: false };
      if (!busy) {
        if (bot.target && time >= bot.reactAt) {
          // engage: strafe and face the target
          const t = bot.target;
          const tp = t.pos;
          const dx = tp.x - mv.position.x;
          const dz = tp.z - mv.position.z;
          const want = Math.atan2(-dx, -dz);
          let dyaw = want - mv.yaw;
          while (dyaw > Math.PI) dyaw -= Math.PI * 2;
          while (dyaw < -Math.PI) dyaw += Math.PI * 2;
          mv.yaw += Math.max(-3.2 * dt, Math.min(3.2 * dt, dyaw));
          if (time >= bot.strafeAt) {
            bot.strafeAt = time + 0.5 + rng() * 0.7;
            bot.strafeDir = rng() < 0.5 ? -1 : 1;
          }
          move.strafe = bot.strafeDir * 0.7;
          move.forward = rng() < 0.3 ? 0.4 : 0;
        } else {
          // advance along the waypoint graph
          const dest = objectivePoint(bot, bomb);
          const dx = dest.x - mv.position.x;
          const dz = dest.z - mv.position.z;
          const dist = Math.hypot(dx, dz);
          if (dist > 0.9) {
            if (time >= bot.repathAt || bot.path.length === 0) {
              bot.path = world.findPath(mv.position.x, mv.position.z, dest.x, dest.z);
              bot.pathIndex = 0;
              bot.repathAt = time + 2.5;
            }
            const node = bot.path[Math.min(bot.pathIndex, bot.path.length - 1)];
            const nx = node.x - mv.position.x;
            const nz = node.z - mv.position.z;
            if (Math.hypot(nx, nz) < 0.7 && bot.pathIndex < bot.path.length - 1) bot.pathIndex += 1;
            const want = Math.atan2(-nx, -nz);
            let dyaw = want - mv.yaw;
            while (dyaw > Math.PI) dyaw -= Math.PI * 2;
            while (dyaw < -Math.PI) dyaw += Math.PI * 2;
            mv.yaw += Math.max(-2.6 * dt, Math.min(2.6 * dt, dyaw));
            move.forward = Math.abs(dyaw) < 0.9 ? 1 : 0.25;
          } else {
            // holding: slowly scan
            mv.yaw += Math.sin(time * 0.5 + bot.index) * 0.35 * dt;
          }
          // unstuck: if barely moved in 2.5 s, re-path with a random detour
          const moved = Math.hypot(mv.position.x - bot.lastX, mv.position.z - bot.lastZ);
          if (moved > 0.4) { bot.lastX = mv.position.x; bot.lastZ = mv.position.z; bot.stuckAt = time; }
          else if (time - bot.stuckAt > 2.5) {
            bot.path = world.findPath(mv.position.x, mv.position.z, dest.x + (rng() - 0.5) * 6, dest.z + (rng() - 0.5) * 6);
            bot.pathIndex = 0;
            bot.stuckAt = time;
          }
        }
      }
      bot.mover.step(dt, move);
      bot.group.position.set(mv.position.x, mv.position.y, mv.position.z);
      bot.group.rotation.y = mv.yaw + Math.PI;

      // --- shooting ---
      bot.shotGap -= dt;
      if (bot.target && time >= bot.reactAt && !busy && bot.shotGap <= 0) {
        const def = WEAPONS[bot.weaponId];
        if (bot.burstLeft <= 0) {
          if (bot.burstPause > 0) { bot.burstPause -= dt; }
          else {
            bot.burstLeft = 3 + Math.floor(rng() * 4);
            bot.burstPause = 0;
          }
        }
        if (bot.burstLeft > 0) {
          bot.burstLeft -= 1;
          bot.shotGap = def.fireGap * (1.15 + rng() * 0.5);
          if (bot.burstLeft === 0) bot.burstPause = 0.45 + rng() * 0.6;
          const t = bot.target;
          const tp = t.pos;
          const aimAtHead = rng() < 0.22;
          const ty = tp.y + (aimAtHead ? 1.55 : 1.05 + (rng() - 0.5) * 0.3);
          const dist = Math.hypot(tp.x - mv.position.x, tp.z - mv.position.z);
          const err = (0.012 + dist * 0.0016) * (1.7 - bot.skill) * (bot.mover.groundSpeed() > 1 ? 1.4 : 1);
          const origin = new THREE.Vector3(mv.position.x, mv.position.y + EYE_HEIGHT, mv.position.z);
          const dir = new THREE.Vector3(tp.x - origin.x, ty - origin.y, tp.z - origin.z).normalize();
          dir.x += (rng() * 2 - 1) * err;
          dir.y += (rng() * 2 - 1) * err;
          dir.z += (rng() * 2 - 1) * err;
          dir.normalize();
          game.shoot(bot, origin, dir, def, { head: aimAtHead });
          audio.enemyShot();
        }
      }
    }
  }

  return {
    list: bots,
    setMovers,
    equipRound,
    damage,
    step,
    aliveCount(team) {
      return bots.filter((b) => b.team === team && b.alive).length;
    },
    hitMeshes() {
      const out = [];
      for (const b of bots) if (b.alive) out.push(b.torso, b.head);
      return out;
    },
    carrier() {
      return bots.find((b) => b.role === 'carrier');
    },
  };
}

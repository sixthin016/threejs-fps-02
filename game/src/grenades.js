// Grenades: one frag per round, thrown with G. A small sphere that arcs, bounces off
// the floor and walls, then bursts after a short fuse: radial damage, a flash, sparks
// and a boom. The player carries one per round; bots never throw.
import * as THREE from 'three';

const FUSE = 1.6;
const RADIUS = 6;
const MAX_DAMAGE = 110;
const MIN_DAMAGE = 30;
const SPEED = 17;
const GRAVITY = 13;

export function createGrenades(scene, world, deps) {
  const { effects, audio } = deps;
  const active = [];
  let count = 1;
  const geo = new THREE.SphereGeometry(0.09, 10, 8);
  const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#2f6b4f'), roughness: 0.5, metalness: 0.3 });
  const probe = new THREE.Box3();

  function overlaps(x, y, z) {
    probe.min.set(x - 0.09, y - 0.09, z - 0.09);
    probe.max.set(x + 0.09, y + 0.09, z + 0.09);
    for (const c of world.colliders) {
      if (probe.intersectsBox(c)) return c;
    }
    return null;
  }

  function explode(g, game) {
    const pos = g.mesh.position;
    effects.addSparks(pos, 26);
    audio.shot('longshot');
    for (const bot of game.bots.list) {
      if (!bot.alive) continue;
      const p = bot.mover.state.position;
      const d = Math.hypot(p.x - pos.x, p.z - pos.z);
      if (d > RADIUS) continue;
      const amount = Math.round(MAX_DAMAGE - ((MAX_DAMAGE - MIN_DAMAGE) * d) / RADIUS);
      game.damageBot(bot, amount, 'torso', game.player);
    }
    if (game.player.alive) {
      const p = game.player.position;
      const d = Math.hypot(p.x - pos.x, p.z - pos.z);
      if (d <= RADIUS) {
        const amount = Math.round((MAX_DAMAGE - ((MAX_DAMAGE - MIN_DAMAGE) * d) / RADIUS) * 0.5);
        game.damagePlayer(amount, pos);
      }
    }
    scene.remove(g.mesh);
    const i = active.indexOf(g);
    if (i >= 0) active.splice(i, 1);
  }

  return {
    get count() { return count; },
    reset() {
      for (const g of active) scene.remove(g.mesh);
      active.length = 0;
      count = 1;
    },
    throwFrom(player, camera) {
      if (count <= 0 || !player.alive) return false;
      count -= 1;
      const dir = new THREE.Vector3();
      camera.getWorldDirection(dir);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(camera.position).addScaledVector(dir, 0.5);
      mesh.position.y -= 0.12;
      mesh.castShadow = true;
      scene.add(mesh);
      active.push({
        mesh,
        vel: dir.multiplyScalar(SPEED).add(new THREE.Vector3(0, 3.2, 0)),
        fuse: FUSE,
      });
      return true;
    },
    step(dt, time, game) {
      for (let i = active.length - 1; i >= 0; i -= 1) {
        const g = active[i];
        g.fuse -= dt;
        if (g.fuse <= 0) { explode(g, game); continue; }
        g.vel.y -= GRAVITY * dt;
        const p = g.mesh.position;
        let nx = p.x + g.vel.x * dt;
        let ny = p.y + g.vel.y * dt;
        let nz = p.z + g.vel.z * dt;
        // floor bounce
        if (ny < 0.09) {
          g.vel.y = Math.abs(g.vel.y) * 0.45;
          g.vel.x *= 0.7;
          g.vel.z *= 0.7;
          ny = 0.09;
        }
        // wall bounce: revert the axis that entered a collider
        if (!overlaps(nx, ny, p.z)) p.x = nx;
        else { g.vel.x *= -0.45; }
        if (!overlaps(p.x, ny, p.z)) p.y = ny;
        else { g.vel.y *= -0.45; }
        if (!overlaps(p.x, p.y, nz)) p.z = nz;
        else { g.vel.z *= -0.45; }
      }
    },
  };
}

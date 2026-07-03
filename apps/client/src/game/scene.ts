/**
 * Three.js isometric scene — M1.
 * Orthographic camera at the classic iso pitch; yaw rotatable via middle-mouse
 * drag; map rendered from sim data; capsule soldiers; tracers; corpses.
 * World units: meters (sim mm / 1000).
 */
import * as THREE from "three";
import type { ShotEvent, SoldierSnapshot } from "@coc/protocol";
import { ACTIVE_MAP } from "@coc/sim";

const CAM_PITCH = Math.atan(1 / Math.SQRT2); // classic 2:1 iso pitch ≈ 35.26°

export interface SceneApi {
  updateSoldiers(soldiers: SoldierSnapshot[], mySoldierIds: number[], selectedId: number | null): void;
  addShotEvents(events: ShotEvent[]): void;
  onGroundClick(cb: (xMm: number, yMm: number) => void): void;
  onSoldierClick(cb: (id: number) => void): void;
  onAttack(cb: (targetId: number) => void): void;
  onHover(cb: (targetId: number | null, screenX: number, screenY: number) => void): void;
  dispose(): void;
}

export function createScene(canvas: HTMLCanvasElement): SceneApi {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x11151a);
  scene.fog = new THREE.Fog(0x11151a, 120, 260);

  // --- camera -------------------------------------------------------------
  const MAP_W = ACTIVE_MAP.w / 1000;
  const MAP_H = ACTIVE_MAP.h / 1000;
  const camera = new THREE.OrthographicCamera();
  const camTarget = new THREE.Vector3(MAP_W / 2, 0, MAP_H / 2);
  let viewSize = 55;
  let yaw = Math.PI / 4; // camera yaw — middle-mouse drag to rotate
  function layoutCamera(): void {
    const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
    camera.left = -viewSize * aspect;
    camera.right = viewSize * aspect;
    camera.top = viewSize;
    camera.bottom = -viewSize;
    camera.near = -200;
    camera.far = 500;
    const r = 120;
    camera.position.set(
      camTarget.x + r * Math.cos(yaw),
      r * Math.sin(CAM_PITCH) * Math.SQRT2,
      camTarget.z + r * Math.sin(yaw),
    );
    camera.lookAt(camTarget);
    camera.updateProjectionMatrix();
  }

  // --- lights -------------------------------------------------------------
  scene.add(new THREE.HemisphereLight(0x8899bb, 0x223311, 0.55));
  const sun = new THREE.DirectionalLight(0xfff2dd, 1.6);
  sun.position.set(60, 80, 20);
  sun.castShadow = true;
  sun.shadow.camera.left = -80; sun.shadow.camera.right = 80;
  sun.shadow.camera.top = 80; sun.shadow.camera.bottom = -80;
  sun.shadow.mapSize.set(2048, 2048);
  scene.add(sun);

  // --- map from sim data (what you see is what collides) --------------------
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(MAP_W, MAP_H),
    new THREE.MeshStandardMaterial({ color: 0x445142, roughness: 0.95 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(MAP_W / 2, 0, MAP_H / 2);
  ground.receiveShadow = true;
  ground.name = "ground";
  scene.add(ground);

  const grid = new THREE.GridHelper(Math.max(MAP_W, MAP_H), Math.max(MAP_W, MAP_H) / 5, 0x2a3138, 0x232a30);
  grid.position.set(MAP_W / 2, 0.01, MAP_H / 2);
  scene.add(grid);

  const KIND_MATS = {
    wall: new THREE.MeshStandardMaterial({ color: 0x8a7f6a, roughness: 0.9 }),
    stone: new THREE.MeshStandardMaterial({ color: 0x8d939a, roughness: 0.85 }),
    hay: new THREE.MeshStandardMaterial({ color: 0xc2a24e, roughness: 1.0 }),
    fence: new THREE.MeshStandardMaterial({ color: 0x6d5136, roughness: 0.95 }),
    shed: new THREE.MeshStandardMaterial({ color: 0x5f5648, roughness: 0.9 }),
    trunk: new THREE.MeshStandardMaterial({ color: 0x4a3826, roughness: 1.0 }),
    leaf: new THREE.MeshStandardMaterial({ color: 0x3e5f34, roughness: 1.0 }),
  } as const;
  for (const o of ACTIVE_MAP.obstacles) {
    const w = o.w / 1000, d = o.h / 1000, ht = o.ht / 1000;
    const cx = o.x / 1000 + w / 2, cz = o.y / 1000 + d / 2;
    if (o.kind === "tree") {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, 2.2, 8), KIND_MATS.trunk);
      trunk.position.set(cx, 1.1, cz);
      trunk.castShadow = true;
      const leaves = new THREE.Mesh(new THREE.SphereGeometry(1.7, 10, 8), KIND_MATS.leaf);
      leaves.position.set(cx, 3.1, cz);
      leaves.scale.y = 0.85;
      leaves.castShadow = true;
      scene.add(trunk, leaves);
      continue;
    }
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, ht, d), KIND_MATS[o.kind]);
    m.position.set(cx, ht / 2, cz);
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
  }

  // --- soldiers -------------------------------------------------------------
  const soldierGroup = new THREE.Group();
  scene.add(soldierGroup);
  const soldierMeshes = new Map<number, THREE.Group>();
  const TEAM_COLORS = [0x4da3ff, 0xff9e4d] as const;
  let mySet = new Set<number>();
  let lastSoldiers = new Map<number, SoldierSnapshot>();

  function makeSoldier(team: 0 | 1, mine: boolean): THREE.Group {
    const g = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({
      color: TEAM_COLORS[team],
      roughness: 0.6,
      emissive: mine ? TEAM_COLORS[team] : 0x000000,
      emissiveIntensity: mine ? 0.12 : 0,
    });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.36, 1.2, 12), bodyMat);
    body.position.y = 0.8;
    body.castShadow = true;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 10), bodyMat);
    head.position.y = 1.62;
    head.castShadow = true;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.55, 0.7, 24),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;
    ring.name = "selection";
    g.add(body, head, ring);
    g.userData.bodyMat = bodyMat;
    return g;
  }

  function updateSoldiers(
    soldiers: SoldierSnapshot[], mySoldierIds: number[], selectedId: number | null,
  ): void {
    mySet = new Set(mySoldierIds);
    lastSoldiers = new Map(soldiers.map((s) => [s.id, s]));
    const seen = new Set<number>();
    for (const s of soldiers) {
      seen.add(s.id);
      let g = soldierMeshes.get(s.id);
      if (!g) {
        g = makeSoldier(s.team, mySet.has(s.id));
        g.userData.soldierId = s.id;
        soldierMeshes.set(s.id, g);
        soldierGroup.add(g);
        g.position.set(s.x / 1000, 0, s.y / 1000);
      }
      // smooth interpolation toward authoritative position
      g.userData.target = new THREE.Vector3(s.x / 1000, 0, s.y / 1000);
      const ring = g.getObjectByName("selection") as THREE.Mesh;
      (ring.material as THREE.MeshBasicMaterial).opacity = s.id === selectedId && s.alive ? 0.9 : 0;
      if (!s.alive && !g.userData.dead) {
        g.userData.dead = true;
        const mat = g.userData.bodyMat as THREE.MeshStandardMaterial;
        mat.color.multiplyScalar(0.25);
        mat.emissiveIntensity = 0;
        g.scale.y = 0.18; // fallen
      } else if (s.alive) {
        g.scale.y = s.stance === "prone" ? 0.45 : s.stance === "crouch" ? 0.72 : 1;
      }
    }
    // fog: enemies the server stopped sending vanish from view
    for (const [id, g] of soldierMeshes) {
      g.visible = seen.has(id) || mySet.has(id);
    }
  }

  // --- tracers ---------------------------------------------------------------
  const tracers: Array<{ line: THREE.Line; ttl: number; max: number }> = [];
  function addShotEvents(events: ShotEvent[]): void {
    for (const e of events) {
      const geo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(e.sx / 1000, 1.3, e.sy / 1000),
        new THREE.Vector3(e.tx / 1000, 1.1, e.ty / 1000),
      ]);
      const mat = new THREE.LineBasicMaterial({
        color: e.kill ? 0xff5544 : e.hit ? 0xffd27d : 0x8fa3b8,
        transparent: true,
        opacity: 0.9,
      });
      const line = new THREE.Line(geo, mat);
      scene.add(line);
      tracers.push({ line, ttl: 0.25, max: 0.25 });
    }
  }

  // --- picking / hover --------------------------------------------------------
  const raycaster = new THREE.Raycaster();
  let groundCb: ((x: number, y: number) => void) | null = null;
  let soldierCb: ((id: number) => void) | null = null;
  let attackCb: ((id: number) => void) | null = null;
  let hoverCb: ((id: number | null, sx: number, sy: number) => void) | null = null;

  function raycastSoldier(e: PointerEvent): number | null {
    const rect = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(soldierGroup.children, true);
    for (const h of hits) {
      const id = h.object.parent?.userData.soldierId as number | undefined;
      if (id !== undefined && soldierMeshes.get(id)?.visible) return id;
    }
    return null;
  }

  function pick(e: PointerEvent): void {
    const id = raycastSoldier(e);
    if (e.button === 0) {
      if (id !== null && mySet.has(id) && lastSoldiers.get(id)?.alive) soldierCb?.(id);
      return;
    }
    if (e.button === 2) {
      if (id !== null && !mySet.has(id) && lastSoldiers.get(id)?.alive) {
        attackCb?.(id);
        return;
      }
      const rect = canvas.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(ndc, camera);
      const hit = raycaster.intersectObject(ground, false)[0];
      if (hit && groundCb) groundCb(Math.round(hit.point.x * 1000), Math.round(hit.point.z * 1000));
    }
  }

  // --- input: pick, hover, middle-drag rotate, WASD pan, wheel zoom ----------
  let rotating = false;
  let lastRotX = 0;
  canvas.addEventListener("pointerdown", (e) => {
    if (e.button === 1) {
      e.preventDefault(); // suppress autoscroll
      rotating = true;
      lastRotX = e.clientX;
      canvas.setPointerCapture(e.pointerId);
    } else {
      pick(e);
    }
  });
  canvas.addEventListener("pointermove", (e) => {
    if (rotating) {
      yaw += (e.clientX - lastRotX) * 0.008;
      lastRotX = e.clientX;
      layoutCamera();
      return;
    }
    const id = raycastSoldier(e);
    const hostile = id !== null && !mySet.has(id) && lastSoldiers.get(id)?.alive;
    canvas.style.cursor = hostile ? "crosshair" : "default";
    hoverCb?.(hostile ? id : null, e.clientX, e.clientY);
  });
  const endRotate = (e: PointerEvent): void => {
    if (e.button === 1) rotating = false;
  };
  canvas.addEventListener("pointerup", endRotate);
  canvas.addEventListener("pointercancel", endRotate);
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  const keys = new Set<string>();
  window.addEventListener("keydown", (e) => keys.add(e.key.toLowerCase()));
  window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));
  canvas.addEventListener("wheel", (e) => {
    viewSize = Math.min(95, Math.max(12, viewSize + Math.sign(e.deltaY) * 4));
    layoutCamera();
  }, { passive: true });

  // --- render loop -----------------------------------------------------------
  let disposed = false;
  const clock = new THREE.Clock();
  function frame(): void {
    if (disposed) return;
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, clock.getDelta());
    const pan = 30 * dt;
    if (keys.has("w")) { camTarget.x -= pan * Math.cos(yaw); camTarget.z -= pan * Math.sin(yaw); }
    if (keys.has("s")) { camTarget.x += pan * Math.cos(yaw); camTarget.z += pan * Math.sin(yaw); }
    if (keys.has("a")) { camTarget.x -= pan * Math.sin(yaw); camTarget.z += pan * Math.cos(yaw); }
    if (keys.has("d")) { camTarget.x += pan * Math.sin(yaw); camTarget.z -= pan * Math.cos(yaw); }
    layoutCamera();

    for (const g of soldierMeshes.values()) {
      const t = g.userData.target as THREE.Vector3 | undefined;
      if (t) g.position.lerp(t, Math.min(1, dt * 12));
    }

    for (let i = tracers.length - 1; i >= 0; i--) {
      const tr = tracers[i]!;
      tr.ttl -= dt;
      if (tr.ttl <= 0) {
        scene.remove(tr.line);
        tr.line.geometry.dispose();
        (tr.line.material as THREE.Material).dispose();
        tracers.splice(i, 1);
      } else {
        (tr.line.material as THREE.LineBasicMaterial).opacity = 0.9 * (tr.ttl / tr.max);
      }
    }

    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== w * devicePixelRatio || canvas.height !== h * devicePixelRatio) {
      renderer.setSize(w, h, false);
      renderer.setPixelRatio(devicePixelRatio);
    }
    renderer.render(scene, camera);
  }
  layoutCamera();
  frame();

  return {
    updateSoldiers,
    addShotEvents,
    onGroundClick: (cb) => { groundCb = cb; },
    onSoldierClick: (cb) => { soldierCb = cb; },
    onAttack: (cb) => { attackCb = cb; },
    onHover: (cb) => { hoverCb = cb; },
    dispose: () => { disposed = true; renderer.dispose(); },
  };
}

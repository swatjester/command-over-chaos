/**
 * Three.js isometric scene — M0 greybox.
 * Orthographic camera at the classic iso pitch; yaw rotatable via
 * middle-mouse drag; procedural map (ground + cover boxes + one building
 * shell); capsule soldiers. World units: meters (sim mm / 1000).
 */
import * as THREE from "three";
import type { SoldierSnapshot } from "@coc/protocol";

const CAM_PITCH = Math.atan(1 / Math.SQRT2); // classic 2:1 iso pitch ≈ 35.26°

export interface SceneApi {
  updateSoldiers(soldiers: SoldierSnapshot[], mySoldierIds: number[], selectedId: number | null): void;
  onGroundClick(cb: (xMm: number, yMm: number) => void): void;
  onSoldierClick(cb: (id: number) => void): void;
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
  const camera = new THREE.OrthographicCamera();
  const camTarget = new THREE.Vector3(50, 0, 50); // map center (100m map)
  let viewSize = 40;
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

  // --- greybox map (procedural, deterministic layout) -----------------------
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(100, 100),
    new THREE.MeshStandardMaterial({ color: 0x39413b, roughness: 0.95 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(50, 0, 50);
  ground.receiveShadow = true;
  ground.name = "ground";
  scene.add(ground);

  const grid = new THREE.GridHelper(100, 20, 0x2a3138, 0x232a30);
  grid.position.set(50, 0.01, 50);
  scene.add(grid);

  const coverMat = new THREE.MeshStandardMaterial({ color: 0x555d66, roughness: 0.8 });
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x6e6a60, roughness: 0.9 });
  function box(w: number, h: number, d: number, x: number, z: number, mat: THREE.Material): void {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, h / 2, z);
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
  }
  // scattered low cover
  const coverSpots: Array<[number, number]> = [
    [20, 30], [25, 55], [40, 42], [55, 30], [62, 60], [75, 45], [35, 70], [70, 75], [50, 15], [50, 85],
  ];
  for (const [x, z] of coverSpots) box(2.4, 1.1, 1.2, x, z, coverMat);
  // central building shell (walls with a doorway gap)
  box(12, 3, 0.4, 50, 44, wallMat);
  box(0.4, 3, 5, 44.2, 47.3, wallMat);
  box(0.4, 3, 12, 56, 50, wallMat);
  box(9, 3, 0.4, 48.4, 56, wallMat);

  // --- soldiers -------------------------------------------------------------
  const soldierGroup = new THREE.Group();
  scene.add(soldierGroup);
  const soldierMeshes = new Map<number, THREE.Group>();
  const TEAM_COLORS = [0x4da3ff, 0xff9e4d] as const;

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
    return g;
  }

  function updateSoldiers(
    soldiers: SoldierSnapshot[], mySoldierIds: number[], selectedId: number | null,
  ): void {
    for (const s of soldiers) {
      let g = soldierMeshes.get(s.id);
      if (!g) {
        g = makeSoldier(s.team, mySoldierIds.includes(s.id));
        g.userData.soldierId = s.id;
        soldierMeshes.set(s.id, g);
        soldierGroup.add(g);
        g.position.set(s.x / 1000, 0, s.y / 1000);
      }
      // smooth interpolation toward authoritative position
      g.userData.target = new THREE.Vector3(s.x / 1000, 0, s.y / 1000);
      g.visible = s.alive;
      const ring = g.getObjectByName("selection") as THREE.Mesh;
      (ring.material as THREE.MeshBasicMaterial).opacity = s.id === selectedId ? 0.9 : 0;
      const scale = s.stance === "prone" ? 0.45 : s.stance === "crouch" ? 0.72 : 1;
      g.scale.y = scale;
    }
  }

  // --- picking --------------------------------------------------------------
  const raycaster = new THREE.Raycaster();
  let groundCb: ((x: number, y: number) => void) | null = null;
  let soldierCb: ((id: number) => void) | null = null;

  function pick(e: PointerEvent): void {
    const rect = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(ndc, camera);
    if (e.button === 0 && soldierCb) {
      const hits = raycaster.intersectObjects(soldierGroup.children, true);
      const hit = hits.find((h) => h.object.parent?.userData.soldierId !== undefined);
      if (hit) {
        soldierCb(hit.object.parent!.userData.soldierId as number);
        return;
      }
    }
    if (e.button === 2 && groundCb) {
      const hit = raycaster.intersectObject(ground, false)[0];
      if (hit) groundCb(Math.round(hit.point.x * 1000), Math.round(hit.point.z * 1000));
    }
  }
  // --- input: pick, middle-drag rotate, WASD/edge pan, wheel zoom -----------
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
    }
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
    viewSize = Math.min(70, Math.max(12, viewSize + Math.sign(e.deltaY) * 3));
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
    onGroundClick: (cb) => { groundCb = cb; },
    onSoldierClick: (cb) => { soldierCb = cb; },
    dispose: () => { disposed = true; renderer.dispose(); },
  };
}

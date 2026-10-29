import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { DEFAULT_TREE_HEIGHT } from '../lib/defaults';
import { drawGround, groundWidth } from '../lib/ground';
import type { Site, Tree } from '../lib/types';

export interface Ghost { x: number; z: number; radius: number; ok: boolean }

interface Props {
  site: Site;
  trees: Tree[];
  greenRoofs: Set<number>;
  sun: { alt: number; az: number };
  selectedId: number | null;
  plantMode: boolean;
  ghost: Ghost | null;
  spots: { x: number; z: number }[];
  onHoverGround: (p: { x: number; z: number } | null) => void; // plant mode: where the cursor is on the ground
  onPick: (id: number | null, x: number, z: number, treeId?: string) => void; // click: a building id, a planted tree's id, or just the ground point
}

const TREE_COLOR = { nus: 0x22a85a, proposed: 0x4ade80 };

// Repeatable per-tree variation (size, turn, shade of green) so crowns don't look stamped from one mould.
const hash = (x: number, z: number) => { const v = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return v - Math.floor(v); };
const crownMatrix = (m: THREE.Matrix4, x: number, y: number, z: number, r: number) => {
  const h = hash(x, z);
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), h * Math.PI * 2);
  return m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(r * (0.9 + h * 0.2), r * (0.62 + h * 0.2), r * (1.1 - h * 0.2)));
};

function numberSprite(n: number) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#2dd4bf'; g.beginPath(); g.arc(32, 32, 28, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#042f2e'; g.font = 'bold 34px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(n), 32, 34);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false }));
  s.scale.set(9, 9, 1); s.renderOrder = 10;
  return s;
}

/** Orbitable 3D view of the selected area: extruded buildings, tree crowns, shaded ground, sun light at the real sun position. */
export default function Scene3D({ site, trees, greenRoofs, sun, selectedId, plantMode, ghost, spots, onHoverGround, onPick }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const three = useRef<{
    scene: THREE.Scene; buildings: THREE.Group; treeGroup: THREE.Group; spotGroup: THREE.Group; ghost: THREE.Group;
    ghostParts: { crown: THREE.Mesh; ring: THREE.Mesh; beam: THREE.Mesh };
    crowns: { mesh: THREE.InstancedMesh | null; shown: Tree[] };
    sunLight: THREE.DirectionalLight; ground: THREE.Mesh; meshes: Map<number, THREE.Mesh>; hover: { id: number | null }; applyMats: () => void;
  } | null>(null);
  const cb = useRef({ onHoverGround, onPick, site, plantMode, selectedId, greenRoofs });
  cb.current = { onHoverGround, onPick, site, plantMode, selectedId, greenRoofs };

  // one-time renderer / camera / controls (the parent remounts this component for each new area)
  useEffect(() => {
    const el = host.current!;
    const reach = Math.max(site.w, site.d);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    rendererRef.current = renderer;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b1117);
    const cam = new THREE.PerspectiveCamera(45, 1, 1, 6000);
    cam.position.set(reach * 0.35, reach * 0.85, reach * 0.8);
    const controls = new OrbitControls(cam, renderer.domElement);
    controls.maxPolarAngle = Math.PI / 2 - 0.05;
    controls.minDistance = 25; controls.maxDistance = reach * 2.5;
    controls.enableDamping = true;
    scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x1a222c, 0.9));
    const sunLight = new THREE.DirectionalLight(0xffffff, 2.2);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.set(4096, 4096);
    const sc = sunLight.shadow.camera;
    sc.left = sc.bottom = -reach * 0.8; sc.right = sc.top = reach * 0.8; sc.near = 1; sc.far = 3000;
    scene.add(sunLight, sunLight.target);
    const buildings = new THREE.Group(), treeGroup = new THREE.Group(), spotGroup = new THREE.Group(), ghostGroup = new THREE.Group();
    scene.add(buildings, treeGroup, spotGroup, ghostGroup);
    // the cursor ghost is built once and only moved/recoloured, so mouse moves never allocate GPU objects
    const ghostMat = () => new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.45, side: THREE.DoubleSide });
    const ghostParts = {
      crown: new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), ghostMat()),
      ring: new THREE.Mesh(new THREE.RingGeometry(0.93, 1, 40).rotateX(-Math.PI / 2), ghostMat()),
      beam: new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 60, 8), ghostMat()), // tall, so the cursor spot reads at any zoom
    };
    ghostParts.ring.material.opacity = 1; ghostParts.beam.material.opacity = 0.55;
    ghostGroup.add(ghostParts.crown, ghostParts.ring, ghostParts.beam);
    ghostGroup.visible = false;
    const crowns = { mesh: null as THREE.InstancedMesh | null, shown: [] as Tree[] };
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(site.w, site.d).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ roughness: 1 }));
    ground.receiveShadow = true;
    scene.add(ground);

    // building materials: [caps, walls]; selected and hovered ones are tinted
    const meshes = new Map<number, THREE.Mesh>();
    const hover = { id: null as number | null };
    const base = [new THREE.MeshStandardMaterial({ color: 0x8795a8, roughness: 0.8 }), new THREE.MeshStandardMaterial({ color: 0x8795a8, roughness: 0.8 })];
    const unk = [new THREE.MeshStandardMaterial({ color: 0x5f6b7a, roughness: 0.8 }), new THREE.MeshStandardMaterial({ color: 0x5f6b7a, roughness: 0.8 })];
    const green = new THREE.MeshStandardMaterial({ color: 0x3f8f4f, roughness: 1 });
    const sel = new THREE.MeshStandardMaterial({ color: 0x2dd4bf, emissive: 0x0f766e, roughness: 0.6 });
    const hov = new THREE.MeshStandardMaterial({ color: 0xa9b8cb, emissive: 0x334155, roughness: 0.7 });
    const dim = new THREE.MeshStandardMaterial({ color: 0x2a3441, roughness: 0.9 }); // beyond the selected area: only there to cast shadows
    const applyMats = () => {
      const { site: st, selectedId: s, greenRoofs: gr } = cb.current;
      for (const b of st.buildings) {
        const m = meshes.get(b.id); if (!m) continue;
        const wall = b.outside ? dim : b.id === s ? sel : b.id === hover.id ? hov : b.heightRecorded ? base[1] : unk[1];
        m.material = [gr.has(b.id) && !b.outside ? green : wall, wall];
      }
    };
    three.current = { scene, buildings, treeGroup, spotGroup, ghost: ghostGroup, ghostParts, crowns, sunLight, ground, meshes, hover, applyMats };

    const render = () => renderer.render(scene, cam);
    const resize = () => { const w = el.clientWidth, h = el.clientHeight; renderer.setSize(w, h); cam.aspect = w / h; cam.updateProjectionMatrix(); render(); };
    const ro = new ResizeObserver(resize); ro.observe(el); resize();
    let raf = 0;
    const loop = () => { raf = requestAnimationFrame(loop); controls.update(); render(); };
    loop();

    // pick: building meshes first (so a roof click selects that roof), else the ground plane
    const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const pick = (e: PointerEvent): { id: number | null; x: number; z: number; treeId?: string } | null => {
      const r = renderer.domElement.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, cam);
      // nearest of: a building, or a tree you planted (mapped trees can't be edited, so rays pass through them)
      const targets: THREE.Object3D[] = [...buildings.children];
      if (crowns.mesh) targets.push(crowns.mesh);
      for (const hit of ray.intersectObjects(targets, false)) {
        if (hit.object === crowns.mesh) {
          const tree = hit.instanceId != null ? crowns.shown[hit.instanceId] : undefined;
          if (tree?.source === 'proposed') return { id: null, x: hit.point.x, z: hit.point.z, treeId: tree.id };
          continue;
        }
        return { id: hit.object.userData.id, x: hit.point.x, z: hit.point.z };
      }
      const p = new THREE.Vector3();
      return ray.ray.intersectPlane(plane, p) ? { id: null, x: p.x, z: p.z } : null;
    };
    const dom = renderer.domElement;
    let down: [number, number] | null = null;
    dom.onpointerdown = (e) => { down = [e.clientX, e.clientY]; };
    dom.onpointermove = (e) => {
      if (e.buttons) return;
      const p = pick(e);
      const id = p?.id ?? null;
      if (id !== hover.id) { hover.id = id; applyMats(); }
      dom.style.cursor = p?.treeId ? 'pointer' : cb.current.plantMode ? 'crosshair' : id != null ? 'pointer' : 'grab';
      cb.current.onHoverGround(cb.current.plantMode && p ? { x: p.x, z: p.z } : null);
    };
    dom.onpointerleave = () => { hover.id = null; applyMats(); cb.current.onHoverGround(null); };
    dom.onpointerup = (e) => {
      if (!down || Math.abs(e.clientX - down[0]) + Math.abs(e.clientY - down[1]) > 4) return;
      const p = pick(e);
      if (p) cb.current.onPick(p.id, p.x, p.z, p.treeId);
    };

    return () => { cancelAnimationFrame(raf); ro.disconnect(); controls.dispose(); renderer.dispose(); Object.values(ghostParts).forEach((m) => { m.geometry.dispose(); (m.material as THREE.Material).dispose(); }); el.removeChild(dom); three.current = null; rendererRef.current = null; };
  }, []);

  // sun direction (east = x, south = z, up = y)
  useEffect(() => {
    const t = three.current; if (!t) return;
    const a = Math.max(sun.alt, 0.05);
    t.sunLight.position.set(Math.sin(sun.az) * Math.cos(a) * 800, Math.sin(a) * 800, -Math.cos(sun.az) * Math.cos(a) * 800);
    t.sunLight.intensity = sun.alt > 0.02 ? 2.2 : 0.2;
  }, [sun]);

  // ground texture
  useEffect(() => {
    const t = three.current; if (!t) return;
    const mat = t.ground.material as THREE.MeshStandardMaterial;
    mat.map?.dispose();
    const tex = new THREE.CanvasTexture(drawGround(site, trees, sun.alt, sun.az, groundWidth(site.w)));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = rendererRef.current?.capabilities.getMaxAnisotropy() ?? 1; // stays sharp at a low viewing angle
    mat.map = tex;
    mat.needsUpdate = true;
  }, [site, trees, sun]);

  // buildings
  useEffect(() => {
    const t = three.current; if (!t) return;
    t.buildings.traverse((c) => { (c as THREE.Mesh).geometry?.dispose(); });
    t.buildings.clear(); t.meshes.clear();
    for (const b of site.buildings) {
      // shape in (x, -z) so that after rotateX(-90°) the footprint lands on world (x, z)
      const shape = new THREE.Shape(b.ring.map(([x, z]) => new THREE.Vector2(x, -z)));
      const geo = new THREE.ExtrudeGeometry(shape, { depth: b.height, bevelEnabled: false }).rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(geo);
      m.castShadow = m.receiveShadow = true;
      m.userData.id = b.id;
      // thin dark outline so building edges stay legible at any distance
      m.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 30), new THREE.LineBasicMaterial({ color: 0x0b1117, transparent: true, opacity: 0.45 })));
      t.buildings.add(m); t.meshes.set(b.id, m);
    }
    t.applyMats();
  }, [site]);
  useEffect(() => { three.current?.applyMats(); }, [selectedId, greenRoofs, site]);

  // trees: one instanced mesh each for trunks and crowns
  useEffect(() => {
    const t = three.current; if (!t) return;
    const shown = trees.filter((tr) => !tr.overBuilding);
    if (!shown.length) return;
    const trunkGeo = new THREE.CylinderGeometry(0.25, 0.35, 1, 6), crownGeo = new THREE.IcosahedronGeometry(1, 1);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5b4636 }), crownMat = new THREE.MeshStandardMaterial({ roughness: 0.9 });
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, shown.length), crowns = new THREE.InstancedMesh(crownGeo, crownMat, shown.length);
    trunks.castShadow = crowns.castShadow = true;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), color = new THREE.Color();
    shown.forEach((tr, i) => {
      const th = tr.height * 0.55;
      trunks.setMatrixAt(i, m.compose(new THREE.Vector3(tr.x, th / 2, tr.z), q, new THREE.Vector3(1, th, 1)));
      crowns.setMatrixAt(i, crownMatrix(m, tr.x, th + tr.radius * 0.5, tr.z, tr.radius));
      crowns.setColorAt(i, color.setHex(TREE_COLOR[tr.source]).offsetHSL(0, 0, (hash(tr.z, tr.x) - 0.5) * 0.08));
    });
    t.treeGroup.add(trunks, crowns);
    t.crowns.mesh = crowns; t.crowns.shown = shown;
    return () => {
      t.crowns.mesh = null; t.crowns.shown = [];
      t.treeGroup.remove(trunks, crowns);
      trunks.dispose(); crowns.dispose(); trunkGeo.dispose(); crownGeo.dispose(); trunkMat.dispose(); crownMat.dispose();
    };
  }, [trees]);

  // generated trees inside dense canopy patches: instanced, drawn a little darker, no shadow casting
  // (the ground texture already shows the patch shading, and their count would slow the shadow pass)
  useEffect(() => {
    const t = three.current; if (!t || !site.generated.length) return;
    const n = site.generated.length;
    const trunkGeo = new THREE.CylinderGeometry(0.25, 0.35, 1, 5), crownGeo = new THREE.IcosahedronGeometry(1, 1);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3a2c }), crownMat = new THREE.MeshStandardMaterial({ roughness: 0.95 });
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, n), crowns = new THREE.InstancedMesh(crownGeo, crownMat, n);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), color = new THREE.Color();
    site.generated.forEach((g, i) => {
      const th = DEFAULT_TREE_HEIGHT * 0.55;
      trunks.setMatrixAt(i, m.compose(new THREE.Vector3(g.x, th / 2, g.z), q, new THREE.Vector3(1, th, 1)));
      crowns.setMatrixAt(i, crownMatrix(m, g.x, th + g.radius * 0.5, g.z, g.radius));
      crowns.setColorAt(i, color.setHex(0x1b7a45).offsetHSL(0, 0, (hash(g.z, g.x) - 0.5) * 0.1));
    });
    t.treeGroup.add(trunks, crowns);
    return () => { t.treeGroup.remove(trunks, crowns); trunks.dispose(); crowns.dispose(); trunkGeo.dispose(); crownGeo.dispose(); trunkMat.dispose(); crownMat.dispose(); };
  }, [site]);

  // ghost tree under the cursor in plant mode: green if allowed, red if not
  useEffect(() => {
    const t = three.current; if (!t) return;
    t.ghost.visible = !!ghost;
    if (!ghost) return;
    const { crown, ring, beam } = t.ghostParts;
    const col = ghost.ok ? 0x4ade80 : 0xef4444;
    for (const m of [crown, ring, beam]) (m.material as THREE.MeshBasicMaterial).color.setHex(col);
    const h = DEFAULT_TREE_HEIGHT * 0.55;
    crown.scale.set(ghost.radius, ghost.radius * 0.7, ghost.radius); crown.position.set(ghost.x, h + ghost.radius * 0.5, ghost.z);
    ring.scale.set(ghost.radius, 1, ghost.radius); ring.position.set(ghost.x, 0.3, ghost.z);
    beam.position.set(ghost.x, 30, ghost.z);
  }, [ghost?.x, ghost?.z, ghost?.ok, ghost?.radius]);

  // numbered recommendation markers
  useEffect(() => {
    const t = three.current; if (!t) return;
    const made: THREE.Object3D[] = [];
    spots.forEach((s, i) => {
      const sp = numberSprite(i + 1); sp.position.set(s.x, 26, s.z);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 24, 6), new THREE.MeshBasicMaterial({ color: 0x2dd4bf }));
      pole.position.set(s.x, 12, s.z);
      t.spotGroup.add(sp, pole); made.push(sp, pole);
    });
    return () => {
      for (const o of made) {
        t.spotGroup.remove(o);
        if (o instanceof THREE.Sprite) { o.material.map?.dispose(); o.material.dispose(); }
        else if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); }
      }
    };
  }, [spots]);

  return <div ref={host} className="scene3d" />;
}

import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { buildOverlay, drawGround } from '../lib/ground';
import type { ShadeResult } from '../lib/shade';
import type { Site, Tree } from '../lib/types';
import { hitTest, type Hit, type View } from './MapCanvas';

interface Props {
  site: Site;
  trees: Tree[];
  res: ShadeResult;
  greenRoofs: Set<number>;
  sun: { alt: number; az: number };
  onClick: (x: number, z: number, hit: Hit) => void;
  onHover: (hit: Hit) => void;
  onView: (v: View) => void;
}

const TREE_COLOR = { osm: 0x22a85a, nparks: 0xd9b82b, proposed: 0x4ade80 };

/** Orbitable 3D view: extruded OSM buildings, tree crowns, shaded ground, and a sun light at the real sun position. */
export default function Scene3D({ site, trees, res, greenRoofs, sun, onClick, onHover, onView }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const three = useRef<{ scene: THREE.Scene; buildings: THREE.Group; treeGroup: THREE.Group; sunLight: THREE.DirectionalLight; ground: THREE.Mesh; cam: THREE.PerspectiveCamera; render: () => void } | null>(null);
  const cb = useRef({ onClick, onHover, onView, site, trees });
  cb.current = { onClick, onHover, onView, site, trees };
  const overlay = useMemo(() => buildOverlay(site, res), [site, res]);

  // one-time renderer / camera / controls
  useEffect(() => {
    const el = host.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b1117);
    const cam = new THREE.PerspectiveCamera(45, 1, 1, 3000);
    const half = cb.current.site.half;
    cam.position.set(half * 0.9, half * 1.1, half * 1.3);
    const controls = new OrbitControls(cam, renderer.domElement);
    controls.maxPolarAngle = Math.PI / 2 - 0.05;
    controls.enableDamping = true;
    scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x1a222c, 0.9));
    const sunLight = new THREE.DirectionalLight(0xffffff, 2.2);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.set(2048, 2048);
    const sc = sunLight.shadow.camera;
    sc.left = sc.bottom = -half * 1.2; sc.right = sc.top = half * 1.2; sc.near = 1; sc.far = 1500;
    scene.add(sunLight, sunLight.target);
    const buildings = new THREE.Group(), treeGroup = new THREE.Group();
    scene.add(buildings, treeGroup);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(2 * half, 2 * half).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ roughness: 1 }));
    ground.receiveShadow = true;
    scene.add(ground);

    const render = () => renderer.render(scene, cam);
    three.current = { scene, buildings, treeGroup, sunLight, ground, cam, render };
    const resize = () => { const w = el.clientWidth, h = el.clientHeight; renderer.setSize(w, h); cam.aspect = w / h; cam.updateProjectionMatrix(); render(); };
    const ro = new ResizeObserver(resize); ro.observe(el); resize();

    let raf = 0;
    const loop = () => { raf = requestAnimationFrame(loop); controls.update(); render(); };
    loop();
    controls.addEventListener('change', () => {
      const d = cam.position.distanceTo(controls.target);
      cb.current.onView({ k: Math.min(8, Math.max(0.6, (2.2 * half) / d)), x: controls.target.x, z: controls.target.z });
    });

    // pick: building meshes first (so a roof click selects that roof), else the ground plane
    const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const pick = (e: PointerEvent): { x: number; z: number; hit: Hit } | null => {
      const r = renderer.domElement.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, cam);
      const { site: st, trees: tr } = cb.current;
      const roof = ray.intersectObjects(buildings.children, false)[0];
      if (roof) {
        const b = st.buildings.find((x) => x.id === roof.object.userData.id)!;
        return { x: roof.point.x, z: roof.point.z, hit: { kind: 'building', id: b.id, label: `${b.name ?? 'Building'} · ${b.height.toFixed(0)} m${b.heightTagged ? '' : ' (assumed)'}` } };
      }
      const p = new THREE.Vector3();
      if (!ray.ray.intersectPlane(groundPlane, p)) return null;
      return { x: p.x, z: p.z, hit: hitTest(st, tr, p.x, p.z) };
    };
    let down: [number, number] | null = null;
    const dom = renderer.domElement;
    dom.onpointerdown = (e) => { down = [e.clientX, e.clientY]; };
    dom.onpointermove = (e) => { if (e.buttons) return; const p = pick(e); if (p) cb.current.onHover(p.hit); };
    dom.onpointerup = (e) => {
      if (!down || Math.abs(e.clientX - down[0]) + Math.abs(e.clientY - down[1]) > 4) return;
      const p = pick(e);
      if (p) cb.current.onClick(p.x, p.z, p.hit);
    };

    return () => { cancelAnimationFrame(raf); ro.disconnect(); controls.dispose(); renderer.dispose(); el.removeChild(dom); three.current = null; };
  }, []);

  // sun direction (east = x, south = z, up = y)
  useEffect(() => {
    const t = three.current; if (!t) return;
    const a = Math.max(sun.alt, 0.05);
    t.sunLight.position.set(Math.sin(sun.az) * Math.cos(a) * 600, Math.sin(a) * 600, -Math.cos(sun.az) * Math.cos(a) * 600);
    t.sunLight.intensity = sun.alt > 0.02 ? 2.2 : 0.2;
  }, [sun]);

  // ground texture
  useEffect(() => {
    const t = three.current; if (!t) return;
    const mat = t.ground.material as THREE.MeshStandardMaterial;
    mat.map?.dispose();
    mat.map = new THREE.CanvasTexture(drawGround(site, overlay, 2048));
    mat.map.colorSpace = THREE.SRGBColorSpace;
    mat.needsUpdate = true;
  }, [site, overlay]);

  // buildings (rebuilt only when the site or green roofs change)
  useEffect(() => {
    const t = three.current; if (!t) return;
    const g = t.buildings;
    g.children.forEach((c) => (c as THREE.Mesh).geometry.dispose());
    g.clear();
    const bMat = new THREE.MeshStandardMaterial({ color: 0x8795a8, roughness: 0.8 });
    const bUnk = new THREE.MeshStandardMaterial({ color: 0x5f6b7a, roughness: 0.8 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x3f8f4f, roughness: 1 });
    for (const b of site.buildings) {
      // shape in (x, -z) so that after rotateX(-90°) the footprint lands on world (x, z)
      const shape = new THREE.Shape(b.ring.map(([x, z]) => new THREE.Vector2(x, -z)));
      const geo = new THREE.ExtrudeGeometry(shape, { depth: b.height, bevelEnabled: false }).rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(geo, greenRoofs.has(b.id) ? [roofMat, bMat] /* extrude groups: 0 = top/bottom caps, 1 = walls */ : b.heightTagged ? bMat : bUnk);
      m.castShadow = m.receiveShadow = true;
      m.userData.id = b.id;
      g.add(m);
    }
    return () => { bMat.dispose(); bUnk.dispose(); roofMat.dispose(); };
  }, [site, greenRoofs]);

  // trees (cheap; rebuilt on every plant). One shared material per source.
  useEffect(() => {
    const t = three.current; if (!t) return;
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5b4636 });
    const crownMats = Object.fromEntries(Object.entries(TREE_COLOR).map(([k, c]) => [k, new THREE.MeshStandardMaterial({ color: c, roughness: 0.9 })]));
    const crownGeo = new THREE.SphereGeometry(1, 16, 12);
    const trunkGeo = new THREE.CylinderGeometry(0.25, 0.35, 1, 6);
    for (const tr of trees) {
      const th = tr.height * 0.55;
      const trunk = new THREE.Mesh(trunkGeo, trunkMat);
      trunk.scale.set(1, th, 1); trunk.position.set(tr.x, th / 2, tr.z); trunk.castShadow = true;
      const crown = new THREE.Mesh(crownGeo, crownMats[tr.source]);
      crown.scale.set(tr.radius, tr.radius * 0.7, tr.radius); crown.position.set(tr.x, th + tr.radius * 0.5, tr.z);
      crown.castShadow = true;
      t.treeGroup.add(trunk, crown);
    }
    return () => {
      t.treeGroup.clear();
      [trunkMat, ...Object.values(crownMats)].forEach((m) => m.dispose());
      crownGeo.dispose(); trunkGeo.dispose();
    };
  }, [trees]);

  return <div ref={host} className="scene3d" />;
}

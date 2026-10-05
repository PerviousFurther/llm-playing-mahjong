import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { tileFile, tileName } from '../shared/tiles.js';
import { tableTiles, tileSize } from './table-layout.js';

export function createTableRenderer(host, { onAction, onHover, onError }) {
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0x000000, 0);
  host.prepend(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, .1, 60);
  camera.position.set(0, 12, 10);
  camera.lookAt(0, 0, 0);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x304b40, 2.3));
  const light = new THREE.DirectionalLight(0xfff2db, 3);
  light.position.set(-5, 10, 5);
  light.castShadow = true;
  light.shadow.mapSize.set(1024, 1024);
  Object.assign(light.shadow.camera, { left: -7, right: 7, top: 7, bottom: -7, near: .5, far: 25 });
  light.shadow.bias = -.0003;
  light.shadow.normalBias = .025;
  scene.add(light);
  const resources = [];
  const own = resource => { resources.push(resource); return resource; };
  const box = (width, height, length, radius) => own(new RoundedBoxGeometry(width, height, length, 2, radius));
  const material = (color, roughness = .65) => own(new THREE.MeshStandardMaterial({ color, roughness }));
  const wood = new THREE.Mesh(box(12, .36, 8.3, .14), material(0x875b38));
  wood.position.y = -.23;
  wood.receiveShadow = true;
  scene.add(wood);
  const felt = new THREE.Mesh(box(11.6, .12, 7.9, .08), material(0x285b4d, .95));
  felt.position.y = -.04;
  felt.receiveShadow = true;
  scene.add(felt);
  const bodyGeometry = box(tileSize.width, .145, tileSize.length, .025);
  const backGeometry = box(tileSize.width, .055, tileSize.length, .018);
  const faceGeometry = own(new THREE.PlaneGeometry(tileSize.width - .028, tileSize.length - .028));
  faceGeometry.rotateX(-Math.PI / 2);
  const bodyMaterial = material(0xf9f3df, .38), backMaterial = material(0x789d80, .5);
  const faceMaterials = new Map(), tiles = new Map();
  const loader = new THREE.TextureLoader(), raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2();
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let frame = 0, disposed = false, lost = false, hovered = null, state, width = 1, height = 1;
  let pickable = [];
  function requestRender() { if (!disposed && !lost && !frame) frame = requestAnimationFrame(render); }
  function faceMaterial(code) {
    const file = tileFile(code);
    if (!faceMaterials.has(file)) {
      const texture = own(loader.load(`/tiles/Regular/${file}.svg`, () => {
        if (disposed) texture.dispose();
        else requestRender();
      }, undefined, () => { if (!disposed) onError(`牌面加载失败：${file}`); }));
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      const face = own(new THREE.MeshStandardMaterial({ map: texture, roughness: .5, transparent: true, alphaTest: .01 }));
      faceMaterials.set(file, face);
    }
    return faceMaterials.get(file);
  }
  function createTile(descriptor, animate) {
    const group = new THREE.Group();
    const back = new THREE.Mesh(backGeometry, backMaterial);
    back.position.y = .0275;
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    body.position.y = .1275;
    const face = new THREE.Mesh(faceGeometry, faceMaterial(descriptor.code));
    face.position.y = .201;
    group.add(back, body, face);
    for (const mesh of [back, body]) { mesh.castShadow = true; mesh.receiveShadow = true; }
    group.position.set(descriptor.x, (descriptor.y || 0) + (animate ? .6 : 0), descriptor.z);
    scene.add(group);
    return { group, face, descriptor };
  }
  function render() {
    frame = 0;
    if (disposed || lost) return;
    let moving = false;
    for (const tile of tiles.values()) {
      const d = tile.descriptor;
      const targetY = (d.y || 0) + (tile === hovered && d.action ? .22 : 0);
      for (const [axis, target] of [['x', d.x], ['y', targetY], ['z', d.z]]) {
        const delta = target - tile.group.position[axis];
        if (!reduceMotion.matches && Math.abs(delta) > .001) {
          tile.group.position[axis] += delta * .24;
          moving = true;
        } else tile.group.position[axis] = target;
      }
    }
    renderer.render(scene, camera);
    if (moving) requestRender();
  }
  function project(x, y, z) {
    const point = new THREE.Vector3(x, y, z).project(camera);
    return { x: (point.x + 1) * width / 2, y: (1 - point.y) * height / 2 };
  }
  function anchors() {
    const center = project(0, .2, 0);
    const hand = [...tiles.values()].filter(t => t.descriptor.handIndex !== undefined);
    const left = hand.length ? Math.min(...hand.map(t => project(t.descriptor.x - .22, .2, t.descriptor.z).x)) : width / 2 - 150;
    const top = project(0, .2, 3.45 - .34).y;
    host.style.setProperty('--table-center-x', `${center.x}px`);
    host.style.setProperty('--table-center-y', `${center.y}px`);
    host.style.setProperty('--hand-left', `${Math.max(10, left)}px`);
    host.style.setProperty('--hand-top', `${top}px`);
    host.style.setProperty('--actions-left', `${Math.max(10, left - 112)}px`);
    host.style.setProperty('--actions-top', `${left > 122 ? top + 45 : top - 16}px`);
    host.classList.toggle('actions-above', left <= 122);
  }
  function resize() {
    width = host.clientWidth; height = host.clientHeight;
    if (!width || !height) return;
    const aspect = width / height;
    const viewHeight = Math.max(7.5, 13 / aspect);
    const distance = viewHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.2;
    camera.aspect = aspect;
    camera.position.set(0, distance * .7682, distance * .6402);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    renderer.setSize(width, height);
    anchors(); requestRender();
  }
  function setHover(tile) {
    if (hovered === tile) return;
    hovered = tile;
    renderer.domElement.style.cursor = tile?.descriptor.action ? 'pointer' : 'default';
    renderer.domElement.title = tile ? tileName(tile.descriptor.code) : '';
    onHover(tile?.descriptor.code || null);
    requestRender();
  }
  function pick(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    scene.updateMatrixWorld(true);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(pickable, true)[0];
    return hit ? tiles.get(hit.object.parent.userData.key) : null;
  }
  const move = event => setHover(pick(event));
  const leave = () => setHover(null);
  const click = event => { const tile = pick(event); if (tile?.descriptor.action) onAction(tile.descriptor.action); };
  const contextLost = event => { event.preventDefault(); lost = true; cancelAnimationFrame(frame); frame = 0; onError('3D 渲染中断，点击重试恢复牌桌'); };
  const contextRestored = () => { lost = false; onError(''); requestRender(); };
  const canvas = renderer.domElement;
  canvas.setAttribute('aria-hidden', 'true');
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerleave', leave);
  canvas.addEventListener('click', click);
  canvas.addEventListener('webglcontextlost', contextLost);
  canvas.addEventListener('webglcontextrestored', contextRestored);
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();
  return {
    update(nextState, riichiMode) {
      const descriptors = tableTiles(nextState, riichiMode), retained = new Set();
      const animate = state?.started && state.matchHand === nextState.matchHand && !nextState.replay && !nextState.paused;
      state = nextState;
      for (const d of descriptors) {
        retained.add(d.key);
        let tile = tiles.get(d.key);
        if (!tile) { tile = createTile(d, animate && ['hand', 'discard'].includes(d.kind)); tiles.set(d.key, tile); }
        tile.descriptor = d;
        tile.face.material = faceMaterial(d.code);
        tile.group.userData.key = d.key;
        tile.group.rotation.y = d.angle;
        tile.group.scale.setScalar(d.scale);
        if (!animate) tile.group.position.set(d.x, d.y || 0, d.z);
      }
      for (const [key, tile] of tiles) if (!retained.has(key)) { scene.remove(tile.group); tiles.delete(key); }
      if (hovered && !retained.has(hovered.descriptor.key)) setHover(null);
      pickable = [...tiles.values()].filter(t => t.descriptor.handIndex !== undefined).map(t => t.group);
      anchors(); requestRender();
    },
    focus(index) { setHover([...tiles.values()].find(t => t.descriptor.handIndex === index) || null); },
    dispose() {
      disposed = true; cancelAnimationFrame(frame); observer.disconnect();
      canvas.removeEventListener('pointermove', move); canvas.removeEventListener('pointerleave', leave);
      canvas.removeEventListener('click', click); canvas.removeEventListener('webglcontextlost', contextLost);
      canvas.removeEventListener('webglcontextrestored', contextRestored);
      for (const resource of resources) resource.dispose();
      light.shadow.dispose(); renderer.dispose(); renderer.forceContextLoss(); canvas.remove();
    },
  };
}

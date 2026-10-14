import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const TABLE_STATUS = Object.freeze({
  available: { label: 'Available', color: '#66d98a' },
  occupied: { label: 'Occupied', color: '#f0b85b' },
  reserved: { label: 'Reserved', color: '#aa88db' },
  attention: { label: 'Attention', color: '#ef716b' }
});

const MODEL_URL = '/assets/3d/tea-amo-floor.glb?v=20261014-seating';
const MODEL_IDS = ['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8', 't9', 't10', 't11', 'a', 'b', 'c', 'd'];

export class TeaAmo3DFloor {
  constructor(container, onSelect) {
    this.container = container;
    this.onSelect = onSelect;
    this.tables = new Map();
    this.nodes = new Map();
    this.rings = new Map();
    this.labels = new Map();
    this.hitboxes = [];
    this.selectedId = null;
    this.hoveredId = null;
    this.frame = 0;
    this.ready = false;
    this.pointerDown = null;
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#24231f');
    this.camera = new THREE.OrthographicCamera(-9, 9, 7, -7, .1, 80);
    this.camera.position.set(0, 19, 6.8);
    this.camera.lookAt(0, 0, 0);
    this.scene.add(new THREE.HemisphereLight(0xfff1da, 0x786758, 2.1));
    const key = new THREE.DirectionalLight(0xffd7a0, 2.1);
    key.position.set(-5, 12, 5);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xb9d7dd, .65);
    fill.position.set(6, 8, -5);
    this.scene.add(fill);
  }

  async init() {
    this.container.classList.add('three-floor');
    this.loading = document.createElement('div');
    this.loading.className = 'floor3d-loading';
    this.loading.setAttribute('role', 'status');
    this.loading.textContent = 'Loading 3D floor…';
    this.container.appendChild(this.loading);
    try {
      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'low-power' });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.35;
      this.renderer.domElement.className = 'floor3d-canvas';
      this.renderer.domElement.setAttribute('aria-hidden', 'true');
      this.container.appendChild(this.renderer.domElement);
      this.labelLayer = document.createElement('div');
      this.labelLayer.className = 'floor3d-label-layer';
      this.container.appendChild(this.labelLayer);
      this.tooltip = document.createElement('div');
      this.tooltip.className = 'floor3d-tooltip';
      this.tooltip.setAttribute('role', 'status');
      this.container.appendChild(this.tooltip);
      const loader = new GLTFLoader();
      const gltf = await loader.loadAsync(MODEL_URL, (event) => {
        if (event.total) this.loading.textContent = `Loading 3D floor… ${Math.round(event.loaded / event.total * 100)}%`;
      });
      this.model = gltf.scene;
      this.scene.add(this.model);
      this.model.updateMatrixWorld(true);
      this.model.traverse((object) => {
        if (object.userData?.entityType !== 'table') return;
        const id = String(object.userData.tableKey || object.userData.tableId || '').toLowerCase();
        if (!id || this.nodes.has(id)) throw new Error(`Duplicate or invalid 3D table: ${id}`);
        this.nodes.set(id, object);
        const ring = object.getObjectByName(`STATUS_${String(object.userData.tableId).toUpperCase()}`);
        const hitbox = object.getObjectByName(`HITBOX_${String(object.userData.tableId).toUpperCase()}`);
        if (!ring || !hitbox) throw new Error(`Missing status ring or hitbox for ${id}`);
        this.rings.set(id, ring);
        hitbox.material = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false });
        hitbox.userData.tableKey = id;
        this.hitboxes.push(hitbox);
      });
      if (MODEL_IDS.some((id) => !this.nodes.has(id)) || this.nodes.size !== MODEL_IDS.length) {
        throw new Error('The 3D model does not match the 15 TEA AMO table IDs');
      }
      this.createLabels();
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(this.container);
      this.renderer.domElement.addEventListener('pointerdown', this.onPointerDown);
      this.renderer.domElement.addEventListener('pointermove', this.onPointerMove);
      this.renderer.domElement.addEventListener('pointerup', this.onPointerUp);
      this.renderer.domElement.addEventListener('pointerleave', this.onPointerLeave);
      document.addEventListener('visibilitychange', this.onVisibility);
      this.resize();
      this.ready = true;
      this.setTables([...this.tables.values()]);
      this.container.classList.add('three-floor--ready');
      this.loading.remove();
      this.render();
      return this;
    } catch (error) {
      console.error('3D floor unavailable; retaining the table floor fallback.', error);
      this.destroy();
      throw error;
    }
  }

  createLabels() {
    for (const [id, node] of this.nodes) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'floor3d-label';
      button.textContent = node.userData.tableId;
      button.dataset.table = id;
      button.addEventListener('click', (event) => { event.stopPropagation(); this.selectTable(id); });
      button.addEventListener('pointerenter', () => this.showTooltip(id, button));
      button.addEventListener('pointerleave', () => this.hideTooltip());
      button.addEventListener('focus', () => this.showTooltip(id, button));
      button.addEventListener('blur', () => this.hideTooltip());
      this.labelLayer.appendChild(button);
      this.labels.set(id, button);
    }
  }

  resize() {
    if (!this.renderer) return;
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    const aspect = width / height;
    const viewHeight = Math.max(13.8, 18.2 / aspect);
    this.camera.left = -viewHeight * aspect / 2;
    this.camera.right = viewHeight * aspect / 2;
    this.camera.top = viewHeight / 2;
    this.camera.bottom = -viewHeight / 2;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.positionLabels();
    this.render();
  }

  positionLabels() {
    const vector = new THREE.Vector3();
    for (const [id, node] of this.nodes) {
      node.getWorldPosition(vector);
      vector.y += .86;
      vector.project(this.camera);
      const label = this.labels.get(id);
      label.style.left = `${(vector.x + 1) * 50}%`;
      label.style.top = `${(1 - vector.y) * 50}%`;
    }
  }

  setTables(tables) {
    this.tables = new Map((tables || []).map((table) => [String(table.id).toLowerCase(), table]));
    if (!this.ready) return;
    for (const [id, node] of this.nodes) {
      const table = this.tables.get(id);
      const status = TABLE_STATUS[table?.status] ? table.status : 'available';
      const color = new THREE.Color(TABLE_STATUS[status].color);
      node.visible = !!table && table.active !== false;
      const ring = this.rings.get(id);
      ring.traverse((child) => {
        if (!child.isMesh) return;
        if (!child.userData.floor3dRingMaterial) {
          child.material = new THREE.MeshBasicMaterial({ color, toneMapped: false });
          child.userData.floor3dRingMaterial = true;
        }
        child.material.color.copy(color);
        child.material.color.multiplyScalar(this.selectedId === id ? 1.18 : this.hoveredId === id ? 1.08 : .94);
      });
      const label = this.labels.get(id);
      label.hidden = !node.visible;
      label.dataset.status = status;
      label.classList.toggle('is-selected', this.selectedId === id);
      label.setAttribute('aria-label', `Table ${table?.name || node.userData.tableId}, ${TABLE_STATUS[status].label}${table?.detail ? ', ' + table.detail : ''}`);
    }
    this.positionLabels();
    this.render();
  }

  setTableState(id, status) {
    const key = String(id).toLowerCase();
    const table = this.tables.get(key);
    if (table) this.setTables([...this.tables.values()].map((row) => String(row.id).toLowerCase() === key ? { ...row, status } : row));
  }

  selectTable(id) {
    const key = String(id).toLowerCase();
    if (!this.tables.get(key)?.active || !this.nodes.has(key)) return;
    this.selectedId = key;
    this.setTables([...this.tables.values()]);
    this.onSelect(key);
  }

  showTooltip(id, anchor) {
    if (!this.tables.has(id)) return;
    this.hoveredId = id;
    const table = this.tables.get(id);
    const status = TABLE_STATUS[table.status] || TABLE_STATUS.available;
    this.tooltip.textContent = `${table.name || id.toUpperCase()} · ${status.label}${table.detail ? ' · ' + table.detail : ''}`;
    this.tooltip.style.left = anchor.style.left;
    this.tooltip.style.top = anchor.style.top;
    this.tooltip.classList.add('is-visible');
    this.setTables([...this.tables.values()]);
  }

  hideTooltip() {
    this.hoveredId = null;
    this.tooltip?.classList.remove('is-visible');
    this.setTables([...this.tables.values()]);
  }

  raycast(event) {
    const bounds = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set((event.clientX - bounds.left) / bounds.width * 2 - 1,
      -(event.clientY - bounds.top) / bounds.height * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return this.raycaster.intersectObjects(this.hitboxes, false).find((hit) => hit.object.parent?.visible)?.object.userData.tableKey || null;
  }

  onPointerDown = (event) => { this.pointerDown = { x: event.clientX, y: event.clientY }; };
  onPointerMove = (event) => {
    if (event.pointerType === 'touch') return;
    const id = this.raycast(event);
    this.renderer.domElement.style.cursor = id ? 'pointer' : 'default';
    if (id === this.hoveredId) return;
    if (id) this.showTooltip(id, this.labels.get(id));
    else this.hideTooltip();
  };
  onPointerUp = (event) => {
    if (!this.pointerDown) return;
    const moved = Math.hypot(event.clientX - this.pointerDown.x, event.clientY - this.pointerDown.y);
    this.pointerDown = null;
    if (moved > 10) return;
    const id = this.raycast(event);
    if (id) this.selectTable(id);
  };
  onPointerLeave = () => { this.pointerDown = null; this.hideTooltip(); };
  onVisibility = () => { if (document.visibilityState === 'visible') this.render(); };

  render() {
    if (!this.renderer || document.visibilityState === 'hidden' || this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.renderer.render(this.scene, this.camera);
    });
  }

  destroy() {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.resizeObserver?.disconnect();
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.renderer?.domElement.removeEventListener('pointerdown', this.onPointerDown);
    this.renderer?.domElement.removeEventListener('pointermove', this.onPointerMove);
    this.renderer?.domElement.removeEventListener('pointerup', this.onPointerUp);
    this.renderer?.domElement.removeEventListener('pointerleave', this.onPointerLeave);
    const geometries = new Set(), materials = new Set(), textures = new Set();
    this.model?.traverse((object) => {
      if (!object.isMesh) return;
      geometries.add(object.geometry);
      for (const material of (Array.isArray(object.material) ? object.material : [object.material])) {
        materials.add(material);
        if (material?.map) textures.add(material.map);
      }
    });
    textures.forEach((texture) => texture.dispose());
    materials.forEach((material) => material?.dispose());
    geometries.forEach((geometry) => geometry.dispose());
    this.renderer?.dispose();
    this.renderer?.domElement.remove();
    this.labelLayer?.remove();
    this.tooltip?.remove();
    this.loading?.remove();
    this.container.classList.remove('three-floor', 'three-floor--ready');
    this.ready = false;
  }
}

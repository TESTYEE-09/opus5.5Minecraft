// Keyboard / mouse input with pointer lock. Keys are remappable via settings.
export const DEFAULT_KEYS = {
  forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD', jump: 'Space', sneak: 'ShiftLeft', sprint: 'ControlLeft',
  inventory: 'KeyE', drop: 'KeyQ', chat: 'KeyT', command: 'Slash', perspective: 'F5', hud: 'F1', screenshot: 'F2',
  debug: 'F3', players: 'Tab', photo: 'KeyP', reload: 'KeyR',
};

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set();     // pressed this frame
    this.mouse = { dx: 0, dy: 0, left: false, right: false, middle: false, leftDown: false, rightDown: false, middleDown: false, wheel: 0 };
    this.locked = false;
    this.binds = { ...DEFAULT_KEYS };
    this.sensitivity = 1;
    this.invertY = false;
    this.enabled = true;
    this.onLockChange = null;
    this.textFocus = () => document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA');

    window.addEventListener('keydown', (e) => {
      if (this.textFocus()) return;
      if (['Tab', 'F1', 'F2', 'F3', 'F5', 'Space', 'Slash'].includes(e.code) || (e.code.startsWith('Arrow'))) e.preventDefault();
      if (e.ctrlKey && ['KeyW', 'KeyS', 'KeyD', 'KeyA'].includes(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => { this.keys.delete(e.code); });
    window.addEventListener('blur', () => { this.keys.clear(); this.mouse.left = this.mouse.right = this.mouse.middle = false; });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      // clamp spikes some browsers produce when locking
      const dx = Math.abs(e.movementX) > 400 ? 0 : e.movementX, dy = Math.abs(e.movementY) > 400 ? 0 : e.movementY;
      this.mouse.dx += dx; this.mouse.dy += dy;
    });
    canvas.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      e.preventDefault();
      if (e.button === 0) { this.mouse.left = true; this.mouse.leftDown = true; }
      if (e.button === 2) { this.mouse.right = true; this.mouse.rightDown = true; }
      if (e.button === 1) { this.mouse.middle = true; this.mouse.middleDown = true; }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
      if (e.button === 1) this.mouse.middle = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('wheel', (e) => { if (this.locked) this.mouse.wheel += Math.sign(e.deltaY); }, { passive: true });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked) { this.keys.clear(); this.mouse.left = this.mouse.right = false; }
      if (this.onLockChange) this.onLockChange(this.locked);
    });
  }
  lock() {
    if (this.locked) return;
    try {
      const p = this.canvas.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) p.catch(() => { try { this.canvas.requestPointerLock(); } catch (e) { /* ignore */ } });
    } catch (e) { try { this.canvas.requestPointerLock(); } catch (e2) { /* ignore */ } }
  }
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }
  down(action) { return this.keys.has(this.binds[action]) || (action === 'sneak' && this.keys.has('ShiftRight')) || (action === 'sprint' && this.keys.has('ControlRight')); }
  hit(action) { return this.pressed.has(this.binds[action]); }
  hitCode(code) { return this.pressed.has(code); }
  endFrame() {
    this.pressed.clear();
    this.mouse.dx = 0; this.mouse.dy = 0; this.mouse.wheel = 0;
    this.mouse.leftDown = this.mouse.rightDown = this.mouse.middleDown = false;
  }
}

const PINCH_SQUINT_ON = .48;
const PINCH_SQUINT_OFF = .34;
const PINCH_SURPRISE_SECONDS = .36;

window.MaxFacePinch = class {
  constructor(canvas, portrait, source, {
    onStart = () => {}, onEnd = () => {}, hitBounds = () => portrait.getBoundingClientRect(),
  } = {}) {
    this.canvas = canvas;
    this.portrait = portrait;
    this.source = source;
    this.onStart = onStart;
    this.onEnd = onEnd;
    this.hitBounds = hitBounds;
    this.ctx = canvas.getContext('2d');
    this.surface = document.createElement('canvas');
    this.surface.width = source.width;
    this.surface.height = source.height;
    this.surfaceContext = this.surface.getContext('2d');
    this.output = this.surfaceContext.createImageData(source.width, source.height);
    this.expressions = window.MaxPinchExpressions ? new window.MaxPinchExpressions(source) : null;
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)');
    this.ready = false;
    this.characterName = 'Claire';
    this.chinY = .724;
    this.busy = false;
    this.held = false;
    this.pointerId = null;
    this.raf = 0;
    this.lastTime = 0;
    this.releaseTimer = 0;
    this.elapsed = 0;
    this.peakPull = 0;
    this.reaction = 'neutral';
    this.p = { ax: 0, ay: 0, rx: source.width * .25, ry: source.height * .20, x: 0, y: 0, vx: 0, vy: 0, followHead: true };
    this.buttons = [...document.querySelectorAll('[data-pinch]')];
    this.buttons.forEach(button => button.addEventListener('click', () => this.preset(button.dataset.pinch)));
    for (const [event, method] of Object.entries({
      pointerdown: 'down', pointermove: 'move', pointerup: 'up',
      pointercancel: 'up', lostpointercapture: 'up',
    })) {
      portrait.addEventListener(event, input => this[method](input), { capture: true });
    }
    portrait.addEventListener('keydown', event => {
      if (event.key === 'Escape') this.reset();
    });
    window.addEventListener('blur', () => this.reset());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.reset();
    });
    this.reduced.addEventListener('change', () => {
      if (this.reduced.matches) this.reset();
    });
    this.status('idle');
  }

  loadExpressions(atlas, { registered = false } = {}) {
    delete this.canvas.dataset.reactionsReady;
    if (!this.expressions) return;
    const neutral = document.createElement('canvas');
    neutral.width = this.source.width;
    neutral.height = this.source.height;
    neutral.getContext('2d').drawImage(this.source, 0, 0);
    if (this.expressions.prepare(atlas, neutral, { registered })) {
      this.canvas.dataset.reactionsReady = 'true';
      this.draw();
    }
  }

  frameChanged() {
    this.ready = true;
    this.pixels = this.source.getContext('2d', { willReadFrequently: true })
      .getImageData(0, 0, this.source.width, this.source.height);
    this.buttons.forEach(button => { button.disabled = false; });
    this.draw();
  }

  coordinates(event) {
    const bounds = this.hitBounds();
    return {
      x: (event.clientX - bounds.left) / bounds.width * this.source.width,
      y: (event.clientY - bounds.top) / bounds.height * this.source.height,
    };
  }

  hit(point) {
    const { width, height } = this.source;
    const areas = [
      { x: .55, y: this.chinY, rx: .137, ry: .071, side: 'chin' },
      { x: .405, y: .591, rx: .134, ry: .116, side: 'left' },
      { x: .705, y: .591, rx: .134, ry: .116, side: 'right' },
    ];
    return areas.find(area =>
      ((point.x / width - area.x) / area.rx) ** 2 +
      ((point.y / height - area.y) / area.ry) ** 2 <= 1);
  }

  status(value) {
    this.canvas.dataset.pinchState = value;
    this.canvas.dataset.pinchX = this.p.x.toFixed(3);
    this.canvas.dataset.pinchY = this.p.y.toFixed(3);
    this.canvas.dataset.pinchReaction = this.reaction;
    this.portrait.classList.toggle('pinching', value === 'grabbed');
    this.canvas.dataset.interaction = 'gaze-v1-with-expressive-pinch';
  }

  anchor(point, side) {
    this.side = side;
    this.p.chin = side === 'chin';
    this.p.ax = point.x;
    this.p.ay = point.y;
    this.p.rx = this.source.width * (side === 'chin' ? .26 : .25);
    this.p.ry = this.source.height * (side === 'chin' ? .25 : .20);
    this.p.x = this.p.y = 0;
  }

  down(event) {
    if (!this.ready || event.button > 0 || event.isPrimary === false) return;
    if (this.pointerId !== null) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    const point = this.coordinates(event);
    const area = this.hit(point);
    if (!area) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    clearTimeout(this.releaseTimer);
    this.onStart();
    if (!this.busy || this.side !== area.side) this.anchor(point, area.side);
    this.start = { x: point.x, y: point.y, dx: this.p.x, dy: this.p.y };
    this.p.vx = this.p.vy = 0;
    this.elapsed = this.lastTime = this.peakPull = 0;
    this.held = this.busy = true;
    this.pointerId = event.pointerId;
    this.portrait.setPointerCapture(event.pointerId);
    this.reaction = 'surprise';
    document.querySelector('#feedback').textContent = '輕輕拉，放手就會彈回來。';
    this.draw();
    this.wake();
  }

  move(event) {
    if (event.pointerId !== this.pointerId) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const point = this.coordinates(event);
    const displacement = MaxPinchMath.limit(
      point.x - this.start.x + this.start.dx,
      point.y - this.start.y + this.start.dy,
      this.p.rx, this.p.ry
    );
    this.p.x = displacement.x;
    this.p.y = displacement.y;
    this.peakPull = Math.max(this.peakPull, this.pull());
    this.updateHeldReaction();
    if (!this.raf) this.lastTime = 0;
    this.draw();
    this.wake();
  }

  up(event) {
    if (event.pointerId !== this.pointerId) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.pointerId = null;
    this.release();
  }

  release() {
    this.held = false;
    if (this.reduced.matches) {
      this.reset();
      return;
    }
    this.elapsed = this.lastTime = 0;
    this.draw();
    this.wake();
  }

  preset(side) {
    if (!this.ready) return;
    this.reset(false);
    this.onStart();
    const { width, height } = this.source;
    const isChin = side === 'chin';
    this.anchor({ x: width * (isChin ? .55 : side === 'left' ? .405 : .705),
      y: height * (isChin ? this.chinY : .595) }, side);
    this.p.x = isChin ? 0 : this.p.rx * (side === 'left' ? -.38 : .38);
    this.p.y = this.p.ry * (isChin ? .38 : -.07);
    this.peakPull = this.pull();
    this.busy = this.held = true;
    this.reaction = 'surprise';
    if (this.reduced.matches) this.updateHeldReaction();
    this.draw();
    document.querySelector('#feedback').textContent = `輕拉一下，${this.characterName} 有反應了。`;
    this.wake();
    this.releaseTimer = setTimeout(() => this.release(), this.reduced.matches ? 450 : 420);
  }

  pull() {
    return Math.min(1, Math.hypot(this.p.x / this.p.rx, this.p.y / this.p.ry) / .42);
  }

  updateHeldReaction() {
    // Preset buttons show the grab reaction briefly before their preset pull.
    if (this.pointerId === null && this.elapsed < .10 && !this.reduced.matches) return;
    const threshold = this.reaction === 'squint' ? PINCH_SQUINT_OFF : PINCH_SQUINT_ON;
    if (this.pull() >= threshold) {
      this.reaction = 'squint';
    } else {
      this.reaction = this.elapsed < PINCH_SURPRISE_SECONDS ? 'surprise' : 'neutral';
    }
  }

  wake() {
    if (!this.raf && this.busy && !document.hidden && !this.reduced.matches) {
      this.raf = requestAnimationFrame(time => this.tick(time));
    }
  }

  tick(now) {
    this.raf = 0;
    if (!this.busy || document.hidden) return;
    const delta = this.lastTime ? Math.min((now - this.lastTime) / 1000, .06) : 1 / 60;
    this.lastTime = now;
    this.elapsed += delta;
    if (this.held) {
      this.updateHeldReaction();
      this.draw();
      if (this.elapsed < PINCH_SURPRISE_SECONDS) this.wake();
      return;
    }

    MaxPinchMath.spring(this.p, delta);
    const strongPull = this.peakPull >= PINCH_SQUINT_ON;
    const reactionEnd = strongPull ? .68 : .16;
    if (this.elapsed >= reactionEnd) {
      this.reaction = 'neutral';
    } else if (strongPull && this.elapsed >= .19) {
      this.reaction = 'pout';
    }
    if (this.p.x === 0 && this.p.y === 0 && this.elapsed >= reactionEnd) {
      this.reset();
      return;
    }
    this.draw();
    this.wake();
  }

  draw() {
    if (!this.ready) return;
    const pixels = this.expressions?.compose(this.pixels, this.reaction) ?? this.pixels;
    if (this.p.x === 0 && this.p.y === 0 && pixels === this.pixels) {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.ctx.drawImage(this.source, 0, 0, this.canvas.width, this.canvas.height);
    } else {
      MaxPinchMath.warp(pixels, this.source.width, this.source.height, this.p, this.output);
      this.surfaceContext.putImageData(this.output, 0, 0);
      this.ctx.drawImage(this.surface, 0, 0, this.canvas.width, this.canvas.height);
    }
    this.status(this.held ? 'grabbed' : this.busy ? 'returning' : 'idle');
  }

  reset(notify = true) {
    const wasBusy = this.busy;
    const pointerId = this.pointerId;
    this.pointerId = null;
    this.held = this.busy = false;
    clearTimeout(this.releaseTimer);
    cancelAnimationFrame(this.raf);
    this.raf = this.lastTime = this.elapsed = 0;
    this.p.x = this.p.y = this.p.vx = this.p.vy = 0;
    this.reaction = 'neutral';
    this.draw();
    this.status('idle');
    if (pointerId !== null && this.portrait.hasPointerCapture(pointerId)) {
      this.portrait.releasePointerCapture(pointerId);
    }
    if (wasBusy && notify) {
      document.querySelector('#feedback').textContent = '回來了。也可以再輕捏另一邊。';
      this.onEnd();
    }
  }
};

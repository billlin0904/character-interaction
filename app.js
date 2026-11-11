(() => {
  'use strict';
  const $ = s => document.querySelector(s);
  const canvas = $('#canvas'), source = document.createElement('canvas');
  source.width=296; source.height=370;
  const frames = new MaxCircleFrames(source);
  const portrait = $('#portrait'), label = $('#mode-label'), artwork = $('#portrait-art');
  const loading = $('#loading'), imageError = $('#image-error'), smileButton = $('#smile');
  const characterStatus = $('#character-status'), feedback = $('#feedback');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const modes = [...document.querySelectorAll('[data-mode]')];
  const expressions = [...document.querySelectorAll('[data-expression]')];
  const characterButtons = [...document.querySelectorAll('button[data-character]')];
  const characterNames = document.querySelectorAll('[data-character-name]');
  const characters = {
    bill: {
      name: 'Bill',
      artwork: 'assets/bill-circle.png',
      atlas: 'assets/bill-atlas.png',
      reactions: 'assets/bill-pinch-reactions.png',
      mouth: 'assets/bill-open-smile.png',
      geometry: {
        crop: { x: .102, y: .052, width: .716, height: .895 },
        squareAtlas: true,
        smileOrigin: { x: 510 / 1254, y: 735 / 1254 },
      },
      eyeLine: .458, mouthX: .575, chinY: .79, registeredReactions: true,
    },
    claire: {
      name: 'Claire',
      artwork: 'assets/max-circle.png',
      atlas: 'assets/max-atlas.png',
      reactions: 'assets/max-pinch-reactions.png',
      mouth: 'assets/max-open-smile.png',
      eyeLine: .445, mouthX: .555, chinY: .724,
    },
  };
  const characterAssets = new Map();
  let atlas, character = characters.bill, activeCharacter, pendingCharacter;
  let requestedCharacter = 'bill', loadVersion = 0;
  let ready = false, mode = reduced.matches ? 'paused' : 'follow';
  let gaze = 4, frame = 4, expression = 4, overrideUntil = 0;
  let blinkUntil = 0, nextBlink = Infinity, nextDemo = 0, raf = 0;
  let bounds, faceBounds, cursor, lastInput = 0, gazePointerId = null;
  let mouthSmileReady = false, paintedMouthSmile = false;
  const demoOrder = [4, 3, 0, 1, 2, 5, 8, 7, 6, 4, 10, 11];
  let demoIndex = 0;
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const hitBounds = () => (portrait.classList.contains('circle-ready') ? canvas : portrait).getBoundingClientRect();
  const pinch = new MaxFacePinch(canvas, portrait, source, {
    onStart: () => paint(frame, false),
    onEnd: () => { lastInput = performance.now(); resetBlink(); wake(); },
    hitBounds,
  });
  const measure = () => {
    bounds = portrait.getBoundingClientRect();
    faceBounds = hitBounds();
  };
  function isMouthHovered() {
    if (mode !== 'follow' || !mouthSmileReady || !portrait.classList.contains('circle-ready') ||
        !cursor || !faceBounds?.width || !faceBounds.height) return false;
    const x = (cursor.x - faceBounds.left) / faceBounds.width;
    const y = (cursor.y - faceBounds.top) / faceBounds.height;
    return ((x - character.mouthX) / .11) ** 2 + ((y - .665) / .038) ** 2 <= 1;
  }
  function paint(index, mouthSmile = isMouthHovered()) {
    if (!ready || pinch.busy || index === frame && mouthSmile === paintedMouthSmile && canvas.dataset.drawn) return;
    frames.paint(atlas, index, { mouthSmile });
    frame = index;
    paintedMouthSmile = mouthSmile;
    canvas.dataset.frame = String(index);
    canvas.dataset.mouthSmile = String(mouthSmile);
    canvas.dataset.drawn = 'true';
    pinch.frameChanged();
  }
  function resetBlink() { blinkUntil = 0; nextBlink = performance.now() + 3800 + Math.random() * 2700; }
  function updateModeUI() {
    modes.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
    label.textContent = !ready ? '正在載入肖像' : mode === 'follow' ? '目光跟隨中' : mode === 'demo' ? '自動展示中' : '已暫停';
    portrait.dataset.mode = mode;
  }
  function tick(now) {
    raf = 0;
    if (!ready || document.hidden) return;
    if (pinch.busy) { if (mode !== 'paused') raf=requestAnimationFrame(tick); return; }
    if (mode === 'demo' && now >= nextDemo && now >= overrideUntil) {
      gaze = demoOrder[demoIndex++ % demoOrder.length]; nextDemo = now + 1000;
    }
    if (mode === 'follow' && now - lastInput > 2400 && now >= overrideUntil) gaze = 4;
    if (mode !== 'paused' && !reduced.matches && now >= nextBlink && now >= overrideUntil) {
      blinkUntil = now + 125; nextBlink = now + 4000 + Math.random() * 2600;
    }
    paint(mode === 'paused' ? frame : now < overrideUntil ? expression : now < blinkUntil ? 9 : gaze);
    if (mode !== 'paused') raf = requestAnimationFrame(tick);
  }
  function wake() { if (!raf && ready && !document.hidden) raf = requestAnimationFrame(tick); }
  function setMode(value) {
    mode = value; overrideUntil = 0; blinkUntil = 0;
    if (mode !== 'paused') { gaze = 4; lastInput = performance.now(); resetBlink(); }
    if (mode === 'demo') { nextDemo = 0; demoIndex = 0; }
    updateModeUI();
    if (mode === 'paused') { paint(frame, false); cancelAnimationFrame(raf); raf = 0; }
    else wake();
  }
  function chooseGaze(index) {
    if (!ready) return;
    gaze = index; lastInput = performance.now(); overrideUntil = 0; blinkUntil = 0;
    if (mode === 'demo') setMode('follow');
    gaze = index;
    paint(index); wake();
  }
  function pointAt(x, y) {
    if (!ready || pinch.busy || mode !== 'follow') return;
    if (!bounds) measure();
    const dx = (x - (bounds.left + bounds.width * .5)) / (bounds.width * .7);
    const dy = (y - (bounds.top + bounds.height * character.eyeLine)) / (bounds.height * .6);
    const col = clamp(Math.round(dx * 1.5), -1, 1) + 1;
    const row = clamp(Math.round(dy * 1.5), -1, 1) + 1;
    const index = row * 3 + col;
    lastInput = performance.now();
    // Reduced motion allows deliberate single-frame changes, without timers or parallax.
    gaze = index; wake();
  }
  function showExpression(index) {
    if (!ready) return;
    expression = index; blinkUntil = 0;
    overrideUntil = performance.now() + (index === 9 ? 700 : 2200);
    expressions.forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.expression === index)));
    feedback.textContent = ({4:'平靜地看著你。',10:'收到，一個微笑送給你。',11:'嗯？有什麼新鮮事嗎？',9:'閉上眼，讓這一刻慢一點。'})[index];
    paint(index); resetBlink(); wake();
  }
  modes.forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
  expressions.forEach(b => b.addEventListener('click', () => { showExpression(+b.dataset.expression); }));
  document.querySelectorAll('[data-gaze]').forEach(b => b.addEventListener('click', () => chooseGaze(+b.dataset.gaze)));
  smileButton.addEventListener('click', () => showExpression(10));
  document.addEventListener('pointermove', e => {
    if (e.pointerType !== 'mouse') return;
    cursor = { x: e.clientX, y: e.clientY };
    pointAt(e.clientX, e.clientY);
  }, { capture: true, passive: true });
  function clearCursor() { cursor = null; wake(); }
  window.addEventListener('pointerout', e => { if (e.relatedTarget === null) clearCursor(); });
  window.addEventListener('blur', clearCursor);
  portrait.addEventListener('pointerdown', e => {
    if (!ready || pinch.busy || e.pointerType === 'mouse' || gazePointerId !== null) return;
    gazePointerId = e.pointerId;
    portrait.setPointerCapture(e.pointerId);
    pointAt(e.clientX, e.clientY);
  });
  portrait.addEventListener('pointermove', e => { if (e.pointerId === gazePointerId) pointAt(e.clientX, e.clientY); }, {passive:true});
  const release = e => { if (e.pointerId === gazePointerId) gazePointerId = null; };
  portrait.addEventListener('pointerup', release);
  portrait.addEventListener('pointercancel', release);
  portrait.addEventListener('lostpointercapture', release);
  portrait.addEventListener('keydown', e => {
    const delta = {ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[e.key];
    if (delta) { e.preventDefault(); chooseGaze(clamp(gaze % 3 + delta[0],0,2) + clamp(Math.floor(Math.min(gaze,8)/3)+delta[1],0,2)*3); }
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showExpression(10); }
    if (e.key === 'Escape') setMode('paused');
    if (e.key === 'Home') { e.preventDefault(); chooseGaze(4); }
  });
  window.addEventListener('resize', measure, {passive:true});
  window.addEventListener('scroll', measure, {passive:true});
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { clearCursor(); cancelAnimationFrame(raf); raf = 0; }
    else { resetBlink(); wake(); }
  });
  reduced.addEventListener('change', () => { if (reduced.matches) setMode('paused'); });
  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        if (image.decode) image.decode().then(() => resolve(image), reject);
        else resolve(image);
      };
      image.onerror = reject;
      image.src = url;
    });
  }

  function loadAssets(key) {
    if (!characterAssets.has(key)) {
      const { artwork, atlas, reactions, mouth } = characters[key];
      const assets = Promise.all([artwork, atlas, reactions, mouth].map(loadImage)).catch(error => {
        characterAssets.delete(key);
        throw error;
      });
      characterAssets.set(key, assets);
    }
    return characterAssets.get(key);
  }

  function activateCharacter(key, [portraitImage, atlasImage, reactions, mouth]) {
    cancelAnimationFrame(raf);
    raf = 0;
    pinch.reset(false);
    if (gazePointerId !== null && portrait.hasPointerCapture(gazePointerId)) {
      portrait.releasePointerCapture(gazePointerId);
    }
    gazePointerId = null;
    cursor = null;
    gaze = frame = expression = 4;
    overrideUntil = nextDemo = demoIndex = 0;
    lastInput = performance.now();
    paintedMouthSmile = false;
    delete canvas.dataset.drawn;

    character = characters[key];
    atlas = atlasImage;
    frames.setArtwork(portraitImage, character.geometry);
    mouthSmileReady = frames.setMouthSmile(mouth);
    canvas.dataset.mouthSmileReady = String(mouthSmileReady);
    artwork.src = portraitImage.src;
    portrait.dataset.character = key;
    portrait.classList.add('circle-ready');
    pinch.characterName = character.name;
    pinch.chinY = character.chinY;
    portrait.setAttribute('aria-label', `${character.name} 互動肖像`);
    canvas.setAttribute('aria-label', `${character.name} 的正面肖像，目光會回應你的操作`);
    smileButton.setAttribute('aria-label', `讓 ${character.name} 微笑`);
    characterNames.forEach(node => { node.textContent = character.name; });
    characterButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.character === key)));
    expressions.forEach(button => button.setAttribute('aria-pressed', String(+button.dataset.expression === 4)));
    feedback.textContent = '';
    activeCharacter = key;
    ready = true;
    paint(4, false);
    pinch.loadExpressions(reactions, { registered: character.registeredReactions });
    measure();
    resetBlink();
    updateModeUI();
    wake();
  }

  async function selectCharacter(key) {
    if (!Object.hasOwn(characters, key) || pendingCharacter === key) return;
    requestedCharacter = key;
    const version = ++loadVersion;
    const name = characters[key].name;
    pendingCharacter = null;
    imageError.hidden = true;
    if (activeCharacter === key) {
      loading.hidden = true;
      characterStatus.textContent = `${name} 已就緒`;
      return;
    }
    pendingCharacter = key;
    loading.hidden = !!activeCharacter;
    characterStatus.textContent = `正在載入 ${name}`;
    try {
      const assets = await loadAssets(key);
      if (version !== loadVersion) return;
      activateCharacter(key, assets);
      loading.hidden = true;
      characterStatus.textContent = `${name} 已就緒`;
    } catch {
      if (version !== loadVersion) return;
      characterAssets.delete(key);
      loading.hidden = true;
      imageError.hidden = false;
      characterStatus.textContent = `${name} 的肖像尚未載入，請再試一次`;
      if (!ready) label.textContent = '等待重新連線';
    } finally {
      if (version === loadVersion) pendingCharacter = null;
    }
  }

  characterButtons.forEach(button => button.addEventListener('click', () => selectCharacter(button.dataset.character)));
  $('#retry').addEventListener('click', () => selectCharacter(requestedCharacter));
  updateModeUI();
  selectCharacter(requestedCharacter);
})();

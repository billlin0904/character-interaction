(() => {
  'use strict';

  const ARTWORK_CROP = { x: .203, y: .086, width: .571, height: .714 };
  // The mouth asset is a crop from a matching 1254 × 1254 portrait.
  const SMILE_ORIGIN = { x: 520 / 1254, y: 630 / 1254 };
  const OPEN_SMILE = { left: 128, top: 229, right: 203, bottom: 264, feather: 10 };
  const SMILE_CROP_FEATHER = 5;
  const BILL_ATLAS_CROP = { x: .032, y: .033, width: .834, height: .998 };
  const BILL_FEATURES = [
    { left: 109, top: 162, right: 151, bottom: 179, feather: 4 },
    { left: 185, top: 161, right: 226, bottom: 179, feather: 4 },
    { left: 133, top: 231, right: 207, bottom: 262, feather: 8 },
  ];
  const FEATURES = [
    { left: 108, top: 156, right: 152, bottom: 181, feather: 7 },
    { left: 180, top: 155, right: 225, bottom: 180, feather: 7 },
    { left: 132, top: 232, right: 197, bottom: 260, feather: 9 },
  ];

  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const smoothstep = value => {
    const t = clamp(value, 0, 1);
    return t * t * (3 - 2 * t);
  };

  function paintAtlas(context, atlas, index, width, height, squareAtlas) {
    const tileWidth = atlas.naturalWidth / 3;
    const tileHeight = atlas.naturalHeight / 4;
    context.clearRect(0, 0, width, height);
    if (squareAtlas) {
      // The Bill contact sheet is registered by the lens and lip positions,
      // while the original Claire atlas already uses the canonical framing.
      const crop = BILL_ATLAS_CROP;
      const scaleX = width / crop.width, scaleY = height / crop.height;
      context.drawImage(atlas, (index % 3) * tileWidth, Math.floor(index / 3) * tileHeight,
        tileWidth, tileHeight, -crop.x * scaleX, -crop.y * scaleY, scaleX, scaleY);
      return;
    }
    const cropHeight = Math.min(tileHeight, tileWidth * height / width);
    context.drawImage(atlas,
      (index % 3) * tileWidth,
      Math.floor(index / 3) * tileHeight + (tileHeight - cropHeight) * .2,
      tileWidth, cropHeight, 0, 0, width, height);
  }

  function prepareFeature(feature, width, height) {
    const { left, top, right, bottom, feather } = feature;
    const pixels = [];
    const samples = [];
    for (let y = Math.max(0, Math.floor((top - feather) * height / 370));
         y < Math.min(height, Math.ceil((bottom + feather) * height / 370)); y++) {
      for (let x = Math.max(0, Math.floor((left - feather) * width / 296));
           x < Math.min(width, Math.ceil((right + feather) * width / 296)); x++) {
        const px = (x + .5) * 296 / width, py = (y + .5) * 370 / height;
        const distance = Math.hypot(Math.max(left - px, 0, px - right),
          Math.max(top - py, 0, py - bottom));
        const opacity = smoothstep(1 - distance / feather);
        const offset = (y * width + x) * 4;
        if (opacity > 0) pixels.push({ offset, opacity });
        if (opacity > .05 && opacity < .5) samples.push(offset);
      }
    }
    return { pixels, samples };
  }

  function matchSkin(base, donor, samples) {
    const sums = [0, 0, 0];
    let count = 0;
    for (const i of samples) {
      // Brightness and red/blue separation exclude hair, lashes and eye whites.
      if (donor[i + 3] !== 255 || base[i] < 140 || donor[i] < 140 ||
          base[i] - base[i + 2] < 18 || donor[i] - donor[i + 2] < 18) continue;
      count++;
      for (let c = 0; c < 3; c++) sums[c] += base[i + c] - donor[i + c];
    }
    return sums.map(sum => count >= 12 ? clamp(sum / count, -24, 24) : 0);
  }

  function replaceFeature(output, base, donor, { pixels, samples }) {
    const offsets = matchSkin(base, donor, samples);
    for (const { offset, opacity } of pixels) {
      const weight = opacity * donor[offset + 3] / 255;
      for (let c = 0; c < 3; c++) {
        const i = offset + c;
        output[i] = base[i] + (donor[i] + offsets[c] - base[i]) * weight;
      }
    }
  }

  class MaxCircleFrames {
    constructor(source) {
      this.width = source.width;
      this.height = source.height;
      this.context = source.getContext('2d', { willReadFrequently: true });
      const layer = document.createElement('canvas');
      layer.width = this.width;
      layer.height = this.height;
      this.layer = layer.getContext('2d', { willReadFrequently: true });
      this.features = FEATURES.map(feature => prepareFeature(feature, this.width, this.height));
      this.openSmileFeature = prepareFeature(OPEN_SMILE, this.width, this.height);
      this.base = null;
      this.mouthSmile = null;
      this.frames = new Map();
      this.atlas = null;
    }

    setArtwork(image, geometry = {}) {
      const width = image?.naturalWidth;
      const height = image?.naturalHeight;
      this.frames.clear();
      this.base = null;
      this.mouthSmile = null;
      this.geometry = geometry;
      const featureShapes = geometry.squareAtlas ? BILL_FEATURES : FEATURES;
      this.features = featureShapes.map(feature => prepareFeature(feature, this.width, this.height));
      const smileShape = geometry.squareAtlas
        ? { left: 132, top: 228, right: 207, bottom: 263, feather: 8 }
        : OPEN_SMILE;
      this.openSmileFeature = prepareFeature(smileShape, this.width, this.height);
      if (!width || !height) return;
      const crop = geometry.crop ?? ARTWORK_CROP;
      this.layer.clearRect(0, 0, this.width, this.height);
      this.layer.drawImage(image, width * crop.x, height * crop.y,
        width * crop.width, height * crop.height, 0, 0, this.width, this.height);
      this.base = this.layer.getImageData(0, 0, this.width, this.height);
    }

    setMouthSmile(image) {
      if (!image?.naturalWidth || !image?.naturalHeight) return false;
      const crop = this.geometry?.crop ?? ARTWORK_CROP;
      const origin = this.geometry?.smileOrigin ?? SMILE_ORIGIN;
      const scaleX = this.width / crop.width, scaleY = this.height / crop.height;
      const left = (origin.x - crop.x) * scaleX;
      const top = (origin.y - crop.y) * scaleY;
      const width = image.naturalWidth / 1254 * scaleX;
      const height = image.naturalHeight / 1254 * scaleY;
      this.layer.clearRect(0, 0, this.width, this.height);
      this.layer.drawImage(image, left, top, width, height);
      this.mouthSmile = this.layer.getImageData(0, 0, this.width, this.height);
      // Fade in from the donor crop edge, even where the feature mask extends past it.
      const pixels = this.mouthSmile.data;
      for (const { offset } of this.openSmileFeature.pixels) {
        const index = offset / 4;
        const x = index % this.width + .5;
        const y = Math.floor(index / this.width) + .5;
        const distanceX = Math.min(x - left, left + width - x) * 296 / this.width;
        const distanceY = Math.min(y - top, top + height - y) * 370 / this.height;
        pixels[offset + 3] *= smoothstep(Math.min(distanceX, distanceY) / SMILE_CROP_FEATHER);
      }
      this.frames.clear();
      return true;
    }

    paint(atlas, index, { mouthSmile = false } = {}) {
      if (!this.base) {
        paintAtlas(this.context, atlas, index, this.width, this.height, this.geometry?.squareAtlas);
        return;
      }
      if (this.atlas !== atlas) {
        this.atlas = atlas;
        this.frames.clear();
      }
      const open = mouthSmile && !!this.mouthSmile;
      const frame = index === 4 && !open ? this.base : this.getFrame(atlas, index, open);
      this.context.putImageData(frame, 0, 0);
    }

    getFrame(atlas, index, mouthSmile) {
      const key = mouthSmile ? `smile:${index}` : index;
      if (this.frames.has(key)) return this.frames.get(key);
      const base = this.base.data;
      const frame = this.layer.createImageData(this.width, this.height);
      frame.data.set(base);
      if (index !== 4) {
        paintAtlas(this.layer, atlas, index, this.width, this.height, this.geometry?.squareAtlas);
        const donor = this.layer.getImageData(0, 0, this.width, this.height).data;
        const features = index === 10 && !mouthSmile ? this.features : this.features.slice(0, 2);
        for (const feature of features) replaceFeature(frame.data, base, donor, feature);
      }
      if (mouthSmile) replaceFeature(frame.data, base, this.mouthSmile.data, this.openSmileFeature);
      this.frames.set(key, frame);
      return frame;
    }
  }

  window.MaxCircleFrames = MaxCircleFrames;
})();

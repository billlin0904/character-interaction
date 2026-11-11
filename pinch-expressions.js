(() => {
  'use strict';

  const phases = ['surprise', 'squint', 'pout'];
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const smoothstep = value => {
    const t = clamp(value, 0, 1);
    return t * t * (3 - 2 * t);
  };

  // Normalized eye landmarks measured on the three generated expression tiles.
  const landmarks = {
    surprise: { x: .556, y: .400, span: .242 },
    squint: { x: .556, y: .422, span: .247 },
    pout: { x: .557, y: .421, span: .244 },
  };

  // Registration points in Bill's square donor tiles. Match the eye span
  // horizontally and the eye-to-mouth distance vertically.
  const billLandmarks = [
    { x: .512, eyes: .489, span: .203, mouth: .707 },
    { x: .499, eyes: .501, span: .201, mouth: .693 },
    { x: .512, eyes: .501, span: .205, mouth: .700 },
  ];
  const billFeatures = [
    [105, 138, 154, 152, 4], [181, 138, 231, 151, 4],
    [109, 162, 151, 180, 4], [185, 161, 226, 179, 4],
    [132, 227, 207, 265, 8],
  ];

  // Skin perimeter on the 296 × 370 portrait. Keep the full brows, eyes,
  // and mouth inside the opaque region and feather into the surrounding skin.
  const faceContour = [
    [114, 122, 213], [134, 103, 232], [152, 95, 238], [176, 90, 243],
    [203, 89, 242], [224, 97, 234], [249, 113, 220], [267, 126, 208],
    [281, 144, 188], [290, 158, 174],
  ];

  function faceMask(width, height) {
    const mask = new Float32Array(width * height);
    const firstRow = Math.floor(114 / 370 * height);
    const endRow = Math.ceil(290 / 370 * height);
    let segment = 0;
    for (let y = firstRow; y < endRow; y++) {
      const nativeY = y * 370 / height;
      while (nativeY > faceContour[segment + 1][0]) segment++;
      const [top, leftAtTop, rightAtTop] = faceContour[segment];
      const [bottom, leftAtBottom, rightAtBottom] = faceContour[segment + 1];
      const t = clamp((nativeY - top) / (bottom - top), 0, 1);
      const left = (leftAtTop + (leftAtBottom - leftAtTop) * t) * width / 296;
      const right = (rightAtTop + (rightAtBottom - rightAtTop) * t) * width / 296;
      const vertical = smoothstep((nativeY - 114) / 20) * smoothstep((290 - nativeY) / 13);
      const feather = 9 * width / 296;
      for (let x = Math.ceil(left); x < right; x++) {
        const distance = Math.min(x - left, right - x);
        mask[y * width + x] = smoothstep(distance / feather) * vertical;
      }
    }
    return { mask, firstPixel: firstRow * width, endPixel: endRow * width };
  }

  function billFaceMask(width, height) {
    const mask = new Float32Array(width * height);
    const firstRow = Math.floor(134 / 370 * height);
    const endRow = Math.ceil(273 / 370 * height);
    for (let y = firstRow; y < endRow; y++) {
      const py = (y + .5) * 370 / height;
      for (let x = 0; x < width; x++) {
        const px = (x + .5) * 296 / width;
        let opacity = 0;
        // Keep the rims of the spectacles from being overlaid by another rim.
        for (const [left, top, right, bottom, feather] of billFeatures) {
          const distance = Math.hypot(Math.max(left - px, 0, px - right),
            Math.max(top - py, 0, py - bottom));
          opacity = Math.max(opacity, smoothstep(1 - distance / feather));
        }
        mask[y * width + x] = opacity;
      }
    }
    return { mask, firstPixel: firstRow * width, endPixel: endRow * width };
  }

  function skinSamples(width, height) {
    const samples = [];
    for (let y = Math.round(height * .48); y < height * .66; y += 3) {
      for (let x = Math.round(width * .335); x < width * .77; x += 3) {
        samples.push({ x, y });
      }
    }
    return samples;
  }

  function skinToneOffsets(reference, donor, width, samples) {
    const difference = [0, 0, 0];
    let count = 0;
    for (const sample of samples) {
      const i = (sample.y * width + sample.x) * 4;
      // Exclude shadow, hair, and empty portions of an adjusted crop.
      if (reference[i] < 100 || donor[i] < 100 || donor[i + 3] !== 255 ||
          reference[i] - reference[i + 2] < 8 || donor[i] - donor[i + 2] < 8) continue;
      count++;
      for (let c = 0; c < 3; c++) difference[c] += reference[i + c] - donor[i + c];
    }
    return difference.map(sum => count > 15 ? clamp(sum / count, -17, 17) : 0);
  }

  class MaxPinchExpressions {
    constructor(source) {
      this.source = source;
      this.frames = null;
      this.output = null;
    }

    prepare(atlas, neutralFrame = this.source, { registered = false } = {}) {
      this.frames = null;
      const width = this.source.width, height = this.source.height;
      const imageWidth = atlas?.naturalWidth || atlas?.width;
      const imageHeight = atlas?.naturalHeight || atlas?.height;
      if (!imageWidth || !imageHeight || !width || !height ||
          neutralFrame?.width !== width || neutralFrame?.height !== height) return false;

      const neutral = neutralFrame.getContext('2d');
      const layer = document.createElement('canvas');
      layer.width = width;
      layer.height = height;
      const ctx = layer.getContext('2d', { willReadFrequently: true });
      if (!neutral || !ctx) return false;

      const reference = neutral.getImageData(0, 0, width, height).data;
      const samples = skinSamples(width, height);
      const pivotX = width * .5625;
      const pivotY = height * .453;
      const targetEyeSpan = width * .247;
      const tileWidth = imageWidth / 3;
      const frames = {};

      for (let i = 0; i < phases.length; i++) {
        const phase = phases[i];
        ctx.clearRect(0, 0, width, height);
        if (registered) {
          const points = billLandmarks[i];
          const drawWidth = width * .259 / points.span;
          const drawHeight = height * .209 / (points.mouth - points.eyes);
          ctx.drawImage(atlas, i * tileWidth, 0, tileWidth, imageHeight,
            width * .569 - points.x * drawWidth, height * .453 - points.eyes * drawHeight,
            drawWidth, drawHeight);
        } else {
          const eyes = landmarks[phase];
          const scale = targetEyeSpan / (tileWidth * eyes.span);
          const drawX = pivotX - tileWidth * eyes.x * scale;
          const drawY = pivotY - imageHeight * eyes.y * scale;
          ctx.drawImage(atlas, i * tileWidth, 0, tileWidth, imageHeight,
            drawX, drawY, tileWidth * scale, imageHeight * scale);
        }
        const pixels = ctx.getImageData(0, 0, width, height).data;
        const offsets = skinToneOffsets(reference, pixels, width, samples);
        for (let p = 0; p < pixels.length; p += 4) {
          for (let c = 0; c < 3; c++) pixels[p + c] += offsets[c];
        }
        frames[phase] = pixels;
      }

      const { mask, firstPixel, endPixel } = (registered ? billFaceMask : faceMask)(width, height);
      this.width = width;
      this.height = height;
      this.mask = mask;
      this.firstPixel = firstPixel;
      this.endPixel = endPixel;
      this.output = ctx.createImageData(width, height);
      this.frames = frames;
      return true;
    }

    // The returned ImageData is reused on the next call. Consume it immediately.
    compose(basePixels, phase) {
      if (!this.frames || !Object.hasOwn(this.frames, phase) || !basePixels ||
          basePixels.width !== this.width || basePixels.height !== this.height) return basePixels;
      const donor = this.frames[phase];
      const base = basePixels.data;
      // Allow the previously returned frame as a source without blending over our own reads.
      if (base === this.output.data) this.output = new ImageData(this.width, this.height);
      const output = this.output.data;
      output.set(base);
      for (let pixel = this.firstPixel; pixel < this.endPixel; pixel++) {
        const mask = this.mask[pixel];
        if (!mask) continue;
        const i = pixel * 4;
        const alpha = mask * donor[i + 3] / 255;
        for (let channel = 0; channel < 3; channel++) {
          const k = i + channel;
          output[k] = base[k] + (donor[k] - base[k]) * alpha;
        }
      }
      return this.output;
    }
  }

  window.MaxPinchExpressions = MaxPinchExpressions;
})();

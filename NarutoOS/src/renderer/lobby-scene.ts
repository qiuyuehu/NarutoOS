function hexToHsl(hex: string) {
  const value = parseInt(hex.slice(1), 16), r = ((value >> 16) & 255) / 255, g = ((value >> 8) & 255) / 255, b = (value & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  const s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
  const h = d ? ((max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60 + 360) % 360 : 0;
  const linear = (channel: number) => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
  return { h, s: s * 100, l: l * 100, y: .2126 * linear(r) + .7152 * linear(g) + .0722 * linear(b) };
}

export class LobbyScene {
  private visible = false;
  private artGeneration = 0;
  private artFrame = 0;
  private resizeFrame = 0;
  private renderedBackground = '';
  private ink = { color: '#302a24', alpha: .28 };
  private focusPoint = { x: .68, y: .24 };
  private artImage: HTMLImageElement | null = null;
  private pendingArtwork: HTMLImageElement | null = null;
  private readonly art: HTMLImageElement;
  private readonly dots: HTMLCanvasElement;
  private readonly lines: HTMLCanvasElement;

  constructor(private readonly root: HTMLElement) {
    this.art = root.querySelector<HTMLImageElement>('#lobby-character')!;
    this.dots = root.querySelector<HTMLCanvasElement>('#lobby-dots')!;
    this.lines = root.querySelector<HTMLCanvasElement>('#lobby-lines')!;
    window.addEventListener('resize', () => this.scheduleDraw());
  }

  show() {
    const wasVisible = this.visible;
    this.visible = true;
    if (!this.artImage && !this.pendingArtwork) this.loadArtwork();
    if (!wasVisible) this.scheduleDraw();
  }

  hide() {
    this.visible = false;
    this.artGeneration++;
    if (this.artFrame) cancelAnimationFrame(this.artFrame);
    if (this.resizeFrame) cancelAnimationFrame(this.resizeFrame);
    this.artFrame = this.resizeFrame = 0;
    this.cancelArtwork();
    this.artImage = null;
    this.art.removeAttribute('src');
    this.art.classList.remove('is-swapping');
    this.dots.width = this.dots.height = 1;
    this.lines.width = this.lines.height = 1;
  }

  setBackground(hex: string) {
    if (this.renderedBackground === hex) return false;
    this.renderedBackground = hex;
    const { h, s, l, y } = hexToHsl(hex), isDark = y < .28;
    this.root.dataset.tone = isDark ? 'dark' : 'light';
    this.root.style.setProperty('--bg-top', `hsl(${h},${s}%,${Math.min(l + (isDark ? 2.5 : 1.2), 99.5)}%)`);
    this.root.style.setProperty('--bg-bottom', `hsl(${h},${s}%,${Math.max(l - (isDark ? 1.5 : 2.5), 0)}%)`);
    this.ink = isDark
      ? { color: `hsl(${h},${Math.min(s, 25)}%,88%)`, alpha: .14 + y * 1.2 }
      : { color: `hsl(${h},${Math.min(s * .7, 50)}%,${Math.max(l * .22, 6)}%)`, alpha: .20 + (1 - y) * .32 };
    this.scheduleDraw();
    return true;
  }

  private cancelArtwork() {
    if (!this.pendingArtwork) return;
    this.pendingArtwork.onload = this.pendingArtwork.onerror = null;
    this.pendingArtwork.removeAttribute('src');
    this.pendingArtwork = null;
  }

  private loadArtwork() {
    this.cancelArtwork();
    const generation = ++this.artGeneration;
    if (this.artFrame) cancelAnimationFrame(this.artFrame);
    this.artFrame = 0;
    const artwork = new Image();
    this.pendingArtwork = artwork;
    const source = 'lobby-art-br.png';
    artwork.onload = () => { if (generation === this.artGeneration) this.installArtwork(artwork, source, generation); };
    artwork.onerror = () => {
      if (generation !== this.artGeneration) return;
      const fallback = new Image();
      this.pendingArtwork = fallback;
      fallback.onload = () => { if (generation === this.artGeneration) this.installArtwork(fallback, 'zhiyan-br.png', generation); };
      fallback.onerror = () => { if (generation === this.artGeneration) this.root.dataset.artworkFailed = 'true'; };
      fallback.src = 'zhiyan-br.png';
    };
    artwork.src = source;
  }

  private installArtwork(image: HTMLImageElement, src: string, generation: number) {
    if (generation !== this.artGeneration || !this.visible) return;
    this.pendingArtwork = null;
    this.root.removeAttribute('data-artwork-failed');
    this.art.src = src;
    this.artImage = image;
    try { this.measureFocus(image); }
    catch { this.focusPoint = { x: .68, y: .24 }; }
    this.root.removeAttribute('data-canvas-error');
    this.scheduleDraw();
    if (this.artFrame) cancelAnimationFrame(this.artFrame);
    this.artFrame = requestAnimationFrame(() => {
      this.artFrame = 0;
      if (generation === this.artGeneration && this.visible) this.art.classList.remove('is-swapping');
    });
  }

  private measureFocus(image: HTMLImageElement) {
    const canvas = document.createElement('canvas'); canvas.width = 96; canvas.height = 144;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas unavailable');
    context.drawImage(image, 0, 0, 96, 144);
    const data = context.getImageData(0, 0, 96, 144).data;
    let top = 144, bottom = 0;
    for (let y = 0; y < 144; y++) for (let x = 0; x < 96; x++) if (data[(y * 96 + x) * 4 + 3] > 128) { top = Math.min(top, y); bottom = Math.max(bottom, y); }
    if (top === 144) throw new Error('Artwork has no visible pixels');
    const limit = top + (bottom - top) * .25; let sx = 0, sy = 0, count = 0;
    for (let y = top; y < limit; y++) for (let x = 0; x < 96; x++) if (data[(y * 96 + x) * 4 + 3] > 128) { sx += x; sy += y; count++; }
    if (count) this.focusPoint = { x: sx / count / 96, y: (sy / count / 144 + limit / 144) / 2 };
  }

  private scheduleDraw() {
    if (!this.visible || this.resizeFrame) return;
    this.resizeFrame = requestAnimationFrame(() => { this.resizeFrame = 0; this.drawScene(); });
  }

  private drawScene() {
    if (!this.visible || !this.artImage || this.root.hidden || this.root.dataset.canvasError === 'true') return;
    try {
      const width = this.root.clientWidth, height = this.root.clientHeight, dpr = Math.min(window.devicePixelRatio || 1, 1);
      if (!width || !height) return;
      const rootRect = this.root.getBoundingClientRect(), artRect = this.art.getBoundingClientRect();
      const art = { x: artRect.left - rootRect.left, y: artRect.top - rootRect.top, w: artRect.width, h: artRect.height };
      const fx = art.x + this.focusPoint.x * art.w, fy = art.y + this.focusPoint.y * art.h;
      this.root.style.setProperty('--focus-x', `${fx}px`); this.root.style.setProperty('--focus-y', `${fy}px`);
      const prepare = (canvas: HTMLCanvasElement) => {
        const pixelWidth = Math.max(1, Math.round(width * dpr)), pixelHeight = Math.max(1, Math.round(height * dpr));
        if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
        if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
        const context = canvas.getContext('2d'); if (!context) throw new Error('Canvas unavailable');
        context.setTransform(dpr, 0, 0, dpr, 0, 0); context.clearRect(0, 0, width, height); return context;
      };
      const dots = prepare(this.dots), cell = 6.5, k = cell / Math.SQRT2;
      const right = art.x + art.w / 2 > width / 2, cx = right ? width * 1.02 : -width * .02, cy = height * 1.04;
      const reach = Math.hypot(width, height) * .62;
      dots.fillStyle = this.ink.color; dots.globalAlpha = Math.min(this.ink.alpha, .5); dots.beginPath();
      const count = Math.ceil((width + height) / k) + 2;
      for (let i = -count; i <= count; i++) for (let j = 0; j <= count * 2; j++) {
        const x = (i + j) * k - height, y = (j - i) * k;
        if (x < -4 || x > width + 4 || y < -4 || y > height + 4) continue;
        const amount = 1 - Math.hypot(x - cx, y - cy) / reach; if (amount <= 0) continue;
        const radius = cell * .46 * Math.pow(amount, 1.35); if (radius < .32) continue;
        dots.moveTo(x + radius, y); dots.arc(x, y, radius, 0, Math.PI * 2);
      }
      dots.fill(); dots.globalAlpha = 1;
      const lines = prepare(this.lines); let lineSeed = 7; lines.fillStyle = this.ink.color;
      const lineFactor = this.ink.alpha / .22, far = Math.hypot(width, height) * 1.1, base = Math.min(width, height);
      const random = () => (lineSeed = (lineSeed * 16807) % 2147483647) / 2147483647;
      for (let angle = 0; angle < Math.PI * 2;) {
        angle += (.6 + random() * 2.6) * Math.PI / 180;
        if (random() < .18) angle += random() * 5 * Math.PI / 180;
        const start = base * (.34 + random() * .3), lineWidth = .5 + random() * 1.6, alpha = .03 + random() * .045;
        const cos = Math.cos(angle), sin = Math.sin(angle), px = -sin, py = cos, halfEnd = lineWidth * 1.7;
        lines.globalAlpha = Math.min(alpha * lineFactor, .2); lines.beginPath();
        lines.moveTo(fx + cos * start, fy + sin * start);
        lines.lineTo(fx + cos * far + px * halfEnd, fy + sin * far + py * halfEnd);
        lines.lineTo(fx + cos * far - px * halfEnd, fy + sin * far - py * halfEnd);
        lines.closePath(); lines.fill();
      }
      lines.globalAlpha = 1;
      for (const [context, blur] of [[dots, 9], [lines, 14]] as const) {
        context.save(); context.globalCompositeOperation = 'destination-out'; context.filter = `blur(${blur}px)`;
        for (let i = 0; i < 3; i++) context.drawImage(this.artImage, art.x, art.y, art.w, art.h);
        context.restore();
      }
    } catch {
      this.root.dataset.canvasError = 'true';
      this.dots.getContext('2d')?.clearRect(0, 0, this.dots.width, this.dots.height);
      this.lines.getContext('2d')?.clearRect(0, 0, this.lines.width, this.lines.height);
    }
  }
}

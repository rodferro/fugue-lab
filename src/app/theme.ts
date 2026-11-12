// Canvas colors come from CSS custom properties so both themes work.
export interface Palette {
  bg: string; rowAlt: string; rowKey: string; grid: string; beat: string; bar: string;
  ink: string; muted: string; accent: string; head: string; ghost: string; playhead: string;
  keyWhite: string; keyBlack: string; noteInk: string; voices: string[];
}

export function readPalette(): Palette {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string) => cs.getPropertyValue(name).trim() || '#888';
  return {
    bg: v('--roll-bg'), rowAlt: v('--roll-row'), rowKey: v('--roll-scale'), grid: v('--roll-grid'),
    beat: v('--roll-beat'), bar: v('--roll-bar'), ink: v('--ink'), muted: v('--muted'),
    accent: v('--accent'), head: v('--head'), ghost: v('--ghost'), playhead: v('--playhead'),
    keyWhite: v('--key-white'), keyBlack: v('--key-black'), noteInk: v('--note-ink'),
    voices: [v('--v0'), v('--v1'), v('--v2'), v('--v3')],
  };
}

export const isBlack = (pitch: number) => [1, 3, 6, 8, 10].includes(((pitch % 12) + 12) % 12);

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export function setupCanvas(canvas: HTMLCanvasElement, w: number, h: number): CanvasRenderingContext2D {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

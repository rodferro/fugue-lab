// Read-only multi-voice roll of the generated fugue.
import { VNote } from '../engine/model';
import { FugueResult } from '../engine/fugue';
import { keyName, pitchName } from '../engine/theory';
import { Palette, readPalette, roundRect, setupCanvas } from './theme';

const BAND = 46; // header band with entry labels
const PAD = 8;

const ROLE_LABEL: Record<string, string> = {
  subject: 'Subject', answer: 'Answer', countersubject: 'Countersubject', free: 'Free counterpoint', link: 'Link', cadence: 'Cadence',
};

export class FugueView {
  result: FugueResult | null = null;
  muted: boolean[] = [];
  playhead: number | null = null;
  /** Pixels per tick (of the result's grid). */
  tickW = 9;
  private canvas: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private pal: Palette = readPalette();
  private low = 40;
  private high = 84;
  private rowH = 6;
  private tip: HTMLElement;

  constructor(private scroller: HTMLElement, tip: HTMLElement, private onSeek: (tick: number) => void) {
    this.canvas = document.createElement('canvas');
    this.canvas.setAttribute('role', 'img');
    scroller.appendChild(this.canvas);
    this.tip = tip;
    this.canvas.addEventListener('pointermove', (e) => this.hover(e));
    this.canvas.addEventListener('pointerleave', () => { this.tip.hidden = true; });
    this.canvas.addEventListener('click', (e) => {
      const r = this.canvas.getBoundingClientRect();
      this.onSeek(Math.max(0, (e.clientX - r.left - PAD) / this.tickW));
    });
    new ResizeObserver(() => this.layout()).observe(scroller);
  }

  refreshPalette(): void { this.pal = readPalette(); this.draw(); }

  set(result: FugueResult): void {
    this.result = result;
    if (this.muted.length !== result.voices.length) this.muted = result.voices.map(() => false);
    const ps = result.notes.flat().map((n) => n.pitch);
    this.low = Math.min(...ps) - 2;
    this.high = Math.max(...ps) + 2;
    this.canvas.setAttribute('aria-label', `Generated ${result.voices.length}-voice exposition in ${keyName(result.key)}`);
    this.layout();
  }

  private layout(): void {
    if (!this.result) return;
    const avail = this.scroller.clientWidth - PAD * 2;
    // 6-14 px per 16th, whatever the grid resolution.
    const six = this.result.grid.sixteenth;
    this.tickW = Math.max(6, Math.min(14, (avail * six) / this.result.length)) / six;
    const w = Math.max(this.scroller.clientWidth, this.result.length * this.tickW + PAD * 2);
    this.rowH = Math.max(4, Math.min(8, 300 / (this.high - this.low + 1)));
    const h = BAND + (this.high - this.low + 1) * this.rowH + PAD;
    this.ctx = setupCanvas(this.canvas, w, h);
    this.draw();
  }

  private x(t: number) { return PAD + t * this.tickW; }
  private y(p: number) { return BAND + (this.high - p) * this.rowH; }

  /** Keep the playhead visible while playing. */
  follow(): void {
    if (this.playhead === null) return;
    const x = this.x(this.playhead);
    const { scrollLeft, clientWidth } = this.scroller;
    if (x > scrollLeft + clientWidth - 60 || x < scrollLeft) this.scroller.scrollLeft = x - 60;
  }

  draw(): void {
    const { ctx, pal, result: r } = this;
    if (!ctx || !r) return;
    const W = this.canvas.clientWidth || parseFloat(this.canvas.style.width);
    const H = parseFloat(this.canvas.style.height);
    ctx.fillStyle = pal.bg;
    ctx.fillRect(0, 0, W, H);
    const { beat, bar } = r.grid;
    for (let t = 0; t <= r.length; t += beat) {
      const xx = Math.round(this.x(t)) + 0.5;
      ctx.strokeStyle = t % bar === 0 ? pal.bar : pal.grid;
      ctx.beginPath(); ctx.moveTo(xx, BAND - 6); ctx.lineTo(xx, H - PAD); ctx.stroke();
      if (t % bar === 0 && t < r.length) {
        ctx.fillStyle = pal.muted;
        ctx.font = '500 9px "IBM Plex Mono", ui-monospace, monospace';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(String(t / bar + 1), xx + 3, BAND - 8);
      }
    }
    // entry chips
    for (const e of r.entries) {
      const x0 = this.x(e.start) + 2;
      const w = (e.end - e.start) * this.tickW - 4;
      const col = pal.voices[e.voice];
      ctx.fillStyle = col;
      roundRect(ctx, x0, 6, w, 18, 4);
      ctx.fill();
      ctx.fillStyle = pal.noteInk;
      ctx.font = '600 10px "IBM Plex Sans", system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      const label = `${e.role === 'subject' ? 'Subject' : 'Answer'} · ${r.voices[e.voice].name} · ${keyName(e.key)}`;
      ctx.save();
      ctx.beginPath(); ctx.rect(x0, 6, w, 18); ctx.clip();
      ctx.fillText(label, x0 + 6, 15.5);
      ctx.restore();
    }
    for (const s of r.sections) {
      if (s.label === 'Exposition') continue;
      const x0 = this.x(s.start) + 2;
      ctx.strokeStyle = pal.muted;
      ctx.setLineDash([3, 3]);
      roundRect(ctx, x0, 6, (s.end - s.start) * this.tickW - 4, 18, 4);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = pal.muted;
      ctx.fillText(s.label, x0 + 6, 15.5);
    }
    // notes, lowest voice first so the top voice draws on top
    for (let v = r.notes.length - 1; v >= 0; v--) {
      const col = pal.voices[v];
      ctx.globalAlpha = this.muted[v] ? 0.15 : 1;
      for (const n of r.notes[v]) {
        const xx = this.x(n.start) + 0.5;
        const yy = this.y(n.pitch);
        const w = Math.max(2, n.dur * this.tickW - 1.5);
        roundRect(ctx, xx, yy, w, this.rowH, Math.min(2.5, this.rowH / 2));
        if (n.role === 'subject' || n.role === 'answer') {
          ctx.fillStyle = col;
          ctx.fill();
        } else if (n.role === 'countersubject') {
          ctx.globalAlpha *= 0.55;
          ctx.fillStyle = col;
          ctx.fill();
          ctx.globalAlpha = this.muted[v] ? 0.15 : 1;
        } else {
          ctx.globalAlpha *= 0.2;
          ctx.fillStyle = col;
          ctx.fill();
          ctx.globalAlpha = this.muted[v] ? 0.15 : 1;
          ctx.strokeStyle = col;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
    }
    ctx.globalAlpha = 1;
    if (this.playhead !== null) {
      ctx.fillStyle = pal.playhead;
      ctx.fillRect(this.x(this.playhead) - 1, BAND - 6, 2, H);
    }
  }

  private hover(e: PointerEvent): void {
    const r = this.result;
    if (!r) return;
    const rect = this.canvas.getBoundingClientRect();
    const t = (e.clientX - rect.left - PAD) / this.tickW;
    const p = this.high - Math.floor((e.clientY - rect.top - BAND) / this.rowH);
    let found: VNote | null = null;
    for (const line of r.notes) for (const n of line) if (n.start <= t && n.start + n.dur > t && Math.abs(n.pitch - p) <= 0) found = n;
    if (!found) { this.tip.hidden = true; return; }
    this.tip.hidden = false;
    this.tip.textContent = `${pitchName(found.pitch)} · ${r.voices[found.voice].name} · ${ROLE_LABEL[found.role]}`;
    const host = this.scroller.getBoundingClientRect();
    this.tip.style.left = `${e.clientX - host.left + 12}px`;
    this.tip.style.top = `${e.clientY - host.top + 12}px`;
  }
}

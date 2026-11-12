// Canvas piano-roll editor for the (monophonic) subject.
import { Note, TPB, makeMonophonic, noteEnd } from '../engine/model';
import { Key, degreeLabel, mod12, pitchName, scaleOf } from '../engine/theory';
import { Palette, isBlack, readPalette, roundRect, setupCanvas } from './theme';

export interface PianoRollEvents {
  onChange(notes: Note[]): void;
  onPreview(pitch: number): void;
}

type Drag =
  | { kind: 'move'; index: number; dTick: number; origin: Note; moved: boolean }
  | { kind: 'resize'; index: number; origin: Note; created: boolean };

const LOW = 36;
const HIGH = 96;
const ROW = 13;
const KB = 44;

export class PianoRoll {
  notes: Note[] = [];
  bars = 2;
  beatsPerBar = 4;
  defaultLen = 2;
  key: { key: Key; mutation: number } | null = null;
  ghost: Note[] = [];
  playhead: number | null = null;
  selected = -1;
  private drag: Drag | null = null;
  private canvas: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private width = 600;
  private pal: Palette = readPalette();

  constructor(private scroller: HTMLElement, private events: PianoRollEvents) {
    this.canvas = document.createElement('canvas');
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute('role', 'application');
    this.canvas.setAttribute('aria-label', 'Subject piano roll. Click to add a note, drag to move, drag the right edge to resize, double-click to delete. Arrow keys move the selected note.');
    scroller.appendChild(this.canvas);
    new ResizeObserver(() => this.resize()).observe(scroller);
    this.canvas.addEventListener('pointerdown', (e) => this.down(e));
    this.canvas.addEventListener('pointermove', (e) => this.move(e));
    this.canvas.addEventListener('pointerup', (e) => this.up(e));
    this.canvas.addEventListener('pointercancel', () => { this.drag = null; });
    this.canvas.addEventListener('dblclick', (e) => this.remove(e));
    this.canvas.addEventListener('contextmenu', (e) => { e.preventDefault(); this.remove(e); });
    this.canvas.addEventListener('keydown', (e) => this.key_(e));
    this.resize();
  }

  get totalTicks(): number { return this.bars * this.beatsPerBar * TPB; }
  private get tickW(): number { return (this.width - KB) / this.totalTicks; }
  private get height(): number { return (HIGH - LOW + 1) * ROW; }

  refreshPalette(): void { this.pal = readPalette(); this.draw(); }

  resize(): void {
    this.width = Math.max(320, this.scroller.clientWidth);
    this.ctx = setupCanvas(this.canvas, this.width, this.height);
    this.draw();
  }

  /** Scroll so the subject (or middle C) is in view. */
  center(): void {
    const ps = this.notes.map((n) => n.pitch);
    const mid = ps.length ? (Math.min(...ps) + Math.max(...ps)) / 2 : 67;
    this.scroller.scrollTop = this.yOf(mid) - this.scroller.clientHeight / 2;
  }

  private yOf(pitch: number): number { return (HIGH - pitch) * ROW; }
  private xOf(tick: number): number { return KB + tick * this.tickW; }

  private hit(e: PointerEvent | MouseEvent) {
    const r = this.canvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const pitch = HIGH - Math.floor(y / ROW);
    const tickF = (x - KB) / this.tickW;
    let index = -1;
    let edge = false;
    this.notes.forEach((n, i) => {
      if (n.pitch !== pitch) return;
      const x0 = this.xOf(n.start), x1 = this.xOf(noteEnd(n));
      if (x >= x0 && x <= x1) { index = i; edge = x >= x1 - Math.min(7, (x1 - x0) / 3); }
    });
    return { x, pitch, tickF, index, edge };
  }

  private down(e: PointerEvent): void {
    if (e.button !== 0) return;
    this.canvas.focus();
    const h = this.hit(e);
    if (h.x < KB) { this.events.onPreview(h.pitch); return; }
    this.canvas.setPointerCapture(e.pointerId);
    if (h.index >= 0) {
      this.selected = h.index;
      const n = this.notes[h.index];
      this.drag = h.edge
        ? { kind: 'resize', index: h.index, origin: { ...n }, created: false }
        : { kind: 'move', index: h.index, dTick: Math.floor(h.tickF) - n.start, origin: { ...n }, moved: false };
    } else {
      const start = Math.max(0, Math.min(this.totalTicks - 1, Math.floor(h.tickF)));
      const n: Note = { pitch: h.pitch, start, dur: Math.min(this.defaultLen, this.totalTicks - start) };
      this.notes.push(n);
      this.selected = this.notes.length - 1;
      this.drag = { kind: 'resize', index: this.selected, origin: { ...n }, created: true };
      this.events.onPreview(h.pitch);
    }
    this.draw();
  }

  private move(e: PointerEvent): void {
    const h = this.hit(e);
    if (!this.drag) {
      this.canvas.style.cursor = h.x < KB ? 'pointer' : h.index < 0 ? 'crosshair' : h.edge ? 'ew-resize' : 'grab';
      return;
    }
    const n = this.notes[this.drag.index];
    if (this.drag.kind === 'move') {
      this.canvas.style.cursor = 'grabbing';
      const start = Math.max(0, Math.min(this.totalTicks - n.dur, Math.floor(h.tickF) - this.drag.dTick));
      const pitch = Math.max(LOW, Math.min(HIGH, h.pitch));
      if (pitch !== n.pitch) this.events.onPreview(pitch);
      if (pitch !== n.pitch || start !== n.start) this.drag.moved = true;
      n.start = start;
      n.pitch = pitch;
    } else {
      const end = Math.max(n.start + 1, Math.min(this.totalTicks, Math.ceil(h.tickF)));
      if (!this.drag.created || end > n.start + this.drag.origin.dur) n.dur = end - n.start;
      else if (this.drag.created) n.dur = this.drag.origin.dur;
    }
    this.draw();
  }

  private up(_e: PointerEvent): void {
    if (!this.drag) return;
    const keep = this.notes[this.drag.index];
    this.drag = null;
    this.commit(keep);
  }

  private commit(keep?: Note): void {
    // The edited note wins against any note it now overlaps.
    const out: Note[] = [];
    for (const o of this.notes) {
      if (!keep || o === keep) continue;
      const kEnd = noteEnd(keep);
      if (noteEnd(o) <= keep.start || o.start >= kEnd) out.push(o);
      else if (o.start < keep.start) out.push({ ...o, dur: keep.start - o.start });
      else if (noteEnd(o) > kEnd) out.push({ ...o, start: kEnd, dur: noteEnd(o) - kEnd });
    }
    if (keep) out.push(keep);
    else out.push(...this.notes);
    this.notes = makeMonophonic(out);
    this.selected = keep ? this.notes.findIndex((n) => n.start === keep.start && n.pitch === keep.pitch) : -1;
    this.events.onChange(this.notes.map((n) => ({ ...n })));
    this.draw();
  }

  private remove(e: MouseEvent): void {
    const h = this.hit(e);
    if (h.index < 0) return;
    this.notes.splice(h.index, 1);
    this.selected = -1;
    this.commit();
  }

  private key_(e: KeyboardEvent): void {
    const n = this.notes[this.selected];
    if (!n) return;
    let handled = true;
    if (e.key === 'Delete' || e.key === 'Backspace') { this.notes.splice(this.selected, 1); this.selected = -1; this.commit(); return; }
    else if (e.key === 'ArrowUp') n.pitch = Math.min(HIGH, n.pitch + (e.shiftKey ? 12 : 1));
    else if (e.key === 'ArrowDown') n.pitch = Math.max(LOW, n.pitch - (e.shiftKey ? 12 : 1));
    else if (e.key === 'ArrowLeft') n.start = Math.max(0, n.start - 1);
    else if (e.key === 'ArrowRight') n.start = Math.min(this.totalTicks - n.dur, n.start + 1);
    else handled = false;
    if (!handled) return;
    e.preventDefault();
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') this.events.onPreview(n.pitch);
    this.commit(n);
  }

  draw(): void {
    const { ctx, pal } = this;
    if (!ctx) return;
    const W = this.width, H = this.height, tw = this.tickW;
    ctx.fillStyle = pal.bg;
    ctx.fillRect(0, 0, W, H);
    const scale = this.key ? scaleOf(this.key.key.mode).map((p) => mod12(p + this.key!.key.tonic)) : null;
    for (let p = LOW; p <= HIGH; p++) {
      const y = this.yOf(p);
      if (scale && mod12(p) === this.key!.key.tonic) { ctx.fillStyle = pal.rowKey; ctx.fillRect(KB, y, W - KB, ROW); }
      else if (isBlack(p)) { ctx.fillStyle = pal.rowAlt; ctx.fillRect(KB, y, W - KB, ROW); }
      ctx.fillStyle = pal.grid;
      ctx.fillRect(KB, y + ROW - 0.5, W - KB, 0.5);
    }
    for (let t = 0; t <= this.totalTicks; t++) {
      const x = Math.round(this.xOf(t)) + 0.5;
      const isBar = t % (TPB * this.beatsPerBar) === 0;
      const isBeat = t % TPB === 0;
      ctx.strokeStyle = isBar ? pal.bar : isBeat ? pal.beat : pal.grid;
      ctx.lineWidth = isBar ? 1.25 : 1;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    // keyboard
    for (let p = LOW; p <= HIGH; p++) {
      const y = this.yOf(p);
      ctx.fillStyle = isBlack(p) ? pal.keyBlack : pal.keyWhite;
      ctx.fillRect(0, y, KB - 1, ROW);
      ctx.fillStyle = pal.grid;
      ctx.fillRect(0, y + ROW - 0.5, KB - 1, 0.5);
      if (mod12(p) === 0) {
        ctx.fillStyle = pal.muted;
        ctx.font = '600 9px "IBM Plex Mono", ui-monospace, monospace';
        ctx.textBaseline = 'middle';
        ctx.fillText(pitchName(p), 4, y + ROW / 2);
      }
    }
    // ghost answer
    if (this.ghost.length) {
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = pal.ghost;
      ctx.lineWidth = 1.25;
      for (const n of this.ghost) {
        if (n.pitch < LOW || n.pitch > HIGH) continue;
        roundRect(ctx, this.xOf(n.start) + 1, this.yOf(n.pitch) + 1.5, n.dur * tw - 2, ROW - 3, 3);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }
    // notes
    const mut = this.key?.mutation ?? 0;
    this.notes.forEach((n, i) => {
      const x = this.xOf(n.start) + 1, y = this.yOf(n.pitch) + 1, w = n.dur * tw - 2, h = ROW - 2;
      ctx.fillStyle = i < mut ? pal.head : pal.accent;
      roundRect(ctx, x, y, w, h, 3);
      ctx.fill();
      if (i === this.selected) { ctx.strokeStyle = pal.ink; ctx.lineWidth = 1.5; ctx.stroke(); }
      if (this.key && w > 15) {
        ctx.fillStyle = pal.noteInk;
        ctx.font = '600 9px "IBM Plex Mono", ui-monospace, monospace';
        ctx.textBaseline = 'middle';
        ctx.fillText(degreeLabel(n.pitch, this.key.key), x + 4, y + h / 2 + 0.5);
      }
    });
    // mutation marker
    if (mut > 0 && mut < this.notes.length) {
      const x = Math.round(this.xOf(this.notes[mut].start)) + 0.5;
      ctx.strokeStyle = pal.head;
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
      ctx.setLineDash([]);
    }
    if (this.playhead !== null) {
      const x = this.xOf(this.playhead);
      ctx.fillStyle = pal.playhead;
      ctx.fillRect(x - 1, 0, 2, H);
    }
  }
}

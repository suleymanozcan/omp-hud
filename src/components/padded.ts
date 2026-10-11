// Wraps a component and appends `pad` blank rows below its content (see ../pad.ts). The same array
// reference is returned while the inner output, the pad and nothing else changed (cheap repaints).
import type { Component } from "@oh-my-pi/pi-tui";
import { withPad } from "../pad.ts";

export class PaddedComponent implements Component {
  private readonly inner: Component;
  private readonly getPad: () => number;
  private readonly onRender?: (width: number, lines: number) => void;
  private lastInner: readonly string[] | undefined;
  private lastPad = -1;
  private lastOut: readonly string[] = [];

  constructor(inner: Component, getPad: () => number, onRender?: (width: number, lines: number) => void) {
    this.inner = inner;
    this.getPad = getPad;
    this.onRender = onRender;
  }

  render(width: number): readonly string[] {
    const content = this.inner.render(width);
    const pad = this.getPad();
    if (content !== this.lastInner || pad !== this.lastPad) {
      this.lastOut = withPad(content, pad);
      this.lastInner = content;
      this.lastPad = pad;
    }
    try {
      this.onRender?.(width, this.lastOut.length);
    } catch {
      // diagnostics never break rendering
    }
    return this.lastOut;
  }

  invalidate(): void {
    this.lastInner = undefined;
    this.inner.invalidate?.();
  }

  dispose(): void {
    this.inner.dispose?.();
  }
}

/** Keep all panels equally wide and balance the last row without adding another row. */
export function panelLayout(count: number, width: number, minimum: number, gap: number) {
  const capacity = Math.max(1, Math.floor((width + gap) / (minimum + gap)));
  const rows = Math.max(1, Math.ceil(count / capacity));
  const across = Math.max(1, Math.ceil(count / rows));
  return { across, panelWidth: Math.max(0, Math.floor((width - gap * (across - 1)) / across)) };
}

/** Keep the end ticks and use the space between them for labels that fit. */
export function horizontalTicks(widths: number[], position: (index: number) => number) {
  if (widths.length < 2) return widths.map((_, i) => i);
  const last = widths.length - 1;
  const gap = 8;
  const lastLeft = position(last) - widths[last] / 2;
  const ticks = [0];
  let previousRight = position(0) + widths[0] / 2;
  if (lastLeft < previousRight + gap) return ticks;
  for (let i = 1; i < last; i++) {
    const right = position(i) + widths[i] / 2;
    if (position(i) - widths[i] / 2 >= previousRight + gap && right + gap <= lastLeft) {
      ticks.push(i);
      previousRight = right;
    }
  }
  ticks.push(last);
  return ticks;
}

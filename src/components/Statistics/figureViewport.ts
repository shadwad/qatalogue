/** Reveal the new chart's controls within the results panel, below its sticky toolbar. */
export function focusAddedChart(panel: HTMLElement, card: HTMLElement, toolbarHeight: number) {
  const control = card.querySelector<HTMLSelectElement>('select:required:invalid') ?? card.querySelector<HTMLSelectElement>('select');
  const bounds = panel.getBoundingClientRect();
  const visibleTop = bounds.top + toolbarHeight;
  const cardTop = card.getBoundingClientRect().top;
  // scrollIntoView would also move overflow-hidden ancestors, including the application shell.
  if (cardTop < visibleTop || (control ?? card).getBoundingClientRect().bottom > bounds.bottom) {
    panel.scrollTop += cardTop - visibleTop;
  }
  control?.focus({ preventScroll: true });
}

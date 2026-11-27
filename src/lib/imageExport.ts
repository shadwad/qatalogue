import { getFontEmbedCSS, toCanvas } from 'html-to-image';

/** The two lines under every saved image: what it shows, then the filters and the export date. */
export interface Caption {
  headline: string;
  detail: string;
}

export const exportDate = () => new Date().toISOString().slice(0, 10);

/** A file name from a figure's title, e.g. "qatalogue-paper-count-by-topic-2026-11-20.png". */
export function imageFileName(title: string) {
  const slug = title.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
  return `qatalogue-${slug || 'figure'}-${exportDate()}.png`;
}

/** The sidebar filters a figure obeys, for its caption. */
export function filterSummary(filters: {
  startYear: number;
  endYear: number;
  topics: string[];
  topicsMatchAll: boolean;
  platforms: string[];
  platformsMatchAll: boolean;
  venues: string[];
  locations: string[];
  paperQuery: string;
}) {
  // Some location names contain a comma ("Name, Qualifier"), so a list that has one is separated by semicolons.
  const list = (names: string[], all = false) => {
    const separator = names.some(name => name.includes(',')) ? '; ' : ', ';
    return names.length > 4
      ? `${names.slice(0, 3).join(separator)} and ${names.length - 3} more`
      : names.join(all ? ' and ' : separator);
  };
  return [
    `${filters.startYear}–${filters.endYear}`,
    filters.topics.length ? `Topics: ${list(filters.topics, filters.topicsMatchAll)}` : '',
    filters.platforms.length ? `Platforms: ${list(filters.platforms, filters.platformsMatchAll)}` : '',
    filters.venues.length ? `Venues: ${list(filters.venues)}` : '',
    filters.locations.length ? `Locations: ${list(filters.locations)}` : '',
    filters.paperQuery ? `Papers matching “${filters.paperQuery}”` : '',
  ].filter(Boolean).join(' · ');
}

function wrap(ctx: CanvasRenderingContext2D, text: string, width: number) {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > width) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

const LOGO_FONT = '400 13px "Special Gothic Expanded One", sans-serif';
const HEADLINE_FONT = '700 12px "Outfit Variable", sans-serif';
const DETAIL_FONT = '400 11px "Inter Variable", sans-serif';
const LOGO_MARK = 16;
const LOGO_GAP = 6;

let logoMark: Promise<HTMLImageElement | null> | null = null;
/** The logo's mark (public/qatalogue.svg), loaded once; null if it can't be, so the image saves without it. */
function loadLogoMark() {
  logoMark ??= new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = '/qatalogue.svg';
  });
  return logoMark;
}

/**
 * Adds the site's caption under an image, with the Qatalogue logo at its bottom right, and saves it as a PNG.
 * `scale` is the image's pixels per CSS pixel; `margin` pads the image on every side, in CSS pixels.
 */
export async function saveImage(image: HTMLCanvasElement, { scale, margin = 0, caption, surface, ink, fileName }: {
  scale: number;
  margin?: number;
  caption: Caption;
  surface: string;
  ink: string;
  fileName: string;
}) {
  const width = image.width / scale + margin * 2;
  const out = document.createElement('canvas');
  const ctx = out.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');
  const [mark] = await Promise.all([
    loadLogoMark(),
    document.fonts.load(LOGO_FONT).catch(() => []),
    document.fonts.load(HEADLINE_FONT).catch(() => []),
    document.fonts.load(DETAIL_FONT).catch(() => []),
  ]);
  ctx.font = LOGO_FONT;
  const wordWidth = ctx.measureText('QATALOGUE').width;
  const logoWidth = (mark ? LOGO_MARK + LOGO_GAP : 0) + wordWidth;
  // The caption wraps short of the logo, which keeps the strip's right end.
  const textWidth = width - 32 - logoWidth - 16;
  ctx.font = HEADLINE_FONT;
  const headline = wrap(ctx, caption.headline, textWidth);
  ctx.font = DETAIL_FONT;
  const detail = wrap(ctx, caption.detail, textWidth);
  const detailTop = 10 + headline.length * 18;
  const footer = Math.max(detailTop + detail.length * 15 + 5, LOGO_MARK + 20);
  const imageHeight = image.height / scale + margin * 2;

  out.width = Math.round(width * scale);
  out.height = Math.round((imageHeight + footer) * scale);
  ctx.fillStyle = surface;
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(image, margin * scale, margin * scale);
  ctx.setTransform(scale, 0, 0, scale, 0, imageHeight * scale);
  ctx.fillStyle = ink;
  ctx.globalAlpha = 0.15;
  ctx.fillRect(0, 0, width, 1);
  ctx.globalAlpha = 1;
  ctx.textBaseline = 'top';
  ctx.font = HEADLINE_FONT;
  headline.forEach((line, i) => ctx.fillText(line, 16, 10 + i * 18));
  ctx.font = DETAIL_FONT;
  ctx.globalAlpha = 0.75;
  detail.forEach((line, i) => ctx.fillText(line, 16, detailTop + i * 15));
  // The logo, bottom right: its mark and wordmark, in the caption's ink, level with the caption's last line.
  ctx.globalAlpha = 1;
  const logoTop = footer - 10 - LOGO_MARK;
  let x = width - 16 - logoWidth;
  if (mark) {
    ctx.drawImage(mark, x, logoTop, LOGO_MARK, LOGO_MARK);
    x += LOGO_MARK + LOGO_GAP;
  }
  ctx.font = LOGO_FONT;
  ctx.textBaseline = 'middle';
  ctx.fillText('QATALOGUE', x, logoTop + LOGO_MARK / 2 + 1);

  return new Promise<void>((resolve, reject) => out.toBlob(blob => {
    if (!blob) return reject(new Error('Image encoding failed'));
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    resolve();
  }, 'image/png'));
}

let fontCSS: Promise<string> | null = null;
/** Fetching and embedding the web fonts is the slow part of a capture, so it happens once and can start early. */
export function prepareImageFonts(node: HTMLElement) {
  fontCSS ??= getFontEmbedCSS(node).catch(error => {
    fontCSS = null;
    throw error;
  });
  return fontCSS;
}

/**
 * Draws an element to a canvas at `scale` pixels per CSS pixel. It draws an off-screen copy without scroll limits,
 * so the image holds the whole figure and nothing on the page moves.
 */
export async function captureElement(node: HTMLElement, { scale, background }: { scale: number; background: string }) {
  const holder = document.createElement('div');
  holder.setAttribute('aria-hidden', 'true');
  holder.style.cssText = 'position:fixed;left:-100000px;top:0;pointer-events:none;';
  const copy = node.cloneNode(true) as HTMLElement;
  copy.setAttribute('data-image-export', '');
  copy.style.width = `${node.offsetWidth}px`;
  holder.appendChild(copy);
  document.body.appendChild(holder);
  try {
    const width = Math.max(node.offsetWidth, copy.scrollWidth);
    copy.style.width = `${width}px`;
    const fontEmbedCSS = await prepareImageFonts(node);
    return await toCanvas(copy, { pixelRatio: scale, backgroundColor: background, fontEmbedCSS, width, height: copy.scrollHeight });
  } finally {
    holder.remove();
  }
}

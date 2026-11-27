/**
 * Network cluster colours: 7 fixed colours per theme plus a neutral fallback, ordered for visual
 * separation across colour-vision profiles (>= 3:1 contrast against each theme surface).
 */
export const NETWORK_PALETTE = {
  light: ['#c96fd2', '#3aa643', '#82380c', '#156e9f', '#707000', '#6d3975', '#b63e64'],
  dark: ['#6da649', '#0b5dc5', '#e259aa', '#426d01', '#2b9ed9', '#95418d', '#8a69ec'],
} as const;

export const NETWORK_NEUTRAL = { light: '#86878f', dark: '#827a76' } as const;

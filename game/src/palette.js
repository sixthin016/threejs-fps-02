// SABLE LINE — the look plan, in one place.
// A foundry at dusk: warm furnace amber against cool teal steel. Every colour the game
// uses is one of these names; the same names are the CSS custom properties in index.html.
export const PALETTE = {
  // environment
  canvas: '#191410', // dusk sky / fog
  surface: '#2b241c', // concrete floor and walls
  hairline: '#453a2c', // dark steel trim
  rust: '#6e4a26', // rusted beams and crates
  // text
  ink: '#f2ede3', // warm white
  muted: '#a89a86', // dim warm grey
  // accents
  accent: '#ff9a3c', // furnace amber — the game's one hot colour
  ember: '#ff5a3c', // enemy team
  sable: '#37c8ab', // player team (teal)
  gold: '#f0c040', // money / buy menu
  danger: '#ff4444', // damage / low health
  // site markers
  siteA: '#ff9a3c',
  siteB: '#37c8ab',
};

export function hex(name) {
  return PALETTE[name];
}

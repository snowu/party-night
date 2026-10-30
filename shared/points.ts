// Places → night points. Ties share the higher score; a chaos round doubles it,
// so the back of the table always has a way back in.
export const PLACE_POINTS = [10, 7, 5, 3, 1];
export const CHAOS_EVERY = 4;   // every 4th round

export const pointsFor = (place: number, chaos: boolean) => (PLACE_POINTS[place - 1] ?? 0) * (chaos ? 2 : 1);
export const isChaos = (round: number, total: number) => round % CHAOS_EVERY === 0 || (round === total && total >= 4);

// Turn scores (higher is better) into shared places: [9, 9, 4] → places [1, 1, 3].
export function placesByScore<T>(items: T[], score: (x: T) => number): Array<{ item: T; place: number }> {
  const sorted = [...items].sort((a, b) => score(b) - score(a));
  return sorted.map(item => ({ item, place: 1 + sorted.findIndex(o => score(o) === score(item)) }));
}

export function mulberry32(a: number): () => number {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

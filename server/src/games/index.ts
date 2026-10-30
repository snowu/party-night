import { Approve } from './approve.ts';
import { Bird } from './bird.ts';
import { Gallery } from './gallery.ts';
import { Guessing } from './guessing.ts';
import { HotTake } from './hottake.ts';
import { MostLikely } from './mostlikely.ts';
import { Quiz } from './quiz.ts';
import { Who } from './who.ts';
import type { StagedGame } from './staged.ts';
import type { GameCtx, GameFactory } from './types.ts';
import { BIRD } from '../../../shared/bird.ts';

const staged = (C: new (ctx: GameCtx, now: number) => StagedGame): GameFactory => (ctx, now) => {
  const g = new C(ctx, now);
  g.start(now);
  return g;
};

export const FACTORIES: Record<string, GameFactory> = {
  ...Object.fromEntries(Object.keys(BIRD).map(id => [id, (ctx: GameCtx, now: number) => new Bird(ctx, now, id)])),
  quiz: staged(Quiz),
  approve: staged(Approve),
  hottake: staged(HotTake),
  mostlikely: staged(MostLikely),
  who: staged(Who),
  draw: (ctx, now) => new Guessing(ctx, now, 'draw'),
  perform: (ctx, now) => new Guessing(ctx, now, 'perform'),
  gallery: (ctx, now) => new Gallery(ctx, now),
};

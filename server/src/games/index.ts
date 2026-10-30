import { Approve } from './approve.ts';
import { Bird } from './bird.ts';
import { CodeReview } from './codereview.ts';
import { Gallery } from './gallery.ts';
import { Guessing } from './guessing.ts';
import { Hivemind } from './hivemind.ts';
import { HotTake } from './hottake.ts';
import { Incident } from './incident.ts';
import { MostLikely } from './mostlikely.ts';
import { OnCall } from './oncall.ts';
import { Planning } from './planning.ts';
import { Pong } from './pong.ts';
import { TrickShot } from './pool.ts';
import { Quiz } from './quiz.ts';
import { PerfReview } from './review.ts';
import { RootCause } from './rootcause.ts';
import { Who } from './who.ts';
import type { StagedGame } from './staged.ts';
import type { GameCtx, GameFactory } from './types.ts';

const staged = (C: new (ctx: GameCtx, now: number) => StagedGame): GameFactory => (ctx, now) => {
  const g = new C(ctx, now);
  g.start(now);
  return g;
};

export const FACTORIES: Record<string, GameFactory> = {
  race: (ctx, now) => new Bird(ctx, now),
  quiz: staged(Quiz),
  approve: staged(Approve),
  hottake: staged(HotTake),
  mostlikely: staged(MostLikely),
  who: staged(Who),
  draw: (ctx, now) => new Guessing(ctx, now, 'draw'),
  perform: (ctx, now) => new Guessing(ctx, now, 'perform'),
  gallery: (ctx, now) => new Gallery(ctx, now),
  rootcause: staged(RootCause),
  hivemind: staged(Hivemind),
  review: staged(PerfReview),
  codereview: staged(CodeReview),
  incident: staged(Incident),
  planning: staged(Planning),
  oncall: (ctx, now) => new OnCall(ctx, now),
  pong: (ctx, now) => new Pong(ctx, now),
  pool: staged(TrickShot),
};

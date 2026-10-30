// Approve or Deny: a generated IAM policy and a request; decide before the bar runs
// out. Evaluation follows the real rules in miniature: an explicit Deny wins, then
// any matching Allow, otherwise the implicit deny. Wildcards match like IAM's.
import { StagedGame } from './staged.ts';
import { mostAward, pick, type GameCtx, type Seat } from './types.ts';

const CARDS = 6;

const SERVICES: Record<string, { actions: string[]; resources: string[] }> = {
  s3: { actions: ['GetObject', 'PutObject', 'DeleteObject', 'ListBucket'], resources: ['arn:aws:s3:::prod-backups/*', 'arn:aws:s3:::team-memes/*', 'arn:aws:s3:::retro-notes/*'] },
  ec2: { actions: ['StartInstances', 'StopInstances', 'TerminateInstances', 'DescribeInstances'], resources: ['arn:aws:ec2:us-east-1:123456789012:instance/i-prod42', 'arn:aws:ec2:eu-west-1:123456789012:instance/i-dev7'] },
  dynamodb: { actions: ['GetItem', 'PutItem', 'DeleteTable', 'Query'], resources: ['arn:aws:dynamodb:us-east-1:123456789012:table/Orders', 'arn:aws:dynamodb:us-east-1:123456789012:table/Snacks'] },
  iam: { actions: ['CreateUser', 'DeleteRole', 'PassRole', 'ListUsers'], resources: ['arn:aws:iam::123456789012:role/Admin', 'arn:aws:iam::123456789012:user/intern-47'] },
  lambda: { actions: ['InvokeFunction', 'DeleteFunction', 'UpdateFunctionCode'], resources: ['arn:aws:lambda:us-east-1:123456789012:function:billing', 'arn:aws:lambda:us-east-1:123456789012:function:party'] },
};

export interface Statement { Effect: 'Allow' | 'Deny'; Action: string; Resource: string }
export interface Card { who: string; action: string; resource: string; statements: Statement[]; allow: boolean; why: string }

const WHO = ['Intern #47', 'Kevin from Billing', 'the CI pipeline', 'Clippy', 'a Lambda at 3am', 'the new contractor', 'Chaos Monkey'];

export const wildMatch = (pattern: string, value: string) =>
  new RegExp('^' + pattern.split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$').test(value);
const matches = (s: Statement, action: string, resource: string) => wildMatch(s.Action, action) && wildMatch(s.Resource, resource);

export function evaluate(statements: Statement[], action: string, resource: string): { allow: boolean; why: string } {
  const deny = statements.find(s => s.Effect === 'Deny' && matches(s, action, resource));
  if (deny) return { allow: false, why: `Explicit Deny on ${deny.Action} wins over any Allow` };
  const allow = statements.find(s => s.Effect === 'Allow' && matches(s, action, resource));
  if (allow) return { allow: true, why: allow.Action === action && allow.Resource === resource ? 'An Allow matches exactly' : `${allow.Action} on ${allow.Resource} matches the request` };
  return { allow: false, why: 'No Allow matches, so it\'s an implicit deny' };
}

export function makeCard(rng: () => number): Card {
  const svc = pick(rng, Object.keys(SERVICES));
  const { actions, resources } = SERVICES[svc];
  const act = pick(rng, actions), res = pick(rng, resources);
  const action = `${svc}:${act}`;
  const matchAction = () => pick(rng, [action, action, `${svc}:*`, `${svc}:${act.slice(0, 3)}*`, '*']);
  const otherAction = () => {
    const others = actions.filter(a => !a.startsWith(act.slice(0, 3)));
    return others.length ? `${svc}:${pick(rng, others)}` : `${pick(rng, Object.keys(SERVICES).filter(s => s !== svc))}:*`;
  };
  const matchRes = () => pick(rng, [res, res, '*', res.replace(/[^/:]+$/, '*')]);
  const otherRes = () => pick(rng, resources.filter(r => r !== res).concat(resources.length === 1 ? ['arn:aws:s3:::somewhere-else/*'] : []));
  const scenario = Math.floor(rng() * 4);
  const st: Statement[] = [];
  if (scenario === 0) st.push({ Effect: 'Allow', Action: matchAction(), Resource: matchRes() });
  if (scenario === 1) st.push({ Effect: 'Allow', Action: pick(rng, [`${svc}:*`, '*']), Resource: '*' }, { Effect: 'Deny', Action: matchAction(), Resource: matchRes() });
  if (scenario === 2) st.push(rng() < 0.5
    ? { Effect: 'Allow', Action: otherAction(), Resource: matchRes() }
    : { Effect: 'Allow', Action: matchAction(), Resource: otherRes() });
  if (scenario === 3) st.push({ Effect: 'Deny', Action: otherAction(), Resource: '*' }, { Effect: 'Allow', Action: matchAction(), Resource: matchRes() });
  if (rng() < 0.5) st.reverse();
  const { allow, why } = evaluate(st, action, res);
  return { who: pick(rng, WHO), action, resource: res, statements: st, allow, why };
}

export class Approve extends StagedGame {
  cards: Card[];
  right = new Map<string, number>();
  revMs = 2800;

  constructor(ctx: GameCtx, now: number) {
    super(ctx, now);
    this.cards = Array.from({ length: CARDS }, () => makeCard(ctx.rng));
  }

  stages() { return CARDS; }
  stageMs() { return 7000; }
  valid(_from: string, v: any) { return v === true || v === false; }
  botAnswer(_bot: Seat) { return this.ctx.rng() < 0.6 ? this.cards[this.stage].allow : this.ctx.rng() < 0.5; }

  reveal() {
    const card = this.cards[this.stage];
    const gains: Record<string, number> = {};
    for (const [id, a] of this.answers) {
      if (a.v !== card.allow) continue;
      gains[id] = this.speedPts(a.t);
      this.add(id, gains[id]);
      this.right.set(id, (this.right.get(id) ?? 0) + 1);
    }
    return { allow: card.allow, why: card.why, gains };
  }

  stageView() {
    const { who, action, resource, statements } = this.cards[this.stage];
    return { card: { who, action, resource, statements } };
  }

  headline() {
    const top = [...this.right].sort((a, b) => b[1] - a[1])[0];
    return top ? `🔐 ${this.name(top[0])} judged ${top[1]}/${CARDS} correctly` : '🔐 Every request was mishandled. Very realistic.';
  }

  awards() {
    const a = mostAward(this.ctx.players, id => (this.right.get(id) ?? 0) === CARDS ? 1 : 0, '🛡️', 'Security Team', () => 'got every card right');
    return a ? [a] : [];
  }
}

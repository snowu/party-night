// Round content. Trivia leans on the house style (cloud satire) with some general
// knowledge so non-engineers on the team have a fair shot.

// [question, correct, wrong, wrong, wrong]
export const QUIZ: [string, string, string, string, string][] = [
  ['Which AWS region is famous for taking the internet down with it?', 'us-east-1', 'eu-west-2', 'ap-south-1', 'sa-east-1'],
  ['In an IAM policy, what beats an explicit Allow?', 'An explicit Deny', 'A wildcard Allow', 'The root account', 'A strongly worded ticket'],
  ['What does the "S3" in Amazon S3 stand for?', 'Simple Storage Service', 'Secure Storage Server', 'Scalable Static Store', 'Super Serious Storage'],
  ['What HTTP status code means "I\'m a teapot"?', '418', '404', '451', '503'],
  ['Which of these is NOT a real AWS service name?', 'Amazon Kerfuffle', 'Amazon Kinesis', 'AWS Snowmobile', 'Amazon Honeycode'],
  ['What does DNS stand for?', 'Domain Name System', 'Data Network Service', 'Distributed Node Switch', 'Do Not Ship'],
  ['How many bits are in a byte?', '8', '4', '16', '10'],
  ['What is the principle of least privilege?', 'Grant only the permissions a job needs', 'Interns get read-only', 'Nobody gets admin on Fridays', 'Root for emergencies only'],
  ['Which company created Kubernetes?', 'Google', 'Amazon', 'Microsoft', 'Red Hat'],
  ['What does "MFA" stand for?', 'Multi-Factor Authentication', 'Managed Firewall Access', 'Mandatory Flag Approval', 'Maximum Failed Attempts'],
  ['What colour is the AWS "smile" arrow in the logo?', 'Orange', 'Blue', 'Green', 'Black'],
  ['What does a 503 status code mean?', 'Service Unavailable', 'Not Found', 'Forbidden', 'Gateway Timeout'],
  ['In Git, what does "HEAD" usually point to?', 'The current branch tip', 'The first commit', 'The remote', 'The stash'],
  ['What is the capital of Australia?', 'Canberra', 'Sydney', 'Melbourne', 'Perth'],
  ['Which planet has the most known moons?', 'Saturn', 'Jupiter', 'Uranus', 'Neptune'],
  ['What is the largest ocean on Earth?', 'Pacific', 'Atlantic', 'Indian', 'Arctic'],
  ['Which language has the most native speakers?', 'Mandarin Chinese', 'English', 'Spanish', 'Hindi'],
  ['How many players are on a football (soccer) team on the pitch?', '11', '10', '9', '12'],
  ['What is the chemical symbol for gold?', 'Au', 'Ag', 'Gd', 'Go'],
  ['In what decade was the World Wide Web invented?', '1980s', '1970s', '1990s', '1960s'],
  ['What does "YAML" officially stand for?', "YAML Ain't Markup Language", 'Yet Another Markup Language', 'Your API Means Lambda', 'Yielding Abstract Meta Logic'],
  ['Which of these is a NoSQL database from AWS?', 'DynamoDB', 'Aurora', 'Redshift', 'RDS'],
  ['What does a CDN mainly do?', 'Serve content from servers near the user', 'Encrypt databases', 'Run cron jobs', 'Count daily nodes'],
  ['Which animal is on the O\'Reilly book "Learning Perl"?', 'Llama', 'Camel', 'Alpaca', 'Owl'],
  ['What does "IAM" stand for in AWS?', 'Identity and Access Management', 'Internal Access Monitor', 'Infrastructure As Markup', 'I Am Me'],
  ['A NAT Gateway mostly lets private subnets do what?', 'Reach the internet outbound', 'Accept inbound traffic', 'Talk to S3 for free', 'Lower your bill'],
  ['What is the most common default port for HTTPS?', '443', '80', '8080', '22'],
  ['Which of these is the hardest natural substance?', 'Diamond', 'Quartz', 'Titanium', 'Graphite'],
  ['What is a "rubber duck" used for in programming?', 'Explaining code out loud to find bugs', 'Load testing', 'Mocking APIs', 'Bath-time deploys'],
  ['How many minutes is a standard football (soccer) match, not counting stoppage time?', '90', '80', '100', '60'],
];

// [question, number]: only facts that don't drift.
export const CLOSEST: [string, number][] = [
  ['How many bones are in the adult human body?', 206],
  ['How many keys does a standard piano have?', 88],
  ['In what year did Apollo 11 land on the Moon?', 1969],
  ['How tall is Mount Everest, in metres?', 8849],
  ['In what year was Python first released?', 1991],
  ['In what year was Git first released?', 2005],
  ['How many minutes are there in a week?', 10080],
  ['How many elements are in the periodic table?', 118],
  ['How many squares of all sizes are there on a chessboard?', 204],
  ["What's the largest number a signed 32-bit integer can hold?", 2147483647],
  ['In what year did the Titanic sink?', 1912],
  ['In what year was AWS S3 launched?', 2006],
  ['How many seconds are there in a day?', 86400],
  ['Unix time counts seconds since January 1st of which year?', 1970],
  ['How long is a marathon, in metres?', 42195],
  ['How many characters could a tweet have when Twitter launched?', 140],
];

export const HOT_TAKES = [
  'Tabs are better than spaces', 'Pineapple belongs on pizza', 'Meetings without an agenda should be cancelled automatically',
  'Cameras should be on in every video call', 'Dark mode is the only acceptable mode', 'Deploying on a Friday is fine',
  'Working from home beats the office', 'Most stand-ups could be a Slack message', 'Story points are made up',
  'Replying "ok." with a full stop is passive-aggressive', 'A hot dog is a sandwich', 'Cereal is a soup',
  'Mondays aren\'t that bad', 'Emojis belong in work emails', 'We should all have a four-day week',
  'Good code doesn\'t need comments', 'Retros are the best meeting of the sprint', 'YAML was a mistake',
  'Every service should have been a monolith', 'Terraform state is a cry for help',
];

export const WRITE_PROMPTS = [
  'The worst bug you ever shipped', 'Your most-used emoji', 'The first concert you went to', 'A weird food combo you secretly love',
  'Your go-to karaoke song', 'Your very first job', 'The app you\'d delete from everyone\'s phone', 'Your guilty-pleasure TV show',
  'A skill nobody here knows you have', 'Your most controversial coffee opinion', 'The best thing that happened this sprint',
  'Your dream retirement, in one sentence', 'What you\'d name a pet cloud server',
];

export const BOT_WRITES = [
  'I plead the fifth', 'Rebooting it fixed it', 'It works on my machine', 'A strongly typed sandwich', 'us-east-1, obviously',
  'Have you tried turning it off and on again', 'Kevin from Billing knows', 'Something with too much YAML',
];

export const WORDS = [
  'cat', 'dog', 'pizza', 'rocket', 'banana', 'unicorn', 'snowman', 'volcano', 'octopus', 'robot', 'ghost', 'dragon', 'castle', 'rainbow',
  'guitar', 'bicycle', 'umbrella', 'penguin', 'giraffe', 'spider', 'cactus', 'mermaid', 'pirate', 'tornado', 'sandwich',
  'laptop', 'coffee', 'keyboard', 'printer', 'deadline', 'meeting', 'bug', 'cloud', 'rubber duck', 'sticky note',
  'spaghetti', 'hamburger', 'ice cream', 'popcorn', 'birthday cake', 'toothbrush', 'lighthouse', 'submarine', 'helicopter',
  'snail', 'shark', 'crab', 'flamingo', 'sloth', 'zombie', 'wizard', 'alien', 'ninja', 'astronaut', 'dinosaur', 'chicken',
  'mustache', 'crown', 'trophy', 'fire', 'tree', 'mushroom', 'island', 'pyramid', 'moon', 'clock', 'bomb', 'key', 'anchor', 'kite', 'bridge',
];

export const PERFORM: [string, 'song' | 'movie'][] = [
  ['Bohemian Rhapsody', 'song'], ['Africa', 'song'], ['Never Gonna Give You Up', 'song'], ['Billie Jean', 'song'],
  ["Sweet Child O' Mine", 'song'], ['Wonderwall', 'song'], ['Hey Jude', 'song'], ['Yellow Submarine', 'song'],
  ['Single Ladies', 'song'], ['Happy', 'song'], ['Macarena', 'song'], ['YMCA', 'song'], ['Dancing Queen', 'song'],
  ['Take On Me', 'song'], ["Livin' on a Prayer", 'song'], ['Eye of the Tiger', 'song'], ['We Will Rock You', 'song'],
  ["Stayin' Alive", 'song'], ['Thriller', 'song'], ['Toxic', 'song'], ['My Heart Will Go On', 'song'], ['Gangnam Style', 'song'],
  ['Seven Nation Army', 'song'], ['The Final Countdown', 'song'], ['Barbie Girl', 'song'], ['Let It Go', 'song'],
  ['Star Wars', 'movie'], ['Jaws', 'movie'], ['Mission: Impossible', 'movie'], ['Jurassic Park', 'movie'], ['Harry Potter', 'movie'],
  ['The Pink Panther', 'movie'], ['Ghostbusters', 'movie'], ['Rocky', 'movie'], ['The Lion King', 'movie'], ['Indiana Jones', 'movie'],
  ['Pirates of the Caribbean', 'movie'], ['James Bond', 'movie'], ['Back to the Future', 'movie'], ['Titanic', 'movie'], ['E.T.', 'movie'],
];

export const MOST_LIKELY = [
  'Most likely to push straight to main', 'Most likely to reply-all', 'Most likely to survive a zombie apocalypse',
  'Most likely to have 200 browser tabs open', 'Most likely to fix prod in their pyjamas', 'Most likely to become famous',
  'Most likely to forget they\'re unmuted', 'Most likely to rewrite it in Rust', 'Most likely to bring snacks to the office',
  'Most likely to schedule a meeting about meetings', 'Most likely to win a hot-dog-eating contest', 'Most likely to adopt a fifth cat',
  'Most likely to become a Kubernetes influencer', 'Most likely to still be online at 2am', 'Most likely to name a variable "thing2"',
];

export const BOT_NAMES = [
  'Clippy', 'Kevin from Billing', 'NAT Gateway', 'Lambda Cold Start', 'Terraform Plan',
  'Root Account', 'Chaos Monkey', 'us-east-1', 'Intern #47', 'Legacy Monolith',
  'YAML Engineer', 'On-call Pager', 'CloudWatch Alarm', 'Sev-2', 'Jeff (bot)',
];

// Lowercase, no accents, no punctuation, no leading article: "The Rubber-Duck!" → "rubber duck".
export const norm = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, ' ').trim().replace(/^(a|an|the) /, '');

// A guess counts give or take a plural, spacing or a trailing "theme"/"song", or when it
// contains every word of a multi-word answer.
export function guessMatches(guess: string, answer: string): boolean {
  const g = norm(guess).replace(/ (theme|song|movie|film)$/, '');
  const a = norm(answer);
  if (!g || !a) return false;
  if (g === a || g === a + 's' || g + 's' === a || g.replace(/ /g, '') === a.replace(/ /g, '')) return true;
  const aw = a.split(' '), gw = g.split(' ');
  return aw.length >= 2 && gw.length <= aw.length + 3 && aw.every(w => gw.includes(w) || gw.includes(w + 's'));
}

export function lev(a: string, b: string): number {
  const d = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0];
    d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const t = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = t;
    }
  }
  return d[b.length];
}

// ── the satire rounds ───────────────────────────────────────────────────────

// Root Cause Analysis: [fact with ___, the real answer, fakes the bots write]. All true.
export const ROOT_CAUSES: [string, string, string[]][] = [
  ['In 1947, Harvard engineers taped a ___ into their logbook as the "first actual case of bug being found".', 'moth', ['cockroach', 'mouse tail', 'paperclip', 'spider']],
  ['HTTP status code 418 means "I\'m a ___".', 'teapot', ['toaster', 'little busy', 'potato', 'printer']],
  ['Before it was JavaScript, the language was called ___.', 'Mocha', ['NetScript', 'Coffee', 'BrowserTalk', 'Java Lite']],
  ['Java was originally called ___.', 'Oak', ['Kona', 'Greenbean', 'Brew', 'Pine']],
  ['The first webcam was pointed at a ___ in a Cambridge University lab.', 'coffee pot', ['fish tank', 'printer queue', 'door', 'goldfish']],
  ['In 2016, unpublishing an 11-line npm package called ___ broke builds across the internet.', 'left-pad', ['is-even', 'trim-left', 'pad-start', 'string-utils']],
  ['The big 2017 AWS S3 outage started with a ___.', 'typo', ['squirrel', 'leap second', 'intern', 'solar flare']],
  ['The Agile Manifesto was written at a ski resort in ___.', 'Utah', ['Colorado', 'Switzerland', 'Vermont', 'Aspen']],
  ['The word "Scrum" was borrowed from ___.', 'rugby', ['baking', 'sailing', 'a typo', 'wrestling']],
  ['Kanban was developed at ___.', 'Toyota', ['IKEA', 'Sony', 'McDonald\'s', 'Honda']],
  ['Bluetooth is named after a Danish ___.', 'king', ['dentist', 'cheese', 'ferry', 'footballer']],
  ['The Python language is named after ___.', 'Monty Python', ['a pet snake', 'a font', 'a Dutch bakery', 'Guido\'s car']],
  ['Ward Cunningham, who coined "technical debt", also invented the ___.', 'wiki', ['stand-up meeting', 'pull request', 'sprint', 'kanban board']],
  ['"Rubber duck debugging" comes from the book "The Pragmatic ___".', 'Programmer', ['Plumber', 'Duck', 'Debugger', 'Architect']],
];

// Alignment Meeting: [prompt, the answers bots reach for, most popular first].
export const HIVEMIND: [string, string[]][] = [
  ['Name a Jira ticket status', ['In Progress', 'Done', 'To Do', 'Blocked', 'In Review', 'Backlog']],
  ['Name a programming language', ['Python', 'JavaScript', 'Java', 'Rust', 'Go', 'C']],
  ['A word you hear at every stand-up', ['blocked', 'yesterday', 'sync', 'ticket', 'PR', 'today']],
  ['Name a cloud provider', ['AWS', 'Azure', 'Google Cloud', 'Cloudflare', 'Oracle']],
  ['Something in every office kitchen', ['coffee', 'microwave', 'fridge', 'mugs', 'passive-aggressive note']],
  ['An excuse for a missed deadline', ['scope creep', 'it works on my machine', 'meetings', 'dependencies', 'sick']],
  ['Name a Scrum ceremony', ['stand-up', 'retro', 'planning', 'review', 'refinement']],
  ['Name a text editor', ['VS Code', 'Vim', 'Notepad', 'Emacs', 'Sublime']],
  ['A meeting that should have been an email', ['status update', 'all hands', 'sync', 'stand-up', 'kickoff']],
  ['Something that is always on fire', ['prod', 'the backlog', 'the build', 'my inbox', 'the server room']],
  ['Name a JavaScript framework', ['React', 'Vue', 'Angular', 'Svelte', 'Next.js']],
  ['Name a Git command', ['commit', 'push', 'pull', 'rebase', 'merge', 'status']],
];

// Performance Review: bots' [truth, truth, lie].
export const BOT_REVIEWS: [string, string, string][] = [
  ['I once deployed on a Friday and nothing broke', 'I own a mechanical keyboard', 'I have never force-pushed to main'],
  ['I have a Jira ticket older than my laptop', 'I know my way around vim', 'I read every PR before approving it'],
  ['I own more than three rubber ducks', 'I once replied-all to the whole company', 'My code has no TODOs'],
  ['I named a variable after my cat', 'I have cried during a merge conflict', 'I always update the docs'],
  ['I have 47 browser tabs open right now', 'I wrote a regex I no longer understand', 'I estimate tickets accurately'],
];

// Code Review: two people answer the same prompt, the room merges one.
export const REVIEW_PROMPTS = [
  'The worst possible name for a microservice', 'What the TODO comment from 2014 says', 'The real reason the deploy failed',
  'A rejected fifth value of the Agile Manifesto', 'A new Jira status nobody asked for', 'The worst thing to hear in a retro',
  "The senior dev's only comment on your 3,000-line PR", 'A sprint goal that guarantees failure',
  'The commit message right before the outage', 'A new Scrum ceremony nobody needs', 'What "quick sync" actually means',
  'An honest job title for whoever maintains the build', 'The worst thing to find in a config file', 'A feature flag name that should worry everyone',
];
export const BOT_QUIPS = [
  'LGTM 👍', 'It worked on my machine', 'git push --force and pray', 'Synergy-as-a-Service', 'Blocked by legal',
  'fix: fix the fix', 'A meeting about the meeting', 'Just one more microservice', 'The intern did it',
  "Ship it, we'll fix it in prod", 'Story points: yes', 'TODO: delete this before launch', 'Kevin from Billing',
];

// Incident Response: what the page says when it finally goes off.
export const ALERTS = [
  'prod-db-01: disk 100% full', 'TLS certificate expired 4 minutes ago', 'Someone pushed to main on a Friday',
  'p99 latency: 45 seconds', 'An S3 bucket is public', "The CEO can't log in", "DNS. It's always DNS.",
  'Kafka consumer lag: yes', 'us-east-1 is having a moment', 'The intern found the admin password',
  'Error rate 100% (the dashboard is fine though)', 'Cron job deleted the backups',
];

// Planning Poker: [estimate this, the real number]. All true.
export const ESTIMATES: [string, number][] = [
  ['In what year was the Agile Manifesto written?', 2001],
  ['How many people signed the original Agile Manifesto?', 17],
  ['How many principles sit behind the Agile Manifesto?', 12],
  ['In what year was the first Scrum Guide published?', 2010],
  ['In what year did Linus Torvalds announce Linux?', 1991],
  ['How many bits are in an IPv6 address?', 128],
  ['Which port does PostgreSQL listen on by default?', 5432],
  ['In what year did Stack Overflow launch?', 2008],
  ['How many characters long is a SHA-256 hash written in hex?', 64],
  ['How many lines of code was the npm package left-pad?', 11],
  ['In what year does a signed 32-bit Unix timestamp overflow?', 2038],
  ['In how many days did Brendan Eich write the first JavaScript?', 10],
  ['In what year was the first email sent?', 1971],
  ['How many people does the 2020 Scrum Guide say a Scrum Team should be, at most?', 10],
];

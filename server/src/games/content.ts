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

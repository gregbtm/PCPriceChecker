// Reddit API integration — r/buildapc community recommendations and
// r/buildapcsales UK deal posts.
//
// Setup: create a "script" app at https://www.reddit.com/prefs/apps
// Set user-agent to: "uk-pc-price-mcp/1.0 by <your_reddit_username>"
// Keys: REDDIT_CLIENT_ID (app ID), REDDIT_CLIENT_SECRET (app secret)
// No refresh token needed — uses OAuth2 client_credentials (read-only).

const REDDIT_TOKEN_URL = 'https://www.reddit.com/api/v1/access_token';
const REDDIT_API_BASE  = 'https://oauth.reddit.com';
const TIMEOUT_MS = 8000;
const USER_AGENT = 'uk-pc-price-mcp/1.0 (community recommendations tool)';

let _token: { value: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (_token && _token.expiresAt > Date.now() + 60_000) return _token.value;

  const clientId = process.env.REDDIT_CLIENT_ID;
  const secret   = process.env.REDDIT_CLIENT_SECRET;
  if (!clientId || !secret) throw new Error('REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET not set');

  const creds = Buffer.from(`${clientId}:${secret}`).toString('base64');
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(REDDIT_TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${creds}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': USER_AGENT,
      },
      body: 'grant_type=client_credentials',
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`Reddit auth ${res.status}`);
    const data: any = await res.json();
    _token = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
    return _token.value;
  } finally {
    clearTimeout(timeout);
  }
}

async function redditGet(path: string, params: Record<string, string> = {}): Promise<any> {
  const token = await getAccessToken();
  const url = new URL(`${REDDIT_API_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': USER_AGENT },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`Reddit API ${res.status}`);
    return res.json();
  } finally {
    clearTimeout(timeout);
  }
}

export interface RedditPost {
  id: string;
  title: string;
  subreddit: string;
  score: number;
  numComments: number;
  url: string;
  selftext: string;
  author: string;
  createdUtc: number;
  createdDate: string;
  flair: string | null;
  permalink: string;
}

export interface RedditSearchResult {
  query: string;
  subreddit: string;
  posts: RedditPost[];
  fetchedAt: string;
  error?: string;
}

function mapPost(child: any): RedditPost {
  const d = child.data;
  return {
    id: d.id,
    title: d.title,
    subreddit: d.subreddit,
    score: d.score,
    numComments: d.num_comments,
    url: d.url,
    selftext: (d.selftext ?? '').slice(0, 500),
    author: d.author,
    createdUtc: d.created_utc,
    createdDate: new Date(d.created_utc * 1000).toISOString().split('T')[0],
    flair: d.link_flair_text ?? null,
    permalink: `https://reddit.com${d.permalink}`,
  };
}

export async function searchBuildapc(
  query: string,
  sortBy: 'relevance' | 'top' | 'new' = 'relevance',
  maxResults = 10,
): Promise<RedditSearchResult> {
  const fetchedAt = new Date().toISOString();
  const subreddit = 'buildapc';

  if (!process.env.REDDIT_CLIENT_ID) {
    return { query, subreddit, posts: [], fetchedAt, error: 'REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET not configured.' };
  }

  try {
    const data = await redditGet(`/r/${subreddit}/search`, {
      q: query,
      restrict_sr: 'true',
      sort: sortBy,
      t: 'year',
      limit: String(Math.min(maxResults, 25)),
    });

    const posts = (data.data?.children ?? []).map(mapPost);
    return { query, subreddit, posts, fetchedAt };
  } catch (err: any) {
    return { query, subreddit, posts: [], fetchedAt, error: String(err.message) };
  }
}

export async function getUkDeals(maxResults = 15): Promise<RedditSearchResult> {
  const fetchedAt = new Date().toISOString();
  const subreddit = 'buildapcsales';

  if (!process.env.REDDIT_CLIENT_ID) {
    return { query: 'UK deals', subreddit, posts: [], fetchedAt, error: 'REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET not configured.' };
  }

  try {
    // Search for recent posts tagged UK or with UK retailers
    const data = await redditGet(`/r/${subreddit}/search`, {
      q: 'UK | Scan | Overclockers | Ebuyer | Amazon.co.uk | CCL',
      restrict_sr: 'true',
      sort: 'new',
      t: 'week',
      limit: String(Math.min(maxResults, 25)),
    });

    const posts = (data.data?.children ?? [])
      .map(mapPost)
      .filter((p: RedditPost) =>
        /uk|scan|overclockers|ebuyer|amazon\.co\.uk|ccl|argos|currys/i.test(
          p.title + ' ' + p.selftext,
        ),
      );
    return { query: 'UK deals', subreddit, posts, fetchedAt };
  } catch (err: any) {
    return { query: 'UK deals', subreddit, posts: [], fetchedAt, error: String(err.message) };
  }
}

export async function getBuildRecommendations(
  budget: number,
  useCase: string,
): Promise<RedditSearchResult> {
  const query = `${useCase} build £${budget} UK`;
  return searchBuildapc(query, 'relevance', 8);
}

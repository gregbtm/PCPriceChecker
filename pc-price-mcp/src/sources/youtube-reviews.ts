// YouTube Data API v3 — find review videos for PC components.
// API key: YOUTUBE_API_KEY (Google Cloud Console → APIs & Services → YouTube Data API v3)
// Free quota: 10,000 units/day (1 search = 100 units, so ≈100 searches/day free).

const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';
const TIMEOUT_MS = 8000;

// Channels known for high-quality, trustworthy PC hardware reviews
const TRUSTED_CHANNELS: Record<string, string> = {
  'UCXuqSBlHAE6Xw-yeJA0Tunw': 'Linus Tech Tips',
  'UChIs72whgZI9w6d6FhwGGHA': 'Gamers Nexus',
  'UC0vBXGSyV14uvJ4hECDOl0Q': 'Hardware Unboxed',
  'UCRYOj4DmyxzbkLS-ywjoy5w': 'Digital Foundry',
  'UCCss5QbjZQ42QZ6iKD6TSAw': 'JayzTwoCents',
  'UCBJycsmduvYEL83R_U4JriQ': 'Marques Brownlee',
  'UCXzeSgs8a1yd6-4mOhfEt-A': "Paul's Hardware",
  'UCFDR-OPAhqr3H7KKtgEA4YQ': 'TechPowerUp',
  'UCHXbr4097NhJv-xe6gVsm6g': 'Techquickie',
  'UC8wWQrSOLwmkbmLjTkvWv3w': 'Dawid Does Tech Stuff',
};

export interface YouTubeReview {
  videoId: string;
  title: string;
  channelName: string;
  channelId: string;
  publishedAt: string;
  viewCount: string | null;
  thumbnailUrl: string;
  url: string;
  isTrustedChannel: boolean;
}

export interface YouTubeSearchResult {
  query: string;
  videos: YouTubeReview[];
  trustedFirst: boolean;
  fetchedAt: string;
  error?: string;
}

async function youtubeGet(endpoint: string, params: Record<string, string>): Promise<any> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) throw new Error('YOUTUBE_API_KEY not set');

  const url = new URL(`${YOUTUBE_API_BASE}/${endpoint}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set('key', apiKey);

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), { signal: ctrl.signal });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`YouTube API ${res.status}: ${body.slice(0, 200)}`);
    }
    return res.json();
  } finally {
    clearTimeout(timeout);
  }
}

export async function findComponentReviews(
  componentName: string,
  maxResults = 8,
  trustedOnly = false,
): Promise<YouTubeSearchResult> {
  const query = `${componentName} review`;
  const fetchedAt = new Date().toISOString();

  if (!process.env.YOUTUBE_API_KEY) {
    return {
      query,
      videos: [],
      trustedFirst: true,
      fetchedAt,
      error: 'YOUTUBE_API_KEY not configured. Set it in your environment to enable review search.',
    };
  }

  try {
    // Search YouTube
    const searchData = await youtubeGet('search', {
      part: 'snippet',
      q: query,
      type: 'video',
      regionCode: 'GB',
      relevanceLanguage: 'en',
      maxResults: String(Math.min(maxResults + 5, 25)),
      order: 'relevance',
    });

    if (!searchData.items?.length) {
      return { query, videos: [], trustedFirst: true, fetchedAt };
    }

    const videoIds: string[] = searchData.items.map((i: any) => i.id.videoId).filter(Boolean);

    // Fetch video statistics in one batch call
    let statsMap: Record<string, string> = {};
    if (videoIds.length > 0) {
      try {
        const statsData = await youtubeGet('videos', {
          part: 'statistics',
          id: videoIds.join(','),
        });
        for (const item of statsData.items ?? []) {
          statsMap[item.id] = item.statistics?.viewCount ?? null;
        }
      } catch {
        // Stats are optional — continue without them
      }
    }

    let videos: YouTubeReview[] = searchData.items.map((item: any) => {
      const vid = item.id.videoId;
      const snippet = item.snippet;
      const channelId = snippet.channelId;
      return {
        videoId: vid,
        title: snippet.title,
        channelName: snippet.channelTitle,
        channelId,
        publishedAt: snippet.publishedAt,
        viewCount: statsMap[vid] ?? null,
        thumbnailUrl: snippet.thumbnails?.medium?.url ?? snippet.thumbnails?.default?.url ?? '',
        url: `https://www.youtube.com/watch?v=${vid}`,
        isTrustedChannel: channelId in TRUSTED_CHANNELS,
      };
    });

    if (trustedOnly) {
      videos = videos.filter(v => v.isTrustedChannel);
    }

    // Sort: trusted channels first, then by view count
    videos.sort((a, b) => {
      if (a.isTrustedChannel !== b.isTrustedChannel) return a.isTrustedChannel ? -1 : 1;
      return parseInt(b.viewCount ?? '0') - parseInt(a.viewCount ?? '0');
    });

    return {
      query,
      videos: videos.slice(0, maxResults),
      trustedFirst: true,
      fetchedAt,
    };
  } catch (err: any) {
    return { query, videos: [], trustedFirst: true, fetchedAt, error: String(err.message) };
  }
}

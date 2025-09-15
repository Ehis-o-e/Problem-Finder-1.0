import fetch from 'node-fetch';
import dotenv from 'dotenv';
import { redisClient } from '../config/redis.js';
import type { RedditPost, RedditResponse} from '../types/index.js';

dotenv.config();

export async function rateLimitDelay(){
  const lastRequestKey = 'reddit:lastRequestTime';
  const minDelayMs = 1100; 

  try {
    const lastRequestTime = await redisClient.get(lastRequestKey);
    if (lastRequestTime) {
      const elapsedTime = Date.now() - parseInt(lastRequestTime);

      if (elapsedTime < minDelayMs) {
        const waitTime = minDelayMs - elapsedTime;
        console.log(`Rate limiting: waiting ${waitTime}ms before next request`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
    await redisClient.set(lastRequestKey, Date.now().toString());
  } catch (error) {
    console.error('Rate limit tracking error:', error);
    // If Redis fails, just add a basic delay as fallback
    await new Promise(resolve => setTimeout(resolve, 1100));
  }
}

export async function trackAPIUsage(): Promise<void> {
  const now = new Date();
  const hourKey = `reddit:usage:${now.getUTCFullYear()}-${now.getUTCMonth()}-${now.getUTCDate()}-${now.getUTCHours()}`;
  const dayKey = `reddit:usage:${now.getUTCFullYear()}-${now.getUTCMonth()}-${now.getUTCDate()}`;

  try{
    const hourlyCount = await redisClient.incr(hourKey);
    await redisClient.expire(hourKey, 7200);

    const dailyCount = await redisClient.incr(dayKey);
    await redisClient.expire(dayKey, 172800);

    console.log(`Reddit API usage - Last hour: ${hourlyCount}, Today: ${dailyCount}`);

    if (hourlyCount > 50) {
      console.warn(`⚠️  High API usage this hour: ${hourlyCount} requests`);
    }
  }catch(error){
    console.error('API usage tracking error:', error);
  }
}


export async function getRedditToken(){
  const clientId = process.env.REDDIT_CLIENT_ID;
  const clientSecret = process.env.REDDIT_CLIENT_SECRET;


  if (!clientId||!clientSecret) {
    throw new Error('Missing Reddit API credentials');
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');  

   const res = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
    })
  });

  const data:any = await res.json();

  if (!res.ok) {
    throw new Error(data.error || 'Failed to get token');
  }

  return data.access_token; // use this token for Reddit API calls
}

export async function fetchSubredditPosts(subreddit: string): Promise<RedditResponse> {

  const cached = await redisClient.get(`subreddit:${subreddit}`);
  if (cached) {
    console.log(`Cache HIT for ${subreddit}`);
    return JSON.parse(cached) as RedditResponse;
  }
  console.log(`Cache MISS for ${subreddit} - fetching fresh`);

  await rateLimitDelay();
  await trackAPIUsage();

  const token = await getRedditToken();
  const res = await fetch(`https://oauth.reddit.com/r/${subreddit}/hot`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'User-Agent': process.env.REDDIT_USER_AGENT||'ProblemDiscoveryBot/1.0'
    }
  });

  if (!res.ok) {
  throw new Error(`Failed to fetch: ${res.status} ${res.statusText}`);
  }

  const data = await res.json() as RedditResponse;

  try {
    const cacheKey = `subreddit:${subreddit}`;
    const cacheValue = JSON.stringify(data);
    const expirationSeconds = 15 * 60; // 15 minutes
    
    await redisClient.setEx(cacheKey, expirationSeconds, cacheValue);
    console.log(`Cached ${subreddit} for 15 minutes`);
  } catch (error) {
    console.error('Cache write error:', error);
  }

  return data;
}

export function filterProblemFromPost(posts: RedditResponse[]): RedditPost[]{
  const problemKeywords = [
      "i wish", "need help", "problem", "issue", "struggle",
      "difficult", "hard to", "can't find", "looking for",
      "frustrated", "annoying", "hate when"
  ];

 const allPosts = posts.flatMap(response => 
    response.data.children.map(child => child.data)
  );

  return allPosts.filter(post => {
    const fullText =  `${post.title} ${post.selftext||''}`.toLowerCase();
    const hasProblems = problemKeywords.some(keyword => fullText.includes(keyword))
    return hasProblems;
  })
}


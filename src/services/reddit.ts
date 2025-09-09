import fetch from 'node-fetch';
import dotenv from 'dotenv';
import { redisClient } from '../config/redis.js';
import type { RedditPost, RedditResponse} from '../types/index.js';

dotenv.config();

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




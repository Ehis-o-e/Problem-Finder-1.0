import fetch from 'node-fetch';
import dotenv from 'dotenv';
import type { RedditResponse} from '../types/index.js';

dotenv.config();

export async function fetchSubredditPosts(subreddit: string): Promise<RedditResponse> {

    const url = `https://www.reddit.com/r/${subreddit}/new.json`;
    const response = await fetch(url);

    if (!response.ok) {
    throw new Error(`Failed to fetch: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as RedditResponse;

  return data;
}
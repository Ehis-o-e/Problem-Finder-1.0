import fetch from 'node-fetch';
import dotenv from 'dotenv';
import { redisClient } from '../config/redis.js';
import type { RedditPost, 
            RedditResponse, 
            ClassifiedPost, 
            ClassifyAndFilterResult  } from '../types/index.js';
import { RuleBasedClassifier } from '../classification/rule-base-classification.js';
import { supabase } from '../config/database.js';

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
      console.warn(`High API usage this hour: ${hourlyCount} requests`);
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

export async function classifyAndFilterPosts(
  posts: RedditResponse[], 
  useClassifier: boolean = true,
  saveToDatabase: boolean = false
): Promise<ClassifyAndFilterResult>{
  
  const classifier = new RuleBasedClassifier();
  
  // Extract all posts with complete RedditPost fields
  const allPosts = posts.flatMap(response => 
    response.data.children.map(child => ({
      id: child.data.id,
      title: child.data.title,
      selftext: child.data.selftext || '',
      url: child.data.url,
      score: child.data.score,
      num_comments: child.data.num_comments,
      created_utc: child.data.created_utc,
      subreddit: child.data.subreddit
    }))
  );

  let problemPosts: RedditPost[] = [];
  let classifiedPosts: ClassifiedPost[] = [];
  
  if (useClassifier) {
    // Use intelligent classification
    classifiedPosts = allPosts.map(post => {
      const classification = classifier.classifyPost(post);
      return { ...post, classification };
    });
    
    problemPosts = classifiedPosts
      .filter(post => post.classification.isRealProblem)
      .map(post => {
        const { classification, ...redditPost } = post;
        return redditPost;
      });
  } else {
    // Use basic keyword filtering (your original logic)
    problemPosts = filterProblemFromPost(posts);
    classifiedPosts = problemPosts.map(post => ({
      ...post,
      classification: {
        isRealProblem: true,
        category: 'general' as const,
        confidence: 0.5,
        reasoning: 'Classified using basic keyword filtering',
        keywords: []
      }
    }));
  }

  // Calculate stats
  const categoryBreakdown = classifiedPosts
    .filter(post => post.classification.isRealProblem)
    .reduce((acc, post) => {
      const category = post.classification.category;
      acc[category] = (acc[category] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

  const stats = {
    totalPosts: allPosts.length,
    problemsFound: problemPosts.length,
    categoryBreakdown
  };

  // Save to database if requested
  if (saveToDatabase && problemPosts.length > 0) {
    await saveProblemsToDB(classifiedPosts.filter(post => post.classification.isRealProblem));
  }

  return {
    classifiedPosts,
    problemPosts,
    stats
  };
}

async function saveProblemsToDB(
  classifiedProblems: ClassifiedPost[]
): Promise<void> {
  try {
const { data: categories, error: categoryError } = await supabase
      .from('categories')
      .select('id, name');
    
    if (categoryError) {
      console.error('Error fetching categories:', categoryError);
      return;
    }


    // Create category name -> UUID mapping (case insensitive)
    const categoryMap = categories?.reduce((acc, cat) => {
      acc[cat.name.toLowerCase()] = cat.id;
      return acc;
    }, {} as Record<string, string>) || {};

    console.log('Category mapping:', categoryMap); // Debug log

    const problemRecords = classifiedProblems.map(post => ({
      
      title: post.title,
      description: post.selftext || null,
      source_type: 'reddit',
      source_id: post.id,
      source_url: post.url,
      engagement_score: post.score + post.num_comments, // Simple engagement calculation
      recency_score: calculateRecencyScore(post.created_utc),
      final_score: post.classification.confidence,
      keywords: post.classification.keywords,
      // created_at and updated_at will be auto-generated by Supabase
    }));

    const { error } = await supabase
      .from('problems')
      .insert(problemRecords)

    if (error) {
      console.error('Error saving problems to database:', error);
    } else {
      console.log(`Saved ${problemRecords.length} problems to database`);
    }
  } catch (error) {
    console.error('Database save failed:', error);
  }
}

export function calculateRecencyScore(created_utc: number): number {
  const now = Date.now() / 1000; // Current time in seconds
  const age = now - created_utc; // Age in seconds
  const ageInDays = age / (24 * 60 * 60);
  
  // Recent posts get higher scores (1.0 for today, decreases over time)
  return Math.max(0, 1 - (ageInDays / 30)); // Score decreases over 30 days
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


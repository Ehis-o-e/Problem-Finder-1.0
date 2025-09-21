import fetch from 'node-fetch';
import { redisClient } from '../config/redis.js';
import type { FetchStackExchangeResult, StackExchangeQuestion, StackExchangeResponse } from '../types/index.js';
import { RuleBasedClassifier } from '../classification/rule-base-classification.js';



// Rate limiting for Stack Exchange (10,000 requests/day)
export async function stackExchangeDelay() {
  const lastRequestKey = 'stackexchange:lastRequestTime';
  const minDelayMs = 1100; // Be respectful to SE API

  try {
    const lastRequestTime = await redisClient.get(lastRequestKey);
    if (lastRequestTime) {
      const elapsedTime = Date.now() - parseInt(lastRequestTime);
      if (elapsedTime < minDelayMs) {
        const waitTime = minDelayMs - elapsedTime;
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
    await redisClient.set(lastRequestKey, Date.now().toString());
  } catch (error) {
    console.error('Stack Exchange rate limit tracking error:', error);
    await new Promise(resolve => setTimeout(resolve, 1100));
  }
};

//Track API usage
export async function trackStackExchangeUsage(): Promise<void> {
  const now = new Date();
  const dayKey = `stackexchange:usage:${now.getUTCFullYear()}-${now.getUTCMonth()}-${now.getUTCDate()}`;

  try {
    const dailyCount = await redisClient.incr(dayKey);
    await redisClient.expire(dayKey, 172800); // 48 hours expiry

    console.log(`Stack Exchange API usage - Today: ${dailyCount}/10000`);

    // Warning thresholds
    if (dailyCount > 8000) {
      console.warn(`HIGH Stack Exchange usage: ${dailyCount}/10000 requests today`);
    } else if (dailyCount > 5000) {
      console.warn(`Stack Exchange usage: ${dailyCount}/10000 requests today`);
    }

    // Track quota from API response if available
    await redisClient.set('stackexchange:last_quota_check', JSON.stringify({
      used: dailyCount,
      timestamp: Date.now()
    }));

  } catch (error) {
    console.error('Stack Exchange usage tracking error:', error);
  }
};

export async function fetchStackExchangeQuestions(
  site: string = 'stackoverflow', 
  tagged: string = '',
  pageSize: number = 50
): Promise<StackExchangeQuestion[]> {

  const cacheKey = `stackexchange:${site}:${tagged}:${pageSize}`;
  
  try {
    // Check cache first
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      console.log(`Cache HIT for Stack Exchange ${site}`);
      const parsedData = JSON.parse(cached) as StackExchangeResponse;
      return parsedData.items.map(item => ({ ...item, site }));
    }

    console.log(`Cache MISS for Stack Exchange ${site} - fetching fresh`);

    await stackExchangeDelay();
    await trackStackExchangeUsage(); // ← ADD THIS LINE

    const baseUrl = 'https://api.stackexchange.com/2.3/questions';
    const params = new URLSearchParams({
      order: 'desc',
      sort: 'activity',
      site: site,
      pagesize: pageSize.toString(),
      filter: 'withbody', // Get question body content
    });

    if (tagged) {
      params.append('tagged', tagged);
    }

    const apiUrl = `${baseUrl}?${params.toString()}`;
    console.log(`Fetching: ${apiUrl}`);

    const response = await fetch(apiUrl, {
      headers: {
        'User-Agent': 'ProblemDiscoveryTool/1.0',
      }
    });

    if (!response.ok) {
      throw new Error(`Stack Exchange API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as StackExchangeResponse;
    
    console.log(`Fetched ${data.items.length} questions from ${site}`);
    console.log(`API quota remaining: ${data.quota_remaining}/${data.quota_max}`);

    // Update quota tracking with real API data
    await redisClient.set('stackexchange:api_quota', JSON.stringify({
      remaining: data.quota_remaining,
      max: data.quota_max,
      timestamp: Date.now()
    }));

    await redisClient.setEx(cacheKey, 20 * 60, JSON.stringify(data)); // 20 minutes cache

    // Add site info to each question
    return data.items.map(item => ({ ...item, site }));

  } catch (error) {
    console.error(`Error fetching from ${site}:`, error);
    return [];
  }
}

export async function classifyStackExchangeQuestions(
  questions: StackExchangeQuestion[]
): Promise<FetchStackExchangeResult> {
  
  const classifier = new RuleBasedClassifier();
  
  // Adapt Stack Exchange questions to work with Reddit classifier
  const classifiedQuestions = questions.map(question => {
    // Create a pseudo-Reddit post for classification
    const pseudoPost = {
      id: question.question_id.toString(),
      title: question.title,
      selftext: question.body || '',
      url: question.link,
      score: question.score,
      num_comments: question.answer_count,
      created_utc: question.creation_date,
      subreddit: question.site // Use site as subreddit
    };

    const classification = classifier.classifyPost(pseudoPost);
    return { ...question, classification };
  });

  // Filter for real problems
  const problemQuestions = classifiedQuestions
    .filter(q => q.classification.isRealProblem)
    .map(q => {
      const { classification, ...question } = q;
      return question;
    });

  // Calculate stats
  const categoryBreakdown = classifiedQuestions
    .filter(q => q.classification.isRealProblem)
    .reduce((acc, q) => {
      const category = q.classification.category;
      acc[category] = (acc[category] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

  return {
    classifiedQuestions,
    problemQuestions,
    stats: {
      totalQuestions: questions.length,
      problemsFound: problemQuestions.length,
      categoryBreakdown
    }
  };
}

// Fetch from multiple Stack Exchange sites
export async function fetchMultipleStackExchangeSites(): Promise<{
  allQuestions: StackExchangeQuestion[];
  siteStats: Record<string, number>;
}> {
  
  const sites = [
    { name: 'stackoverflow', tags: 'javascript' },
    { name: 'askubuntu', tags: '' },
    { name: 'superuser', tags: '' },
    { name: 'serverfault', tags: '' }
  ];

  const results = await Promise.allSettled(
    sites.map(async (site) => {
      const questions = await fetchStackExchangeQuestions(site.name, site.tags, 25);
      return { site: site.name, questions };
    })
  );

  let allQuestions: StackExchangeQuestion[] = [];
  const siteStats: Record<string, number> = {};

  results.forEach((result, i) => {
  const siteInfo = sites[i];
  if (!siteInfo) return;

  if (result.status === 'fulfilled') {
    const { site, questions } = result.value;
    allQuestions.push(...questions);
    siteStats[site] = questions.length;
  } else {
    console.error(`Failed to fetch from ${siteInfo.name}:`, result.reason);
    siteStats[siteInfo.name] = 0;
  }
});

  return {
    allQuestions,
    siteStats
  };
}



import fetch from 'node-fetch';
import { redisClient } from '../config/redis.js';
import type { ProblemClassification, StackExchangeQuestion, StackExchangeResponse } from '../types/index.js';
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
}



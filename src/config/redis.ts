import redis from 'redis';
import dotenv from 'dotenv';

dotenv.config();

const client = redis.createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379'
});

client.on('error', (err) => console.error('Redis Client Error', err));
client.on('connect', () => console.log('Redis connected'));

export async function connectRedis() {
  if (!client.isOpen) {
    await client.connect();
  }
  return client;
}

export { client as redisClient };
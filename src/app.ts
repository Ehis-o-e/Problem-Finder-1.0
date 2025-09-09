import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import helmet from 'helmet';
import { testDatabaseConnection, connectRedis } from './config/index.js';
import {fetchSubredditPosts, filterProblemFromPost} from './services/reddit.js';

dotenv.config();

//Middlewares
const app = express();
app.use(cors());
app.use(helmet());
app.use(express.json());

const PORT = 3000;

app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV 
    });
});

// Basic route
app.get('/', (req, res) => {
    res.json({ message: 'Problem Discovery API - Ready!' });
});

// Add this route to your app.ts
app.get('/test-filter', async (req, res) => {
    try {
        // Fetch from one or multiple subreddits
        const response1 = await fetchSubredditPosts('Entrepreneur');
        const response2 = await fetchSubredditPosts('College');
        const response3 = await fetchSubredditPosts('programming');
        
        // Import your filter function at the top first
        const { filterProblemFromPost } = await import('./services/reddit.js');
        
        // Test with multiple responses
        const problems = filterProblemFromPost([response1, response2, response3]);
        
        res.json({ 
            success: true,
            totalResponses: 3,
            totalPostsFound: response1.data.children.length + response2.data.children.length + response3.data.children.length,
            problemsFiltered: problems.length,
            sampleProblems: problems.slice(0, 3).map(post => ({
                title: post.title,
                excerpt: post.selftext?.substring(0, 100) + '...',
                subreddit: post.subreddit
            }))
        });
        
    } catch (error: any) {
        res.json({ 
            error: error.message,
            success: false 
        });
    }
});

async function startServer() {
    console.log ('Starting server...');

    await testDatabaseConnection;
    await connectRedis();

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV }`)
})
}

startServer();  
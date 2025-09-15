import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import helmet from 'helmet';
import { testDatabaseConnection, connectRedis } from './config/index.js';
import { fetchSubredditPosts, filterProblemFromPost } from './services/reddit.js';
import { RuleBasedClassifier } from './classification/rule-base-classification.js';

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
        // Initialize the classifier (if needed)
        const classifier = new RuleBasedClassifier();

        // Fetch from one or multiple subreddits
        const response1 = await fetchSubredditPosts('Entrepreneur');
        const response2 = await fetchSubredditPosts('College');
        const response3 = await fetchSubredditPosts('programming');     
        
        const responses = [response1, response2, response3];


        const problems = filterProblemFromPost(responses);

        const allPosts = responses.flatMap(response => 
            response.data.children.map(child => ({
                id: child.data.id,
                title: child.data.title,
                selftext: child.data.selftext || '',
                subreddit: child.data.subreddit,
                url: child.data.url,
                score: child.data.score,
                num_comments: child.data.num_comments,
                created_utc: child.data.created_utc,
            }))
        );

        // Classify each post
        const classifiedPosts = allPosts.map(post => {
            const classification = classifier.classifyPost(post);
            return {
                ...post,
                classification
            };
        });

        // Filter posts that classifier thinks are real problems
        const classifierProblems = classifiedPosts.filter(post => 
            post.classification.isRealProblem
        );

        // Group by category for analysis
        const byCategory = classifierProblems.reduce((acc, post) => {
            const category = post.classification.category;
            if (!acc[category]) acc[category] = [];
            acc[category].push(post);
            return acc;
        }, {} as Record<string, any[]>);

        res.json({
            success: true,
            classifierName: classifier.getName(),
            stats: {
                totalPostsAnalyzed: allPosts.length,
                basicFilterFound: problems.length,
                classifierFound: classifierProblems.length,
                categoryBreakdown: Object.keys(byCategory).map(category => {
                const posts = byCategory[category];
                return {
                    category,
                    count: posts ? posts.length : 0
                };
            })
            },
            sampleClassifications: classifiedPosts.slice(0, 5).map(post => ({
                title: post.title.substring(0, 80) + '...',
                subreddit: post.subreddit,
                isRealProblem: post.classification.isRealProblem,
                category: post.classification.category,
                confidence: post.classification.confidence,
                reasoning: post.classification.reasoning,
                keywords: post.classification.keywords
            })),
            topProblemsFound: classifierProblems
                .sort((a, b) => b.classification.confidence - a.classification.confidence)
                .slice(0, 3)
                .map(post => ({
                    title: post.title,
                    subreddit: post.subreddit,
                    category: post.classification.category,
                    confidence: post.classification.confidence,
                    reasoning: post.classification.reasoning
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
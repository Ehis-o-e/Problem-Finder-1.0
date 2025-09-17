import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import helmet from 'helmet';
import { testDatabaseConnection, connectRedis } from './config/index.js';
import { fetchSubredditPosts, classifyAndFilterPosts, calculateRecencyScore } from './services/reddit.js';
import { RuleBasedClassifier } from './classification/rule-base-classification.js';
import { supabase } from './config/database.js';

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
app.get('/test-filter-save', async (req, res) => {
    try {
        // Initialize the classifier (if needed)
        const classifier = new RuleBasedClassifier();

        // Fetch from one or multiple subreddits
        const response1 = await fetchSubredditPosts('Entrepreneur');
        const response2 = await fetchSubredditPosts('College');
        const response3 = await fetchSubredditPosts('programming');     
        
        const responses = [response1, response2, response3];


       const result = await classifyAndFilterPosts(
            responses, 
            true,  // Use classifier
            true  // save to db
        );

        res.json({
            success: true,
            classifierName: 'Rule-Based Classifier v1.0',
            stats: result.stats,
            sampleProblems: result.problemPosts.slice(0, 5).map(post => ({
                title: post.title,
                subreddit: post.subreddit,
                excerpt: post.selftext?.substring(0, 100) + '...'
            })),
           sampleClassifications: result.classifiedPosts
                .filter(post => post.classification.isRealProblem)
                .slice(0, 3)
                .map(post => ({
                    title: post.title.substring(0, 60) + '...',
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

// Problems endpoint
app.get('/api/problems', async (req, res) => {
    try {
        const { 
            category = 'all',
            limit = 10,
            page = 1,
            minConfidence = 0.5,
            source = 'reddit',
            sortBy = 'confidence', // confidence, engagement, recency
        } = req.query;

        const pageNum = Math.max(1, parseInt(page as string));
        const limitNum = Math.min(50, Math.max(1, parseInt(limit as string))); // Cap at 50
        const offset = (pageNum - 1) * limitNum;

        // Fetch from multiple subreddits for better coverage
        const responses = await Promise.all([
            fetchSubredditPosts('Entrepreneur'),
            fetchSubredditPosts('College'),
            fetchSubredditPosts('programming'),
            fetchSubredditPosts('personalfinance'),
            fetchSubredditPosts('productivity')
        ]);

        // Use smart classification and save to DB
        const result = await classifyAndFilterPosts(responses, true, true);

        // Apply filters
        let filteredProblems = result.classifiedPosts.filter(post => 
            post.classification.isRealProblem && 
            post.classification.confidence >= Number(minConfidence)
        );

        // Filter by category if specified
        if (category !== 'all') {
            filteredProblems = filteredProblems.filter(post => 
                post.classification.category === category
            );
        }

        //Apply sorting
        filteredProblems.sort((a, b) => {
            switch (sortBy) {
                case 'engagement':
                    return (b.score + b.num_comments) - (a.score + a.num_comments);
                case 'recency':
                    return b.created_utc - a.created_utc;
                case 'confidence':
                default:
                    return b.classification.confidence - a.classification.confidence;
            }
        });

         // Apply pagination
        const totalCount = filteredProblems.length;
        const paginatedProblems = filteredProblems
            .slice(offset, offset + limitNum)
            .map(post => ({
                id: `reddit_${post.id}`,
                title: post.title,
                description: post.selftext?.substring(0, 250) + (post.selftext?.length > 250 ? '...' : ''),
                category: post.classification.category,
                confidence: Math.round(post.classification.confidence * 100) / 100,
                reasoning: post.classification.reasoning,
                keywords: post.classification.keywords.slice(0, 5), // Limit keywords
                source: {
                    type: 'reddit',
                    subreddit: post.subreddit,
                    url: post.url,
                    score: post.score,
                    comments: post.num_comments,
                    created: new Date(post.created_utc * 1000).toISOString()
                },
                metrics: {
                    engagement: post.score + post.num_comments,
                    recency: calculateRecencyScore(post.created_utc)
                }
            }));
        res.json({
            success: true,
            problems: paginatedProblems,
            pagination: {
                currentPage: pageNum,
                totalPages: Math.ceil(totalCount / limitNum),
                totalCount,
                hasNext: (pageNum * limitNum) < totalCount,
                hasPrev: pageNum > 1,
                limit: limitNum
            },
            metadata: {
                totalAnalyzed: result.stats.totalPosts,
                categoryBreakdown: result.stats.categoryBreakdown,
                filters: { category, minConfidence, sortBy, source }
            }
        });

    } catch (error: any) {
        res.json({ error: error.message, success: false });
    }
});

// Add this after your other imports
const cache = new Map();
const CACHE_DURATION = 10 * 60 * 1000; // 10 minutes

// Cache middleware
function cacheMiddleware(duration: number) {
    return (req: any, res: any, next: any) => {
        const key = req.originalUrl;
        const cachedResponse = cache.get(key);
        
        if (cachedResponse && (Date.now() - cachedResponse.timestamp) < duration) {
            console.log(`Cache HIT for ${key}`);
            return res.json(cachedResponse.data);
        }
        
        // Store original res.json
        const originalJson = res.json;
        
        // Override res.json to cache the response
        res.json = function(data: any) {
            if (data.success) {
                console.log(`Cache SET for ${key}`);
                cache.set(key, {
                    data,
                    timestamp: Date.now()
                });
            }
            return originalJson.call(this, data);
        };
        
        next();
    };
}

// Apply cache to your problems endpoint
app.get('/api/problems', cacheMiddleware(CACHE_DURATION), async (req, res) => {
    // ... your existing problems endpoint code
});


// API statistics endpoint
app.get('/api/stats', async (req, res) => {
    try {
        // Get stats from database
        const { data: problemStats, error: problemError } = await supabase
            .from('problems')
            .select(`
                category_id,
                source_type,
                created_at,
                final_score,
                engagement_score
            `);

        if (problemError) throw problemError;

        const { data: categories, error: categoryError } = await supabase
            .from('categories')
            .select('id, name');

        if (categoryError) throw categoryError;

        // Create category lookup
        const categoryLookup = categories?.reduce((acc, cat) => {
            acc[cat.id] = cat.name;
            return acc;
        }, {} as Record<string, string>) || {};

        // Calculate statistics
        const stats = {
            totalProblems: problemStats?.length || 0,
            categoryStats: {},
            sourceStats: {},
            averageConfidence: 0,
            averageEngagement: 0,
            recentProblems: 0 // Last 24 hours
        };

        if (problemStats && problemStats.length > 0) {
            // Category breakdown
            const categoryCount: Record<string, number> = {};
            problemStats.forEach(problem => {
                const categoryName = categoryLookup[problem.category_id] || 'Unknown';
                categoryCount[categoryName] = (categoryCount[categoryName] || 0) + 1;
            });
            stats.categoryStats = categoryCount;

            // Source breakdown
            const sourceCount: Record<string, number> = {};
            problemStats.forEach(problem => {
                sourceCount[problem.source_type] = (sourceCount[problem.source_type] || 0) + 1;
            });
            stats.sourceStats = sourceCount;

            // Averages
            stats.averageConfidence = Math.round(
                (problemStats.reduce((sum, p) => sum + (p.final_score || 0), 0) / problemStats.length) * 100
            ) / 100;

            stats.averageEngagement = Math.round(
                problemStats.reduce((sum, p) => sum + (p.engagement_score || 0), 0) / problemStats.length
            );

            // Recent problems (last 24 hours)
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            stats.recentProblems = problemStats.filter(p => 
                new Date(p.created_at) > yesterday
            ).length;
        }

        res.json({
            success: true,
            stats,
            generatedAt: new Date().toISOString()
        });

    } catch (error: any) {
        res.json({ error: error.message, success: false });
    }
});

// Search problems endpoint
app.get('/api/search', async (req, res) => {
    try {
        const { 
            q: query,
            category = 'all',
            limit = 20,
            minConfidence = 0.3
        } = req.query;

        if (!query) {
            return res.json({ 
                error: 'Query parameter "q" is required',
                success: false 
            });
        }

        // Search in database first
        let dbQuery = supabase
            .from('problems')
            .select(`
                *,
                categories!inner(name, description)
            `)
            .gte('final_score', Number(minConfidence))
            .limit(Number(limit));

        // Add text search
        dbQuery = dbQuery.or(`title.ilike.%${query}%,description.ilike.%${query}%`);

        // Add category filter
        if (category !== 'all') {
            dbQuery = dbQuery.eq('categories.name', category);
        }

        const { data: searchResults, error } = await dbQuery;

        if (error) throw error;

        const formattedResults = searchResults?.map(problem => ({
            id: problem.id,
            title: problem.title,
            description: problem.description?.substring(0, 200) + '...',
            category: problem.categories.name,
            confidence: problem.final_score,
            engagement: problem.engagement_score,
            source: {
                type: problem.source_type,
                url: problem.source_url
            },
            createdAt: problem.created_at
        })) || [];

        res.json({
            success: true,
            results: formattedResults,
            metadata: {
                query: query,
                totalFound: formattedResults.length,
                filters: { category, minConfidence }
            }
        });

    } catch (error: any) {
        res.json({ error: error.message, success: false });
    }
});


// Categories endpoint
app.get('/api/categories', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('categories')
            .select('name, description')
            .order('name');
        
        if (error) throw error;
        
        res.json({
            success: true,
            categories: data
        });
    } catch (error: any) {
        res.json({ error: error.message, success: false });
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
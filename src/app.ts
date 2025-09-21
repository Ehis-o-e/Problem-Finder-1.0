import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import helmet from 'helmet';
import { testDatabaseConnection, connectRedis } from './config/index.js';
import { fetchMultipleStackExchangeSites, classifyStackExchangeQuestions } from './services/stack-exchange.js';
import { fetchSubredditPosts, classifyAndFilterPosts, calculateRecencyScore } from './services/reddit.js';
import { RuleBasedClassifier } from './classification/rule-base-classification.js';
import { supabase } from './config/database.js';
import { getChatbotResponse } from './services/chatbot.js';

dotenv.config();

//Middlewares
const app = express();
app.use(errorHandler);
app.use(cors());
app.use(helmet());
app.use(express.json());

const PORT = 3000;

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

app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV 
    });
});

// Basic route

// Input validation middleware
function validateProblemQuery(req: any, res: any, next: any) {
    const { category, limit, page, minConfidence, sortBy } = req.query;
    
    // Validate category
    const validCategories = ['all', 'business', 'technology', 'education', 'finance', 'social', 'general'];
    if (category && !validCategories.includes(category as string)) {
        return res.status(400).json({
            error: `Invalid category. Must be one of: ${validCategories.join(', ')}`,
            success: false
        });
    }
    
    // Validate limit
    if (limit && (isNaN(Number(limit)) || Number(limit) < 1 || Number(limit) > 100)) {
        return res.status(400).json({
            error: 'Limit must be a number between 1 and 100',
            success: false
        });
    }
    
    // Validate page
    if (page && (isNaN(Number(page)) || Number(page) < 1)) {
        return res.status(400).json({
            error: 'Page must be a positive number',
            success: false
        });
    }
    
    // Validate confidence
    if (minConfidence && (isNaN(Number(minConfidence)) || Number(minConfidence) < 0 || Number(minConfidence) > 1)) {
        return res.status(400).json({
            error: 'minConfidence must be a number between 0 and 1',
            success: false
        });
    }
    
    // Validate sortBy
    const validSorts = ['confidence', 'engagement', 'recency'];
    if (sortBy && !validSorts.includes(sortBy as string)) {
        return res.status(400).json({
            error: `Invalid sortBy. Must be one of: ${validSorts.join(', ')}`,
            success: false
        });
    }
    
    next();
}

// Global error handler
function errorHandler(err: any, req: any, res: any, next: any) {
    console.error('Unhandled error:', err);
    
    res.status(500).json({
        error: 'Internal server error',
        success: false,
        timestamp: new Date().toISOString()
    });
}

app.get('/', (req, res) => {
    res.json({ message: 'Problem Discovery API - Ready!' });
});


app.get('/test-stackexchange', async (req, res) => {
    try {
        console.log('🔍 Fetching from Stack Exchange sites...');
        
        const { allQuestions, siteStats } = await fetchMultipleStackExchangeSites();
        
        console.log('🤖 Classifying Stack Exchange questions...');
        const result = await classifyStackExchangeQuestions(allQuestions);
        
        res.json({
            success: true,
            source: 'Stack Exchange',
            stats: {
                totalFetched: allQuestions.length,
                problemsFound: result.stats.problemsFound,
                siteBreakdown: siteStats,
                categoryBreakdown: result.stats.categoryBreakdown
            },
            sampleProblems: result.problemQuestions.slice(0, 5).map(q => ({
                title: q.title,
                site: q.site,
                score: q.score,
                views: q.view_count,
                answers: q.answer_count,
                tags: q.tags.slice(0, 3)
            })),
            topProblems: result.classifiedQuestions
                .filter(q => q.classification.isRealProblem)
                .sort((a, b) => b.classification.confidence - a.classification.confidence)
                .slice(0, 3)
                .map(q => ({
                    title: q.title,
                    site: q.site,
                    confidence: q.classification.confidence,
                    category: q.classification.category,
                    reasoning: q.classification.reasoning
                }))
        });

    } catch (error: any) {
        console.error('Stack Exchange test error:', error);
        res.json({ 
            error: error.message, 
            success: false 
        });
    }
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
// Production-ready problems endpoint
app.get('/api/problems', validateProblemQuery, cacheMiddleware(CACHE_DURATION), async (req, res) => {
    const startTime = Date.now();
    
    try {
        const { 
            category = 'all',
            limit = 10,
            page = 1,
            minConfidence = 0.5,
            sortBy = 'confidence',
            sources = 'reddit'
        } = req.query;

        const pageNum = parseInt(page as string);
        const limitNum = parseInt(limit as string);
        const offset = (pageNum - 1) * limitNum;

        console.log(`API Request: category=${category}, limit=${limitNum}, page=${pageNum}, sources=${sources}`);

        // Collect problems from requested sources
        let allProblems: any[] = [];
        const sourceResults: any = {};

        // Reddit source
        if ((sources as string).includes('reddit')) {
            try {
                console.log('📱 Fetching Reddit data...');
                const redditResponses = await Promise.all([
                    fetchSubredditPosts('Entrepreneur'),
                    fetchSubredditPosts('College'),
                    fetchSubredditPosts('programming'),
                    fetchSubredditPosts('personalfinance')
                ]);
                
                const redditResult = await classifyAndFilterPosts(redditResponses, true, true);
                
                const redditProblems = redditResult.classifiedPosts
                    .filter(p => p.classification.isRealProblem && p.classification.confidence >= Number(minConfidence))
                    .map(p => ({
                        id: `reddit_${p.id}`,
                        title: p.title,
                        description: p.selftext?.substring(0, 250) + (p.selftext && p.selftext.length > 250 ? '...' : ''),
                        category: p.classification.category,
                        confidence: Math.round(p.classification.confidence * 100) / 100,
                        reasoning: p.classification.reasoning,
                        keywords: p.classification.keywords.slice(0, 5),
                        source: {
                            type: 'reddit',
                            platform: p.subreddit,
                            url: p.url,
                            score: p.score,
                            comments: p.num_comments,
                            created: new Date(p.created_utc * 1000).toISOString()
                        },
                        metrics: {
                            engagement: p.score + p.num_comments,
                            hoursAgo: Math.round((Date.now()/1000 - p.created_utc) / 3600)
                        }
                    }));
                
                allProblems = allProblems.concat(redditProblems);
                sourceResults.reddit = {
                    found: redditProblems.length,
                    analyzed: redditResult.stats.totalPosts
                };
                
            } catch (error) {
                console.error('Reddit fetch failed:', error);
                sourceResults.reddit = { error: 'Failed to fetch Reddit data' };
            }
        }

        // Stack Exchange source
        if ((sources as string).includes('stackexchange')) {
            try {
                console.log('🏗️ Fetching Stack Exchange data...');
                const { allQuestions } = await fetchMultipleStackExchangeSites();
                const seResult = await classifyStackExchangeQuestions(allQuestions);
                
                const seProblems = seResult.classifiedQuestions
                    .filter(q => q.classification.isRealProblem && q.classification.confidence >= Number(minConfidence))
                    .map(q => ({
                        id: `se_${q.question_id}`,
                        title: q.title,
                        description: q.body?.substring(0, 250) + (q.body && q.body.length > 250 ? '...' : '') || 'No description',
                        category: q.classification.category,
                        confidence: Math.round(q.classification.confidence * 100) / 100,
                        reasoning: q.classification.reasoning,
                        keywords: q.classification.keywords.slice(0, 5),
                        source: {
                            type: 'stackexchange',
                            platform: q.site,
                            url: q.link,
                            score: q.score,
                            views: q.view_count,
                            answers: q.answer_count,
                            created: new Date(q.creation_date * 1000).toISOString()
                        },
                        metrics: {
                            engagement: q.score + q.answer_count,
                            hoursAgo: Math.round((Date.now()/1000 - q.creation_date) / 3600)
                        }
                    }));
                
                allProblems = allProblems.concat(seProblems);
                sourceResults.stackexchange = {
                    found: seProblems.length,
                    analyzed: seResult.stats.totalQuestions
                };
                
            } catch (error) {
                console.error('Stack Exchange fetch failed:', error);
                sourceResults.stackexchange = { error: 'Failed to fetch Stack Exchange data' };
            }
        }

        // Apply category filter
        if (category !== 'all') {
            allProblems = allProblems.filter(p => p.category === category);
        }

        // Apply sorting
        allProblems.sort((a, b) => {
            switch (sortBy) {
                case 'engagement':
                    return b.metrics.engagement - a.metrics.engagement;
                case 'recency':
                    return a.metrics.hoursAgo - b.metrics.hoursAgo; // Newer first
                case 'confidence':
                default:
                    return b.confidence - a.confidence;
            }
        });

        // Apply pagination
        const totalCount = allProblems.length;
        const paginatedProblems = allProblems.slice(offset, offset + limitNum);

        const processingTime = Date.now() - startTime;
        console.log(`✅ Request completed in ${processingTime}ms`);

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
                processingTimeMs: processingTime,
                sourceResults,
                filters: { category, minConfidence, sortBy, sources }
            }
        });

    } catch (error: any) {
        const processingTime = Date.now() - startTime;
        console.error('API Error:', error);
        
        res.status(500).json({
            error: 'Failed to fetch problems',
            success: false,
            processingTimeMs: processingTime
        });
    }
});

// Add this simple endpoint to app.ts
app.get('/api/chat', async (req, res) => {
    const { category = 'all', limit = 3 } = req.query;
    
    const result = await getChatbotResponse(
        category as string, 
        Number(limit)
    );
    
    res.json(result);
});


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

// API documentation endpoint
app.get('/api/docs', (req, res) => {
    res.json({
        success: true,
        apiVersion: '1.0',
        documentation: {
            endpoints: {
                '/api/problems': {
                    method: 'GET',
                    description: 'Get classified problems from multiple sources',
                    parameters: {
                        category: 'Filter by category (business, technology, education, finance, social, general, all)',
                        limit: 'Number of results (1-100, default: 10)',
                        page: 'Page number (default: 1)',
                        minConfidence: 'Minimum confidence score (0-1, default: 0.5)',
                        sortBy: 'Sort results (confidence, engagement, recency, default: confidence)',
                        sources: 'Data sources (reddit, stackexchange, default: reddit)'
                    },
                    examples: [
                        '/api/problems?category=business&limit=5',
                        '/api/problems?sortBy=engagement&sources=reddit,stackexchange',
                        '/api/problems?page=2&limit=10&minConfidence=0.8'
                    ]
                },
                '/api/categories': {
                    method: 'GET',
                    description: 'Get available problem categories'
                },
                '/api/stats': {
                    method: 'GET',
                    description: 'Get API usage statistics'
                }
            },
            rateLimits: {
                reddit: '60 requests/minute',
                stackexchange: '10,000 requests/day'
            },
            supportedCategories: ['business', 'technology', 'education', 'finance', 'social', 'general']
        }
    });
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
import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import helmet from 'helmet';
import { testDatabaseConnection, connectRedis } from './config/index.js';
import {fetchSubredditPosts} from './services/reddit.js';

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
app.get('/test-reddit', async (req, res) => { 
    try {
        const data:any = await fetchSubredditPosts('Entrepreneur'); 
        res.json({ success: true, posts: data.data.children.length }); 
    } 
    catch (error:any) { 
        res.json({ error: error.message }); 
    } });

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
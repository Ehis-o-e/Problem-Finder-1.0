import { fetchSubredditPosts, classifyAndFilterPosts } from './reddit.js';

export function formatForChatbot(problems: any[]){
    if(problems.length === 0){
        return "I couldn't find problem associated with your request"
    }

    let response = `I found ${problems.length} problems that can be associated with your request.\n\n`;
    response += `**Here are the top ones:**\n\n`;

    problems.slice(0,3).forEach((problem, index) => {
        const confidence = Math.round(problem.confidence*100);
        response += `${index + 1}. ${problem.title}\n`;
        response += `Confidence: ${confidence}%\n\n`
    });

    return response;
}

export async function getChatbotResponse(category: string = 'all', limit: number=3){
    try {
        console.log (`Processing chatbot request: category=${category}, limit=${limit}`);

        const responses = await Promise.all([
            fetchSubredditPosts('Entrepreneur'),
            fetchSubredditPosts('programming')
        ]);

        const result = await classifyAndFilterPosts(responses, true, false);
        
        let problems = result.classifiedPosts
        .filter(p => p.classification.isRealProblem)
        .map(p => ({
            title: p.title,
            confidence: p.classification.confidence,
            category: p.classification.category
        }))

        if (category !== 'all'){
            problems = problems.filter(p => p.category === category);
        }

        problems.sort((a,b) => b.confidence - a.confidence);

        const chatResponse = formatForChatbot(problems);

        return {
            success: true,
            chatResponse, 
            problemCount: problems.length,
            rawProblems: problems
        };

        
    } catch (error) {
        return{
            success: false,
            chatResponse: "Sorry, something went wrong! Please try again.",
            error: console.log(error)
        }
    }
}
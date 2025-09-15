import type { RedditPost } from '../types/index.js';
import type { ProblemClassifier, ProblemClassification } from '../types/index.js';

export class RuleBasedClassifier implements ProblemClassifier {
  getName(): string {
    return 'Rule-Based Classifier v1.0';
  }



    classifyPost(post: RedditPost): ProblemClassification {
    const text = `${post.title} ${post.selftext || ''}`.toLowerCase();
    
    const isRealProblem = detectRealProblem(text);
    const category = categorizePost(text, post.subreddit);
    const confidence = calculateConfidence(text, isRealProblem);
    const reasoning = generateReasoning(isRealProblem, category);
    const keywords = extractKeywords(text);

    return {
      isRealProblem,
      category,
      confidence,
      reasoning,
      keywords
    };
  }
}

function detectRealProblem(text: string): boolean {
  const realProblemIndicators = [
    'i wish there was',
    'wish there was an app',
    'wish there was a tool',
    'wish there was a service',
    'there should be',
    'it would be great if',
    'hard to find',
    'difficult to find',
    'impossible to find',
    'no good way to',
    'no easy way to',
    'time consuming',
    'time-consuming',
    'takes forever to',
    'such a pain to',
    'hate having to',
    'frustrated with',
    'annoying that',
    'why isn\'t there',
    'someone should make',
    'someone should build',
    'would pay for',
    'willing to pay',
    'need a solution',
    'looking for a solution'
  ];

  const notRealProblemIndicators = [
    'help me with my homework',
    'do my assignment',
    'help me move',
    'give me a ride',
    'lend me money',
    'my ex',
    'my crush',
    'dating advice',
    'relationship advice',
    'weather',
    'it\'s raining',
    'traffic',
    'my parents',
    'family drama',
    'roommate',
    'help me cheat',
    'write my essay',
    'do my project for me'
  ];

   
   const hasRealProblemIndicators = realProblemIndicators.some(indicator => 
    text.includes(indicator)
  );
  const hasNonProblemIndicators = notRealProblemIndicators.some(indicator => 
    text.includes(indicator)
  );
  if (hasNonProblemIndicators) {
    return false;
  }
  if (hasRealProblemIndicators) {
    return true;
  }

  const generalProblemWords = ['problem', 'issue', 'struggle', 'challenge', 'need help'];
  const hasGeneralProblemWords = generalProblemWords.some(word => text.includes(word));

   const wordCount = text.split(' ').length;
  if (hasGeneralProblemWords && wordCount > 50) {
    return true;
  }
  return false; 
}

function categorizePost(text: string, subreddit: string): "business" | "technology" | "finance" | "social" | "education" | "general" {

 const businessKeywords = [
    'startup', 'business', 'entrepreneur', 'company', 'revenue', 'marketing', 
    'sales', 'investment', 'funding', 'client', 'customer', 'profit', 'launch',
    'product', 'service', 'market', 'competition', 'strategy'
  ];
  const educationKeywords = [
    'homework', 'assignment', 'project', 'exam', 'study', 'research', 'course', 
    'class', 'thesis', 'lecture', 'student', 'learning', 'school', 'college',
    'university', 'professor', 'grade', 'academic'
  ];
  const technologyKeywords = [
    'app', 'software', 'tool', 'coding', 'programming', 'development', 'platform',
    'automation', 'ai', 'machine learning', 'ml', 'website', 'system', 'tech',
    'algorithm', 'database', 'api', 'mobile', 'web', 'computer'
  ];
  const financeKeywords = [
    'money', 'budget', 'saving', 'savings', 'debt', 'investment', 'finance', 
    'loan', 'banking', 'cryptocurrency', 'crypto', 'economy', 'financial',
    'expense', 'income', 'tax', 'insurance', 'retirement'
  ];
  const socialKeywords = [
    'community', 'social', 'dating', 'relationship', 'friend', 'network',
    'communication', 'meeting', 'group', 'team', 'collaboration', 'sharing'
  ];

  const subredditLower = subreddit.toLowerCase();
  // Check subreddit first for strong context clues
  if (['entrepreneur', 'smallbusiness', 'startup', 'business'].includes(subredditLower)) {
    return 'business';
  }
  if (['college', 'university', 'student', 'learnprogramming', 'studytips'].includes(subredditLower)) {
    return 'education';
  }
  if (['programming', 'webdev', 'technology', 'coding'].includes(subredditLower)) {
    return 'technology';
  }
  if (['personalfinance', 'investing', 'financialindependence'].includes(subredditLower)) {
    return 'finance';
  }

    const businessCount = businessKeywords.filter(keyword => text.includes(keyword)).length;
    const educationCount = educationKeywords.filter(keyword => text.includes(keyword)).length;
    const technologyCount = technologyKeywords.filter(keyword => text.includes(keyword)).length;
    const financeCount = financeKeywords.filter(keyword => text.includes(keyword)).length;
    const socialCount = socialKeywords.filter(keyword => text.includes(keyword)).length;

  // Find category with highest count
  const counts = {
    business: businessCount,
    education: educationCount,
    technology: technologyCount,
    finance: financeCount,
    social: socialCount
  };

  const maxCount = Math.max(...Object.values(counts));

  if (maxCount === 0) {
    return 'general';
  }

const entries = Object.entries(counts);

// 2. Find the first [category, count] where count equals maxCount
const matchingEntry = entries.find(([category, count]) => count === maxCount);

// 3. If a match was found, take the category name; otherwise use 'general'
let category: string;
if (matchingEntry) {
  category = matchingEntry[0]; // the category name
} else {
  category = 'general';
}

// 4. Return the category
return category as "business" | "technology" | "finance" | "social" | "education" | "general";
}


function calculateConfidence(text: string, isRealProblem: boolean): number {
  let confidence = 0.5; 
   if (!isRealProblem) {
    confidence = 0.2;
  }
  const wordCount = text.split(' ').length;
  if (wordCount > 100) {
    confidence += 0.2;
  } else if (wordCount > 50) {
    confidence += 0.1;
  } else if (wordCount < 10) {
    confidence -= 0.2;
  }

  const strongIndicators = [
    'i wish there was an app',
    'someone should make',
    'would pay for',
    'no good solution',
    'such a pain to'
  ];

  const hasStrongIndicator = strongIndicators.some(indicator => text.includes(indicator));
  if (hasStrongIndicator) {
    confidence += 0.2;
  }

   if (text.includes('?') && text.split('?').length > 2) {
    confidence -= 0.1;
  }
   return Math.max(0, Math.min(1, confidence));
}

function generateReasoning(isRealProblem: boolean, category: string): string {
  if (!isRealProblem) {
    return 'Classified as not a real problem - appears to be a personal request, complaint, or non-solvable issue';
  }

  const categoryReasons = {
    business: 'Contains business-related keywords and appears to be an entrepreneurial opportunity',
    education: 'Related to learning, studying, or academic challenges',
    technology: 'Involves software, apps, coding, or technical solutions',
    finance: 'Deals with money, budgeting, or financial management',
    social: 'Focuses on community, relationships, or social interactions',
    general: 'Appears to be a real problem but doesn\'t fit into specific categories'
  };

  return `Classified as a real ${category} problem. ${categoryReasons[category as keyof typeof categoryReasons]}`;
}

function extractKeywords(text: string): string[] {
  const allKeywords = [
    // Problem indicators
    'i wish there was', 'wish there was', 'there should be', 'hard to find',
    'difficult to find', 'time consuming', 'frustrated with', 'annoying that',
    'someone should make', 'would pay for', 'need a solution',
    
    // Category keywords
    'startup', 'business', 'app', 'software', 'money', 'budget', 'study',
    'homework', 'coding', 'programming', 'community', 'social', 'tool'
  ];

  return allKeywords.filter(keyword => text.includes(keyword));
}


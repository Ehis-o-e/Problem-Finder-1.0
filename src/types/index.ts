// Database table types
export type Category= {
  id: string;
  name: string;
  description: string | null;
  keywords: string[];
  created_at: string;
}

export type Source = {
  id: string;
  type: string;
  name: string;
  api_endpoint: string | null;
  last_fetched: string | null;
  is_active: boolean;
  created_at: string;
}

export type Problem = {
  id: string;
  title: string;
  description: string | null;
  source_type: string;
  source_id: string;
  source_url: string | null;
  category_id: string | null;
  engagement_score: number;
  recency_score: number;
  final_score: number;
  keywords: string[];
  created_at: string;
  updated_at: string;
}

// Reddit API response types
export type RedditPost = {
  id: string;
  title: string;
  selftext: string;
  url: string;
  score: number;
  num_comments: number;
  created_utc: number;
  subreddit: string;
}

export type RedditResponse = {
  data: {
    children: Array<{
      data: RedditPost;
    }>;
    after: string | null;
  };
}

export type ProblemClassifier = {
  classifyPost(post: RedditPost): ProblemClassification
}

export type ProblemClassification = {
  isRealProblem: boolean
  category: 'business' | 'education' | 'technology' | 'finance' | 'social' |'general'
  confidence: number
  reasoning: string
  keywords: string[]
}

export type ClassifiedPost = RedditPost & {
  classification: ProblemClassification;
};

export type Stats = {
  totalPosts: number;
  problemsFound: number;
  categoryBreakdown: Record<string, number>;
};

export type ClassifyAndFilterResult = {
  classifiedPosts: ClassifiedPost[];
  problemPosts: RedditPost[];
  stats: Stats;
};

//stack exchange
export type StackExchangeQuestion = {
  question_id: number;
  title: string;
  body: string;
  score: number;
  view_count: number;
  answer_count: number;
  creation_date: number;
  tags: string[];
  link: string;
  site: string;
};

export type StackExchangeResponse = {
  items: StackExchangeQuestion[];
  has_more: boolean;
  quota_max: number;
  quota_remaining: number;
};



import React, { useState } from 'react';
import './App.css';

function App() {
  const [messages, setMessages] = useState([
    { type: 'bot', text: '👋 Hi! I can help you find business problems to solve. Try asking me to "find business problems" or "show technology problems".' }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  // Your backend URL - adjust if different
  const API_BASE = 'http://localhost:3000';

  const sendMessage = async () => {
    if (!input.trim()) return;

    // Add user message
    const userMessage = { type: 'user', text: input };
    setMessages(prev => [...prev, userMessage]);
    setLoading(true);

    try {
      // Parse user input to determine API call
      const params = parseUserInput(input);
      
      // Call your chatbot API
      const response = await fetch(`${API_BASE}/api/chat?${params}`);
      const data = await response.json();

      // Add bot response
      const botMessage = {
        type: 'bot',
        text: data.chatResponse || data.error || 'Sorry, something went wrong!'
      };
      setMessages(prev => [...prev, botMessage]);

    } catch (error) {
      const errorMessage = {
        type: 'bot',
        text: '❌ Could not connect to the server. Make sure your backend is running!'
      };
      setMessages(prev => [...prev, errorMessage]);
    }

    setInput('');
    setLoading(false);
  };

  // Simple function to parse user input into API parameters
  const parseUserInput = (text) => {
    const params = new URLSearchParams();
    
    // Check for category keywords
    if (text.toLowerCase().includes('business')) params.set('category', 'business');
    else if (text.toLowerCase().includes('technology') || text.toLowerCase().includes('tech')) params.set('category', 'technology');
    else if (text.toLowerCase().includes('education')) params.set('category', 'education');
    else if (text.toLowerCase().includes('finance') || text.toLowerCase().includes('money')) params.set('category', 'finance');
    else if (text.toLowerCase().includes('social')) params.set('category', 'social');
    else params.set('category', 'all');

    // Check for limit keywords
    if (text.toLowerCase().includes('few') || text.toLowerCase().includes('2') || text.toLowerCase().includes('two')) {
      params.set('limit', '2');
    } else if (text.toLowerCase().includes('many') || text.toLowerCase().includes('10')) {
      params.set('limit', '10');
    } else {
      params.set('limit', '3');
    }

    return params.toString();
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      sendMessage();
    }
  };

  return (
    <div className="App">
      <div className="chat-container">
        <div className="chat-header">
          <h2>🔍 Problem Discovery Assistant</h2>
        </div>
        
        <div className="chat-messages">
          {messages.map((message, index) => (
            <div key={index} className={`message ${message.type}`}>
              <div className="message-content">
                {message.text.split('\n').map((line, i) => (
                  <div key={i}>{line}</div>
                ))}
              </div>
            </div>
          ))}
          {loading && (
            <div className="message bot">
              <div className="message-content">
                <div className="loading-dots">
                  <span></span>
                  <span></span>
                  <span></span>
                </div>
                Thinking...
              </div>
            </div>
    )}
        </div>

        <div className="chat-input">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Ask me to find problems... (e.g., 'find business problems')"
          />
          <button onClick={sendMessage} disabled={loading}>
            Send
          </button>
        </div>

        <div className="quick-buttons">
          <button onClick={() => setInput('find business problems')}>Business Problems</button>
          <button onClick={() => setInput('show technology problems')}>Tech Problems</button>
          <button onClick={() => setInput('find finance problems')}>Finance Problems</button>
        </div>
      </div>
    </div>
  );
}

export default App;





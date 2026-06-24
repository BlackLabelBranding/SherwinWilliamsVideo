
const express = require('express');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

// In-memory storage (for demo purposes). In production, use a database.
const users = [
  { username: 'driver1', password: 'pass123' },
  { username: 'driver2', password: 'pass123' }
];
let sessions = {};
let comments = [];

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Login endpoint
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = users.find(u => u.username === username && u.password === password);
  if (user) {
    const token = uuidv4();
    sessions[token] = { username, timestamp: Date.now() };
    res.json({ success: true, token, username });
  } else {
    res.status(401).json({ success: false, message: 'Invalid credentials' });
  }
});

// Middleware to validate session tokens
function authenticate(req, res, next) {
  const token = req.headers['authorization'];
  if (token && sessions[token]) {
    req.user = sessions[token];
    return next();
  }
  res.status(401).json({ success: false, message: 'Unauthorized' });
}

// Comments API
app.get('/api/comments', authenticate, (req, res) => {
  res.json(comments);
});

app.post('/api/comments', authenticate, (req, res) => {
  const { body } = req.body;
  if (!body || !body.trim()) {
    return res.status(400).json({ success: false, message: 'Comment body required' });
  }
  const comment = {
    id: uuidv4(),
    username: req.user.username,
    body: body.trim(),
    timestamp: Date.now()
  };
  comments.push(comment);
  res.json({ success: true, comment });
});

// Logout endpoint
app.post('/api/logout', authenticate, (req, res) => {
  const token = req.headers['authorization'];
  delete sessions[token];
  res.json({ success: true });
});

// Serve the app
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

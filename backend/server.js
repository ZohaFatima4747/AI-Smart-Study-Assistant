// Load environment variables from .env file
require('dotenv').config();

var express = require('express');
var cors = require('cors');
var connectDB = require('./config/db');
var authRoutes = require('./routes/auth');
var chatRoutes = require('./routes/chat');

// Create the express app
var app = express();

// Allow requests from the frontend
app.use(cors({ origin: '*' }));

// Allow the app to read JSON from request body
app.use(express.json());

// Connect the routes
app.use('/api/auth', authRoutes);
app.use('/api/chat', chatRoutes);

// A simple route to check if the server is running
app.get('/api/health', function(req, res) {
  res.json({ status: 'Server is running' });
});

// Start the server only after the database is ready.
var PORT = process.env.PORT || 5000;

async function startServer() {
  try {
    await connectDB();
    app.listen(PORT, function() {
      console.log('Server is running on port ' + PORT);
    });
  } catch (error) {
    console.error('MongoDB connection failed');
    console.error('Error message:', error.message);

    if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEOUT') {
      console.error(
        'Atlas DNS could not be reached. Try another network or set your DNS to 1.1.1.1/8.8.8.8, then restart nodemon.'
      );
    }

    process.exit(1);
  }
}

startServer();

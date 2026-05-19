var mongoose = require('mongoose');

// This function connects our app to MongoDB
function connectDB() {
  mongoose.connect(process.env.MONGO_ATLAS_URI)
    .then(function() {
      console.log('MongoDB connected successfully');
    })
    .catch(function(error) {
      console.log('MongoDB connection failed:', error.message);
      process.exit(1); // Stop the app if the database fails to connect
    });
}

module.exports = connectDB;

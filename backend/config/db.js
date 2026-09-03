var mongoose = require("mongoose");

// This function connects our app to MongoDB
async function connectDB() {
  var uri = process.env.MONGO_ATLAS_URI || process.env.MONGODB_URI;

  if (!uri) {
    throw new Error("Set MONGO_ATLAS_URI (or MONGODB_URI) in backend/.env");
  }

  await mongoose.connect(uri, {
    // Fail quickly and show a useful startup error when Atlas is unreachable.
    serverSelectionTimeoutMS: 10000,
  });

  console.log("MongoDB connected successfully");
}

module.exports = connectDB;

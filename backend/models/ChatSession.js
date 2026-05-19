const mongoose = require('mongoose');

// A chat session is like one conversation thread in the sidebar
const chatSessionSchema = new mongoose.Schema({
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  title: {
    type: String,
    required: true,
    default: 'New Chat'
  },
  created_at: {
    type: Date,
    default: Date.now
  },
  last_message_at: {
    type: Date,
    default: Date.now
  },
  is_pinned: {
    type: Boolean,
    default: false
  }
});

module.exports = mongoose.model('ChatSession', chatSessionSchema);

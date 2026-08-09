const mongoose = require('mongoose');

// Each message in a chat session is stored here
const chatMessageSchema = new mongoose.Schema({
  session_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ChatSession',
    required: true
  },
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  user_question: {
    type: String,
    required: true
  },
  question_type: {
    type: String,
    enum: ['summary', 'explanation', 'mcq', 'solve', 'extract'],
    required: true
  },
  // 'text' = typed input, 'file' = uploaded PDF/TXT/MD
  source_type: {
    type: String,
    enum: ['text', 'file'],
    default: 'text'
  },
  // Original filename when source_type is 'file'
  file_name: {
    type: String,
    default: null
  },
  // Extracted text from the file (stored for reference / re-processing)
  file_text: {
    type: String,
    default: null
  },
  ai_response: {
    type: String,
    default: ''
  },
  response_type: {
    type: String,
    enum: ['summary', 'explanation', 'mcq', 'solve', 'extract'],
    required: true
  },
  ai_status: {
    type: String,
    enum: ['success', 'failed'],
    default: 'success'
  },
  error_message: {
    type: String,
    default: 'no error detected'
  },
  created_at: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('ChatMessage', chatMessageSchema);

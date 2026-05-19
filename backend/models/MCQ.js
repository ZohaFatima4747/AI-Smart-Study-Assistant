const mongoose = require('mongoose');

// Each MCQ question is saved here, linked to a chat message
const mcqSchema = new mongoose.Schema({
  message_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ChatMessage',
    required: true
  },
  question: {
    type: String,
    required: true
  },
  option_a: { type: String, required: true },
  option_b: { type: String, required: true },
  option_c: { type: String, required: true },
  option_d: { type: String, required: true },
  correct_option: {
    type: String,
    enum: ['A', 'B', 'C', 'D'],
    required: true
  },
  user_answer: {
    type: String,
    enum: ['A', 'B', 'C', 'D', null],
    default: null
  },
  is_correct: {
    type: Boolean,
    default: null
  },
  answered_at: {
    type: Date,
    default: null
  },
  created_at: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('MCQ', mcqSchema);

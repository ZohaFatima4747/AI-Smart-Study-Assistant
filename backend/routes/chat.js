var express = require('express');
var { GoogleGenerativeAI } = require('@google/generative-ai');
var multer = require('multer');
var pdfParse = require('pdf-parse');
var mammoth = require('mammoth');

// pdf-parse v2 uses a class
var PDFParser = pdfParse.PDFParse;

// This function pulls the text out of a PDF file buffer
function extractPdfText(buffer) {
  var parser = new PDFParser({ data: buffer });
  return parser.getText().then(function(result) {
    return result.text || '';
  });
}

var auth = require('../middleware/auth');
var ChatSession = require('../models/ChatSession');
var ChatMessage = require('../models/ChatMessage');
var MCQ = require('../models/MCQ');

var router = express.Router();

// Simple in-memory rate limiter — max 5 AI calls per IP per minute
var requestCounts = {};
setInterval(function() { requestCounts = {}; }, 60 * 1000);

function aiRateLimit(req, res, next) {
  var key = req.ip;
  requestCounts[key] = (requestCounts[key] || 0) + 1;
  if (requestCounts[key] > 5) {
    return res.status(429).json({ error: 'Too many requests. Please wait a moment and try again.' });
  }
  next();
}

// Set up multer to store uploaded files in memory (no disk writes)
var upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB max
  fileFilter: function(req, file, cb) {
    var allowedTypes = [
      'application/pdf',
      'text/plain',
      'text/markdown',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword'
    ];
    var allowedExtension = file.originalname.match(/\.(pdf|txt|md|docx)$/i);

    if (allowedTypes.includes(file.mimetype) || allowedExtension) {
      cb(null, true);
    } else {
      cb(null, false); // reject silently — route will check req.file
    }
  }
});

// Detect question type from the user's input text.
// Returns 'mcq', 'explanation', 'summary', or null (unknown intent).
// Explicit dropdown selection always overrides this — only called when questionType === 'auto'.
function detectQuestionType(input) {
  var text = input.toLowerCase();

  // Intent rules — ordered by specificity. Add new modes here as the app grows.
  var intentRules = [
    {
      type: 'mcq',
      pattern: /\b(mcq|mcqs|quiz|quizzes|multiple.?choice|test me|questions?|practice|give me questions?|generate questions?)\b/
    },
    {
      type: 'explanation',
      pattern: /\b(explain|explanation|what is|what are|how does|how do|why is|why does|describe|elaborate|clarify|break.?down|tell me about|define|definition|help me understand)\b/
    },
    {
      type: 'summary',
      pattern: /\b(summar|summarize|summarise|overview|brief|tldr|tl;dr|short|concise|gist|outline|recap|key points?|main points?)\b/
    }
  ];

  for (var i = 0; i < intentRules.length; i++) {
    if (intentRules[i].pattern.test(text)) {
      return intentRules[i].type;
    }
  }

  // Intent unclear — fall back to summary as a safe default
  return 'summary';
}

// Detect whether the user's message references prior conversation context.
// Phrases like "this topic", "above", "same concept", "it", etc. signal that
// the user expects the AI to use the existing conversation rather than treat
// the message as a standalone query.
function isContextualQuery(input) {
  var text = input.toLowerCase();
  return /\b(this topic|this concept|this chapter|this subject|this lesson|this content|this material|above (topic|discussion|content|explanation|summary|concept)|same topic|same concept|related to this|based on (this|above|that)|about (this|that|it)|on (this|that)|from (this|above)|the (above|previous|last|same)|it\b|that\b)/i.test(text);
}

// Build a conversation history block from prior messages (most recent last).
// Each entry shows the user question and the AI response so Gemini has full context.
function buildHistoryBlock(priorMessages) {
  if (!priorMessages || priorMessages.length === 0) return '';

  var lines = ['--- Conversation History (most recent last) ---'];
  for (var i = 0; i < priorMessages.length; i++) {
    var m = priorMessages[i];
    if (m.ai_status !== 'success') continue;

    lines.push('User: ' + m.user_question);

    // For MCQ messages the ai_response is JSON — summarise it instead of dumping raw JSON
    if (m.question_type === 'mcq') {
      lines.push('Assistant: [Generated MCQs about the above topic]');
    } else {
      // Trim long responses so the prompt stays within token limits
      var resp = (m.ai_response || '').substring(0, 600);
      if (m.ai_response && m.ai_response.length > 600) resp += '...';
      lines.push('Assistant: ' + resp);
    }
  }
  lines.push('--- End of History ---');
  return lines.join('\n');
}

// Build the AI prompt, optionally injecting conversation history for context.
// priorMessages: array of ChatMessage docs (last N messages before this one), may be empty.
function buildPrompt(userInput, type, priorMessages) {
  var historyBlock = buildHistoryBlock(priorMessages);
  var hasHistory = historyBlock.length > 0;

  // When the user references prior context, instruct the AI to use it.
  // When there is no prior context, fall back to treating the input as a standalone topic.
  var contextInstruction = hasHistory
    ? 'You are an educational AI assistant with memory of the current conversation.\n' +
      'Use the conversation history below to understand what "this topic", "this concept", "above", etc. refer to.\n' +
      'Always base your response on the most relevant topic from the conversation history when the user refers to it.\n\n' +
      historyBlock + '\n\n'
    : 'You are an educational AI assistant.\n\n';

  var userLine = 'User request: "' + userInput + '"';

  if (type === 'summary') {
    return contextInstruction +
      userLine + '\n\n' +
      'Provide a concise summary (2-3 sentences) for the topic the user is asking about.\n' +
      'Respond ONLY with valid JSON:\n' +
      '{\n  "summary": "A clear 2-3 sentence summary"\n}';
  }

  if (type === 'explanation') {
    return contextInstruction +
      userLine + '\n\n' +
      'Provide a detailed explanation (3-4 paragraphs) for the topic the user is asking about.\n' +
      'Respond ONLY with valid JSON:\n' +
      '{\n  "explanation": "A detailed explanation that breaks down the concept clearly"\n}';
  }

  // MCQ type
  return contextInstruction +
    userLine + '\n\n' +
    'Generate 3 multiple-choice questions about the topic the user is asking about.\n' +
    'Respond ONLY with valid JSON:\n' +
    '{\n  "mcqs": [\n' +
    '    {\n      "question": "Question text here",\n      "options": ["Option A text", "Option B text", "Option C text", "Option D text"],\n      "correct_answer": "A"\n    },\n' +
    '    {\n      "question": "Question text here",\n      "options": ["Option A text", "Option B text", "Option C text", "Option D text"],\n      "correct_answer": "B"\n    },\n' +
    '    {\n      "question": "Question text here",\n      "options": ["Option A text", "Option B text", "Option C text", "Option D text"],\n      "correct_answer": "C"\n    }\n' +
    '  ]\n}';
}

// Fetch the last N successful messages from a session to use as context.
// Returns a promise that resolves to an array of ChatMessage docs.
function fetchRecentHistory(sessionId, limitCount) {
  return ChatMessage.find({
    session_id: sessionId,
    ai_status: 'success'
  })
    .sort({ created_at: -1 })
    .limit(limitCount)
    .then(function(messages) {
      // Reverse so oldest is first (chronological order for the prompt)
      return messages.reverse();
    });
}

// Models to try in order — primary first, fallback second
var AI_MODELS = ['gemini-2.5-flash', 'gemini-1.5-flash'];

// Wait for a given number of milliseconds
function wait(ms) {
  return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

// Call Gemini with automatic retry on 503 and model fallback
function callGeminiWithRetry(prompt) {
  var genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  var modelIndex = 0;
  var attempt = 0;
  var maxAttemptsPerModel = 2;

  function tryNext() {
    if (modelIndex >= AI_MODELS.length) {
      return Promise.reject(new Error('All AI models are currently unavailable. Please try again in a moment.'));
    }

    var modelName = AI_MODELS[modelIndex];
    var model = genAI.getGenerativeModel({
      model: modelName,
      generationConfig: { responseMimeType: 'application/json' }
    });

    return model.generateContent(prompt)
      .catch(function(err) {
        var is503 = err.message && (err.message.includes('503') || err.message.includes('Service Unavailable') || err.message.includes('high demand'));
        var isOverload = err.message && (err.message.includes('429') || err.message.includes('quota') || err.message.includes('RESOURCE_EXHAUSTED'));

        if (is503 || isOverload) {
          attempt++;
          if (attempt < maxAttemptsPerModel) {
            // Retry same model after a short delay (exponential backoff)
            var delay = attempt * 1500;
            console.log('Model ' + modelName + ' busy, retrying in ' + delay + 'ms (attempt ' + attempt + ')...');
            return wait(delay).then(tryNext);
          } else {
            // Move to fallback model
            modelIndex++;
            attempt = 0;
            console.log('Switching to fallback model: ' + (AI_MODELS[modelIndex] || 'none'));
            return tryNext();
          }
        }

        // Non-retryable error — rethrow immediately
        return Promise.reject(err);
      });
  }

  return tryNext();
}

// ── POST /api/chat/generate — send a message and get an AI response ───────────
router.post('/generate', auth, aiRateLimit, function(req, res) {

  var input = req.body.input;
  var sessionId = req.body.sessionId;
  var questionType = req.body.questionType || 'auto';

  // Check that the user typed something
  if (!input || !input.trim()) {
    return res.status(400).json({ error: 'Please enter a topic.' });
  }

  // Auto-detect type from the input if not specified
  if (!questionType || questionType === 'auto') {
    questionType = detectQuestionType(input.trim());
  }

  // Check that the question type is valid
  var validTypes = ['summary', 'explanation', 'mcq'];
  if (!validTypes.includes(questionType)) {
    questionType = 'explanation';
  }

  var sessionObj = null;

  // Step 1: Find existing session or create a new one
  var sessionPromise;

  if (sessionId) {
    // Load the existing session
    sessionPromise = ChatSession.findOne({ _id: sessionId, user_id: req.userId })
      .then(function(foundSession) {
        if (!foundSession) {
          return res.status(404).json({ error: 'Chat session not found.' });
        }
        return foundSession;
      });
  } else {
    // Create a brand new session
    sessionPromise = ChatSession.create({
      user_id: req.userId,
      title: input.trim().substring(0, 60),
      last_message_at: new Date()
    });
  }

  sessionPromise
    .then(function(session) {
      if (!session) return; // already sent a 404 response above

      sessionObj = session;

      // Update the last message time
      session.last_message_at = new Date();
      return session.save();
    })
    .then(function() {
      if (!sessionObj) return;

      // Step 2: Fetch recent conversation history for context (last 6 messages)
      return fetchRecentHistory(sessionObj._id, 6);
    })
    .then(function(priorMessages) {
      if (!sessionObj) return;

      // Step 3: Call the Gemini AI API with context-aware prompt
      var prompt = buildPrompt(input.trim(), questionType, priorMessages || []);
      return callGeminiWithRetry(prompt);
    })
    .then(function(result) {
      if (!result) return;

      // Clean up the response text and parse it as JSON
      var responseText = result.response.text();
      responseText = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      var aiData = JSON.parse(responseText);

      // Figure out what text to save in the database
      var aiResponseText = '';
      if (questionType === 'summary') {
        aiResponseText = aiData.summary || '';
      } else if (questionType === 'explanation') {
        aiResponseText = aiData.explanation || '';
      } else {
        aiResponseText = JSON.stringify(aiData.mcqs);
      }

      // Step 3: Save the message to the database
      return ChatMessage.create({
        session_id: sessionObj._id,
        user_id: req.userId,
        user_question: input.trim(),
        question_type: questionType,
        source_type: 'text',
        ai_response: aiResponseText,
        response_type: questionType,
        ai_status: 'success',
        error_message: 'no error detected'
      }).then(function(message) {

        // Step 4: If it was MCQ, save each question separately
        if (questionType === 'mcq' && aiData.mcqs && aiData.mcqs.length > 0) {
          var mcqsToSave = [];

          for (var i = 0; i < aiData.mcqs.length; i++) {
            var mcq = aiData.mcqs[i];
            mcqsToSave.push({
              message_id: message._id,
              question: mcq.question,
              option_a: mcq.options[0],
              option_b: mcq.options[1],
              option_c: mcq.options[2],
              option_d: mcq.options[3],
              correct_option: mcq.correct_answer
            });
          }

          return MCQ.insertMany(mcqsToSave).then(function(savedMcqs) {
            // Merge _id from saved docs back into aiData.mcqs so frontend gets the DB id
            var mcqsWithId = aiData.mcqs.map(function(mcq, idx) {
              return Object.assign({}, mcq, { _id: savedMcqs[idx]._id });
            });
            return { message: message, aiData: aiData, savedMcqs: mcqsWithId };
          });
        }

        return { message: message, aiData: aiData, savedMcqs: null };
      });
    })
    .then(function(result) {
      if (!result) return;

      var message = result.message;
      var aiData = result.aiData;

      // Send the response back to the frontend
      res.json({
        sessionId: sessionObj._id,
        messageId: message._id,
        questionType: questionType,
        summary: aiData.summary || null,
        explanation: aiData.explanation || null,
        mcqs: result.savedMcqs || aiData.mcqs || null
      });
    })
    .catch(function(error) {
      console.log('Generate error:', error.message);

      // Save a failed message record if we have a session
      if (sessionObj) {
        ChatMessage.create({
          session_id: sessionObj._id,
          user_id: req.userId,
          user_question: input.trim(),
          question_type: questionType,
          source_type: 'text',
          ai_response: '',
          response_type: questionType,
          ai_status: 'failed',
          error_message: error.message || 'Unknown error'
        }).catch(function(saveErr) {
          console.log('Could not save failed message:', saveErr.message);
        });
      }

      // Check if it is a rate limit error
      if (error.message && (error.message.includes('429') || error.message.includes('quota'))) {
        return res.status(429).json({ error: 'AI rate limit reached. Please wait a moment and try again.' });
      }

      res.status(500).json({ error: 'Failed to get AI response. Please try again.' });
    });
});

// ── GET /api/chat/history — get all chat sessions for the sidebar ─────────────
router.get('/history', auth, function(req, res) {

  ChatSession.find({ user_id: req.userId })
    .sort({ is_pinned: -1, last_message_at: -1 })
    .limit(50)
    .then(function(sessions) {
      res.json({ sessions: sessions });
    })
    .catch(function(error) {
      console.log('History error:', error.message);
      res.status(500).json({ error: 'Could not load chat history.' });
    });
});

// ── GET /api/chat/session/:id — load all messages in a session ────────────────
router.get('/session/:id', auth, function(req, res) {

  var sessionData = null;
  var messagesData = null;
  var responded = false;

  // Find the session (make sure it belongs to this user)
  ChatSession.findOne({ _id: req.params.id, user_id: req.userId })
    .then(function(session) {

      if (!session) {
        responded = true;
        return res.status(404).json({ error: 'Session not found.' });
      }

      sessionData = session;

      // Get all messages in this session
      return ChatMessage.find({ session_id: session._id }).sort({ created_at: 1 });
    })
    .then(function(messages) {
      if (responded || !messages) return;

      messagesData = messages;

      // Get the IDs of MCQ messages so we can load their questions
      var mcqMessageIds = [];
      for (var i = 0; i < messages.length; i++) {
        if (messages[i].question_type === 'mcq' && messages[i].ai_status === 'success') {
          mcqMessageIds.push(messages[i]._id);
        }
      }

      return MCQ.find({ message_id: { $in: mcqMessageIds } });
    })
    .then(function(mcqs) {
      if (responded || !mcqs) return;

      res.json({
        session: sessionData.toObject(),
        messages: messagesData.map(function(m) { return m.toObject(); }),
        mcqs: mcqs.map(function(m) { return m.toObject(); })
      });
    })
    .catch(function(error) {
      console.log('Session load error:', error.message);
      if (!responded) {
        res.status(500).json({ error: 'Could not load session.' });
      }
    });
});

// ── PATCH /api/chat/history/:id/pin — toggle pin state of a session ──────────
router.patch('/history/:id/pin', auth, function(req, res) {

  // Find the session and flip its is_pinned value
  ChatSession.findOne({ _id: req.params.id, user_id: req.userId })
    .then(function(session) {
      if (!session) {
        return res.status(404).json({ error: 'Session not found.' });
      }

      session.is_pinned = !session.is_pinned;
      return session.save();
    })
    .then(function(session) {
      if (!session) return;
      res.json({ session: session });
    })
    .catch(function(error) {
      console.log('Pin error:', error.message);
      res.status(500).json({ error: 'Could not update pin state.' });
    });
});

// ── PATCH /api/chat/history/:id/rename — rename a chat session ────────────────
router.patch('/history/:id/rename', auth, function(req, res) {

  var title = req.body.title;

  if (!title || !title.trim()) {
    return res.status(400).json({ error: 'Title is required.' });
  }

  ChatSession.findOneAndUpdate(
    { _id: req.params.id, user_id: req.userId },
    { title: title.trim().substring(0, 60) },
    { new: true }
  )
    .then(function(session) {
      if (!session) {
        return res.status(404).json({ error: 'Session not found.' });
      }
      res.json({ session: session });
    })
    .catch(function(error) {
      console.log('Rename error:', error.message);
      res.status(500).json({ error: 'Could not rename session.' });
    });
});

// ── PATCH /api/chat/history/:id/pin — toggle pin on a chat session ───────────
router.patch('/history/:id/pin', auth, function(req, res) {

  // First find the session so we know its current pin state
  ChatSession.findOne({ _id: req.params.id, user_id: req.userId })
    .then(function(session) {
      if (!session) {
        return res.status(404).json({ error: 'Session not found.' });
      }

      // Flip the pin state
      session.is_pinned = !session.is_pinned;
      return session.save();
    })
    .then(function(session) {
      res.json({ session: session });
    })
    .catch(function(error) {
      console.log('Pin error:', error.message);
      res.status(500).json({ error: 'Could not update pin status.' });
    });
});

// ── DELETE /api/chat/history/:id — delete a chat session ─────────────────────
router.delete('/history/:id', auth, function(req, res) {

  var sessionToDelete = null;

  // Find the session first
  ChatSession.findOne({ _id: req.params.id, user_id: req.userId })
    .then(function(session) {

      if (!session) {
        return res.status(404).json({ error: 'Session not found.' });
      }

      sessionToDelete = session;

      // Get all messages in this session
      return ChatMessage.find({ session_id: session._id });
    })
    .then(function(messages) {
      if (!messages) return;

      // Collect all message IDs
      var messageIds = [];
      for (var i = 0; i < messages.length; i++) {
        messageIds.push(messages[i]._id);
      }

      // Delete MCQs linked to those messages
      return MCQ.deleteMany({ message_id: { $in: messageIds } });
    })
    .then(function() {
      // Delete all messages in the session
      return ChatMessage.deleteMany({ session_id: sessionToDelete._id });
    })
    .then(function() {
      // Delete the session itself
      return ChatSession.deleteOne({ _id: sessionToDelete._id });
    })
    .then(function() {
      res.json({ message: 'Chat deleted successfully.' });
    })
    .catch(function(error) {
      console.log('Delete error:', error.message);
      res.status(500).json({ error: 'Could not delete session.' });
    });
});

// ── POST /api/chat/upload — extract text from a file and get AI response ──────
router.post('/upload', auth, aiRateLimit, upload.single('file'), function(req, res) {

  if (!req.file) {
    return res.status(400).json({ error: 'Only PDF, TXT, MD, and DOCX files are supported.' });
  }

  var sessionId = req.body.sessionId;
  var questionType = req.body.questionType || 'auto';
  var fileLabel = req.file.originalname;

  // Auto-detect type from filename/context if not specified
  if (!questionType || questionType === 'auto') {
    questionType = 'summary'; // files default to summary
  }

  var validTypes = ['summary', 'explanation', 'mcq'];
  if (!validTypes.includes(questionType)) {
    questionType = 'summary';
  }

  var extractedText = '';
  var sessionObj = null;

  // Step 1: Extract text from the file
  var extractPromise;

  if (req.file.mimetype === 'application/pdf' || req.file.originalname.match(/\.pdf$/i)) {
    extractPromise = extractPdfText(req.file.buffer);
  } else if (
    req.file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    req.file.mimetype === 'application/msword' ||
    req.file.originalname.match(/\.docx$/i)
  ) {
    extractPromise = mammoth.extractRawText({ buffer: req.file.buffer })
      .then(function(result) { return result.value || ''; });
  } else {
    extractPromise = Promise.resolve(req.file.buffer.toString('utf-8'));
  }

  extractPromise
    .then(function(text) {
      extractedText = text.trim();

      if (!extractedText || extractedText.length < 20) {
        return res.status(400).json({ error: 'Could not extract readable text from the file.' });
      }

      // Truncate to stay within Gemini token limits
      if (extractedText.length > 12000) {
        extractedText = extractedText.substring(0, 12000) + '\n\n[Content truncated...]';
      }

      // Step 2: Find or create a session
      if (sessionId) {
        return ChatSession.findOne({ _id: sessionId, user_id: req.userId })
          .then(function(session) {
            if (!session) {
              return res.status(404).json({ error: 'Chat session not found.' });
            }
            return session;
          });
      } else {
        return ChatSession.create({
          user_id: req.userId,
          title: ('📄 ' + fileLabel).substring(0, 60),
          last_message_at: new Date()
        });
      }
    })
    .then(function(session) {
      if (!session) return;

      sessionObj = session;
      session.last_message_at = new Date();
      return session.save();
    })
    .then(function() {
      if (!sessionObj) return;

      // Step 3: Fetch recent conversation history for context (last 6 messages)
      return fetchRecentHistory(sessionObj._id, 6);
    })
    .then(function(priorMessages) {
      if (!sessionObj) return;

      // Step 4: Call the Gemini AI API with context-aware prompt
      var prompt = buildPrompt(extractedText, questionType, priorMessages || []);
      return callGeminiWithRetry(prompt);
    })
    .then(function(result) {
      if (!result) return;

      // Parse the AI response
      var responseText = result.response.text();
      responseText = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      var aiData = JSON.parse(responseText);

      // Figure out what text to save
      var aiResponseText = '';
      if (questionType === 'summary') {
        aiResponseText = aiData.summary || '';
      } else if (questionType === 'explanation') {
        aiResponseText = aiData.explanation || '';
      } else {
        aiResponseText = JSON.stringify(aiData.mcqs);
      }

      // Step 4: Save the message to the database
      return ChatMessage.create({
        session_id: sessionObj._id,
        user_id: req.userId,
        user_question: '📄 ' + fileLabel,
        question_type: questionType,
        source_type: 'file',
        file_name: fileLabel,
        file_text: extractedText,
        ai_response: aiResponseText,
        response_type: questionType,
        ai_status: 'success',
        error_message: 'no error detected'
      }).then(function(message) {

        // Step 5: Save MCQs if applicable
        if (questionType === 'mcq' && aiData.mcqs && aiData.mcqs.length > 0) {
          var mcqsToSave = [];

          for (var i = 0; i < aiData.mcqs.length; i++) {
            var mcq = aiData.mcqs[i];
            mcqsToSave.push({
              message_id: message._id,
              question: mcq.question,
              option_a: mcq.options[0],
              option_b: mcq.options[1],
              option_c: mcq.options[2],
              option_d: mcq.options[3],
              correct_option: mcq.correct_answer
            });
          }

          return MCQ.insertMany(mcqsToSave).then(function(savedMcqs) {
            var mcqsWithId = aiData.mcqs.map(function(mcq, idx) {
              return Object.assign({}, mcq, { _id: savedMcqs[idx]._id });
            });
            return { message: message, aiData: aiData, savedMcqs: mcqsWithId };
          });
        }

        return { message: message, aiData: aiData, savedMcqs: null };
      });
    })
    .then(function(result) {
      if (!result) return;

      var message = result.message;
      var aiData = result.aiData;

      res.json({
        sessionId: sessionObj._id,
        messageId: message._id,
        questionType: questionType,
        fileName: fileLabel,
        summary: aiData.summary || null,
        explanation: aiData.explanation || null,
        mcqs: result.savedMcqs || aiData.mcqs || null
      });
    })
    .catch(function(error) {
      console.log('Upload error:', error.message);

      // Save a failed message record if we have a session
      if (sessionObj) {
        ChatMessage.create({
          session_id: sessionObj._id,
          user_id: req.userId,
          user_question: '📄 ' + fileLabel,
          question_type: questionType,
          source_type: 'file',
          file_name: fileLabel,
          file_text: extractedText,
          ai_response: '',
          response_type: questionType,
          ai_status: 'failed',
          error_message: error.message || 'Unknown error'
        }).catch(function(saveErr) {
          console.log('Could not save failed message:', saveErr.message);
        });
      }

      if (error.message && (error.message.includes('429') || error.message.includes('quota'))) {
        return res.status(429).json({ error: 'AI rate limit reached. Please wait and try again.' });
      }

      res.status(500).json({ error: error.message || 'Failed to process file.' });
    });
});

// ── PATCH /api/chat/mcq/:id/answer — save the user's answer for an MCQ ────────
router.patch('/mcq/:id/answer', auth, function(req, res) {

  var userAnswer = req.body.user_answer;

  if (!userAnswer || !['A', 'B', 'C', 'D'].includes(userAnswer)) {
    return res.status(400).json({ error: 'Invalid answer. Must be A, B, C, or D.' });
  }

  MCQ.findById(req.params.id)
    .then(function(mcq) {
      if (!mcq) {
        return res.status(404).json({ error: 'MCQ not found.' });
      }

      // Only save the first answer — don't allow overwriting
      if (mcq.user_answer !== null) {
        return res.json({ mcq: mcq });
      }

      mcq.user_answer = userAnswer;
      mcq.is_correct = userAnswer === mcq.correct_option;
      mcq.answered_at = new Date();
      return mcq.save();
    })
    .then(function(mcq) {
      res.json({ mcq: mcq });
    })
    .catch(function(error) {
      console.log('MCQ answer error:', error.message);
      res.status(500).json({ error: 'Could not save answer.' });
    });
});

module.exports = router;

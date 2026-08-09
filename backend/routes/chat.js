var express = require('express');
var { GoogleGenerativeAI } = require('@google/generative-ai');
var multer = require('multer');
var pdfParse = require('pdf-parse');
var mammoth = require('mammoth');

// pdf-parse v2 uses a class
var PDFParser = pdfParse.PDFParse;

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

// ── Rate limiter — max 10 AI calls per IP per minute ─────────────────────────
var requestCounts = {};
setInterval(function() { requestCounts = {}; }, 60 * 1000);

function aiRateLimit(req, res, next) {
  var key = req.ip;
  requestCounts[key] = (requestCounts[key] || 0) + 1;
  if (requestCounts[key] > 10) {
    return res.status(429).json({ error: 'Too many requests. Please wait a moment and try again.' });
  }
  next();
}

// ── File upload config ────────────────────────────────────────────────────────
var upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: function(req, file, cb) {
    var allowed = ['application/pdf', 'text/plain', 'text/markdown',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword'];
    if (allowed.includes(file.mimetype) || file.originalname.match(/\.(pdf|txt|md|docx)$/i)) {
      cb(null, true);
    } else {
      cb(null, false);
    }
  }
});

// ── Build conversation history block ─────────────────────────────────────────
function buildHistoryBlock(priorMessages) {
  if (!priorMessages || priorMessages.length === 0) return '';
  var lines = ['=== Conversation so far (oldest first) ==='];
  for (var i = 0; i < priorMessages.length; i++) {
    var m = priorMessages[i];
    if (m.ai_status !== 'success') continue;
    lines.push('User: ' + m.user_question);
    if (m.question_type === 'mcq') {
      lines.push('Assistant: [Generated MCQs]');
    } else if (m.question_type === 'solve') {
      lines.push('Assistant: [Solved questions from document]');
    } else if (m.question_type === 'extract') {
      lines.push('Assistant: [Extracted questions from document]');
    } else {
      var resp = (m.ai_response || '').substring(0, 500);
      if (m.ai_response && m.ai_response.length > 500) resp += '...';
      lines.push('Assistant: ' + resp);
    }
  }
  lines.push('=== End of conversation ===');
  return lines.join('\n');
}

// ── THE UNIFIED PROMPT ────────────────────────────────────────────────────────
//
// This is the core of the intent-understanding fix.
//
// Instead of pre-classifying the user's intent with regex and choosing a prompt
// template, we give Gemini EVERYTHING — the document, the user's exact words,
// and the conversation history — and let it understand the intent itself.
//
// Gemini is far better at understanding natural language than any regex ruleset.
// It handles every variation automatically: "help me solve", "show MCQs in this",
// "make this easy", "explain question 5", "give 10 new MCQs", etc.
//
// The only thing we enforce is the output JSON shape, so the frontend can render it.
//
function buildUnifiedPrompt(userMessage, documentText, priorMessages) {
  var historyBlock = buildHistoryBlock(priorMessages);
  var hasHistory = historyBlock.length > 0;
  var hasDocument = documentText && documentText.trim().length > 0;

  // ── System context ──
  var prompt =
    'You are an intelligent educational AI assistant.\n' +
    'Your job is to read the user\'s message carefully and do EXACTLY what they ask.\n' +
    'Do NOT decide on your own to summarise, generate MCQs, or do anything else\n' +
    'unless the user specifically asked for it.\n\n';

  // ── Conversation history ──
  if (hasHistory) {
    prompt += historyBlock + '\n\n';
  }

  // ── Document context ──
  if (hasDocument) {
    prompt +=
      '=== UPLOADED DOCUMENT ===\n' +
      documentText + '\n' +
      '=== END OF DOCUMENT ===\n\n';
  }

  // ── User's message ──
  prompt += 'User\'s message: "' + userMessage + '"\n\n';

  // ── Intent-understanding instructions ──
  prompt +=
    'Read the user\'s message above and decide what they want.\n' +
    'Here are the possible actions and when to use each:\n\n' +

    '1. SOLVE — User wants you to answer/solve questions that EXIST in the uploaded document.\n' +
    '   Triggers: "solve this", "solve this paper", "help me solve", "answer these questions",\n' +
    '   "can you help me with this paper", "work through this", "give me solutions", etc.\n' +
    '   Response shape: {"intent":"solve","solvedQuestions":[{"question":"...","answer":"..."}]}\n\n' +

    '2. EXTRACT — User wants to see questions that ALREADY EXIST in the uploaded document.\n' +
    '   Triggers: "show me the questions", "list the MCQs in this", "extract subjective questions",\n' +
    '   "give me the theory questions", "which questions are in this paper", "show all questions", etc.\n' +
    '   Response shape: {"intent":"extract","extractedQuestions":[{"number":"1","question":"...","type":"subjective"}]}\n\n' +

    '3. GENERATE_MCQ — User wants you to CREATE new multiple-choice questions.\n' +
    '   Triggers: "make 10 MCQs", "generate MCQs", "create quiz questions", "make new MCQs from this topic",\n' +
    '   "quiz me", "give me practice questions". A specific count (e.g. "10 MCQs") must be honoured.\n' +
    '   Response shape: {"intent":"mcq","mcqs":[{"question":"...","options":["A","B","C","D"],"correct_answer":"A"}]}\n\n' +

    '4. EXPLAIN — User wants an explanation of a concept, topic, or specific part of the document.\n' +
    '   Triggers: "explain question 5", "explain this concept", "what is X", "how does X work",\n' +
    '   "make this easy to understand", "simplify this", "break this down", etc.\n' +
    '   Response shape: {"intent":"explanation","explanation":"..."}\n\n' +

    '5. SUMMARISE — User wants a summary or overview.\n' +
    '   Triggers: "summarise this", "give me a short summary", "what is this about",\n' +
    '   "give me an overview", "key points", "briefly explain", etc.\n' +
    '   Response shape: {"intent":"summary","summary":"..."}\n\n' +

    '6. CLARIFY — The user\'s request is genuinely unclear and you cannot determine what they want\n' +
    '   even after considering the document and conversation history.\n' +
    '   Do NOT use this if the request is reasonably understandable.\n' +
    '   Response shape: {"intent":"clarify","clarification":"<one short question asking what they want>"}\n\n' +

    'CRITICAL RULES:\n' +
    '- Follow the user\'s exact instruction. If they say "solve", solve. If they say "extract", extract.\n' +
    '- If they say "make 10 MCQs", generate exactly 10 MCQs.\n' +
    '- If they uploaded a document, work with that document\'s content.\n' +
    '- If they say "show me the MCQs in this paper", EXTRACT the existing MCQs — do NOT generate new ones.\n' +
    '- If they say "generate MCQs" or "make MCQs", CREATE new ones — do NOT extract existing ones.\n' +
    '- For solve/extract, the document MUST be present. If no document was uploaded, use the CLARIFY shape\n' +
    '  to ask the user to upload a file.\n' +
    '- Never invent a response type the user did not ask for.\n' +
    '- All JSON string values must be properly escaped (use \\n for newlines, \\" for quotes inside strings).\n' +
    '- Respond with ONLY valid JSON. No markdown, no code fences, no text outside the JSON object.\n';

  return prompt;
}

// ── Normalise the intent string from Gemini's response ───────────────────────
// Maps Gemini's intent field to our internal type names.
var VALID_TYPES = ['summary', 'explanation', 'mcq', 'solve', 'extract', 'clarify'];

function normaliseIntent(intent) {
  if (!intent) return 'summary';
  var s = String(intent).toLowerCase().trim();
  // Accept common variations
  if (s === 'generate_mcq' || s === 'mcq' || s === 'mcqs') return 'mcq';
  if (s === 'solve' || s === 'solved') return 'solve';
  if (s === 'extract' || s === 'extracted') return 'extract';
  if (s === 'explain' || s === 'explanation') return 'explanation';
  if (s === 'summary' || s === 'summarise' || s === 'summarize') return 'summary';
  if (s === 'clarify' || s === 'clarification') return 'clarify';
  return 'summary';
}

// ── Retry / fallback logic for Gemini calls ───────────────────────────────────
var AI_MODELS = ['gemini-2.5-flash', 'gemini-1.5-flash-001'];

function wait(ms) {
  return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

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
            var delay = attempt * 1500;
            console.log('Model ' + modelName + ' busy, retrying in ' + delay + 'ms...');
            return wait(delay).then(tryNext);
          } else {
            modelIndex++;
            attempt = 0;
            return tryNext();
          }
        }
        return Promise.reject(err);
      });
  }
  return tryNext();
}

// ── Safely parse the JSON from Gemini ────────────────────────────────────────
function parseGeminiResponse(responseText) {
  var clean = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  try {
    return JSON.parse(clean);
  } catch (e) {
    console.log('JSON parse error. Raw (first 400 chars):', clean.substring(0, 400));
    throw new Error('The AI returned an unreadable response. Please try again.');
  }
}

// ── Fetch recent history for context ─────────────────────────────────────────
function fetchRecentHistory(sessionId, limitCount) {
  return ChatMessage.find({ session_id: sessionId, ai_status: 'success' })
    .sort({ created_at: -1 })
    .limit(limitCount)
    .then(function(msgs) { return msgs.reverse(); });
}

// ── Process the parsed AI response — save to DB, build reply ─────────────────
// Returns a promise resolving to { sessionId, questionType, ...responseFields }
function processAIResponse(aiData, sessionObj, userQuestion, sourceType, fileLabel, extractedText, userId) {
  var intent = normaliseIntent(aiData.intent);
  console.log('[Intent]', intent, '| user:', userQuestion.substring(0, 60));

  var aiResponseText = '';
  if (intent === 'summary') {
    aiResponseText = aiData.summary || '';
  } else if (intent === 'explanation' || intent === 'clarify') {
    aiResponseText = aiData.explanation || aiData.clarification || '';
  } else if (intent === 'solve') {
    aiResponseText = JSON.stringify(aiData.solvedQuestions || []);
  } else if (intent === 'extract') {
    aiResponseText = JSON.stringify(aiData.extractedQuestions || []);
  } else if (intent === 'mcq') {
    aiResponseText = JSON.stringify(aiData.mcqs || []);
  }

  // Map 'clarify' to 'explanation' for DB storage (not in enum)
  var dbType = (intent === 'clarify') ? 'explanation' : intent;

  var messageDoc = {
    session_id: sessionObj._id,
    user_id: userId,
    user_question: userQuestion,
    question_type: dbType,
    source_type: sourceType,
    ai_response: aiResponseText,
    response_type: dbType,
    ai_status: 'success',
    error_message: 'no error detected'
  };
  if (sourceType === 'file') {
    messageDoc.file_name = fileLabel || '';
    messageDoc.file_text = extractedText || '';
  }

  return ChatMessage.create(messageDoc)
    .then(function(message) {
      // Save MCQs individually if applicable
      if (intent === 'mcq' && aiData.mcqs && aiData.mcqs.length > 0) {
        var mcqsToSave = aiData.mcqs.map(function(mcq) {
          return {
            message_id: message._id,
            question: mcq.question,
            option_a: mcq.options[0],
            option_b: mcq.options[1],
            option_c: mcq.options[2],
            option_d: mcq.options[3],
            correct_option: mcq.correct_answer
          };
        });
        return MCQ.insertMany(mcqsToSave).then(function(savedMcqs) {
          var mcqsWithId = aiData.mcqs.map(function(mcq, idx) {
            return Object.assign({}, mcq, { _id: savedMcqs[idx]._id });
          });
          return { message: message, intent: intent, aiData: aiData, savedMcqs: mcqsWithId };
        });
      }
      return { message: message, intent: intent, aiData: aiData, savedMcqs: null };
    });
}

// ── Build the final HTTP response object ──────────────────────────────────────
function buildResponsePayload(sessionObj, result) {
  var intent = result.intent;
  var aiData = result.aiData;
  // 'clarify' renders as an explanation bubble on the frontend
  var frontendType = (intent === 'clarify') ? 'explanation' : intent;
  return {
    sessionId: sessionObj._id,
    messageId: result.message._id,
    questionType: frontendType,
    summary: aiData.summary || null,
    explanation: aiData.explanation || aiData.clarification || null,
    solvedQuestions: aiData.solvedQuestions || null,
    extractedQuestions: aiData.extractedQuestions || null,
    mcqs: result.savedMcqs || aiData.mcqs || null
  };
}

// ── POST /api/chat/generate — text-only message ───────────────────────────────
router.post('/generate', auth, aiRateLimit, function(req, res) {

  var input = (req.body.input || '').trim();
  var sessionId = req.body.sessionId;

  if (!input) {
    return res.status(400).json({ error: 'Please enter a message.' });
  }

  var sessionObj = null;

  var sessionPromise = sessionId
    ? ChatSession.findOne({ _id: sessionId, user_id: req.userId }).then(function(s) {
        if (!s) { res.status(404).json({ error: 'Chat session not found.' }); return null; }
        return s;
      })
    : ChatSession.create({ user_id: req.userId, title: input.substring(0, 60), last_message_at: new Date() });

  sessionPromise
    .then(function(session) {
      if (!session) return null;
      sessionObj = session;
      session.last_message_at = new Date();
      return session.save();
    })
    .then(function(saved) {
      if (!saved) return null;
      return fetchRecentHistory(sessionObj._id, 6);
    })
    .then(function(priorMessages) {
      if (!priorMessages) return null;
      var prompt = buildUnifiedPrompt(input, null, priorMessages);
      return callGeminiWithRetry(prompt);
    })
    .then(function(result) {
      if (!result) return null;
      var aiData = parseGeminiResponse(result.response.text());
      return processAIResponse(aiData, sessionObj, input, 'text', null, null, req.userId);
    })
    .then(function(result) {
      if (!result) return;
      res.json(buildResponsePayload(sessionObj, result));
    })
    .catch(function(error) {
      console.log('Generate error:', error.message);
      if (sessionObj) {
        ChatMessage.create({
          session_id: sessionObj._id, user_id: req.userId,
          user_question: input, question_type: 'summary', source_type: 'text',
          ai_response: '', response_type: 'summary',
          ai_status: 'failed', error_message: error.message || 'Unknown error'
        }).catch(function() {});
      }
      res.status(500).json({ error: 'AI response unavailable. Please try again.' });
    });
});


// ── GET /api/chat/history ─────────────────────────────────────────────────────
router.get('/history', auth, function(req, res) {
  ChatSession.find({ user_id: req.userId })
    .sort({ is_pinned: -1, last_message_at: -1 })
    .limit(50)
    .then(function(sessions) { res.json({ sessions: sessions }); })
    .catch(function(err) { res.status(500).json({ error: 'Could not load chat history.' }); });
});

// ── GET /api/chat/session/:id ─────────────────────────────────────────────────
router.get('/session/:id', auth, function(req, res) {
  var sessionData = null;
  var messagesData = null;
  var responded = false;

  ChatSession.findOne({ _id: req.params.id, user_id: req.userId })
    .then(function(session) {
      if (!session) { responded = true; return res.status(404).json({ error: 'Session not found.' }); }
      sessionData = session;
      return ChatMessage.find({ session_id: session._id }).sort({ created_at: 1 });
    })
    .then(function(messages) {
      if (responded || !messages) return;
      messagesData = messages;
      var mcqIds = messages.filter(function(m) {
        return m.question_type === 'mcq' && m.ai_status === 'success';
      }).map(function(m) { return m._id; });
      return MCQ.find({ message_id: { $in: mcqIds } });
    })
    .then(function(mcqs) {
      if (responded || !mcqs) return;
      res.json({
        session: sessionData.toObject(),
        messages: messagesData.map(function(m) { return m.toObject(); }),
        mcqs: mcqs.map(function(m) { return m.toObject(); })
      });
    })
    .catch(function(err) {
      console.log('Session load error:', err.message);
      if (!responded) res.status(500).json({ error: 'Could not load session.' });
    });
});

// ── PATCH /api/chat/history/:id/pin ──────────────────────────────────────────
router.patch('/history/:id/pin', auth, function(req, res) {
  ChatSession.findOne({ _id: req.params.id, user_id: req.userId })
    .then(function(session) {
      if (!session) return res.status(404).json({ error: 'Session not found.' });
      session.is_pinned = !session.is_pinned;
      return session.save();
    })
    .then(function(session) { if (session) res.json({ session: session }); })
    .catch(function(err) { res.status(500).json({ error: 'Could not update pin state.' }); });
});

// ── PATCH /api/chat/history/:id/rename ───────────────────────────────────────
router.patch('/history/:id/rename', auth, function(req, res) {
  var title = (req.body.title || '').trim();
  if (!title) return res.status(400).json({ error: 'Title is required.' });
  ChatSession.findOneAndUpdate(
    { _id: req.params.id, user_id: req.userId },
    { title: title.substring(0, 60) },
    { new: true }
  )
    .then(function(session) {
      if (!session) return res.status(404).json({ error: 'Session not found.' });
      res.json({ session: session });
    })
    .catch(function(err) { res.status(500).json({ error: 'Could not rename session.' }); });
});

// ── DELETE /api/chat/history/:id ─────────────────────────────────────────────
router.delete('/history/:id', auth, function(req, res) {
  var sessionToDelete = null;
  ChatSession.findOne({ _id: req.params.id, user_id: req.userId })
    .then(function(session) {
      if (!session) return res.status(404).json({ error: 'Session not found.' });
      sessionToDelete = session;
      return ChatMessage.find({ session_id: session._id });
    })
    .then(function(messages) {
      if (!messages) return;
      var ids = messages.map(function(m) { return m._id; });
      return MCQ.deleteMany({ message_id: { $in: ids } });
    })
    .then(function() { return ChatMessage.deleteMany({ session_id: sessionToDelete._id }); })
    .then(function() { return ChatSession.deleteOne({ _id: sessionToDelete._id }); })
    .then(function() { res.json({ message: 'Chat deleted successfully.' }); })
    .catch(function(err) { res.status(500).json({ error: 'Could not delete session.' }); });
});

// ── POST /api/chat/upload — file upload + AI response ────────────────────────
router.post('/upload', auth, aiRateLimit, upload.single('file'), function(req, res) {

  if (!req.file) {
    return res.status(400).json({ error: 'Only PDF, TXT, MD, and DOCX files are supported.' });
  }

  var sessionId = req.body.sessionId;
  var userInstruction = (req.body.userInstruction || '').trim();
  var fileLabel = req.file.originalname;
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
      .then(function(r) { return r.value || ''; });
  } else {
    extractPromise = Promise.resolve(req.file.buffer.toString('utf-8'));
  }

  extractPromise
    .then(function(text) {
      extractedText = text.trim();
      if (!extractedText || extractedText.length < 20) {
        return res.status(400).json({ error: 'Could not extract readable text from the file.' });
      }

      // Cap at 200 000 chars (~50k tokens) — safe for Gemini 2.5-flash
      var MAX_CHARS = 200000;
      if (extractedText.length > MAX_CHARS) {
        extractedText = extractedText.substring(0, MAX_CHARS) +
          '\n\n[Document truncated — showing first ' + MAX_CHARS + ' characters]';
      }

      // Step 2: Find or create session
      if (sessionId) {
        return ChatSession.findOne({ _id: sessionId, user_id: req.userId })
          .then(function(session) {
            if (!session) { res.status(404).json({ error: 'Chat session not found.' }); return null; }
            return session;
          });
      }
      return ChatSession.create({
        user_id: req.userId,
        title: ('📄 ' + fileLabel).substring(0, 60),
        last_message_at: new Date()
      });
    })
    .then(function(session) {
      if (!session) return null;
      sessionObj = session;
      session.last_message_at = new Date();
      return session.save();
    })
    .then(function(saved) {
      if (!saved) return null;
      return fetchRecentHistory(sessionObj._id, 6);
    })
    .then(function(priorMessages) {
      if (!priorMessages) return null;

      // If no instruction was typed, ask Gemini to summarise by default
      var effectiveInstruction = userInstruction ||
        'Please give me a helpful overview of this document.';

      var prompt = buildUnifiedPrompt(effectiveInstruction, extractedText, priorMessages);
      return callGeminiWithRetry(prompt);
    })
    .then(function(result) {
      if (!result) return null;
      var aiData = parseGeminiResponse(result.response.text());
      var userQuestion = userInstruction
        ? userInstruction + '\n📄 ' + fileLabel
        : '📄 ' + fileLabel;
      return processAIResponse(
        aiData, sessionObj, userQuestion, 'file', fileLabel, extractedText, req.userId
      );
    })
    .then(function(result) {
      if (!result) return;
      res.json(buildResponsePayload(sessionObj, result));
    })
    .catch(function(error) {
      console.log('Upload error:', error.message);
      if (sessionObj) {
        ChatMessage.create({
          session_id: sessionObj._id, user_id: req.userId,
          user_question: '📄 ' + fileLabel, question_type: 'summary',
          source_type: 'file', file_name: fileLabel, file_text: extractedText,
          ai_response: '', response_type: 'summary',
          ai_status: 'failed', error_message: error.message || 'Unknown error'
        }).catch(function() {});
      }
      res.status(500).json({ error: 'AI response unavailable. Please try again.' });
    });
});

// ── PATCH /api/chat/mcq/:id/answer ───────────────────────────────────────────
router.patch('/mcq/:id/answer', auth, function(req, res) {
  var userAnswer = req.body.user_answer;
  if (!userAnswer || !['A', 'B', 'C', 'D'].includes(userAnswer)) {
    return res.status(400).json({ error: 'Invalid answer. Must be A, B, C, or D.' });
  }
  MCQ.findById(req.params.id)
    .then(function(mcq) {
      if (!mcq) return res.status(404).json({ error: 'MCQ not found.' });
      if (mcq.user_answer !== null) return res.json({ mcq: mcq });
      mcq.user_answer = userAnswer;
      mcq.is_correct = userAnswer === mcq.correct_option;
      mcq.answered_at = new Date();
      return mcq.save();
    })
    .then(function(mcq) { res.json({ mcq: mcq }); })
    .catch(function(err) { res.status(500).json({ error: 'Could not save answer.' }); });
});

module.exports = router;

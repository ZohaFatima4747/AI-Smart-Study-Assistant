# 🤖 Smart Study Assistant

A full-stack AI-powered web application that helps students learn any topic through instant summaries, detailed explanations, and interactive MCQ quizzes — all in a clean chat interface powered by Google Gemini.

---

## 📌 Project Overview

Smart Study Assistant lets users type a topic or upload a document and get an AI-generated response in the format they need. The app remembers conversation context within each session so follow-up queries like "give me MCQs on this topic" work exactly as expected.

---

## 🎯 Features

| Feature | Description |
|---|---|
| 🔐 Authentication | JWT-based signup and login with bcrypt password hashing |
| 🧠 AI Summaries | 2–3 sentence concise summaries of any topic |
| 💡 AI Explanations | 3–4 paragraph detailed breakdowns of concepts |
| ❓ MCQ Generation | 3 multiple-choice questions with instant answer checking |
| 📄 File Upload | Upload PDF, TXT, MD, or DOCX files for AI analysis |
| 🔄 Auto Intent Detection | AI detects if you want a summary, explanation, or MCQs from your message |
| 🗂️ Conversation Context | AI remembers the last 6 messages so follow-up queries work naturally |
| 💬 Chat History | All sessions saved, grouped by Today / Yesterday / Older |
| 📌 Pin Chats | Pin important sessions to keep them at the top of the sidebar |
| ✏️ Rename Chats | Inline rename any session directly from the sidebar |
| 🗑️ Delete Chats | Confirmation modal before permanently deleting a session |
| 📋 Copy Response | One-click copy of any AI response to clipboard |
| 🔍 Search | Filter chat history by session title in real time |
| 📱 Responsive UI | Fully responsive from mobile to desktop with animated sidebar |
| ⚡ Rate Limiting | Max 5 AI requests per IP per minute with clear error messages |
| 🔁 AI Fallback | Automatic retry with exponential backoff + fallback to secondary Gemini model |
| 📏 Show More / Less | Long user messages collapse to 3 lines with smooth expand/collapse |

---

## 🛠️ Tech Stack

**Frontend**
- HTML5 / CSS3 / Vanilla JavaScript
- Font Awesome 7 icons
- 4 separate CSS files (one per page): `index.css`, `login.css`, `signup.css`, `dashboard.css`

**Backend**
- Node.js + Express.js
- MongoDB + Mongoose ODM
- JSON Web Tokens (JWT) for auth
- bcryptjs for password hashing
- Multer for file uploads (memory storage)
- pdf-parse for PDF text extraction
- Mammoth for DOCX text extraction

**AI**
- Google Gemini 2.5 Flash (primary model)
- Google Gemini 1.5 Flash (fallback model)
- JSON-mode responses for structured output

---

## 📂 Project Structure

```
AI Smart Study Assistant/
├── backend/
│   ├── config/
│   │   └── db.js                  # MongoDB connection
│   ├── middleware/
│   │   └── auth.js                # JWT authentication middleware
│   ├── models/
│   │   ├── User.js                # User schema
│   │   ├── ChatSession.js         # Chat session schema
│   │   ├── ChatMessage.js         # Message schema
│   │   └── MCQ.js                 # MCQ question schema
│   ├── routes/
│   │   ├── auth.js                # Signup and login routes
│   │   └── chat.js                # All chat/AI routes
│   ├── .env                       # Environment variables (not committed)
│   ├── .env.example               # Environment variable template
│   ├── package.json
│   └── server.js                  # Express app entry point
│
└── frontend/
    ├── css/
    │   ├── index.css              # Home page styles
    │   ├── login.css              # Login page styles
    │   ├── signup.css             # Signup page styles
    │   └── dashboard.css          # Dashboard/chat styles
    ├── js/
    │   ├── main.js                # Shared public page logic
    │   ├── auth.js                # Login and signup form logic
    │   └── dashboard.js           # Full chat dashboard logic
    ├── index.html                 # Home / landing page
    ├── login.html                 # Login page
    ├── signup.html                # Signup page
    ├── dashboard.html             # Main chat application
    ├── favicon.png                # Browser tab icon
    └── Chat bot-amico.svg         # Hero illustration
```

---

## 🚀 Getting Started

### Prerequisites

- Node.js v18+
- MongoDB Atlas account (or local MongoDB)
- Google Gemini API key

### 1. Clone the repository

```bash
git clone <your-repo-url>
cd "AI Smart Study Assistant"
```

### 2. Install backend dependencies

```bash
cd backend
npm install
```

### 3. Configure environment variables

Create a `.env` file inside the `backend/` folder:

```env
MONGO_ATLAS_URI=your_mongodb_connection_string
JWT_SECRET=your_jwt_secret_key
GEMINI_API_KEY=your_google_gemini_api_key
PORT=5000
```

### 4. Start the backend server

```bash
# Development (auto-restart on changes)
npm run dev

# Production
npm start
```

The server starts on `http://localhost:5000`.

### 5. Open the frontend

Open `frontend/index.html` directly in a browser, or serve the `frontend/` folder with any static file server.

> All API calls point to `http://localhost:5000/api` — make sure the backend is running first.

---

## 🌐 API Reference

All routes except `/api/health` require a valid JWT token in the `Authorization: Bearer <token>` header (unless noted).

### Authentication — `/api/auth`

#### `POST /api/auth/signup`
Register a new user account.

**Request body:**
```json
{
  "name": "Zoha Fatima",
  "email": "zoha@example.com",
  "password": "securepassword"
}
```

**Response:**
```json
{
  "message": "Account created successfully",
  "token": "<jwt>",
  "user": { "id": "...", "name": "Zoha Fatima", "email": "zoha@example.com" }
}
```

---

#### `POST /api/auth/login`
Log in with existing credentials.

**Request body:**
```json
{
  "email": "zoha@example.com",
  "password": "securepassword"
}
```

**Response:**
```json
{
  "message": "Login successful",
  "token": "<jwt>",
  "user": { "id": "...", "name": "Zoha Fatima", "email": "zoha@example.com" }
}
```

---

### Chat — `/api/chat` *(all require auth)*

#### `POST /api/chat/generate`
Send a text message and get an AI response.

**Request body:**
```json
{
  "input": "Explain recursion in programming",
  "sessionId": "<optional — omit to start a new session>",
  "questionType": "explanation"
}
```

`questionType` options: `"summary"` | `"explanation"` | `"mcq"` | `"auto"` (auto-detects from input)

**Response:**
```json
{
  "sessionId": "...",
  "messageId": "...",
  "questionType": "explanation",
  "summary": null,
  "explanation": "Recursion is...",
  "mcqs": null
}
```

---

#### `POST /api/chat/upload`
Upload a file and get an AI response based on its content.

**Request:** `multipart/form-data`
- `file` — PDF, TXT, MD, or DOCX (max 10 MB)
- `questionType` — same options as above
- `sessionId` — optional

**Response:** Same shape as `/generate` plus `fileName`.

---

#### `GET /api/chat/history`
Get all chat sessions for the sidebar (sorted by pinned first, then most recent).

**Response:**
```json
{
  "sessions": [
    {
      "_id": "...",
      "title": "Explain recursion",
      "is_pinned": false,
      "last_message_at": "2026-07-04T10:00:00Z"
    }
  ]
}
```

---

#### `GET /api/chat/session/:id`
Load all messages and MCQs for a session.

**Response:**
```json
{
  "session": { "_id": "...", "title": "..." },
  "messages": [...],
  "mcqs": [...]
}
```

---

#### `PATCH /api/chat/history/:id/pin`
Toggle the pin state of a session.

---

#### `PATCH /api/chat/history/:id/rename`
Rename a session.

**Request body:**
```json
{ "title": "New session title" }
```

---

#### `DELETE /api/chat/history/:id`
Permanently delete a session and all its messages and MCQs (cascading delete).

---

#### `PATCH /api/chat/mcq/:id/answer`
Save the user's answer for an MCQ question (write-once — cannot overwrite).

**Request body:**
```json
{ "user_answer": "B" }
```

---

#### `GET /api/health`
Check if the server is running. No auth required.

**Response:** `{ "status": "Server is running" }`

---

## 🗄️ Database Models

### User
| Field | Type | Notes |
|---|---|---|
| `name` | String | Required |
| `email` | String | Required, unique, lowercase |
| `password` | String | bcrypt hashed |
| `created_at` | Date | Auto |

### ChatSession
| Field | Type | Notes |
|---|---|---|
| `user_id` | ObjectId | Ref: User |
| `title` | String | Auto-generated from first message (max 60 chars) |
| `is_pinned` | Boolean | Default false |
| `last_message_at` | Date | Updated on each message |
| `created_at` | Date | Auto |

### ChatMessage
| Field | Type | Notes |
|---|---|---|
| `session_id` | ObjectId | Ref: ChatSession |
| `user_id` | ObjectId | Ref: User |
| `user_question` | String | The original input |
| `question_type` | String | `summary` \| `explanation` \| `mcq` |
| `source_type` | String | `text` \| `file` |
| `file_name` | String | Original filename for file uploads |
| `file_text` | String | Extracted text from uploaded file |
| `ai_response` | String | AI-generated text (MCQs stored as JSON string) |
| `ai_status` | String | `success` \| `failed` |
| `error_message` | String | Error details if failed |
| `created_at` | Date | Auto |

### MCQ
| Field | Type | Notes |
|---|---|---|
| `message_id` | ObjectId | Ref: ChatMessage |
| `question` | String | Question text |
| `option_a/b/c/d` | String | Four answer options |
| `correct_option` | String | `A` \| `B` \| `C` \| `D` |
| `user_answer` | String | User's selected answer (null until answered) |
| `is_correct` | Boolean | Computed on answer submission |
| `answered_at` | Date | Timestamp of answer |

---

## ⚙️ Backend Functions Reference

### `config/db.js`
| Function | Description |
|---|---|
| `connectDB()` | Connects to MongoDB Atlas using `MONGO_ATLAS_URI`. Calls `process.exit(1)` on failure. |

### `middleware/auth.js`
| Function | Description |
|---|---|
| `auth(req, res, next)` | Reads `Authorization: Bearer <token>` header, verifies JWT, attaches `req.userId`. Returns 401 if missing or invalid. |

### `routes/auth.js`
| Function | Description |
|---|---|
| `POST /signup` | Validates fields, checks for duplicate email, hashes password with bcrypt (10 rounds), creates user, returns JWT (7d expiry). |
| `POST /login` | Finds user by email, compares password with bcrypt, returns JWT and user info. |

### `routes/chat.js`
| Function | Description |
|---|---|
| `extractPdfText(buffer)` | Extracts plain text from a PDF buffer using pdf-parse v2 class API. |
| `aiRateLimit(req, res, next)` | In-memory rate limiter — max 5 AI calls per IP per minute. Resets every 60 seconds. |
| `detectQuestionType(input)` | Regex-based intent detection. Scans for MCQ, explanation, and summary keywords in order of specificity. Falls back to `'summary'` when intent is unclear. |
| `buildHistoryBlock(priorMessages)` | Formats recent messages into a readable conversation transcript for the AI prompt. MCQ responses are summarised instead of dumping raw JSON. Responses are trimmed to 600 chars. |
| `buildPrompt(userInput, type, priorMessages)` | Builds the full Gemini prompt. Injects conversation history when available. Instructs the AI to resolve contextual references. Returns JSON-mode prompt for the requested response type. |
| `fetchRecentHistory(sessionId, limitCount)` | Queries the last N successful messages from a session, sorted chronologically for use as prompt context. |
| `wait(ms)` | Returns a promise that resolves after `ms` milliseconds. Used for retry backoff. |
| `callGeminiWithRetry(prompt)` | Calls Gemini with automatic retry (2 attempts per model) and model fallback. Handles 503 (overload) and 429 (quota) errors with exponential backoff. Falls back from `gemini-2.5-flash` to `gemini-1.5-flash`. |

---

## 🖥️ Frontend Functions Reference

### `js/main.js`
| Function / Block | Description |
|---|---|
| Auth redirect IIFE | Redirects already-logged-in users away from `index.html` to `dashboard.html` immediately. |
| Smooth scroll | Handles `#features` and `#about` anchor links with `scrollIntoView`. |
| Hamburger menu | Toggles `.nav-open` on the nav links. Closes menu on outside click or nav link click. Sets `aria-expanded` for accessibility. |

### `js/auth.js`
| Function / Block | Description |
|---|---|
| Auth redirect IIFE | Redirects logged-in users away from login/signup pages immediately. |
| Password toggle | `.toggle-pw` buttons switch input type between `password` and `text`, updates aria-label. |
| Signup form handler | Validates password match client-side, POSTs to `/api/auth/signup`, saves token + user to localStorage, redirects to dashboard. |
| Login form handler | POSTs to `/api/auth/login`, saves token + user to localStorage, redirects to dashboard. |

### `js/dashboard.js`
| Function | Description |
|---|---|
| `isMobile()` | Returns `true` if viewport width is below 769px. |
| `closeSidebarIfMobile()` | Collapses the sidebar only on mobile/tablet viewports. |
| `openSidebar()` | Removes `sidebar-collapsed`, adds `sidebar-open`, shows overlay on mobile. |
| `closeSidebar()` | Removes `sidebar-open`, adds `sidebar-collapsed`, hides overlay. |
| `toggleSidebar()` | Switches between open and closed sidebar states. |
| `loadHistory()` | Fetches all sessions from `GET /api/chat/history` and renders them in the sidebar. |
| `renderHistory(sessions)` | Groups sessions into Pinned / Today / Yesterday / Older sections and builds the sidebar HTML. Wires up click and three-dot menu listeners. |
| `startNewChat()` | Resets the UI to the welcome screen, clears the current session ID, refreshes the history list. |
| `loadSession(sessionId)` | Fetches full session data from `GET /api/chat/session/:id`, renders all messages, highlights active session, closes sidebar on mobile. |
| `openDeleteModal(sessionId)` | Shows the delete confirmation modal, stores the pending session ID, focuses the Cancel button. |
| `closeDeleteModal()` | Hides the modal, clears pending session ID, returns the ID so the caller can act on it. |
| `deleteSession(sessionId)` | Calls `DELETE /api/chat/history/:id`, removes session from local list, resets to new chat if current session was deleted. |
| `openContextMenu(btn, sessionId)` | Positions and displays the three-dot context menu near the clicked button. Wires up Pin, Rename, and Delete actions. |
| `closeContextMenu()` | Removes the active context menu from the DOM and clears `menu-open` class. |
| `pinSession(sessionId)` | Calls `PATCH /api/chat/history/:id/pin`, updates local session pin state, re-renders history. |
| `startRename(sessionId)` | Replaces the title text with an inline input field. Saves on Enter or blur, cancels on Escape. |
| `renameSession(sessionId, newTitle)` | Calls `PATCH /api/chat/history/:id/rename`, updates local title and chat header. |
| `validateInput(hasFile)` | Checks that the textarea is not empty (or a file is attached). Shows shake animation and error message for 3 seconds on failure. |
| `sendMessage()` | Validates input, routes to `sendFile()` if a file is attached, otherwise POSTs to `/api/chat/generate`. Handles auto-detected type label update. Prevents duplicate sends with `isSending` guard. |
| `sendFile(file)` | Builds `FormData`, POSTs to `/api/chat/upload`, updates UI with file message bubble. |
| `showChatArea()` | Hides welcome screen, shows chat area. |
| `formatTime(iso)` | Formats an ISO timestamp to `HH:MM AM/PM`. |
| `appendUserMessage(text, questionType, iso, isFile)` | Renders a user message bubble. Handles three variants: normal text, long text (Show More/Less), and file upload (DOM-created icon to avoid escaping). |
| `appendAIResponse(data, iso)` | Renders AI response bubble for summary, explanation, or MCQ type. Wires up copy-to-clipboard button. |
| `appendLoading()` | Adds the three-dot bouncing loading animation while waiting for AI. Returns the element so it can be removed. |
| `appendError(message)` | Adds a red error message bubble to the chat. |
| `checkAnswer(optionEl)` | Handles MCQ option click — disables all options, highlights correct/incorrect, POSTs answer to `/api/chat/mcq/:id/answer`. |
| `scrollToBottom()` | Scrolls the chat area to the latest message. |
| `autoResize(el)` | Auto-resizes the textarea up to 120px based on content height. |
| `resetTypeDropdown()` | Resets the custom dropdown to the placeholder state after sending. |
| `escapeHtml(text)` | Safely escapes HTML characters to prevent XSS by using a temporary DOM text node. |

---

## 🔒 Security

- Passwords are hashed with **bcrypt** (10 salt rounds) — never stored as plain text
- **JWT tokens** expire after 7 days
- All chat routes are protected by the `auth` middleware
- User input is escaped with `escapeHtml()` before being inserted into the DOM
- File uploads are validated by MIME type and extension, stored in memory only (no disk writes)
- File size is capped at **10 MB**
- Extracted file text is truncated to **12,000 characters** before being sent to the AI

---

## ⚡ AI Response Modes

| Mode | Trigger (Dropdown) | Auto-detected from phrases like... |
|---|---|---|
| **Summary** | Select "Summary" | "summarize", "overview", "brief", "tldr", "key points" |
| **Explanation** | Select "Explain" | "explain", "what is", "how does", "define", "help me understand" |
| **MCQs** | Select "MCQs" | "mcq", "quiz", "multiple choice", "test me", "practice questions" |
| **Auto** | Leave blank | AI detects from full message content |

Explicit dropdown selection always overrides auto-detection.

---

## 💬 Conversational Context

The AI maintains short-term memory within each session. Before every request, the backend fetches the last **6 successful messages** from the session and injects them as a conversation history block into the Gemini prompt. This means:

- "Give me MCQs on this topic" → uses the topic from the previous message
- "Explain it differently" → refers to the concept already discussed
- "Summarize the above" → summarizes the previous AI response

---

## 📦 Dependencies

### Backend
| Package | Version | Purpose |
|---|---|---|
| `@google/generative-ai` | ^0.24.1 | Google Gemini AI SDK |
| `bcryptjs` | ^2.4.3 | Password hashing |
| `cors` | ^2.8.5 | Cross-origin requests |
| `dotenv` | ^16.0.3 | Environment variables |
| `express` | ^4.18.2 | Web framework |
| `jsonwebtoken` | ^9.0.0 | JWT auth tokens |
| `mammoth` | ^1.12.0 | DOCX text extraction |
| `mongoose` | ^7.0.0 | MongoDB ODM |
| `multer` | ^2.1.1 | File upload handling |
| `pdf-parse` | ^2.4.5 | PDF text extraction |
| `nodemon` | ^2.0.22 | Dev auto-restart (devDependency) |

---

## 👩‍💻 Developer

**Created by:** Zoha Fatima
**Role:** Full Stack Web Developer / AI Integration

---

## 📄 License

This project was built as a final-year academic project to demonstrate how AI can be integrated into education tools to simplify learning and improve student understanding.

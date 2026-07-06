// Base URL for all API requests
var API_URL = 'http://localhost:5000/api';

// Get the saved token and user info from localStorage
var token = localStorage.getItem('token');
var user = JSON.parse(localStorage.getItem('user') || 'null');

// If there is no token, redirect immediately before DOM loads
if (!token) {
  window.location.replace('login.html');
}

// Keep track of the current chat session
var currentSessionId = null;
var allSessions = [];
var isSending = false;

// Sidebar references — set on DOMContentLoaded, used by loadSession
var _sidebar = null;
var _sidebarOverlay = null;
var _sidebarToggleBtn = null;

function isMobile() {
  return window.innerWidth < 769;
}

function closeSidebarIfMobile() {
  if (!isMobile() || !_sidebar) return;
  _sidebar.classList.remove('sidebar-open');
  _sidebar.classList.add('sidebar-collapsed');
  if (_sidebarOverlay) _sidebarOverlay.classList.remove('active');
  if (_sidebarToggleBtn) _sidebarToggleBtn.style.display = 'flex';
}

// ── When the page loads ───────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function() {

  // Show the user's name in the sidebar if available
  if (user) {
    var nameEl = document.getElementById('sidebarUserName');
    if (nameEl) {
      nameEl.textContent = user.name;
    }
  }

  // Logout button — clear storage and go to login page
  document.getElementById('logoutBtn').addEventListener('click', function() {
    localStorage.clear();
    window.location.replace('login.html');
  });

  // Get references to sidebar elements
  var sidebarToggleBtn = document.getElementById('sidebarToggleBtn');
  var sidebarOverlay = document.getElementById('sidebarOverlay');
  var sidebar = document.querySelector('.sidebar');
  var sidebarMenuIcon = document.querySelector('.sidebar-menu-icon');

  // Store in outer-scope vars so loadSession can access them
  _sidebar = sidebar;
  _sidebarOverlay = sidebarOverlay;
  _sidebarToggleBtn = sidebarToggleBtn;

  // Check if the screen is mobile size
  function isMobile() {
    return window.innerWidth < 769;
  }

  // Open the sidebar
  function openSidebar() {
    sidebar.classList.remove('sidebar-collapsed');
    sidebar.classList.add('sidebar-open');
    if (isMobile()) {
      sidebarOverlay.classList.add('active');
    }
    if (sidebarToggleBtn) {
      sidebarToggleBtn.style.display = 'none';
    }
  }

  // Close the sidebar
  function closeSidebar() {
    sidebar.classList.remove('sidebar-open');
    sidebar.classList.add('sidebar-collapsed');
    sidebarOverlay.classList.remove('active');
    if (sidebarToggleBtn) {
      sidebarToggleBtn.style.display = 'flex';
    }
  }

  // Toggle the sidebar open or closed
  function toggleSidebar() {
    var isCollapsed = sidebar.classList.contains('sidebar-collapsed');
    if (isCollapsed) {
      openSidebar();
    } else {
      closeSidebar();
    }
  }

  // Set the initial sidebar state based on screen size
  if (isMobile()) {
    closeSidebar();
  } else {
    openSidebar();
  }

  // Re-enable transitions after the first paint (prevents a flash on load)
  requestAnimationFrame(function() {
    requestAnimationFrame(function() {
      document.documentElement.classList.remove('sidebar-init-collapsed');
    });
  });

  // When the window is resized, adjust the sidebar state
  var lastIsMobile = isMobile();
  var resizeTimer;

  window.addEventListener('resize', function() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function() {
      var nowMobile = isMobile();

      // Only do something if we crossed the mobile/desktop boundary
      if (nowMobile === lastIsMobile) return;
      lastIsMobile = nowMobile;

      if (nowMobile) {
        // Switched to mobile — close the sidebar without animation
        sidebar.style.transition = 'none';
        closeSidebar();
        requestAnimationFrame(function() {
          sidebar.style.transition = '';
        });
      } else {
        // Switched to desktop — open the sidebar without animation
        sidebar.style.transition = 'none';
        openSidebar();
        requestAnimationFrame(function() {
          sidebar.style.transition = '';
        });
      }
    }, 50);
  });

  // Hook up the sidebar toggle buttons
  if (sidebarToggleBtn) {
    sidebarToggleBtn.addEventListener('click', toggleSidebar);
  }
  if (sidebarMenuIcon) {
    sidebarMenuIcon.addEventListener('click', toggleSidebar);
  }
  if (sidebarOverlay) {
    sidebarOverlay.addEventListener('click', closeSidebar);
  }

  // New chat button
  document.getElementById('newChatBtn').addEventListener('click', startNewChat);

  // Delete chat button — opens confirmation modal
  document.getElementById('deleteChatBtn').addEventListener('click', function() {
    if (!currentSessionId) return;
    openDeleteModal(currentSessionId);
  });

  // Modal cancel
  document.getElementById('deleteModalCancel').addEventListener('click', closeDeleteModal);

  // Modal confirm delete
  document.getElementById('deleteModalConfirm').addEventListener('click', function() {
    var sessionToDelete = closeDeleteModal();
    if (sessionToDelete) {
      deleteSession(sessionToDelete);
    }
  });

  // Close modal on overlay click
  document.getElementById('deleteChatModal').addEventListener('click', function(e) {
    if (e.target === this) closeDeleteModal();
  });

  // Close modal on Escape key
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') closeDeleteModal();
  });

  // Search box — filter the chat history list
  document.getElementById('searchInput').addEventListener('input', function(e) {
    var query = e.target.value.toLowerCase().trim();

    if (query) {
      var filtered = allSessions.filter(function(session) {
        return session.title.toLowerCase().includes(query);
      });
      renderHistory(filtered);
    } else {
      renderHistory(allSessions);
    }
  });

  // Send button
  document.getElementById('sendBtn').addEventListener('click', sendMessage);

  // ── Custom type dropdown ──────────────────────────────────────────────────
  var customSelect     = document.getElementById('customSelect');
  var customSelectMenu = document.getElementById('customSelectMenu');
  var customSelectVal  = document.getElementById('customSelectValue');
  var nativeSelect     = document.getElementById('questionType');

  function openDropdown() {
    customSelect.classList.add('open');
    customSelectMenu.classList.add('open');
    customSelect.setAttribute('aria-expanded', 'true');
  }

  function closeDropdown() {
    customSelect.classList.remove('open');
    customSelectMenu.classList.remove('open');
    customSelect.setAttribute('aria-expanded', 'false');
  }

  customSelect.addEventListener('click', function(e) {
    e.stopPropagation();
    if (customSelect.classList.contains('open')) {
      closeDropdown();
    } else {
      openDropdown();
    }
  });

  // Keyboard support
  customSelect.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDropdown(); }
    if (e.key === 'Escape') closeDropdown();
  });

  // Option click
  var options = customSelectMenu.querySelectorAll('.custom-select-option');
  for (var oi = 0; oi < options.length; oi++) {
    options[oi].addEventListener('click', function(e) {
      e.stopPropagation();
      var val   = this.dataset.value;
      var label = this.textContent.trim();

      // Update native select so existing validation/send logic still works
      nativeSelect.value = val;

      // Update visible label
      customSelectVal.innerHTML = this.innerHTML;

      // Mark selected
      for (var j = 0; j < options.length; j++) options[j].classList.remove('selected');
      this.classList.add('selected');

      closeDropdown();
    });
  }

  // Close when clicking outside
  document.addEventListener('click', function() { closeDropdown(); });

  // File upload setup
  var fileInput = document.getElementById('fileInput');
  var uploadBtn = document.getElementById('uploadBtn');
  var filePreview = document.getElementById('filePreview');
  var filePreviewName = document.getElementById('filePreviewName');
  var fileClearBtn = document.getElementById('fileClearBtn');

  uploadBtn.addEventListener('click', function() {
    fileInput.click();
  });

  fileInput.addEventListener('change', function() {
    if (fileInput.files && fileInput.files[0]) {
      var fileName = fileInput.files[0].name;
      filePreviewName.textContent = fileName;
      filePreview.style.display = 'flex';
      uploadBtn.classList.add('upload-btn-active');
    }
  });

  fileClearBtn.addEventListener('click', function() {
    fileInput.value = '';
    filePreview.style.display = 'none';
    uploadBtn.classList.remove('upload-btn-active');
  });

  // Send message when Enter is pressed (but not Shift+Enter)
  document.getElementById('topicInput').addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // Auto-resize the textarea as the user types
  document.getElementById('topicInput').addEventListener('input', function() {
    autoResize(this);
  });

  // Load the chat history into the sidebar
  loadHistory();
});

// ── Load chat history from the server ────────────────────────────────────────
function loadHistory() {
  fetch(API_URL + '/chat/history', {
    headers: { Authorization: 'Bearer ' + token }
  })
    .then(function(res) {
      return res.json().then(function(data) {
        return { ok: res.ok, data: data };
      });
    })
    .then(function(result) {
      if (result.ok) {
        allSessions = result.data.sessions || [];
        renderHistory(allSessions);
      }
    })
    .catch(function(e) {
      console.log('loadHistory error:', e);
    });
}

// ── Render the chat history list in the sidebar ───────────────────────────────
function renderHistory(sessions) {
  var list = document.getElementById('historyList');
  if (!list) return;

  // Show a message if there are no chats
  if (!sessions || sessions.length === 0) {
    list.innerHTML = '<div class="empty-history">No chats yet</div>';
    return;
  }

  var now = new Date();
  var todayStr = now.toDateString();
  var yesterdayStr = new Date(now - 86400000).toDateString();

  // Pinned sessions always go first
  var pinned = [];
  var rest = [];

  for (var i = 0; i < sessions.length; i++) {
    if (sessions[i].is_pinned) {
      pinned.push(sessions[i]);
    } else {
      rest.push(sessions[i]);
    }
  }

  // Group the rest by date
  var todayGroup = [];
  var yesterdayGroup = [];
  var olderGroup = [];

  for (var j = 0; j < rest.length; j++) {
    var session = rest[j];
    var dateStr = new Date(session.last_message_at || session.created_at).toDateString();

    if (dateStr === todayStr) {
      todayGroup.push(session);
    } else if (dateStr === yesterdayStr) {
      yesterdayGroup.push(session);
    } else {
      olderGroup.push(session);
    }
  }

  // Build the HTML for the sidebar
  var html = '';

  var groups = [
    { label: 'Pinned', items: pinned },
    { label: 'Today', items: todayGroup },
    { label: 'Yesterday', items: yesterdayGroup },
    { label: 'Older', items: olderGroup }
  ];

  for (var k = 0; k < groups.length; k++) {
    var group = groups[k];
    if (group.items.length === 0) continue;

    html += '<div class="sidebar-section-label">' + group.label + '</div>';

    for (var m = 0; m < group.items.length; m++) {
      var s = group.items[m];
      var isActive = currentSessionId === s._id;
      var pinnedClass = s.is_pinned ? ' pinned' : '';
      var activeClass = isActive ? ' active' : '';

      html +=
        '<div class="history-item' + activeClass + pinnedClass + '" data-id="' + s._id + '">' +
          '<span class="history-item-icon">' + (s.is_pinned ? '<i class="fa-solid fa-thumbtack"></i>' : '<i class="fa-regular fa-message"></i>') + '</span>' +
          '<span class="history-item-title">' + escapeHtml(s.title) + '</span>' +
          '<button class="history-menu-btn" data-id="' + s._id + '" title="Options" aria-label="Chat options">' +
            '<i class="fa-solid fa-ellipsis"></i>' +
          '</button>' +
        '</div>';
    }
  }

  list.innerHTML = html;

  // Add click listeners to each history item
  var historyItems = list.querySelectorAll('.history-item');
  for (var n = 0; n < historyItems.length; n++) {
    historyItems[n].addEventListener('click', function(e) {
      var clickedMenu = e.target.closest('.history-menu-btn');
      if (!clickedMenu) {
        loadSession(this.dataset.id);
      }
    });
  }

  // Add click listeners to the three-dot menu buttons
  var menuButtons = list.querySelectorAll('.history-menu-btn');
  for (var p = 0; p < menuButtons.length; p++) {
    menuButtons[p].addEventListener('click', function(e) {
      e.stopPropagation();
      openContextMenu(this, this.dataset.id);
    });
  }
}

// ── Start a new empty chat ────────────────────────────────────────────────────
function startNewChat() {
  currentSessionId = null;

  document.getElementById('chatMessages').innerHTML = '';
  document.getElementById('topicInput').value = '';
  autoResize(document.getElementById('topicInput'));
  document.getElementById('chatArea').style.display = 'none';
  document.getElementById('welcomeScreen').style.display = 'flex';
  document.getElementById('chatHeaderTitle').textContent = 'Smart Study Assistant';
  document.getElementById('deleteChatBtn').style.display = 'none';

  // Remove the active highlight from all sidebar items
  var items = document.querySelectorAll('.history-item');
  for (var i = 0; i < items.length; i++) {
    items[i].classList.remove('active');
  }

  // Refresh the sidebar so the previous session shows up
  loadHistory();
}

// ── Load a chat session and show its messages ─────────────────────────────────
function loadSession(sessionId) {
  fetch(API_URL + '/chat/session/' + sessionId, {
    headers: { Authorization: 'Bearer ' + token }
  })
    .then(function(res) {
      return res.json().then(function(data) {
        return { ok: res.ok, data: data };
      });
    })
    .then(function(result) {
      if (!result.ok) return;

      var data = result.data;
      currentSessionId = sessionId;

      showChatArea();
      document.getElementById('chatMessages').innerHTML = '';
      document.getElementById('chatHeaderTitle').textContent = data.session.title;
      document.getElementById('deleteChatBtn').style.display = 'flex';

      // Loop through each message and display it
      for (var i = 0; i < data.messages.length; i++) {
        var msg = data.messages[i];

        var isFileMsg = msg.source_type === 'file';
        // Strip the emoji prefix saved by the backend before displaying
        var displayQuestion = isFileMsg
          ? msg.user_question.replace(/^📄\s*/, '')
          : msg.user_question;

        appendUserMessage(displayQuestion, msg.question_type, msg.created_at, isFileMsg);

        if (msg.ai_status === 'failed') {
          appendError('AI response failed for this message.');
          continue;
        }

        if (msg.question_type === 'mcq') {
          // Find the MCQs that belong to this message
          var msgMcqs = [];
          for (var j = 0; j < data.mcqs.length; j++) {
            if (data.mcqs[j].message_id.toString() === msg._id.toString()) {
              msgMcqs.push({
                _id: data.mcqs[j]._id,
                question: data.mcqs[j].question,
                options: [data.mcqs[j].option_a, data.mcqs[j].option_b, data.mcqs[j].option_c, data.mcqs[j].option_d],
                correct_answer: data.mcqs[j].correct_option,
                user_answer: data.mcqs[j].user_answer
              });
            }
          }
          appendAIResponse({ questionType: 'mcq', mcqs: msgMcqs }, msg.created_at);

        } else if (msg.question_type === 'summary') {
          appendAIResponse({ questionType: 'summary', summary: msg.ai_response }, msg.created_at);

        } else {
          appendAIResponse({ questionType: 'explanation', explanation: msg.ai_response }, msg.created_at);
        }
      }

      // Highlight the active session in the sidebar
      var items = document.querySelectorAll('.history-item');
      for (var k = 0; k < items.length; k++) {
        if (items[k].dataset.id === sessionId) {
          items[k].classList.add('active');
        } else {
          items[k].classList.remove('active');
        }
      }

      // On mobile/tablet, close the sidebar after opening a chat
      closeSidebarIfMobile();

      scrollToBottom();
    })
    .catch(function(e) {
      console.log('loadSession error:', e);
    });
}

// ── Delete confirmation modal ─────────────────────────────────────────────────
var _pendingDeleteId = null;

function openDeleteModal(sessionId) {
  _pendingDeleteId = sessionId;
  var modal = document.getElementById('deleteChatModal');
  modal.style.display = 'flex';
  // Focus the cancel button for keyboard accessibility
  document.getElementById('deleteModalCancel').focus();
}

// Returns the session ID that was pending (so the caller can act on it), then clears state
function closeDeleteModal() {
  var pending = _pendingDeleteId;
  _pendingDeleteId = null;
  var modal = document.getElementById('deleteChatModal');
  modal.style.display = 'none';
  return pending;
}

// ── Delete a chat session ─────────────────────────────────────────────────────
function deleteSession(sessionId) {
  fetch(API_URL + '/chat/history/' + sessionId, {
    method: 'DELETE',
    headers: { Authorization: 'Bearer ' + token }
  })
    .then(function(res) {
      if (res.ok) {
        // If we deleted the current session, start a new chat
        if (currentSessionId === sessionId) {
          startNewChat();
        }

        // Remove the session from the local list and re-render
        var newSessions = [];
        for (var i = 0; i < allSessions.length; i++) {
          if (allSessions[i]._id !== sessionId) {
            newSessions.push(allSessions[i]);
          }
        }
        allSessions = newSessions;
        renderHistory(allSessions);
      }
    })
    .catch(function(e) {
      console.log('deleteSession error:', e);
    });
}

// ── Context menu (three-dot menu on each chat item) ───────────────────────────
var activeMenu = null;

function openContextMenu(btn, sessionId) {
  // Close any existing menu first
  closeContextMenu();

  // Build the menu HTML — show "Unpin" if already pinned
  var session = null;
  for (var i = 0; i < allSessions.length; i++) {
    if (allSessions[i]._id === sessionId) {
      session = allSessions[i];
      break;
    }
  }
  var pinLabel = (session && session.is_pinned) ? 'Unpin chat' : 'Pin chat';

  var menu = document.createElement('div');
  menu.className = 'chat-context-menu';
  menu.innerHTML =
    '<button id="menuPin"><i class="fa-solid fa-thumbtack" style="flex-shrink:0;font-size:12px;"></i> ' + pinLabel + '</button>' +
    '<button id="menuRename"><i class="fa-solid fa-pen" style="flex-shrink:0;font-size:12px;"></i> Rename</button>' +
    '<div class="menu-divider"></div>' +
    '<button id="menuDelete" class="danger"><i class="fa-solid fa-trash" style="flex-shrink:0;font-size:12px;"></i> Delete chat</button>';

  document.body.appendChild(menu);
  activeMenu = menu;

  // Position the menu near the button that was clicked
  var rect = btn.getBoundingClientRect();
  var menuWidth = 180;
  var left = rect.right - menuWidth;
  var top = rect.bottom + 4;

  // Make sure the menu doesn't go off screen
  if (left < 8) left = 8;
  if (top + 140 > window.innerHeight) top = rect.top - 144;

  menu.style.left = left + 'px';
  menu.style.top = top + 'px';

  // Mark the item as open so the dots stay visible
  var item = document.querySelector('.history-item[data-id="' + sessionId + '"]');
  if (item) {
    item.classList.add('menu-open');
  }

  // Hook up the menu buttons
  menu.querySelector('#menuPin').addEventListener('click', function() {
    closeContextMenu();
    pinSession(sessionId);
  });

  menu.querySelector('#menuRename').addEventListener('click', function() {
    closeContextMenu();
    startRename(sessionId);
  });

  menu.querySelector('#menuDelete').addEventListener('click', function() {
    closeContextMenu();
    openDeleteModal(sessionId);
  });

  // Close the menu if the user clicks somewhere else
  setTimeout(function() {
    document.addEventListener('click', closeContextMenu, { once: true });
  }, 0);
}

function closeContextMenu() {
  if (activeMenu) {
    activeMenu.remove();
    activeMenu = null;
  }

  // Remove the menu-open class from all items
  var openItems = document.querySelectorAll('.history-item.menu-open');
  for (var i = 0; i < openItems.length; i++) {
    openItems[i].classList.remove('menu-open');
  }
}

// ── Pin or unpin a session (saved to the database) ───────────────────────────
function pinSession(sessionId) {
  fetch(API_URL + '/chat/history/' + sessionId + '/pin', {
    method: 'PATCH',
    headers: { Authorization: 'Bearer ' + token }
  })
    .then(function(res) {
      return res.json().then(function(data) {
        return { ok: res.ok, data: data };
      });
    })
    .then(function(result) {
      if (result.ok) {
        // Update the local session list with the new pin state from the server
        for (var i = 0; i < allSessions.length; i++) {
          if (allSessions[i]._id === sessionId) {
            allSessions[i].is_pinned = result.data.session.is_pinned;
            break;
          }
        }
        renderHistory(allSessions);
      }
    })
    .catch(function(e) {
      console.log('pinSession error:', e);
    });
}

// ── Start renaming a session inline ──────────────────────────────────────────
function startRename(sessionId) {
  var item = document.querySelector('.history-item[data-id="' + sessionId + '"]');
  if (!item) return;

  var titleEl = item.querySelector('.history-item-title');
  var currentTitle = titleEl.textContent;

  // Show the rename input
  item.classList.add('renaming');

  var input = document.createElement('input');
  input.className = 'history-rename-input';
  input.value = currentTitle;
  item.insertBefore(input, item.querySelector('.history-menu-btn'));
  input.focus();
  input.select();

  // Save the new title when the user presses Enter or clicks away
  function saveRename() {
    var newTitle = input.value.trim();
    if (newTitle && newTitle !== currentTitle) {
      renameSession(sessionId, newTitle);
    } else {
      item.classList.remove('renaming');
      input.remove();
    }
  }

  input.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveRename();
    }
    if (e.key === 'Escape') {
      item.classList.remove('renaming');
      input.remove();
    }
  });

  input.addEventListener('blur', saveRename);
}

// ── Send the new title to the server ─────────────────────────────────────────
function renameSession(sessionId, newTitle) {
  fetch(API_URL + '/chat/history/' + sessionId + '/rename', {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + token
    },
    body: JSON.stringify({ title: newTitle })
  })
    .then(function(res) {
      if (res.ok) {
        // Update the title in the local sessions list
        for (var i = 0; i < allSessions.length; i++) {
          if (allSessions[i]._id === sessionId) {
            allSessions[i].title = newTitle;
            break;
          }
        }

        // Update the header title if this is the current session
        if (currentSessionId === sessionId) {
          document.getElementById('chatHeaderTitle').textContent = newTitle;
        }
      }
    })
    .catch(function(e) {
      console.log('renameSession error:', e);
    })
    .finally(function() {
      renderHistory(allSessions);
    });
}

// ── Validate input bar before sending ────────────────────────────────────────
function validateInput(hasFile) {
  var inputRow = document.querySelector('.input-row');
  var validationMsg = document.getElementById('inputValidationMsg');
  var input = document.getElementById('topicInput').value.trim();

  var inputEmpty = !hasFile && !input;

  // Clear previous errors
  inputRow.classList.remove('input-error');
  document.querySelector('.type-select-wrap').classList.remove('input-error');
  validationMsg.classList.remove('show');

  if (inputEmpty) {
    inputRow.classList.add('input-error');
    validationMsg.textContent = 'Please enter a question or upload a file.';
    validationMsg.classList.add('show');

    setTimeout(function() {
      inputRow.classList.remove('input-error');
      validationMsg.classList.remove('show');
    }, 3000);

    return false;
  }

  return true;
}

// ── Send a text message ───────────────────────────────────────────────────────
function sendMessage() {
  // Prevent duplicate calls from button click + Enter key firing together
  if (isSending) return;

  var fileInput = document.getElementById('fileInput');
  var hasFile = fileInput && fileInput.files && fileInput.files[0];

  // Validate before proceeding
  if (!validateInput(hasFile)) return;

  isSending = true;

  // If a file is attached, use the file upload flow instead
  if (hasFile) {
    sendFile(fileInput.files[0]);
    return;
  }

  var input = document.getElementById('topicInput').value.trim();
  var questionType = document.getElementById('questionType').value || 'auto';

  showChatArea();
  appendUserMessage(input, questionType, new Date().toISOString());

  document.getElementById('topicInput').value = '';
  autoResize(document.getElementById('topicInput'));
  resetTypeDropdown();

  var loadingEl = appendLoading();
  scrollToBottom();
  document.getElementById('sendBtn').disabled = true;

  fetch(API_URL + '/chat/generate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + token
    },
    body: JSON.stringify({ input: input, sessionId: currentSessionId, questionType: questionType })
  })
    .then(function(res) {
      loadingEl.remove();
      return res.json().then(function(data) {
        return { ok: res.ok, status: res.status, data: data };
      });
    })
    .then(function(result) {
      if (result.ok) {
        // If this was a new chat, save the session ID
        if (!currentSessionId) {
          currentSessionId = result.data.sessionId;
          document.getElementById('chatHeaderTitle').textContent = input.substring(0, 60);
          document.getElementById('deleteChatBtn').style.display = 'flex';
          loadHistory();
        }

        // If type was auto-detected, update the user message label
        if (questionType === 'auto' && result.data.questionType) {
          var lastUserTime = document.querySelector('.msg-time:last-of-type');
          if (lastUserTime) {
            var modeLabel = { summary: '<i class="fa-solid fa-file-lines"></i> Summary', explanation: '<i class="fa-solid fa-lightbulb"></i> Explanation', mcq: '<i class="fa-solid fa-circle-check"></i> MCQs' };
            var detectedLabel = modeLabel[result.data.questionType] || '';
            lastUserTime.innerHTML = detectedLabel + ' &nbsp;·&nbsp; ' + lastUserTime.innerHTML.split('·')[1];
          }
        }

        appendAIResponse(result.data, new Date().toISOString());

        // Highlight the active session in the sidebar
        var items = document.querySelectorAll('.history-item');
        for (var i = 0; i < items.length; i++) {
          if (items[i].dataset.id === currentSessionId) {
            items[i].classList.add('active');
          } else {
            items[i].classList.remove('active');
          }
        }

      } else if (result.status === 429) {
        appendError(result.data.error || 'Rate limit reached. Please wait and try again.');
      } else {
        appendError(result.data.error || 'Failed to generate response. Please try again.');
      }
    })
    .catch(function(err) {
      loadingEl.remove();
      appendError('Network error. Please check your connection and make sure the server is running.');
    })
    .finally(function() {
      isSending = false;
      document.getElementById('sendBtn').disabled = false;
      scrollToBottom();
    });
}

// ── Send a file to the server ─────────────────────────────────────────────────
function sendFile(file) {
  var questionType = document.getElementById('questionType').value || 'auto';
  var fileInput = document.getElementById('fileInput');
  var filePreview = document.getElementById('filePreview');
  var uploadBtn = document.getElementById('uploadBtn');

  showChatArea();
  appendUserMessage(file.name, questionType, new Date().toISOString(), true);

  // Clear the file input UI
  fileInput.value = '';
  filePreview.style.display = 'none';
  uploadBtn.classList.remove('upload-btn-active');
  resetTypeDropdown();

  var loadingEl = appendLoading();
  scrollToBottom();
  document.getElementById('sendBtn').disabled = true;

  // Build the form data to send the file
  var formData = new FormData();
  formData.append('file', file);
  formData.append('questionType', questionType);
  if (currentSessionId) {
    formData.append('sessionId', currentSessionId);
  }

  fetch(API_URL + '/chat/upload', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token },
    body: formData
  })
    .then(function(res) {
      loadingEl.remove();
      return res.json().then(function(data) {
        return { ok: res.ok, status: res.status, data: data };
      });
    })
    .then(function(result) {
      if (result.ok) {
        // If this was a new chat, save the session ID
        if (!currentSessionId) {
          currentSessionId = result.data.sessionId;
          document.getElementById('chatHeaderTitle').textContent = file.name.substring(0, 55);
          document.getElementById('deleteChatBtn').style.display = 'flex';
          loadHistory();
        }

        appendAIResponse(result.data, new Date().toISOString());

        // Highlight the active session in the sidebar
        var items = document.querySelectorAll('.history-item');
        for (var i = 0; i < items.length; i++) {
          if (items[i].dataset.id === currentSessionId) {
            items[i].classList.add('active');
          } else {
            items[i].classList.remove('active');
          }
        }

      } else if (result.status === 429) {
        appendError(result.data.error || 'Rate limit reached. Please wait and try again.');
      } else {
        appendError(result.data.error || 'Failed to process file. Please try again.');
      }
    })
    .catch(function(err) {
      loadingEl.remove();
      appendError('Network error. Please check your connection and make sure the server is running.');
    })
    .finally(function() {
      isSending = false;
      document.getElementById('sendBtn').disabled = false;
      scrollToBottom();
    });
}

// ── UI helper functions ───────────────────────────────────────────────────────

// Show the chat area and hide the welcome screen
function showChatArea() {
  document.getElementById('welcomeScreen').style.display = 'none';
  document.getElementById('chatArea').style.display = 'flex';
}

// Format a date string into a readable time like "02:30 PM"
function formatTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

// Threshold (chars) above which user text gets collapsed
var MSG_COLLAPSE_THRESHOLD = 120;
// Collapsed height in pixels (~3 lines at 0.93rem / 1.6 line-height ≈ 72px)
var MSG_COLLAPSED_PX = 72;

// Add a user message bubble to the chat
function appendUserMessage(text, questionType, iso, isFile) {
  var modeLabel = {
    summary: '<i class="fa-solid fa-file-lines"></i> Summary',
    explanation: '<i class="fa-solid fa-lightbulb"></i> Explanation',
    mcq: '<i class="fa-solid fa-circle-check"></i> MCQs',
    auto: '<i class="fa-solid fa-wand-magic-sparkles"></i> Auto'
  };
  var label = modeLabel[questionType] || modeLabel['auto'];

  // For file messages the display text is short — never collapse them.
  // For text messages check the threshold as usual.
  var isLong = !isFile && text.length > MSG_COLLAPSE_THRESHOLD;

  var wrap = document.createElement('div');
  wrap.className = 'message';

  // Build the inner content of the user bubble
  var msgUserEl = document.createElement('div');

  if (isLong) {
    msgUserEl.className = 'msg-user msg-user-collapsible';
    msgUserEl.innerHTML =
      '<div class="msg-user-text-wrap collapsed">' +
        '<span class="msg-user-text">' + escapeHtml(text) + '</span>' +
      '</div>' +
      '<button class="msg-toggle-btn" type="button" aria-expanded="false">' +
        '<span class="toggle-label">Show more</span>' +
        '<i class="fa-solid fa-chevron-down toggle-icon"></i>' +
      '</button>';
  } else if (isFile) {
    // Render icon via DOM so Font Awesome loads it correctly — never use escapeHtml on icon HTML
    msgUserEl.className = 'msg-user msg-user-file';
    var iconEl = document.createElement('i');
    iconEl.className = 'fa-solid fa-file-pdf';
    iconEl.setAttribute('aria-hidden', 'true');
    msgUserEl.appendChild(iconEl);
    msgUserEl.appendChild(document.createTextNode(' ' + text));
  } else {
    msgUserEl.className = 'msg-user';
    msgUserEl.textContent = text;
  }

  var avatarEl = document.createElement('div');
  avatarEl.className = 'user-avatar-bubble';
  avatarEl.innerHTML = '<i class="fa-solid fa-user"></i>';

  var rowEl = document.createElement('div');
  rowEl.className = 'msg-row-user';
  rowEl.appendChild(msgUserEl);
  rowEl.appendChild(avatarEl);

  var timeEl = document.createElement('div');
  timeEl.className = 'msg-time';
  timeEl.innerHTML = label + ' &nbsp;·&nbsp; ' + formatTime(iso);

  wrap.appendChild(rowEl);
  wrap.appendChild(timeEl);

  if (isLong) {
    var textWrap = wrap.querySelector('.msg-user-text-wrap');
    var toggleBtn = wrap.querySelector('.msg-toggle-btn');

    // After the element is in the DOM we can measure its real full height
    document.getElementById('chatMessages').appendChild(wrap);

    // Measure full height, then lock it to collapsed size
    var fullHeight = textWrap.scrollHeight;

    // If the content is actually short enough, don't bother collapsing
    if (fullHeight <= MSG_COLLAPSED_PX + 10) {
      textWrap.classList.remove('collapsed');
      toggleBtn.style.display = 'none';
      return;
    }

    // Set the collapsed height explicitly so the transition has a concrete value
    textWrap.style.height = MSG_COLLAPSED_PX + 'px';

    toggleBtn.addEventListener('click', function() {
      var isCollapsed = toggleBtn.getAttribute('aria-expanded') === 'false';

      if (isCollapsed) {
        // Expand: animate to full height
        textWrap.style.height = fullHeight + 'px';
        textWrap.classList.remove('collapsed');
        toggleBtn.setAttribute('aria-expanded', 'true');
        toggleBtn.querySelector('.toggle-label').textContent = 'Show less';
        toggleBtn.querySelector('.toggle-icon').style.transform = 'rotate(180deg)';
      } else {
        // Collapse: animate back to fixed height
        textWrap.style.height = fullHeight + 'px'; // set explicit before animating down
        requestAnimationFrame(function() {
          requestAnimationFrame(function() {
            textWrap.style.height = MSG_COLLAPSED_PX + 'px';
            textWrap.classList.add('collapsed');
          });
        });
        toggleBtn.setAttribute('aria-expanded', 'false');
        toggleBtn.querySelector('.toggle-label').textContent = 'Show more';
        toggleBtn.querySelector('.toggle-icon').style.transform = 'rotate(0deg)';
      }
    });

    return; // already appended above
  }

  document.getElementById('chatMessages').appendChild(wrap);
}

// Add an AI response bubble to the chat
function appendAIResponse(data, iso) {
  var questionType = data.questionType;
  var bodyHtml = '';

  if (questionType === 'summary' && data.summary) {
    bodyHtml = '<p>' + escapeHtml(data.summary) + '</p>';

  } else if (questionType === 'explanation' && data.explanation) {
    // Split the explanation into paragraphs
    var paragraphs = data.explanation.split(/\n\n+/);
    for (var i = 0; i < paragraphs.length; i++) {
      bodyHtml += '<p>' + escapeHtml(paragraphs[i].trim()) + '</p>';
    }

  } else if (questionType === 'mcq' && data.mcqs && data.mcqs.length > 0) {
    // Build the MCQ list
    var mcqItems = '';

    for (var j = 0; j < data.mcqs.length; j++) {
      var mcq = data.mcqs[j];
      var optionsHtml = '';
      var letters = ['A', 'B', 'C', 'D'];

      for (var k = 0; k < mcq.options.length; k++) {
        var letter = letters[k];
        var alreadyAnswered = mcq.user_answer ? true : false;
        var disabledStyle = alreadyAnswered ? ' style="pointer-events:none;"' : '';
        var answerClass = '';
        if (alreadyAnswered) {
          if (letter === mcq.correct_answer) answerClass = ' correct';
          else if (letter === mcq.user_answer) answerClass = ' incorrect';
        }
        optionsHtml +=
          '<div class="mcq-option' + answerClass + '" data-letter="' + letter + '" data-correct="' + mcq.correct_answer + '" data-mcq-id="' + (mcq._id || '') + '"' + disabledStyle + ' onclick="checkAnswer(this)">' +
            letter + ') ' + escapeHtml(mcq.options[k]) +
          '</div>';
      }

      mcqItems +=
        '<div class="mcq-item">' +
          '<div class="mcq-question">' + (j + 1) + '. ' + escapeHtml(mcq.question) + '</div>' +
          '<div class="mcq-options">' + optionsHtml + '</div>' +
        '</div>';
    }

    bodyHtml = '<div class="mcq-list">' + mcqItems + '</div>';
  }

  var msgEl = document.createElement('div');
  msgEl.className = 'message';
  msgEl.innerHTML =
    '<div class="msg-row-ai">' +
      '<div class="ai-avatar-bubble"><i class="fa-solid fa-brain"></i></div>' +
      '<div class="ai-bubble">' +
        bodyHtml +
        '<div class="ai-msg-footer">' +
          '<span class="ai-msg-time">' + formatTime(iso) + '</span>' +
          '<button class="reaction-btn copy-btn" title="Copy"><i class="fa-regular fa-copy"></i></button>' +
        '</div>' +
      '</div>' +
    '</div>';

  // Wire up the copy button to copy the plain text of the AI bubble
  msgEl.querySelector('.copy-btn').addEventListener('click', function() {
    var bubble = msgEl.querySelector('.ai-bubble');
    var text = bubble ? bubble.innerText.trim() : '';
    // Strip the footer line (time + "Copy") from the copied text
    var footer = msgEl.querySelector('.ai-msg-footer');
    var footerText = footer ? footer.innerText.trim() : '';
    if (footerText && text.endsWith(footerText)) {
      text = text.slice(0, text.length - footerText.length).trim();
    }
    navigator.clipboard.writeText(text).then(function() {
      var btn = msgEl.querySelector('.copy-btn');
      btn.innerHTML = '<i class="fa-solid fa-check"></i>';
      setTimeout(function() { btn.innerHTML = '<i class="fa-regular fa-copy"></i>'; }, 1500);
    });
  });

  document.getElementById('chatMessages').appendChild(msgEl);
}

// Add a loading animation while waiting for the AI
function appendLoading() {
  var wrap = document.createElement('div');
  wrap.className = 'message msg-loading';
  wrap.innerHTML =
    '<div class="ai-avatar-bubble"><i class="fa-solid fa-brain"></i></div>' +
    '<div class="loading-dots"><span></span><span></span><span></span></div>';

  document.getElementById('chatMessages').appendChild(wrap);
  return wrap;
}

// Add an error message to the chat
function appendError(message) {
  var wrap = document.createElement('div');
  wrap.className = 'message';
  wrap.innerHTML = '<div class="msg-error"><i class="fa-solid fa-triangle-exclamation"></i> ' + escapeHtml(message) + '</div>';
  document.getElementById('chatMessages').appendChild(wrap);
}

// Check if the user picked the right MCQ answer
function checkAnswer(optionEl) {
  var correctLetter = optionEl.dataset.correct;
  var userAnswer = optionEl.dataset.letter;
  var mcqId = optionEl.dataset.mcqId;
  var optionsContainer = optionEl.closest('.mcq-options');
  var allOptions = optionsContainer.querySelectorAll('.mcq-option');

  // Disable all options so the user can't click again
  for (var i = 0; i < allOptions.length; i++) {
    allOptions[i].style.pointerEvents = 'none';

    // Highlight the correct answer
    if (allOptions[i].dataset.letter === correctLetter) {
      allOptions[i].classList.add('correct');
    }
  }

  // If the user picked the wrong one, highlight it as incorrect
  if (userAnswer !== correctLetter) {
    optionEl.classList.add('incorrect');
  }

  // Save the answer to the backend if we have an MCQ ID
  if (mcqId) {
    fetch(API_URL + '/chat/mcq/' + mcqId + '/answer', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + token
      },
      body: JSON.stringify({ user_answer: userAnswer })
    })
      .then(function(res) {
        return res.json();
      })
      .then(function(data) {
        console.log('Answer saved:', data);
      })
      .catch(function(err) {
        console.log('Failed to save answer:', err);
      });
  }
}

// Scroll the chat area to the bottom
function scrollToBottom() {
  var area = document.getElementById('chatArea');
  if (area) {
    area.scrollTop = area.scrollHeight;
  }
}

// Auto-resize the textarea based on its content
function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

// Reset the type dropdown back to the placeholder state
function resetTypeDropdown() {
  var nativeSelect = document.getElementById('questionType');
  var customSelectVal = document.getElementById('customSelectValue');
  var options = document.querySelectorAll('.custom-select-option');

  nativeSelect.value = '';
  customSelectVal.innerHTML = '<span class="custom-select-placeholder">Type</span>';
  for (var i = 0; i < options.length; i++) {
    options[i].classList.remove('selected');
  }
}

// Safely escape HTML to prevent XSS
function escapeHtml(text) {
  var div = document.createElement('div');
  div.appendChild(document.createTextNode(String(text)));
  return div.innerHTML;
}
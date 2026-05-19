// The base URL for all API calls
var API_URL = 'http://localhost:5000/api';

// Redirect logged-in users away from auth pages immediately — before DOM loads
(function() {
  var token = localStorage.getItem('token');
  if (token) {
    window.location.replace('dashboard.html');
  }
})();

// When the page loads, run this setup code
document.addEventListener('DOMContentLoaded', function() {

  // Set up password show/hide toggle buttons
  var toggleButtons = document.querySelectorAll('.toggle-pw');

  for (var i = 0; i < toggleButtons.length; i++) {
    toggleButtons[i].addEventListener('click', function() {
      var inputId = this.dataset.target;
      var input = document.getElementById(inputId);

      if (!input) return;

      // Switch between showing and hiding the password
      if (input.type === 'password') {
        input.type = 'text';
        this.style.color = '#6c63ff';
        this.setAttribute('aria-label', 'Hide password');
      } else {
        input.type = 'password';
        this.style.color = '';
        this.setAttribute('aria-label', 'Show password');
      }
    });
  }

});

// ── SIGNUP ────────────────────────────────────────────────────────────────────
var signupForm = document.getElementById('signupForm');

if (signupForm) {
  signupForm.addEventListener('submit', function(e) {
    e.preventDefault();

    var name = document.getElementById('name').value;
    var email = document.getElementById('email').value;
    var password = document.getElementById('password').value;
    var confirmPasswordInput = document.getElementById('confirmPassword');
    var errorMessage = document.getElementById('errorMessage');

    // Check if passwords match before sending to the server
    if (confirmPasswordInput && password !== confirmPasswordInput.value) {
      errorMessage.textContent = 'Passwords do not match.';
      errorMessage.classList.add('show');
      return;
    }

    // Send the signup request to the backend
    fetch(API_URL + '/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name, email: email, password: password })
    })
      .then(function(response) {
        return response.json().then(function(data) {
          return { ok: response.ok, data: data };
        });
      })
      .then(function(result) {
        if (result.ok) {
          // Save the token and user info, then go to the dashboard
          localStorage.setItem('token', result.data.token);
          localStorage.setItem('user', JSON.stringify(result.data.user));
          window.location.replace('dashboard.html');
        } else {
          // Show the error message from the server
          errorMessage.textContent = result.data.error || 'Signup failed. Please try again.';
          errorMessage.classList.add('show');
        }
      })
      .catch(function(error) {
        errorMessage.textContent = 'Network error. Please check your connection.';
        errorMessage.classList.add('show');
      });
  });
}

// ── LOGIN ─────────────────────────────────────────────────────────────────────
var loginForm = document.getElementById('loginForm');

if (loginForm) {
  loginForm.addEventListener('submit', function(e) {
    e.preventDefault();

    var email = document.getElementById('email').value;
    var password = document.getElementById('password').value;
    var errorMessage = document.getElementById('errorMessage');

    // Send the login request to the backend
    fetch(API_URL + '/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, password: password })
    })
      .then(function(response) {
        return response.json().then(function(data) {
          return { ok: response.ok, data: data };
        });
      })
      .then(function(result) {
        if (result.ok) {
          // Save the token and user info, then go to the dashboard
          localStorage.setItem('token', result.data.token);
          localStorage.setItem('user', JSON.stringify(result.data.user));
          window.location.replace('dashboard.html');
        } else {
          // Show the error message from the server
          errorMessage.textContent = result.data.error || 'Login failed. Please try again.';
          errorMessage.classList.add('show');
        }
      })
      .catch(function(error) {
        errorMessage.textContent = 'Network error. Please check your connection.';
        errorMessage.classList.add('show');
      });
  });
}

// This file runs on all public pages (index, login, signup)

// Redirect logged-in users away from homepage immediately — before DOM loads
(function() {
  var currentPage = window.location.pathname;
  var isHomePage = currentPage.includes('index') || currentPage === '/' || currentPage.endsWith('index.html');
  if (isHomePage && localStorage.getItem('token')) {
    window.location.replace('dashboard.html');
  }
})();

document.addEventListener('DOMContentLoaded', function() {

  // ── Smooth scroll for anchor links (#features, #about) ──────────────────
  document.querySelectorAll('a[href^="#"]').forEach(function(link) {
    link.addEventListener('click', function(e) {
      var targetId = this.getAttribute('href').slice(1);
      var target = document.getElementById(targetId);
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });

  // ── Hamburger menu ──────────────────────────────────────────────────────────
  var hamburger = document.getElementById('navHamburger');
  var navLinks = document.getElementById('navLinks');

  if (hamburger && navLinks) {

    // Toggle the menu open or closed when the hamburger is clicked
    hamburger.addEventListener('click', function() {
      var isOpen = navLinks.classList.toggle('nav-open');
      hamburger.classList.toggle('is-open', isOpen);
      hamburger.setAttribute('aria-expanded', isOpen);
    });

    // Close the menu when any nav link is clicked
    var allLinks = navLinks.querySelectorAll('.nav-link');
    for (var i = 0; i < allLinks.length; i++) {
      allLinks[i].addEventListener('click', function() {
        navLinks.classList.remove('nav-open');
        hamburger.classList.remove('is-open');
        hamburger.setAttribute('aria-expanded', 'false');
      });
    }

    // Close the menu if the user clicks somewhere else on the page
    document.addEventListener('click', function(e) {
      var clickedHamburger = hamburger.contains(e.target);
      var clickedNav = navLinks.contains(e.target);

      if (!clickedHamburger && !clickedNav) {
        navLinks.classList.remove('nav-open');
        hamburger.classList.remove('is-open');
        hamburger.setAttribute('aria-expanded', 'false');
      }
    });
  }

});

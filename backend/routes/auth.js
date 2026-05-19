var express = require('express');
var bcrypt = require('bcryptjs');
var jwt = require('jsonwebtoken');
var User = require('../models/User');

var router = express.Router();

// ── SIGNUP ────────────────────────────────────────────────────────────────────
router.post('/signup', function(req, res) {

  var name = req.body.name;
  var email = req.body.email;
  var password = req.body.password;

  // Make sure all fields are filled in
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  // Check if this email is already registered
  User.findOne({ email: email })
    .then(function(existingUser) {

      if (existingUser) {
        return res.status(400).json({ error: 'Email already registered' });
      }

      // Hash the password before saving it (never save plain text passwords)
      return bcrypt.hash(password, 10)
        .then(function(hashedPassword) {

          // Create a new user object
          var newUser = new User({
            name: name,
            email: email,
            password: hashedPassword
          });

          // Save the user to the database
          return newUser.save();
        })
        .then(function(savedUser) {

          // Create a JWT token so the user stays logged in
          var token = jwt.sign({ userId: savedUser._id }, process.env.JWT_SECRET, {
            expiresIn: '7d'
          });

          // Send back the token and basic user info
          res.status(201).json({
            message: 'Account created successfully',
            token: token,
            user: {
              id: savedUser._id,
              name: savedUser.name,
              email: savedUser.email
            }
          });
        });
    })
    .catch(function(error) {
      console.log('Signup error:', error.message);
      res.status(500).json({ error: 'Something went wrong. Please try again.' });
    });
});

// ── LOGIN ─────────────────────────────────────────────────────────────────────
router.post('/login', function(req, res) {

  var email = req.body.email;
  var password = req.body.password;

  // Make sure both fields are filled in
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  // Find the user by email
  User.findOne({ email: email })
    .then(function(user) {

      // If no user found, return an error
      if (!user) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      // Check if the password matches
      return bcrypt.compare(password, user.password)
        .then(function(passwordMatch) {

          if (!passwordMatch) {
            return res.status(401).json({ error: 'Invalid email or password' });
          }

          // Create a JWT token
          var token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, {
            expiresIn: '7d'
          });

          // Send back the token and user info
          res.json({
            message: 'Login successful',
            token: token,
            user: {
              id: user._id,
              name: user.name,
              email: user.email
            }
          });
        });
    })
    .catch(function(error) {
      console.log('Login error:', error.message);
      res.status(500).json({ error: 'Something went wrong. Please try again.' });
    });
});

module.exports = router;

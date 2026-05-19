var jwt = require('jsonwebtoken');

// This middleware checks if the user is logged in before allowing access to a route
function auth(req, res, next) {

  // Get the token from the request header
  var authHeader = req.header('Authorization');

  // If there is no token, block the request
  if (!authHeader) {
    return res.status(401).json({ error: 'No token provided. Please login.' });
  }

  // Remove the "Bearer " part from the token string
  var token = authHeader.replace('Bearer ', '');

  // Try to verify the token
  try {
    var decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Save the user ID so the route can use it
    req.userId = decoded.userId;

    // Move on to the next function
    next();

  } catch (error) {
    res.status(401).json({ error: 'Token is invalid or expired. Please login again.' });
  }
}

module.exports = auth;

const jwt = require('jsonwebtoken');
const User = require('../models/user');

// Socket.IO middleware to authenticate connections using JWT
const socketAuth = async (socket, next) => {
  try {
    // Get token from handshake auth object
    const token = socket.handshake.auth.token;
    
    if (!token) {
      return next(new Error('Authentication error: Token not provided'));
    }
    
    // Verify the token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Find the user with the decoded ID
    const user = await User.findById(decoded.id);
    
    if (!user) {
      return next(new Error('Authentication error: User not found'));
    }
    
    // Attach the user object to the socket
    socket.user = {
      id: user._id,
      username: user.username,
      email: user.email,
      walletAddress: user.walletAddress
    };
    
    next();
  } catch (err) {
    return next(new Error('Authentication error: Invalid token'));
  }
};

module.exports = socketAuth;
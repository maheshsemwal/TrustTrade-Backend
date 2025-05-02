const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const { createServer } = require('http');
const { Server } = require('socket.io');
require('dotenv').config();

const userRoutes = require('./routes/auth');
const usersRoutes = require('./routes/users');
const chatRoutes = require('./routes/chat');
const socketAuth = require('./middleware/socketAuth');
const Message = require('./models/Message');
const ChatRoom = require('./models/ChatRoom');
const User = require('./models/user');
const { uploadFile } = require('./config/supabase');

const app = express();
app.use(cors());
app.use(express.json());

// Create HTTP server
const httpServer = createServer(app);

// Create Socket.IO server
const io = new Server(httpServer, {
  cors: {
    origin: '*', // Replace with your frontend URL in production
    methods: ['GET', 'POST']
  }
});

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error(err));

// Apply Socket.IO middleware for authentication
io.use(socketAuth);

// Socket.IO connection handling
io.on('connection', (socket) => {
  const userId = socket.user.id;
  console.log(`User connected: ${socket.user.username} (${userId})`);
  
  // Update user status to online
  User.findByIdAndUpdate(userId, { isOnline: true }).catch(err => {
    console.error('Error updating user status:', err);
  });

  // Keep track of rooms the socket is in
  const joinedRooms = new Set();

  // DISPUTE CHAT ENDPOINTS
  
  // Join a dispute chat room
  socket.on('join:dispute', async ({ disputeId }) => {
    try {
      // Find or create the chat room for this dispute
      let chatRoom = await ChatRoom.findOne({ disputeId });
      
      if (!chatRoom) {
        // Create a new chat room if it doesn't exist
        chatRoom = await ChatRoom.create({
          disputeId,
          participants: [userId],
          isActive: true
        });
      } else {
        // Add user to participants if not already there
        if (!chatRoom.participants.includes(userId)) {
          chatRoom.participants.push(userId);
          await chatRoom.save();
        }
      }
      
      // Join the socket room
      const roomId = `dispute:${disputeId}`;
      socket.join(roomId);
      joinedRooms.add(roomId);
      
      socket.emit('join:dispute:success', { roomId, chatRoomId: chatRoom._id });
    } catch (error) {
      socket.emit('error', { message: 'Failed to join dispute chat', error: error.message });
    }
  });

  // Leave a dispute chat room
  socket.on('leave:dispute', ({ disputeId }) => {
    const roomId = `dispute:${disputeId}`;
    socket.leave(roomId);
    joinedRooms.delete(roomId);
    socket.emit('leave:dispute:success', { disputeId });
  });

  // Send a message in a dispute chat room
  socket.on('message:send', async ({ disputeId, content, messageType = 'text', file = null }) => {
    try {
      const chatRoom = await ChatRoom.findOne({ disputeId });
      
      if (!chatRoom) {
        return socket.emit('error', { message: 'Chat room not found' });
      }
      
      let fileUrl = null;
      let fileName = null;
      
      // Handle file uploads using Supabase
      if (file && (messageType === 'file' || messageType === 'image')) {
        fileUrl = await uploadFile(file, `disputes/${disputeId}`);
        fileName = file.name;
      }
      
      // Create new message
      const newMessage = await Message.create({
        sender: userId,
        content,
        chatRoom: chatRoom._id,
        messageType,
        fileUrl,
        fileName,
        readBy: [userId] // Mark as read by sender
      });
      
      // Populate sender details
      await newMessage.populate('sender', 'username email');
      
      // Update chat room with last message
      chatRoom.lastMessage = newMessage._id;
      await chatRoom.save();
      
      // Broadcast the new message to all users in the room
      const roomId = `dispute:${disputeId}`;
      io.to(roomId).emit('message:new', newMessage);
      
      socket.emit('message:send:success');
    } catch (error) {
      socket.emit('error', { message: 'Failed to send message', error: error.message });
    }
  });

  // Get message history for a dispute
  socket.on('message:history', async ({ disputeId, limit = 50, offset = 0 }) => {
    try {
      const chatRoom = await ChatRoom.findOne({ disputeId });
      
      if (!chatRoom) {
        return socket.emit('error', { message: 'Chat room not found' });
      }
      
      const messages = await Message.find({ chatRoom: chatRoom._id })
        .sort({ createdAt: -1 })
        .skip(offset)
        .limit(limit)
        .populate('sender', 'username email')
        .lean();
      
      socket.emit('message:history:data', { messages: messages.reverse(), total: await Message.countDocuments({ chatRoom: chatRoom._id }) });
    } catch (error) {
      socket.emit('error', { message: 'Failed to get message history', error: error.message });
    }
  });

  // DIRECT MESSAGING ENDPOINTS
  
  // Get user's contact list
  socket.on('direct:contacts', async () => {
    try {
      const user = await User.findById(userId).populate('businessAssociates', 'username email isOnline');
      
      // Get users from recent direct messages as well
      const recentChats = await Message.aggregate([
        { $match: { $or: [{ sender: userId }, { receiver: userId }], chatRoom: null } },
        { $group: { _id: { $cond: [{ $eq: ['$sender', userId] }, '$receiver', '$sender'] } } },
        { $limit: 20 }
      ]);
      
      const recentChatUserIds = recentChats.map(chat => chat._id);
      
      // Fetch user details for recent chats
      const recentChatUsers = await User.find({
        _id: { $in: recentChatUserIds }
      }).select('username email isOnline');
      
      // Combine business associates and recent chat users, removing duplicates
      const contacts = [...user.businessAssociates];
      recentChatUsers.forEach(recentUser => {
        if (!contacts.some(contact => contact._id.equals(recentUser._id))) {
          contacts.push(recentUser);
        }
      });
      
      socket.emit('direct:contacts:data', { contacts });
    } catch (error) {
      socket.emit('error', { message: 'Failed to get contacts', error: error.message });
    }
  });

  // Get message history with a specific user
  socket.on('direct:history', async ({ otherUserId, limit = 50, offset = 0 }) => {
    try {
      const otherUser = await User.findById(otherUserId);
      
      if (!otherUser) {
        return socket.emit('error', { message: 'User not found' });
      }
      
      const messages = await Message.find({
        chatRoom: null, // Direct messages don't belong to a chat room
        $or: [
          { sender: userId, receiver: otherUserId },
          { sender: otherUserId, receiver: userId }
        ]
      })
        .sort({ createdAt: -1 })
        .skip(offset)
        .limit(limit)
        .populate('sender', 'username email')
        .lean();
      
      // Mark messages as read
      await Message.updateMany(
        { 
          sender: otherUserId, 
          receiver: userId, 
          readBy: { $ne: userId } 
        },
        { $push: { readBy: userId } }
      );
      
      socket.emit('direct:history:data', { 
        messages: messages.reverse(), 
        total: await Message.countDocuments({
          chatRoom: null,
          $or: [
            { sender: userId, receiver: otherUserId },
            { sender: otherUserId, receiver: userId }
          ]
        })
      });
    } catch (error) {
      socket.emit('error', { message: 'Failed to get direct message history', error: error.message });
    }
  });

  // Send a direct message to another user
  socket.on('direct:send', async ({ receiverId, content, messageType = 'text', file = null }) => {
    try {
      const receiver = await User.findById(receiverId);
      
      if (!receiver) {
        return socket.emit('error', { message: 'Receiver not found' });
      }
      
      let fileUrl = null;
      let fileName = null;
      
      // Handle file uploads using Supabase
      if (file && (messageType === 'file' || messageType === 'image')) {
        fileUrl = await uploadFile(file, `direct/${userId}_${receiverId}`);
        fileName = file.name;
      }
      
      // Create new message
      const newMessage = await Message.create({
        sender: userId,
        receiver: receiverId,
        content,
        messageType,
        fileUrl,
        fileName,
        readBy: [userId] // Mark as read by sender
      });
      
      // Populate sender details
      await newMessage.populate('sender', 'username email');
      
      // Send to the receiver if they are online
      const receiverSocket = Array.from(io.sockets.sockets.values())
        .find(s => s.user && s.user.id.toString() === receiverId.toString());
      
      if (receiverSocket) {
        receiverSocket.emit('direct:message', newMessage);
      }
      
      socket.emit('direct:send:success', newMessage);
    } catch (error) {
      socket.emit('error', { message: 'Failed to send direct message', error: error.message });
    }
  });

  // TYPING INDICATORS
  
  // User starts typing in a dispute chat
  socket.on('typing:start', ({ disputeId }) => {
    const roomId = `dispute:${disputeId}`;
    socket.to(roomId).emit('user:typing', { userId, username: socket.user.username });
  });
  
  // User stops typing in a dispute chat
  socket.on('typing:stop', ({ disputeId }) => {
    const roomId = `dispute:${disputeId}`;
    socket.to(roomId).emit('user:stopped-typing', { userId });
  });
  
  // User starts typing in a direct message
  socket.on('direct:typing:start', ({ receiverId }) => {
    const receiverSocket = Array.from(io.sockets.sockets.values())
      .find(s => s.user && s.user.id.toString() === receiverId.toString());
    
    if (receiverSocket) {
      receiverSocket.emit('user:typing', { userId, username: socket.user.username });
    }
  });
  
  // User stops typing in a direct message
  socket.on('direct:typing:stop', ({ receiverId }) => {
    const receiverSocket = Array.from(io.sockets.sockets.values())
      .find(s => s.user && s.user.id.toString() === receiverId.toString());
    
    if (receiverSocket) {
      receiverSocket.emit('user:stopped-typing', { userId });
    }
  });

  // Handle disconnection
  socket.on('disconnect', async () => {
    console.log(`User disconnected: ${socket.user.username} (${userId})`);
    
    // Update user status to offline
    User.findByIdAndUpdate(userId, { 
      isOnline: false,
      lastSeen: new Date()
    }).catch(err => {
      console.error('Error updating user status:', err);
    });
    
    // Clean up any rooms
    joinedRooms.forEach(room => {
      socket.leave(room);
    });
  });
});

app.use('/api/auth', userRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/chat', chatRoutes);

const PORT = process.env.PORT || 5000;
httpServer.listen(PORT, () => console.log(`Server running on port ${PORT}`));

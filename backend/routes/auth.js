const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { ethers } = require('ethers');

const JWT_SECRET = process.env.JWT_SECRET;

// Register
router.post('/register', async (req, res) => {
  const { username, email, password, walletAddress, userType } = req.body;

  try {
    const existing = await User.findOne({ email });
    if (existing) return res.status(400).json({ msg: 'User already exists' });

    const hashedPass = password ? await bcrypt.hash(password, 10) : null;

    const newUser = new User({
      username,
      email,
      password: hashedPass,
      userType,
      walletAddress
    });

    await newUser.save();

    const token = jwt.sign({ id: newUser._id }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: newUser._id, email, username, userType, walletAddress } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user || !user.password) return res.status(400).json({ msg: 'Invalid credentials' });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(400).json({ msg: 'Invalid credentials' });

    const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user._id, email: user.email, username: user.username, userType: user.userType, walletAddress: user.walletAddress } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Wallet Login
router.post('/wallet-login', async (req, res) => {
  const { walletAddress } = req.body;

  try {
    let user = await User.findOne({ walletAddress });
    if (!user) {
      user = await User.create({
        username: `user_${walletAddress.slice(2, 8)}`,
        email: `${walletAddress}@wallet.com`, // dummy email
        walletAddress: walletAddress
      });
    }

    const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user._id, username: user.username, walletAddress: walletAddress } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


module.exports = router;
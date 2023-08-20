const express = require('express');
const webSocket = require('ws');
const http = require('http');
const mongoose = require('mongoose');
const bcyrpt = require('bcrypt');
require('dotenv').config();
const cors = require('cors');
const jwt = require('jsonwebtoken');
const User = require('./models/User');
const Message = require('./models/Message');
const cookieParser = require('cookie-parser');

const saltRounds = 10;

const app = express();
app.use(cors({
  credentials: true,
  origin: 'http://localhost:5173'
}));
app.use(express.json());
app.use(cookieParser());

mongoose.connect(
  process.env.MONGO_URL,
  { useNewUrlParser: true, useUnifiedTopology: true },
);

app.get('/test', (req, res) => {
  res.json("Test Ok");
  console.log("Test Ok");
});

app.post('/message', async (req, res) => {
  const { token } = req.cookies;
  jwt.verify(token, process.env.JWT_SECRET, {}, async (err, payload) => {
    if (err) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }

    const text = req.body.message;
    console.log(text);
    const message = await Message.create({ text, sender: payload.username });
    res.json(message);
  });
});

app.post('/register', async (req, res) => {
  const hashedPassword = await bcyrpt.hash(req.body.password, saltRounds);
  const { username, password } = req.body;
  User.create({ username, password:hashedPassword }).then((user) => {
    jwt.sign({ _id: user._id, username: user.username }, process.env.JWT_SECRET, {}, (err, token) => {
      if (err) throw err;
      res.cookie('token', token, { sameSite: 'none', secure: true }).status(201).json({ id: user._id });
    });
  }).catch((err) => {
    res.json(err);
  });
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  User.findOne({ username }).then((user) => {
    if (!user) {
      res.json('User not found');
      return;
    }

    bcyrpt.compare(password, user.password).then((match) => {
      if (!match) {
        res.json('Wrong password');
        return;
      }

      jwt.sign({ _id: user._id, username: user.username }, process.env.JWT_SECRET, {}, (err, token) => {
        if (err) throw err;
        res.cookie('token', token, { sameSite: 'none', secure: true }).json({ id: user._id });
      });
    });
  });
});

app.get('/messages/:id', async (req, res) => {
  const { token } = req.cookies;
  jwt.verify(token, process.env.JWT_SECRET, {}, async (err, payload) => {
    if (err) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }

    const { id } = req.params;
    console.log(payload._id, id)
    const messages = await Message.find({
      senderId: { $in: [payload._id, id] },
      receiverId: { $in: [payload._id, id] },
    });
    console.log(messages);
    res.json(messages);
  });
});

app.get('/profile', async (req, res) => {
  const { token } = req.cookies;
  jwt.verify(token, process.env.JWT_SECRET, {}, async (err, payload) => {
    res.json(payload);
  });
});

app.listen(4000);

const server = http.createServer(app);
const wss = new webSocket.Server({ server });

wss.on('connection', (ws, req) => {
  const cookies = req.headers.cookie;
  if (cookies) {
    const tokenCookieString = cookies.split(';').find(str => str.startsWith('token='));
    if (tokenCookieString) {
      const token = tokenCookieString.split('=')[1];
      if (token) {
        jwt.verify(token, process.env.JWT_SECRET, {}, (err, userData) => {
          if (err) throw err;
          const {_id, username} = userData;
          console.log(_id, username);
          ws.userId = _id;
          ws.username = username;
        });
      } else {
        console.log('No token');
        return;
      }
    } 
  } else {
    console.log('No cookies');
    return;
  }

  function notifyOnline() {
    [...wss.clients].forEach(client => {
      client.send(JSON.stringify({
        online: [...wss.clients].map(c => ({userId:c.userId,username:c.username})),
        type: 'contacts'
      }));
    });
  }

  notifyOnline();

  ws.on('close', () => {
    notifyOnline();
  });

  // ws.timer = setInterval(() => {
  //   notifyOnline();
  // }, 1000);

  ws.on('message', (data) => {
    const message = JSON.parse(data);
    let sentTo = new Set();
    [...wss.clients].forEach(client => {
      if ((client.userId === message.receiverId || client.userId === message.senderId) && !sentTo.has(client.userId)) {
        console.log("Sending message from", client.username);
        sentTo.add(client.userId);
        client.send(JSON.stringify({
          ...message,
          type: 'message'
        }));
      }
    });

    const realMessage = {
      text: message.text,
      senderId: message.senderId,
      receiverId: message.receiverId,
      sender: message.senderUsername,
    };
    Message.create(realMessage).then((message) => { 
      console.log("MESSAGE SAVED");
      console.log(message);
    });
  });
});


server.listen(4001);
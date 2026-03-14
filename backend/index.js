const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Real-time synchronization state
// In a high-traffic production app, we would use Redis
const activeNotes = {}; 

io.on('connection', (socket) => {
  console.log('STARK_NODE: Station Connected ->', socket.id);

  socket.on('join-note', (noteId) => {
    socket.join(noteId);
  });

  socket.on('typing', (data) => {
    // Data contains: { noteId, title, content, tags, checklist, theme }
    socket.to(data.noteId).emit('note-update', data);
  });

  socket.on('sync-all', (allNotes) => {
    // This allows syncing between devices when one comes online
    socket.broadcast.emit('bulk-sync', allNotes);
  });

  socket.on('disconnect', () => {
    console.log('STARK_NODE: Station Disconnected');
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ACTIVE', system: 'STARK_CORE_v1' });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`STARK_INDUSTRIAL_CORE -> Running on port ${PORT}`);
});

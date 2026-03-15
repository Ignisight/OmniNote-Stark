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

  socket.on('pair-request', (data) => {
    // Mobile scans QR and sends PC's socket.id in targetId
    const targetSocketId = data.targetId;
    const roomName = 'user-vault-' + targetSocketId;
    
    console.log(`STARK_NODE: Pairing Mobile(${socket.id}) with PC(${targetSocketId})`);
    
    // Add mobile to the shared room
    socket.join(roomName);

    // Let the PC know it has been successfully verified, and PC joins the room as well
    const targetSocket = io.sockets.sockets.get(targetSocketId);
    if (targetSocket) {
      targetSocket.join(roomName);
      io.to(targetSocketId).emit('bridge-auth-success', { email: 'Mobile App', vaultId: roomName });
      // Ask PC to send its current notes to mobile right after pairing
      io.to(targetSocketId).emit('request-sync');
    }
  });

  socket.on('join-room', (roomId) => {
    socket.join(roomId);
  });

  socket.on('typing', (data) => {
    // Iterate over rooms this socket is in and emit to the user vault
    socket.rooms.forEach(room => {
      if (room.startsWith('user-vault-')) {
        socket.to(room).emit('note-update', data);
      }
    });
  });

  socket.on('sync-all', (allNotes) => {
    socket.rooms.forEach(room => {
      if (room.startsWith('user-vault-')) {
        socket.to(room).emit('bulk-sync', allNotes);
      }
    });
  });

  socket.on('disconnect', () => {
    console.log('STARK_NODE: Station Disconnected', socket.id);
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ACTIVE', system: 'STARK_CORE_v1' });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`STARK_INDUSTRIAL_CORE -> Running on port ${PORT}`);
});

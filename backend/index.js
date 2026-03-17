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
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['polling', 'websocket'], // Allow polling first for restricted LANs
  allowEIO3: true
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

  socket.on('drive-vault-commit', (data) => {
    console.log('STARK_NODE: SECURE_DRIVE_COMMIT ->', data.user || 'STARK_OPERATOR');
    // Broadcast back to all rooms to confirm persistence
    socket.rooms.forEach(room => {
      if (room.startsWith('user-vault-')) {
        socket.to(room).emit('vault-sync-success', { timestamp: new Date().toISOString() });
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

// STARK IDENTITY LINK PROTOCOL
// This bridges the real browser session (Chrome) back to the workstation
const GOOGLE_CLIENT_ID = "889390212351-ivpqcjt3j7n5u085j8v0i5v0i5v0i5v0.apps.googleusercontent.com"; 

app.get('/auth/login', (req, res) => {
  const { socketId, platform } = req.query;
  if (!socketId) return res.status(400).send("STARK_ERROR: MISSING_STATION_ID");

  // Construct Google OAuth URL
  // Redirect back to this server's callback endpoint
  const redirectUri = encodeURIComponent(`${req.protocol}://${req.get('host')}/auth/callback`);
  const scope = encodeURIComponent("email profile https://www.googleapis.com/auth/drive.file");
  const state = encodeURIComponent(JSON.stringify({ socketId, platform }));

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${GOOGLE_CLIENT_ID}&redirect_uri=${redirectUri}&response_type=token&scope=${scope}&state=${state}&prompt=select_account`;

  res.redirect(authUrl);
});

app.get('/auth/callback', (req, res) => {
  // Google returns token in hash fragment for response_type=token
  // But we need to parse it client-side and then notify the workstation
  // We'll serve a small "Stark Bridge" page to capture the hash and POST back here or talk to socket
  res.send(`
    <html>
      <body style="background:#000;color:#fff;font-family:monospace;display:flex;justify-content:center;align-items:center;height:100vh;">
        <div style="text-align:center;">
          <h2 style="color:#ff3131;">STARK_IDENTITY_BRIDGE</h2>
          <p id="status">AUTHORIZING_WORKSTATION_ACCESS...</p>
        </div>
        <script>
          const hash = window.location.hash.substring(1);
          const params = new URLSearchParams(hash);
          const token = params.get('access_token');
          
          const stateQuery = new URLSearchParams(window.location.search).get('state');
          const state = JSON.parse(decodeURIComponent(stateQuery));

          if (token && state.socketId) {
            // Signal the backend via POST to notify the socket
            fetch('/auth/finalize', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ socketId: state.socketId, token: token })
            }).then(() => {
              document.getElementById('status').innerText = "SUCCESS: ACCESS_GRANTED. YOU_CAN_CLOSE_THIS_TAB.";
              setTimeout(() => window.close(), 1500);
            }).catch(e => {
              document.getElementById('status').innerText = "STARK_ERROR: BRIDGE_FAIL";
            });
          }
        </script>
      </body>
    </html>
  `);
});

app.post('/auth/finalize', (req, res) => {
  const { socketId, token } = req.body;
  console.log('STARK_NODE: VERIFYING_IDENTITY_FOR ->', socketId);

  // Notify the specific workstation via socket
  io.to(socketId).emit('auth-success', { token });
  res.sendStatus(200);
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`STARK_INDUSTRIAL_CORE -> Running on port ${PORT}`);
});

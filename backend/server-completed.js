// Talkio Outcomes Engine - Backend Server
import express from "express";
import http from "http";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { Server } from "socket.io";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();


// Initialize Express and Socket.io
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());

// Firebase REST API Configuration (commented out - using in-memory fallback)
// const FIREBASE_PROJECT_ID = "talkio-f7365";
// const FIREBASE_DATABASE_URL = `https://${FIREBASE_PROJECT_ID}-default-rtdb.firebaseio.com`;

// In-Memory Database (Production-ready fallback)
const inMemoryStore = {
  users: {},
  conversations: {},
  messages: {},
  outcomes: {}
};

// Database Functions (In-Memory Implementation)
const db = {
  // Users
  async createUser(email, userData) {
    const emailKey = email.replace(/\./g, ",").replace(/@/g, "_at_");
    inMemoryStore.users[emailKey] = {
      ...userData,
      createdAt: new Date().toISOString(),
      lastSeen: new Date().toISOString()
    };
    console.log(`📝 User created: ${userData.username}`);
    return userData;
  },

  async getUser(email) {
    const emailKey = email.replace(/\./g, ",").replace(/@/g, "_at_");
    return inMemoryStore.users[emailKey] || null;
  },

  async getUserByUsername(username) {
    for (const [key, userData] of Object.entries(inMemoryStore.users)) {
      if (userData?.username?.toLowerCase() === username.toLowerCase()) {
        return userData;
      }
    }
    return null;
  },

  async updateUserLastSeen(email) {
    const emailKey = email.replace(/\./g, ",").replace(/@/g, "_at_");
    if (inMemoryStore.users[emailKey]) {
      inMemoryStore.users[emailKey].lastSeen = new Date().toISOString();
    }
  },

  // Conversations
  async createConversation(conversationData) {
    inMemoryStore.conversations[conversationData.id] = conversationData;
    return conversationData;
  },

  async getConversation(conversationId) {
    return inMemoryStore.conversations[conversationId] || null;
  },

  async getAllConversations() {
    return Object.values(inMemoryStore.conversations);
  },

  async updateConversationStatus(conversationId, status) {
    if (inMemoryStore.conversations[conversationId]) {
      inMemoryStore.conversations[conversationId].status = status;
    }
  },

  // Messages
  async addMessage(conversationId, messageData) {
    const convKey = conversationId.replace(/[.#$\[\]]/g, "_");
    if (!inMemoryStore.messages[convKey]) {
      inMemoryStore.messages[convKey] = [];
    }
    inMemoryStore.messages[convKey].push({
      ...messageData,
      id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date().toISOString()
    });
  },

  async getMessages(conversationId, limit = 100) {
    const convKey = conversationId.replace(/[.#$\[\]]/g, "_");
    const messages = inMemoryStore.messages[convKey] || [];
    return messages
      .slice(-limit)
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  },

  // Outcomes
  async saveOutcome(conversationId, outcome) {
    inMemoryStore.outcomes[conversationId] = {
      ...outcome,
      savedAt: new Date().toISOString()
    };
  },

  async getOutcome(conversationId) {
    return inMemoryStore.outcomes[conversationId] || null;
  },

  // Initialize
  async init() {
    console.log("✅ In-memory database ready (data persists during session)");
  }
};

// JWT Configuration - Enforce secure JWT secret
if (!process.env.JWT_SECRET) {
  console.error('❌ ERROR: JWT_SECRET environment variable is required!');
  console.error('Please set JWT_SECRET in your .env file');
  console.error('Example: JWT_SECRET=your_secure_random_string_here');
  process.exit(1);
}
const JWT_SECRET = process.env.JWT_SECRET;
console.log('✅ JWT Secret configured');


// In-memory session tracking
const userSessions = new Map();
const connectedUsers = new Map();
const authenticatedUsers = new Map();
const userConversations = new Map();
const userMessageRates = new Map();

// Constants
const MAX_MESSAGE_LENGTH = 1000;
const MAX_MESSAGES_PER_MINUTE = 30;
const RATE_LIMIT_WINDOW = 60000;

// Initialize database
db.init();

// Socket.io Connection Handler
io.on("connection", (socket) => {
  let userInfo = { username: null, email: null, isAuthenticated: false };

  // Default: guest
  connectedUsers.set(socket.id, userInfo);
  userSessions.set(socket.id, { isAuthenticated: false });
  socket.emit("auth-status", { isAuthenticated: false, isGuest: true });

  // Authentication
  socket.on("authenticate", async (data) => {
    const { token } = data || {};
    if (!token) {
      socket.emit("auth-status", { isAuthenticated: false, isGuest: true });
      return;
    }

    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      const user = await db.getUser(decoded.email);

      if (user) {
        userInfo = {
          username: user.username,
          email: user.email,
          isAuthenticated: true,
        };
        connectedUsers.set(socket.id, userInfo);
        authenticatedUsers.set(socket.id, userInfo);
        userSessions.set(socket.id, {
          userId: user.email,
          username: user.username,
          email: user.email,
          isAuthenticated: true
        });

        userConversations.set(socket.id, new Set());

        await db.updateUserLastSeen(user.email);

        io.emit("user-count", authenticatedUsers.size);
        socket.emit("auth-status", {
          isAuthenticated: true,
          username: user.username,
          email: user.email
        });

        console.log(`✅ ${user.username} authenticated`);
      }
    } catch (error) {
      socket.emit("auth-status", { isAuthenticated: false, isGuest: true });
    }
  });

  // Create conversation
  socket.on("create-conversation", async (data) => {
    const session = userSessions.get(socket.id);
    if (!session?.isAuthenticated) {
      socket.emit("error", { message: "Please log in to create conversations." });
      return;
    }

    try {
      await db.createConversation(data);
      socket.join(data.id);
      userConversations.get(socket.id)?.add(data.id);

      // Join event
      await db.addMessage(data.id, {
        type: "system",
        event: "conversation-started",
        username: session.username,
        intent: data.intent
      });

      socket.emit("conversation-created", data);
      console.log(`📋 Conversation created: ${data.id} (${data.intent})`);
    } catch (error) {
      socket.emit("error", { message: "Failed to create conversation" });
    }
  });

  // Join conversation/group
  socket.on("join-group", async (data) => {
    const session = userSessions.get(socket.id);
    if (!session?.isAuthenticated) {
      socket.emit("error", { message: "Please log in." });
      return;
    }

    const { groupName } = data || {};
    if (!groupName) return;

    socket.join(groupName);
    userConversations.get(socket.id)?.add(groupName);

    // Get messages
    const messages = await db.getMessages(groupName);
    socket.emit("group-messages", {
      group: groupName,
      chatHistory: messages
    });
  });

  // Post message
  socket.on("post-message", async (data) => {
    const session = userSessions.get(socket.id);
    if (!session?.isAuthenticated) {
      socket.emit("error", { message: "Please log in to send messages." });
      return;
    }

    const { message, conversationId, group } = data || {};
    const targetGroup = conversationId || group;

    if (!message || !targetGroup) return;

    // Rate limiting
    if (!checkRateLimit(socket.id)) {
      socket.emit("error", { message: "Too many messages. Slow down." });
      return;
    }

    const sanitizedMessage = sanitizeInput(message);
    if (!sanitizedMessage || sanitizedMessage.length > MAX_MESSAGE_LENGTH) return;

    const messageData = {
      type: "message",
      username: session.username,
      message: sanitizedMessage,
      group: targetGroup,
    };

    await db.addMessage(targetGroup, messageData);

    const messages = await db.getMessages(targetGroup);
    io.to(targetGroup).emit("group-messages", {
      group: targetGroup,
      chatHistory: messages
    });
  });

  // Typing indicators
  socket.on("typing-start", (data) => {
    const session = userSessions.get(socket.id);
    if (!session?.isAuthenticated) return;

    const { conversationId } = data || {};
    if (conversationId) {
      socket.to(conversationId).emit("user-typing", {
        username: session.username,
        isTyping: true,
        conversationId
      });
    }
  });

  socket.on("typing-stop", (data) => {
    const session = userSessions.get(socket.id);
    if (!session?.isAuthenticated) return;

    const { conversationId } = data || {};
    if (conversationId) {
      socket.to(conversationId).emit("user-typing", {
        username: session.username,
        isTyping: false,
        conversationId
      });
    }
  });

  // Save outcome
  socket.on("save-outcome", async (data) => {
    const session = userSessions.get(socket.id);
    if (!session?.isAuthenticated) {
      socket.emit("error", { message: "Please log in." });
      return;
    }

    const { conversationId, outcome } = data || {};
    if (!conversationId || !outcome) return;

    await db.saveOutcome(conversationId, {
      ...outcome,
      owner: session.username
    });

    socket.emit("outcome-saved", { conversationId });
    console.log(`💾 Outcome saved for ${conversationId}`);
  });

  // Get conversations
  socket.on("get-conversations", async () => {
    const session = userSessions.get(socket.id);
    if (!session?.isAuthenticated) return;

    const convs = await db.getAllConversations();
    socket.emit("conversations-list", convs);
  });

  // Disconnect
  socket.on("disconnect", async () => {
    const session = userSessions.get(socket.id);
    const username = session?.username || "User";

    console.log(`👋 ${username} disconnected`);

    if (session?.isAuthenticated) {
      userConversations.delete(socket.id);

      if (session.email) {
        await db.updateUserLastSeen(session.email);
      }

      io.emit("user-count", authenticatedUsers.size - 1);
      authenticatedUsers.delete(socket.id);
    }

    connectedUsers.delete(socket.id);
    userSessions.delete(socket.id);
    userMessageRates.delete(socket.id);
  });
});

// Authentication Routes
app.post("/auth/signup", async (req, res) => {
  try {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ error: "All fields are required" });
    }

    if (username.length < 3 || username.length > 30) {
      return res.status(400).json({ error: "Username must be 3-30 characters" });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Invalid email format" });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }

    const existingUser = await db.getUser(email.toLowerCase());
    if (existingUser) {
      return res.status(409).json({ error: "Email already exists" });
    }

    const existingUsername = await db.getUserByUsername(username);
    if (existingUsername) {
      return res.status(409).json({ error: "Username already exists" });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await db.createUser(email.toLowerCase(), {
      username: sanitizeInput(username),
      email: email.toLowerCase(),
      passwordHash,
    });

    const token = jwt.sign(
      { username: sanitizeInput(username), email: email.toLowerCase() },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    console.log(`✅ User ${username} created`);
    res.json({ token, username: sanitizeInput(username), email: email.toLowerCase() });
  } catch (error) {
    console.error("Signup error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/auth/login", async (req, res) => {
  try {
    const { emailOrUsername, password } = req.body;

    if (!emailOrUsername || !password) {
      return res.status(400).json({ error: "Email/username and password required" });
    }

    let user = await db.getUser(emailOrUsername.toLowerCase());
    if (!user) {
      user = await db.getUserByUsername(emailOrUsername);
    }

    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = jwt.sign(
      { username: user.username, email: user.email },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    console.log(`✅ ${user.username} logged in`);
    res.json({ token, username: user.username, email: user.email });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/auth/verify", (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({ error: "No token provided" });
    }

    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, JWT_SECRET);

    res.json({ username: decoded.username, email: decoded.email });
  } catch (error) {
    res.status(401).json({ error: "Invalid token" });
  }
});

app.get("/auth/test", (req, res) => {
  res.json({ message: "Talkio Outcomes Engine running!", timestamp: new Date().toISOString() });
});

// Static files
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, "..");

app.use(express.static(join(projectRoot, "frontend")));

app.get("/", (req, res) => {
  res.sendFile(join(projectRoot, "frontend", "index.html"));
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log("");
  console.log("═══════════════════════════════════════════════");
  console.log("  🎯 Talkio Outcomes Engine");
  console.log(`  http://localhost:${PORT}`);
  console.log("  \"Where conversations finish.\"");
  console.log("═══════════════════════════════════════════════");
  console.log("");
});

// Helpers
function sanitizeInput(input) {
  if (typeof input !== "string") return "";
  return input.trim().replace(/[<>]/g, "").replace(/javascript:/gi, "").replace(/on\w+=/gi, "");
}

function checkRateLimit(socketId) {
  const now = Date.now();
  const userRate = userMessageRates.get(socketId);

  if (!userRate) {
    userMessageRates.set(socketId, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
    return true;
  }

  if (now > userRate.resetTime) {
    userMessageRates.set(socketId, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
    return true;
  }

  if (userRate.count >= MAX_MESSAGES_PER_MINUTE) {
    return false;
  }

  userRate.count++;
  return true;
}

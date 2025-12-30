// imports required for server
import express from "express";
import http from "http";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// import the socket.io library
import { Server } from "socket.io";

// initializing the servers: HTTP as well as Web Socket
const app = express();
const server = http.createServer(app);
const io = new Server(server);

// EXTENSION: Add JSON body parsing for auth endpoints
app.use(express.json());

// EXTENSION: Authentication & User Management (in-memory storage)
const JWT_SECRET = process.env.JWT_SECRET || "talkio-secret-key-change-in-production";
const users = new Map(); // email -> { username, email, passwordHash }
const userSessions = new Map(); // socket.id -> { userId, username, email, isAuthenticated }

// Track authenticated users
const authenticatedUsers = new Map(); // socket.id -> { username, email, userId }

// create the chat history array for storing messages
const chatHistory = [];

// Track connected users (EXTENSION: now tracks auth status)
const connectedUsers = new Map(); // socket.id -> { username, isAuthenticated, email? }

// Groups/Rooms support (EXTENSION - doesn't break existing functionality)
const groupMessages = new Map(); // groupName -> array of messages
const groupUsers = new Map(); // groupName -> Set of socket.ids
const userGroups = new Map(); // socket.id -> Set of groupNames
const userMessageRates = new Map(); // socket.id -> { count, resetTime }
const MAX_MESSAGE_LENGTH = 1000;
const MAX_MESSAGES_PER_MINUTE = 30;
const RATE_LIMIT_WINDOW = 60000; // 1 minute

// Initialize "General" group (default group)
const GENERAL_GROUP = "General";
groupMessages.set(GENERAL_GROUP, []);
groupUsers.set(GENERAL_GROUP, new Set());

// listen for new web socket connections
io.on("connection", function callback(socket) {
  // EXTENSION: Authentication-based connection (removed random username generation)
  let userInfo = { username: null, email: null, isAuthenticated: false };
  
  // Handle authentication on connection
  socket.on("authenticate", (data) => {
    const { token } = data || {};
    if (!token) {
      // Guest user - allow read-only access
      userInfo = { username: "Guest", isAuthenticated: false };
      connectedUsers.set(socket.id, userInfo);
      userSessions.set(socket.id, { isAuthenticated: false });
      
      // Send guest state
      socket.emit("auth-status", { isAuthenticated: false, isGuest: true });
      socket.emit("all-groups", Array.from(groupMessages.keys()));
      return;
    }
    
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      const user = users.get(decoded.email);
      
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
        
        // Initialize user groups tracking
        userGroups.set(socket.id, new Set());
        
        // Auto-join General group for authenticated users
        socket.join(GENERAL_GROUP);
        userGroups.get(socket.id).add(GENERAL_GROUP);
        if (!groupUsers.has(GENERAL_GROUP)) {
          groupUsers.set(GENERAL_GROUP, new Set());
        }
        groupUsers.get(GENERAL_GROUP).add(socket.id);
        
        // Send user join system event to General group
        const joinEvent = {
          type: "system",
          event: "user-joined",
          username: user.username,
          timestamp: new Date().toISOString(),
          group: GENERAL_GROUP,
        };
        
        // Add to both legacy chatHistory (for backward compatibility) and groupMessages
        chatHistory.push(joinEvent);
        if (!groupMessages.has(GENERAL_GROUP)) {
          groupMessages.set(GENERAL_GROUP, []);
        }
        groupMessages.get(GENERAL_GROUP).push(joinEvent);
        
        // Broadcast user joined event and updated user count (legacy support)
        io.emit("receive-messages", {
          chatHistory: getAllMessages(),
        });
        io.emit("user-count", authenticatedUsers.size);
        
        // Send group-specific messages (EXTENSION)
        socket.emit("group-messages", {
          group: GENERAL_GROUP,
          chatHistory: getGroupMessages(GENERAL_GROUP),
        });
        socket.emit("user-groups", Array.from(userGroups.get(socket.id)));
        socket.emit("all-groups", Array.from(groupMessages.keys()));
        
        // Send auth status
        socket.emit("auth-status", { 
          isAuthenticated: true, 
          username: user.username,
          email: user.email 
        });
        
        // send the chat history and username to the newly connected client (legacy support)
        socket.emit("receive-messages", {
          chatHistory: getAllMessages(),
          username: user.username,
        });
        
        console.log(`Authenticated user ${user.username} connected`);
      } else {
        throw new Error("User not found");
      }
    } catch (error) {
      // Invalid token - treat as guest
      userInfo = { username: "Guest", isAuthenticated: false };
      connectedUsers.set(socket.id, userInfo);
      userSessions.set(socket.id, { isAuthenticated: false });
      socket.emit("auth-status", { isAuthenticated: false, isGuest: true });
      socket.emit("all-groups", Array.from(groupMessages.keys()));
      console.log("Guest user connected (invalid token)");
    }
  });
  
  // Default: treat as guest until authenticated
  userInfo = { username: "Guest", isAuthenticated: false };
  connectedUsers.set(socket.id, userInfo);
  userSessions.set(socket.id, { isAuthenticated: false });
  socket.emit("auth-status", { isAuthenticated: false, isGuest: true });
  socket.emit("all-groups", Array.from(groupMessages.keys()));

  // listen for new messages from the client (EXISTING - preserved)
  socket.on("post-message", function receiveMessages(data) {
    // EXTENSION: Check authentication
    const session = userSessions.get(socket.id);
    if (!session || !session.isAuthenticated) {
      socket.emit("error", { message: "Authentication required. Please log in to send messages." });
      return;
    }
    
    const { message, group } = data || { message: "", group: GENERAL_GROUP };
    const username = session.username;
    
    // Security: Rate limiting
    if (!checkRateLimit(socket.id)) {
      socket.emit("error", { message: "Message rate limit exceeded. Please slow down." });
      return;
    }
    
    // Security: Validate and sanitize message
    const sanitizedMessage = sanitizeInput(message);
    if (!sanitizedMessage || sanitizedMessage.length === 0) {
      return;
    }
    
    if (sanitizedMessage.length > MAX_MESSAGE_LENGTH) {
      socket.emit("error", { message: `Message too long. Maximum ${MAX_MESSAGE_LENGTH} characters.` });
      return;
    }
    
    const targetGroup = group || GENERAL_GROUP;
    const messageData = {
      type: "message",
      username,
      message: sanitizedMessage,
      timestamp: new Date().toISOString(),
      group: targetGroup,
    };
    
    // Legacy support: add to chatHistory (for backward compatibility)
    chatHistory.push(messageData);

    // EXTENSION: Add to group-specific messages (chronological order - append)
    if (!groupMessages.has(targetGroup)) {
      groupMessages.set(targetGroup, []);
    }
    groupMessages.get(targetGroup).push(messageData);

    // Legacy support: send to all clients (existing behavior)
    io.emit("receive-messages", {
      chatHistory: getAllMessages(),
    });
    
    // EXTENSION: Send to group-specific room
    io.to(targetGroup).emit("group-messages", {
      group: targetGroup,
      chatHistory: getGroupMessages(targetGroup),
    });
  });

  // Handle typing indicators (EXISTING - preserved)
  socket.on("typing-start", (data) => {
    const session = userSessions.get(socket.id);
    if (!session || !session.isAuthenticated) {
      return; // Guests can't show typing
    }
    
    const { group } = data || { group: GENERAL_GROUP };
    const targetGroup = group || GENERAL_GROUP;
    const username = session.username;
    socket.to(targetGroup).emit("user-typing", { username, isTyping: true, group: targetGroup });
    // Legacy support
    socket.broadcast.emit("user-typing", { username, isTyping: true });
  });

  socket.on("typing-stop", (data) => {
    const session = userSessions.get(socket.id);
    if (!session || !session.isAuthenticated) {
      return; // Guests can't show typing
    }
    
    const { group } = data || { group: GENERAL_GROUP };
    const targetGroup = group || GENERAL_GROUP;
    const username = session.username;
    socket.to(targetGroup).emit("user-typing", { username, isTyping: false, group: targetGroup });
    // Legacy support
    socket.broadcast.emit("user-typing", { username, isTyping: false });
  });
  
  // EXTENSION: Group management events (new events, don't interfere with existing)
  socket.on("join-group", (data) => {
    // EXTENSION: Check authentication
    const session = userSessions.get(socket.id);
    if (!session || !session.isAuthenticated) {
      socket.emit("error", { message: "Authentication required. Please log in to join groups." });
      return;
    }
    
    const { groupName } = data || {};
    if (!groupName || typeof groupName !== "string") {
      socket.emit("error", { message: "Invalid group name" });
      return;
    }
    
    const sanitizedGroupName = sanitizeInput(groupName.trim());
    if (!sanitizedGroupName || sanitizedGroupName.length === 0 || sanitizedGroupName.length > 50) {
      socket.emit("error", { message: "Group name must be 1-50 characters" });
      return;
    }
    
    const username = session.username;
    
    // Initialize group if it doesn't exist
    if (!groupMessages.has(sanitizedGroupName)) {
      groupMessages.set(sanitizedGroupName, []);
      groupUsers.set(sanitizedGroupName, new Set());
      io.emit("all-groups", Array.from(groupMessages.keys()));
    }
    
    // Check if user is already in group
    const wasAlreadyInGroup = userGroups.get(socket.id)?.has(sanitizedGroupName) || false;
    
    // Join room (idempotent - safe to call multiple times)
    socket.join(sanitizedGroupName);
    userGroups.get(socket.id).add(sanitizedGroupName);
    groupUsers.get(sanitizedGroupName).add(socket.id);
    
    // Send group messages to user (always send, even if already in group)
    socket.emit("group-messages", {
      group: sanitizedGroupName,
      chatHistory: getGroupMessages(sanitizedGroupName),
    });
    socket.emit("user-groups", Array.from(userGroups.get(socket.id)));
    
    // Notify group only if user wasn't already in it
    if (!wasAlreadyInGroup) {
      const joinEvent = {
        type: "system",
        event: "user-joined-group",
        username,
        group: sanitizedGroupName,
        timestamp: new Date().toISOString(),
      };
      groupMessages.get(sanitizedGroupName).push(joinEvent);
      io.to(sanitizedGroupName).emit("group-messages", {
        group: sanitizedGroupName,
        chatHistory: getGroupMessages(sanitizedGroupName),
      });
    }
  });
  
  socket.on("leave-group", (data) => {
    // EXTENSION: Check authentication
    const session = userSessions.get(socket.id);
    if (!session || !session.isAuthenticated) {
      socket.emit("error", { message: "Authentication required." });
      return;
    }
    
    const { groupName } = data || {};
    if (!groupName || groupName === GENERAL_GROUP) {
      socket.emit("error", { message: "Cannot leave General group" });
      return;
    }
    
    if (!userGroups.get(socket.id)?.has(groupName)) {
      return; // Already not in group
    }
    
    const username = session.username;
    
    // Leave room
    socket.leave(groupName);
    userGroups.get(socket.id).delete(groupName);
    if (groupUsers.has(groupName)) {
      groupUsers.get(groupName).delete(socket.id);
    }
    
    socket.emit("user-groups", Array.from(userGroups.get(socket.id)));
    
    // Notify group
    const leaveEvent = {
      type: "system",
      event: "user-left-group",
      username,
      group: groupName,
      timestamp: new Date().toISOString(),
    };
    if (groupMessages.has(groupName)) {
      groupMessages.get(groupName).push(leaveEvent);
      io.to(groupName).emit("group-messages", {
        group: groupName,
        chatHistory: getGroupMessages(groupName),
      });
    }
  });
  
  socket.on("create-group", (data) => {
    // EXTENSION: Check authentication
    const session = userSessions.get(socket.id);
    if (!session || !session.isAuthenticated) {
      socket.emit("error", { message: "Authentication required. Please log in to create groups." });
      return;
    }
    
    const { groupName } = data || {};
    if (!groupName || typeof groupName !== "string") {
      socket.emit("error", { message: "Invalid group name" });
      return;
    }
    
    const sanitizedGroupName = sanitizeInput(groupName.trim());
    if (!sanitizedGroupName || sanitizedGroupName.length === 0 || sanitizedGroupName.length > 50) {
      socket.emit("error", { message: "Group name must be 1-50 characters" });
      return;
    }
    
    if (groupMessages.has(sanitizedGroupName)) {
      socket.emit("error", { message: "Group already exists" });
      return;
    }
    
    // Create group
    groupMessages.set(sanitizedGroupName, []);
    groupUsers.set(sanitizedGroupName, new Set());
    
    // Auto-join creator
    socket.join(sanitizedGroupName);
    userGroups.get(socket.id).add(sanitizedGroupName);
    groupUsers.get(sanitizedGroupName).add(socket.id);
    
    // Notify all clients (broadcast to everyone, including guests)
    io.emit("all-groups", Array.from(groupMessages.keys()));
    socket.emit("user-groups", Array.from(userGroups.get(socket.id)));
    socket.emit("group-messages", {
      group: sanitizedGroupName,
      chatHistory: getGroupMessages(sanitizedGroupName),
    });
  });

  // listen for disconnects and log them (EXISTING - preserved)
  socket.on("disconnect", () => {
    const session = userSessions.get(socket.id);
    const userInfo = connectedUsers.get(socket.id);
    const username = session?.username || userInfo?.username || "User";
    
    console.log(`${username} disconnected`);
    
    // Remove user from all groups (only if authenticated)
    if (session?.isAuthenticated) {
      const userGroupSet = userGroups.get(socket.id) || new Set();
      userGroupSet.forEach(groupName => {
        if (groupUsers.has(groupName)) {
          groupUsers.get(groupName).delete(socket.id);
        }
      });
      userGroups.delete(socket.id);
      
      // Send user left system event (legacy support)
      const leaveEvent = {
        type: "system",
        event: "user-left",
        username: session.username,
        timestamp: new Date().toISOString(),
        group: GENERAL_GROUP,
      };
      chatHistory.push(leaveEvent);
      
      // EXTENSION: Add to General group messages
      if (groupMessages.has(GENERAL_GROUP)) {
        groupMessages.get(GENERAL_GROUP).push(leaveEvent);
      }
      
      // Broadcast user left event and updated user count (legacy support)
      io.emit("receive-messages", {
        chatHistory: getAllMessages(),
      });
      io.emit("user-count", authenticatedUsers.size);
      
      // EXTENSION: Notify General group
      io.to(GENERAL_GROUP).emit("group-messages", {
        group: GENERAL_GROUP,
        chatHistory: getGroupMessages(GENERAL_GROUP),
      });
      
      authenticatedUsers.delete(socket.id);
    }
    
    // Remove user from connected users
    connectedUsers.delete(socket.id);
    userSessions.delete(socket.id);
    
    // Clean up rate limiting
    userMessageRates.delete(socket.id);
  });
});

// EXTENSION: Authentication endpoints (must be before static middleware)
app.post("/auth/signup", async (req, res) => {
  console.log("Signup route hit"); // Debug log
  try {
    const { username, email, password } = req.body;
    
    // Validation
    if (!username || !email || !password) {
      return res.status(400).json({ error: "Username, email, and password are required" });
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
    
    // Check if username or email already exists
    for (const [userEmail, userData] of users.entries()) {
      if (userData.username.toLowerCase() === username.toLowerCase() || userEmail.toLowerCase() === email.toLowerCase()) {
        return res.status(409).json({ error: "Username or email already exists" });
      }
    }
    
    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);
    
    // Store user
    users.set(email.toLowerCase(), {
      username: sanitizeInput(username),
      email: email.toLowerCase(),
      passwordHash,
    });
    
    // Generate JWT
    const token = jwt.sign(
      { username: sanitizeInput(username), email: email.toLowerCase() },
      JWT_SECRET,
      { expiresIn: "7d" }
    );
    
    res.json({ token, username: sanitizeInput(username), email: email.toLowerCase() });
  } catch (error) {
    console.error("Signup error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/auth/login", async (req, res) => {
  try {
    const { emailOrUsername, password } = req.body;
    
    if (!emailOrUsername || !password) {
      return res.status(400).json({ error: "Email/username and password are required" });
    }
    
    // Find user by email or username
    let user = null;
    for (const [email, userData] of users.entries()) {
      if (email.toLowerCase() === emailOrUsername.toLowerCase() || 
          userData.username.toLowerCase() === emailOrUsername.toLowerCase()) {
        user = { email, ...userData };
        break;
      }
    }
    
    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }
    
    // Verify password
    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      return res.status(401).json({ error: "Invalid credentials" });
    }
    
    // Generate JWT
    const token = jwt.sign(
      { username: user.username, email: user.email },
      JWT_SECRET,
      { expiresIn: "7d" }
    );
    
    res.json({ token, username: user.username, email: user.email });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/auth/verify", (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "No token provided" });
    }
    
    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, JWT_SECRET);
    
    res.json({ username: decoded.username, email: decoded.email });
  } catch (error) {
    res.status(401).json({ error: "Invalid token" });
  }
});

// Test route to verify server is working
app.get("/auth/test", (req, res) => {
  res.json({ message: "Auth routes are working", timestamp: new Date().toISOString() });
});

// Boilerplate code - HTTP server setup to serve the page assets (AFTER API routes)
// Use path relative to the script file location
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, "..");

app.use(express.static(join(projectRoot, "frontend")));

// HTTP server setup to serve the page at /
app.get("/", (req, res) => {
  return res.sendFile(join(projectRoot, "frontend", "index.html"));
});

// start the HTTP server to serve the page
server.listen(3000, () => {
  console.log("listening on http://localhost:3000");
  console.log("Auth routes registered:");
  console.log("  POST /auth/signup");
  console.log("  POST /auth/login");
  console.log("  POST /auth/verify");
});

// helper functions
// get all messages in the order they were sent (EXISTING - preserved)
// FIXED: Messages in chronological order (older at top, newer at bottom)
function getAllMessages() {
  // Return in chronological order (oldest first, newest last)
  return Array.from(chatHistory);
}

// REMOVED: Random username generation - now using authenticated usernames only

// EXTENSION: Get messages for a specific group
// FIXED: Messages in chronological order (older at top, newer at bottom)
function getGroupMessages(groupName) {
  if (!groupMessages.has(groupName)) {
    return [];
  }
  // Return in chronological order (oldest first, newest last)
  return Array.from(groupMessages.get(groupName));
}

// EXTENSION: Security - Sanitize input to prevent XSS
function sanitizeInput(input) {
  if (typeof input !== "string") {
    return "";
  }
  // Remove HTML tags and encode special characters
  return input
    .trim()
    .replace(/[<>]/g, "") // Remove angle brackets
    .replace(/javascript:/gi, "") // Remove javascript: protocol
    .replace(/on\w+=/gi, ""); // Remove event handlers
}

// EXTENSION: Security - Rate limiting
function checkRateLimit(socketId) {
  const now = Date.now();
  const userRate = userMessageRates.get(socketId);
  
  if (!userRate) {
    userMessageRates.set(socketId, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
    return true;
  }
  
  if (now > userRate.resetTime) {
    // Reset window
    userMessageRates.set(socketId, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
    return true;
  }
  
  if (userRate.count >= MAX_MESSAGES_PER_MINUTE) {
    return false;
  }
  
  userRate.count++;
  return true;
}

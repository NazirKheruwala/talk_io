Talkio (Talk.io)
Talkio is a real-time web-based chat application focused on outcome-driven conversations. It allows users to create intent-based conversations, chat in real time, and capture decisions and actions as structured outcomes.

Core Features
Real-time messaging using Socket.io
User authentication (login & signup) with JWT
Intent-based conversations (Decision, Brainstorm, Support, Learning, Planning)
Outcome panel to capture summaries, decisions, and action items
Typing indicators and online user tracking
Clean, dashboard-style UI

Tech Stack
Frontend: HTML, CSS, Vanilla JavaScript
Backend: Node.js, Express
Real-time: Socket.io
Database: Firebase Realtime Database
Authentication: JWT

Project Structure
frontend/
index.html – main UI layout
styles.css – full UI styling
script.js – frontend logic and socket handling
server-completed.js – main backend server with auth, chat, and outcomes
server-starter.js – simplified starter versionfirebase-config.js – Firebase admin configuration

Installation & Setup
Clone the repository
Run npm install
Configure Firebase project details
Start the server using node server-completed.js
Open http://localhost:3000 in your browser

Usage
Sign up or log in
Create a new conversation by selecting an intent
Chat in real time with participants

Track outcomes in the outcome panel

Save completed conversation outcomes

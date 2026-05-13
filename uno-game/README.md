# 🃏 UNO Online Multiplayer

A beautiful real-time UNO game built with Node.js, Express, and Socket.io.

## Project Structure

```
uno-game/
├── server/
│   ├── index.js        ← Express + Socket.io server
│   └── gameLogic.js    ← Full UNO rules engine
├── client/
│   └── index.html      ← Complete frontend (single file)
├── render.yaml         ← Render deployment config
└── package.json
```

## Features
- 🎮 Real-time multiplayer (2–8 players)
- 🏠 Room system with shareable codes
- 🃏 Full UNO rules (Skip, Reverse, Draw 2, Wild, Wild +4)
- 🔴 UNO button + catch penalty system
- 🌈 Wild card color picker
- 🏆 Win screen with confetti
- 📱 Mobile-friendly UI

---

## 🚀 Deployment Guide

### Step 1 — Deploy Backend to Render (FREE)

1. Push your code to GitHub:
   ```bash
   git init
   git add .
   git commit -m "UNO game"
   git remote add origin https://github.com/YOUR_USERNAME/uno-game.git
   git push -u origin main
   ```

2. Go to [render.com](https://render.com) → Sign up free
3. Click **New → Web Service**
4. Connect your GitHub repo
5. Settings:
   - **Name**: uno-game-server
   - **Build Command**: `npm install`
   - **Start Command**: `node server/index.js`
   - **Plan**: Free
6. Click **Deploy**
7. Copy your Render URL (e.g. `https://uno-game-server.onrender.com`)

### Step 2 — Update Frontend with Your Render URL

Open `client/index.html` and find this line near the bottom:

```javascript
const SERVER_URL = 'http://localhost:3001'; // ← change this
```

Change it to your Render URL:

```javascript
const SERVER_URL = 'https://uno-game-server.onrender.com';
```

### Step 3 — Deploy Frontend to Netlify (FREE)

**Option A — Drag & Drop (easiest):**
1. Go to [netlify.com](https://netlify.com) → Sign up free
2. Go to **Sites** → drag and drop your `client/` folder
3. Done! You get a URL like `https://random-name.netlify.app`

**Option B — From GitHub:**
1. Push to GitHub (if not done)
2. Netlify → New Site from Git → pick your repo
3. Set **Publish directory** to `client`
4. Deploy

### Step 4 — Share with Friends!

Send your Netlify URL to friends → they open it in browser → create/join room → play! 🎉

---

## 🏃 Run Locally

```bash
# Install dependencies
npm install

# Start server
npm start

# Open client/index.html in browser
# Make sure SERVER_URL = 'http://localhost:3001'
```

---

## 🎮 How to Play

1. Open the site, enter your name
2. **Create Room** → share the code with friends
3. Friends click **Join Room** → enter code
4. Host clicks **Start Game** (need 2+ players)
5. Match cards by color or number
6. Use action cards strategically
7. When you have 1 card left → click **UNO!**
8. First to empty hand wins! 🏆

---

## ⚠️ Note on Render Free Tier

Render free tier spins down after 15 min of inactivity. First load may take ~30 seconds to wake up. This is normal — subsequent loads are instant.

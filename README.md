# Basket Online 🏀

A Basket Random style 1v1 game you can play from two different devices.

## Run it on your laptop
1. Install Node.js (LTS) from https://nodejs.org
2. Open a terminal in this folder:
   ```
   npm install
   npm start
   ```
3. Open http://localhost:3000. Click **Create room** and get a 4-letter code.
4. Player 2 opens the same site and types the code into **Join**.

**Controls:** Space / W / ↑, a mouse click, or a tap on a phone.
Press to jump and swing your arm. Touch the ball to grab it. Swing your arm up while holding it to shoot. First to 5 wins.

## Play on two devices
**Same Wi-Fi (easiest):** find your laptop's IP address (Windows: `ipconfig`, the IPv4 Address line, something like `192.168.1.5`).
Your friend opens `http://192.168.1.5:3000`. School Wi-Fi often blocks this, so if it doesn't work, use ngrok.

**ngrok (quick link from anywhere, your laptop must stay on):**
1. Sign up at https://ngrok.com, install it, and run the `ngrok config add-authtoken ...` command it gives you.
2. Run `npm start` in one terminal and `ngrok http 3000` in another.
3. Share the `https://xxxx.ngrok-free.app` link it prints.

**Render (permanent link, laptop can be off):**
1. Put this folder on GitHub (you don't need to upload node_modules).
2. On https://render.com, go to New → Web Service and pick the repo.
3. Build command: `npm install`. Start command: `npm start`. Instance: Free.
4. Share the `https://your-game.onrender.com` link. The free plan sleeps when nobody is using it, so the first load can take about 30–60 s.

## How it works
- `server.js` runs the physics (matter.js) for each room 60 times per second, so both players always see the same game.
- `public/index.html` only sends "button down/up" and draws whatever the server sends.
- The connection between them uses socket.io (WebSockets).

Things you can easily tweak in `server.js`: `WIN_SCORE`, the `VARIANTS` list (add your own random modes!), jump strength, throw accuracy (`error`).

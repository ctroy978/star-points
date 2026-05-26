# STARFIGHT - Classroom Edition

A fast, simple real-time fleet combat + trading game designed for 10th grade classrooms. Runs entirely in Chrome on Chromebooks. One central server (your laptop or classroom computer) behind your school firewall.

## Quick Start (Teacher)

1. On your computer (the server):
   ```bash
   cd starfight
   npm start
   ```
   The game will say: `STARFIGHT server running on http://0.0.0.0:3000`

2. Open a browser on **your** machine and go to `http://localhost:3000`

3. Click **CREATE NEW GAME SESSION**.  
   You will get a short invite code like `K9RX`.

4. Write the code on the board or tell the class:  
   "Go to [your computer's IP]:3000 and enter code **K9RX**"

   (Find your IP with `ipconfig` on Windows or `ip addr` / `hostname -I` on Linux/Mac)

5. Students open Chrome → enter the URL → type the code → pick a cool solar system name (e.g. "Aether", "Vega-9", "Krell Prime").

6. When 2–4 players have joined, you (the host) click **START GAME**.

## How the Game Works (Student Rules)

Each player is one solar system with:
- 100 starting Titanium
- 1 Factory (100 HP)
- One build queue (builds one thing at a time)

### Units
| Unit           | Cost | Build Time | Role                  |
|----------------|------|------------|-----------------------|
| Fighter (FTR)  | 20 Ti| 30 seconds | Attack other systems  |
| Defense Canon  | 10 Ti| 60 seconds | Shoot down incoming fighters |

### Key Mechanics
- **Passive mining**: Every 15 seconds you get +4 Titanium automatically.
- **Trading**: You can instantly send 10, 25 or 50 Titanium to any other player.
- **Attacking**:
  - Choose a target and how many fighters to send.
  - Fighters leave immediately.
  - They take **8 seconds** to arrive (everyone sees the countdown).
  - On arrival: Each enemy canon destroys **exactly 1** fighter. Survivors each deal **7 damage** to the factory.
- **Factory destruction**: When a factory reaches 0 HP that player is **ELIMINATED**. Their remaining units are lost.
- **Win**: Last factory still alive wins.

### Strategy Tips for Students
- Early game: focus on canons for defense.
- Mid game: mass fighters for a big strike.
- You can trade titanium with allies... or betray them later.
- Watch the "IN TRANSIT" panel — incoming fleets give you time to react.

## Teacher Tips
- Games usually last 6–12 minutes. Perfect for one class period.
- After a game ends, just click "NEW SESSION" or have students refresh and use a new code.
- Works great with 3 or 4 players. 2 players is also fun (very aggressive).
- All data is visible to everyone — great for teaching quick mental math and risk assessment.
- No logins, no accounts, no internet required beyond your local network.

## Running on School Network
- The server listens on port 3000 by default.
- Make sure your firewall allows incoming connections on 3000 (or change the port in server.js).
- Students only need to reach your computer's local IP. No external ports or DNS needed.

## Files
- `server.js` — all game logic, timers, combat resolution
- `public/index.html` — the entire terminal-style client (CSS + JS)

Enjoy watching your students negotiate, backstab, and do math under pressure!

## License
MIT — free to use and modify for any classroom.

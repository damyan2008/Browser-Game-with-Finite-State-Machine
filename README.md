# GHOST PROTOCOL 🕵️

A browser-based top-down stealth game built with HTML5 Canvas and JavaScript.  
**Assignment:** Browser Game with Finite State Machine · Math for Devs \& IT

\---

## 🎮 How to Play

|Action|Control|
|-|-|
|Move|`W A S D` or Arrow Keys|
|Aim|Mouse|
|Pause|`ESC`|
|Restart|`R`|
|Confirm / Start|`Space` or `Enter`|

**Objective:** Collect all 3 gold data chips scattered around the map, then reach the **EXIT** circle in the bottom-right corner — without being caught by any of the 5 guards.

\---

## 🤖 Guard FSM AI

Each guard is controlled by a **Finite State Machine** with 6 states:

|State|Colour|Behaviour|
|-|-|-|
|`PATROL`|🟢 Green|Walks a fixed waypoint loop|
|`ALERT`|🟡 Yellow|Freezes for 0.8 s, "!" pops up|
|`CHASE`|🟠 Orange|Sprints toward the player|
|`ATTACK`|🔴 Red|Strikes the player at close range|
|`SEARCH`|🟣 Purple|Investigates the last known position|
|`RETURN`|🔵 Blue|Returns to starting waypoint|

### Transition Table

|From|To|Condition|
|-|-|-|
|PATROL|ALERT|Player enters FOV + line of sight|
|ALERT|CHASE|0.8 s reaction delay expires|
|CHASE|ATTACK|Distance < 26 px|
|ATTACK|CHASE|Distance ≥ 40 px (player backed away)|
|CHASE / ATTACK|SEARCH|Lost visual contact for 1.5 s|
|SEARCH|RETURN|Searched for 4.5 s without re-spotting|
|RETURN|PATROL|Arrived back at start waypoint|
|SEARCH / RETURN / PATROL|ALERT|Player spotted again|

\---

## ⚡ Implemented Events (10+)

1. `keydown` – movement, ESC pause, R restart, Space/Enter confirm
2. `keyup` – release held movement keys
3. `mousemove` – update player aim direction
4. `click` – menu button, resume pause, restart screens
5. `contextmenu` – suppress browser right-click menu
6. `resize` – refit canvas to new window dimensions
7. `focus` – reserved for manual resume
8. `blur` – auto-pause when window loses focus
9. `visibilitychange` – pause on browser tab switch
10. `requestAnimationFrame` – main game loop
11. Custom: `gameStart`, `gameOver`, `gameWin`, `chipCollected`, `canvasResized`

\---

## 🗂️ File Structure

```
game/
├── assets/
│   ├── images/      (sprite sheets / UI graphics – future)
│   └── sounds/      (sound effects / music – future)
├── js/
│   ├── fsm.js       Reusable Finite State Machine class
│   ├── player.js    Particle system + Player entity
│   ├── enemy.js     Guard entity (FSM AI)
│   └── main.js      Constants, map, utils, canvas, loop, events
├── css/
│   └── style.css    Global styles + CRT scanline effect
├── index.html       Entry point
└── README.md
```

\---

## 🛠️ Technologies

* HTML5 Canvas API
* Vanilla JavaScript (ES6+ classes, arrow functions, const/let)
* CSS3 (custom properties, @import Google Fonts)
* No external libraries or build tools


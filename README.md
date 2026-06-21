# 🎟️ Ticket Scoring System

A small local app for tracking a points system where people earn points by
buying tickets to games. Upload a ticket-sales CSV, pick which game it's for,
and the app awards points to every email in the file.

Everything runs on your own computer — no internet, no accounts. Your data is
saved to a plain `data.json` file you can back up or copy anywhere.

It runs as a native Windows desktop app (built on [Electron](https://www.electronjs.org/)):
its own window, no browser tab and no console window.

## Quick start

1. Make sure [Node.js](https://nodejs.org/) is installed (any recent version).
2. The first time only, install the app's dependencies:
   ```
   npm install
   ```
3. Launch the app:
   ```
   npm start
   ```
4. The Ticket Scoring System opens in its own window. Close the window to stop.

> Prefer the old browser-based mode? `npm run server` still runs the bare local
> server and opens it in your browser at `http://127.0.0.1:4321`.

## How it works

### Sports
Baseball, Football, Basketball, Softball, and Tennis come preset. Each sport has
a **default points-per-ticket** value. Add, rename, re-point, or delete sports on
the **Sports** tab.

### Games
Each game belongs to a sport and has a **date** and two **teams** (home and
away). The game's name fills in automatically from the teams (e.g. *Newton vs
Lincoln*), or you can type your own. By default a game earns its sport's points
per ticket, but you can **override the points for any game individually**
(uncheck "Use sport default points" when adding/editing a game).

> Because the CSV doesn't include a game date, **one CSV = one game**. Create
> the game first, then upload that game's CSV and select it.

### Uploading a CSV
On the **Upload CSV** tab:
1. Pick the game the CSV is for.
2. Choose whether to count **all active tickets** or **only checked-in** ones.
3. Drop in the CSV. You'll see a preview (tickets, people, total points) before
   anything changes.
4. Click **Apply** to award the points.

**Points = number of tickets (rows) for that email × the game's points/ticket.**
So someone who bought 3 tickets to a game earns 3× the points. Rows with no
email (e.g. "Terminal Transaction" cash sales) are skipped, and refunded/void
rows are ignored.

### Leaderboard & History
- **Leaderboard** — everyone ranked by total points; search and export to CSV.
- **History** — every import is logged. Hit **Undo** on any import to subtract
  exactly the points it awarded (useful if you upload the wrong file).

## Expected CSV format

The app reads these columns (extra columns are ignored):

| Column | Used for |
| --- | --- |
| `Ticket Email` (or `Cart Email`) | who earns the points |
| `Cart Owner` | display name (payment-method values like "Apple Pay" are ignored) |
| `Status` | only `active` rows are counted |
| `Checked` | `Yes`/`No` — only matters in "only checked-in" mode |

A sample file lives in [`samples/sample-football.csv`](samples/sample-football.csv).

## Your data

- All data is stored in **`data.json`** in the project folder. Back it up by
  copying that file. It is intentionally not tracked by git.
- To start completely fresh, stop the app and delete `data.json`.

## Tech

A native desktop window (Electron, in `main.js`) hosting a tiny Node.js
standard-library server (`server.js`) that serves the single-page web UI in
`public/`. The server has no dependencies of its own; Electron is the only
install. Not yet packaged into a standalone `.exe` — run it with `npm start`.

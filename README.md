# 🎟️ Ticket Scoring System

A small local app for tracking a points system where people earn points by
buying tickets to games. Upload a ticket-sales CSV, pick which game it's for,
and the app awards points to every email in the file.

Everything runs on your own computer — no internet, no accounts. Your data is
saved to a plain `data.json` file you can back up or copy anywhere.

## Quick start

1. Make sure [Node.js](https://nodejs.org/) is installed (any recent version).
2. Double-click **`start.bat`**.
3. Your browser opens to the app at `http://localhost:4321`.
4. Keep the little black window open while you use the app. Close it to stop.

## How it works

### Categories
Sports categories (Baseball, Football, Basketball, Softball, Tennis come
preset). Each category has a **default points-per-ticket** value. Add, rename,
re-point, or delete categories on the **Categories** tab.

### Games
Each game belongs to a category. By default a game earns its category's points
per ticket, but you can **override the points for any game individually**
(uncheck "Use category default" when adding/editing a game).

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

- All data is stored in **`data.json`** next to `start.bat`. Back it up by
  copying that file. It is intentionally not tracked by git.
- To start completely fresh, stop the app and delete `data.json`.

## Tech

Pure Node.js standard library (no dependencies to install) serving a small
single-page web UI. See `server.js` and `public/`.

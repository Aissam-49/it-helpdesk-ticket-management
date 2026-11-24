# IT Helpdesk & Ticket Management System

A beginner-friendly full-stack portfolio project for an IT support ticket portal. It uses Flask and SQLite on the backend, with plain HTML, CSS, and JavaScript on the frontend.

## Features

- Automatically creates and seeds `helpdesk.db`
- Creates tickets for an existing user or a new user
- Views ticket and requester information in a joined table
- Updates status in the flow Open → In Progress → Resolved
- Deletes tickets
- Filters tickets live by search, category, status, and priority
- Shows status, priority, and resolution-rate KPIs with category and department charts
- Exports joined ticket and requester data as CSV
- Uses a responsive layout suitable for desktop and mobile screens

## Project Structure

```text
Ticket Management/
├── app.py                 # Flask routes and SQLite database logic
├── helpdesk.db            # SQLite database created automatically
├── templates/
│   └── index.html         # Single-page application markup
├── static/
│   ├── style.css          # Responsive design
│   └── script.js          # Fetch API calls, validation, and UI rendering
└── README.md
```

## Prerequisites

- Python 3.9 or newer
- Flask

Flask was the only external package used:

```powershell
python -m pip install Flask
```

## Run the Application

Open PowerShell in the project directory and run:

```powershell
python app.py
```

Then open:

```text
http://127.0.0.1:5000
```

Stop the Flask development server with `Ctrl+C`.

To recreate the starter database, stop the server and delete `helpdesk.db`, then run `python app.py` again.

## Database Schema

### `users`

| Column | SQLite definition | Purpose |
|---|---|---|
| `user_id` | `INTEGER PRIMARY KEY AUTOINCREMENT` | Unique requester ID |
| `full_name` | `TEXT NOT NULL` | Requester's name |
| `department` | `TEXT NOT NULL` | Requester's department |
| `email` | `TEXT UNIQUE NOT NULL` | Unique contact email |

### `tickets`

| Column | SQLite definition | Purpose |
|---|---|---|
| `ticket_id` | `INTEGER PRIMARY KEY AUTOINCREMENT` | Unique ticket ID |
| `user_id` | `INTEGER NOT NULL` | Foreign key to `users.user_id` |
| `title` | `TEXT NOT NULL` | Problem description |
| `category` | `TEXT NOT NULL` | Network, Software, Hardware, or Access |
| `priority` | `TEXT NOT NULL` | Low, Medium, or High |
| `status` | `TEXT NOT NULL` | Open, In Progress, or Resolved |
| `created_at` | `TIMESTAMP DEFAULT CURRENT_TIMESTAMP` | Creation date and time |

The relationship is:

```text
users.user_id ← one-to-many → tickets.user_id
```

`PRAGMA foreign_keys = ON` is applied to every database connection. This tells SQLite to enforce valid foreign-key references.

## Important SQL Queries

### Create users table

```sql
CREATE TABLE IF NOT EXISTS users (
    user_id INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name TEXT NOT NULL,
    department TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL
);
```

`IF NOT EXISTS` prevents an error if the table has already been initialized.

### Create tickets table

```sql
CREATE TABLE IF NOT EXISTS tickets (
    ticket_id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    category TEXT NOT NULL,
    priority TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id)
);
```

The foreign key means every ticket must point to an existing user.

### Fetch all tickets with user details

```sql
SELECT t.ticket_id, t.title, t.category, t.priority, t.status,
       t.created_at, u.user_id, u.full_name, u.department, u.email
FROM tickets AS t
INNER JOIN users AS u ON t.user_id = u.user_id
ORDER BY t.ticket_id DESC;
```

`INNER JOIN` combines matching rows from both tables. `t.user_id = u.user_id` is the relationship condition. Only tickets whose user exists are returned.

### Create a ticket

```sql
INSERT INTO tickets (user_id, title, category, priority, status)
VALUES (?, ?, ?, ?, 'Open');
```

The `?` placeholders are parameter binding. They protect SQL queries from injection and keep user input separate from SQL syntax.

### Create a new user

```sql
INSERT INTO users (full_name, department, email)
VALUES (?, ?, ?);
```

A newly requested ticket first inserts the user, obtains `cursor.lastrowid`, and then uses that ID as the ticket's foreign key.

### Update a ticket status

```sql
UPDATE tickets
SET status = ?
WHERE ticket_id = ?;
```

The frontend sends a valid status, and the Flask route validates it again before executing this query.

### Delete a ticket

```sql
DELETE FROM tickets
WHERE ticket_id = ?;
```

The primary key identifies exactly one ticket to delete.

### Summary by status

```sql
SELECT status, COUNT(*) AS count
FROM tickets
GROUP BY status;
```

`GROUP BY status` combines equal statuses, while `COUNT(*)` calculates the number in each group.

### Summary by priority

```sql
SELECT priority, COUNT(*) AS count
FROM tickets
GROUP BY priority;
```

This produces a separate count for Low, Medium, and High priorities.

## API Endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/` | Render the dashboard |
| `GET` | `/api/users` | List users |
| `GET` | `/api/tickets` | List tickets joined with user details |
| `POST` | `/api/tickets` | Create a ticket for an existing or new user |
| `PATCH` | `/api/tickets/<ticket_id>/status` | Update a ticket status |
| `DELETE` | `/api/tickets/<ticket_id>` | Delete a ticket |
| `GET` | `/api/summary` | Get status, priority, category, department, and resolution-rate analytics |
| `GET` | `/api/tickets/export` | Download joined ticket and requester records as CSV |

Example status update request:

```json
{
  "status": "In Progress"
}
```

Example ticket creation for an existing user:

```json
{
  "user_mode": "existing",
  "user_id": 1,
  "title": "Printer is offline",
  "category": "Hardware",
  "priority": "Medium"
}

```

## Frontend Behavior

- `script.js` uses the browser `fetch` API to communicate with Flask routes.
- Browser-side JavaScript validates required fields and email format.
- Flask also validates inputs as the application server boundary.
- Search plus category, status, and priority filters operate on the browser's current ticket array.
- Charts and summary KPIs refresh after creating, updating, or deleting a ticket.
- `escapeHTML()` prevents API text from being interpreted as HTML markup when rows are rendered.

## Interview Explanation Summary

1. The browser sends an HTTP request to a Flask route.
2. Flask reads JSON or route parameters and validates user input.
3. Python opens SQLite and executes a parameterized SQL statement.
4. SQLite enforces the foreign key and unique email constraint.
5. Flask sends JSON back to JavaScript.
6. JavaScript updates the table and summary cards without reloading the page.

## Key Technical Concepts

- **REST routes:** Flask functions map HTTP methods and URLs to application actions.
- **Foreign key:** Links every ticket to a row in `users`.
- **INNER JOIN:** Returns ticket and requester data in one result set.
- **GROUP BY:** Groups rows before applying `COUNT(*)`.
- **Parameter binding:** Uses `?` placeholders instead of embedding input in SQL strings.
- **Vanilla JavaScript:** Uses `fetch`, DOM updates, and event listeners without a frontend framework.

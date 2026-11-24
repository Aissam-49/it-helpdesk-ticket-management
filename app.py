import csv
import io
from flask import Flask, Response, jsonify, render_template, request
import sqlite3
from pathlib import Path
import webbrowser
import threading


BASE_DIR = Path(__file__).resolve().parent
DATABASE = BASE_DIR / "helpdesk.db"

app = Flask(__name__, template_folder="templates", static_folder="static")

VALID_CATEGORIES = {"Network", "Software", "Hardware", "Access"}
VALID_PRIORITIES = {"Low", "Medium", "High"}
VALID_STATUSES = {"Open", "In Progress", "Resolved"}


def get_db_connection():
    """Open SQLite, enable foreign keys, and return dictionary-style rows."""
    connection = sqlite3.connect(DATABASE)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def initialize_database():
    """Create tables and insert starter data when the database has no users."""
    connection = get_db_connection()

    # CREATE TABLE IF NOT EXISTS makes startup safe even after the database exists.
    connection.execute("""
        CREATE TABLE IF NOT EXISTS users (
            user_id INTEGER PRIMARY KEY AUTOINCREMENT,
            full_name TEXT NOT NULL,
            department TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL
        )
    """)

    # user_id is a foreign key: it connects each ticket to one users row.
    connection.execute("""
        CREATE TABLE IF NOT EXISTS tickets (
            ticket_id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            category TEXT NOT NULL,
            priority TEXT NOT NULL,
            status TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(user_id)
        )
    """)

    # Seeding is conditional on users being empty, so restarting does not duplicate data.
    existing_user_count = connection.execute(
        "SELECT COUNT(*) AS count FROM users"
    ).fetchone()["count"]

    if existing_user_count == 0:
        users = [
            ("Aarav Sharma", "Computer Science", "aarav@example.com"),
            ("Maya Patel", "Accounts", "maya@example.com"),
            ("Rohan Singh", "Human Resources", "rohan@example.com"),
            ("Neha Verma", "Administration", "neha@example.com"),
            ("Kabir Mehta", "Marketing", "kabir@example.com"),
        ]

        # executemany runs the same parameterized INSERT once for each tuple.
        connection.executemany("""
            INSERT INTO users (full_name, department, email)
            VALUES (?, ?, ?)
        """, users)

        ticket_rows = [
            (1, "Office Wi-Fi keeps disconnecting", "Network", "High", "Open"),
            (2, "Cannot open accounting software", "Software", "Medium", "In Progress"),
            (3, "Laptop battery drains quickly", "Hardware", "Medium", "Open"),
            (4, "Need printer access permission", "Access", "Low", "Resolved"),
            (5, "Email account password reset", "Access", "High", "In Progress"),
            (1, "Projector not detected in lab", "Hardware", "Medium", "Open"),
            (2, "VPN authentication failure", "Network", "High", "Open"),
            (5, "Install Microsoft Excel add-in", "Software", "Low", "Resolved"),
        ]

        connection.executemany("""
            INSERT INTO tickets (user_id, title, category, priority, status)
            VALUES (?, ?, ?, ?, ?)
        """, ticket_rows)

        connection.commit()

    connection.close()


@app.route("/")
def index():
    """Render the single-page frontend."""
    return render_template("index.html")


@app.route("/api/users", methods=["GET"])
def get_users():
    """Fetch users for the ticket form's existing-user dropdown."""
    connection = get_db_connection()

    # ? is a placeholder, but this read query has no dynamic user input.
    rows = connection.execute("""
        SELECT user_id, full_name, department, email
        FROM users
        ORDER BY full_name
    """).fetchall()

    connection.close()
    return jsonify([dict(row) for row in rows])


@app.route("/api/tickets", methods=["GET"])
def get_tickets():
    """Fetch tickets joined with users through the foreign-key relationship."""
    connection = get_db_connection()

    # INNER JOIN returns only rows where t.user_id matches u.user_id.
    # Aliases t/u shorten each table name; ORDER BY displays newest tickets first.
    rows = connection.execute("""
        SELECT
            t.ticket_id,
            t.title,
            t.category,
            t.priority,
            t.status,
            t.created_at,
            u.user_id,
            u.full_name,
            u.department,
            u.email
        FROM tickets AS t
        INNER JOIN users AS u ON t.user_id = u.user_id
        ORDER BY t.ticket_id DESC
    """).fetchall()

    connection.close()
    return jsonify([dict(row) for row in rows])


@app.route("/api/tickets/export", methods=["GET"])
def export_tickets():
    """Download all tickets with their associated requester details as CSV."""
    connection = get_db_connection()
    rows = connection.execute("""
        SELECT
            t.ticket_id,
            t.title,
            t.category,
            t.priority,
            t.status,
            t.created_at,
            u.user_id,
            u.full_name,
            u.department,
            u.email
        FROM tickets AS t
        INNER JOIN users AS u ON t.user_id = u.user_id
        ORDER BY t.ticket_id DESC
    """).fetchall()
    connection.close()

    output = io.StringIO(newline="")
    writer = csv.writer(output)
    writer.writerow([
        "ticket_id", "title", "category", "priority", "status", "created_at",
        "user_id", "full_name", "department", "email",
    ])
    writer.writerows(tuple(row) for row in rows)

    return Response(
        output.getvalue(),
        mimetype="text/csv",
        headers={"Content-Disposition": "attachment; filename=helpdesk_tickets_report.csv"},
    )


@app.route("/api/tickets", methods=["POST"])
def create_ticket():
    """Create a ticket for an existing user or transactionally add a new user."""
    data = request.get_json(silent=True) or {}

    title = str(data.get("title", "")).strip()
    category = str(data.get("category", "")).strip()
    priority = str(data.get("priority", "")).strip()

    if not title:
        return jsonify({"error": "Ticket title is required."}), 400
    if category not in VALID_CATEGORIES:
        return jsonify({"error": "Choose a valid category."}), 400
    if priority not in VALID_PRIORITIES:
        return jsonify({"error": "Choose a valid priority."}), 400

    connection = get_db_connection()

    try:
        user_mode = str(data.get("user_mode", "existing")).strip()

        if user_mode == "new":
            full_name = str(data.get("full_name", "")).strip()
            department = str(data.get("department", "")).strip()
            email = str(data.get("email", "")).strip().lower()

            if not full_name or not department or not email:
                return jsonify({"error": "Name, department, and email are required for a new user."}), 400

            # SELECT detects an existing email before attempting the UNIQUE insert.
            existing = connection.execute(
                "SELECT user_id FROM users WHERE email = ?", (email,)
            ).fetchone()
            if existing:
                return jsonify({"error": "That email is already registered. Choose an existing user instead."}), 409

            # The INSERT parameters are safely bound with (?, ?, ?), not string-concatenated.
            cursor = connection.execute("""
                INSERT INTO users (full_name, department, email)
                VALUES (?, ?, ?)
            """, (full_name, department, email))
            user_id = cursor.lastrowid
        else:
            try:
                user_id = int(data.get("user_id", 0))
            except (TypeError, ValueError):
                return jsonify({"error": "Choose an existing user."}), 400

            # Verify the foreign-key target exists before creating the ticket.
            existing = connection.execute(
                "SELECT user_id FROM users WHERE user_id = ?", (user_id,)
            ).fetchone()
            if not existing:
                return jsonify({"error": "The selected user does not exist."}), 404

        # INSERT creates the ticket; status begins at Open for every new ticket.
        cursor = connection.execute("""
            INSERT INTO tickets (user_id, title, category, priority, status)
            VALUES (?, ?, ?, ?, 'Open')
        """, (user_id, title, category, priority))
        ticket_id = cursor.lastrowid

        connection.commit()

        # Return the ticket with user fields to let the frontend refresh immediately.
        ticket = connection.execute("""
            SELECT
                t.ticket_id, t.title, t.category, t.priority, t.status,
                t.created_at, u.user_id, u.full_name, u.department, u.email
            FROM tickets AS t
            INNER JOIN users AS u ON t.user_id = u.user_id
            WHERE t.ticket_id = ?
        """, (ticket_id,)).fetchone()

        return jsonify(dict(ticket)), 201

    except sqlite3.IntegrityError:
        connection.rollback()
        return jsonify({"error": "The database could not save this ticket. Check the email and try again."}), 409
    finally:
        connection.close()


@app.route("/api/tickets/<int:ticket_id>/status", methods=["PATCH"])
def update_ticket_status(ticket_id):
    """Update a ticket only when the submitted status is allowed."""
    data = request.get_json(silent=True) or {}
    status = str(data.get("status", "")).strip()

    if status not in VALID_STATUSES:
        return jsonify({"error": "Status must be Open, In Progress, or Resolved."}), 400

    connection = get_db_connection()

    # UPDATE changes matching rows; ticket_id is unique in this table.
    cursor = connection.execute("""
        UPDATE tickets
        SET status = ?
        WHERE ticket_id = ?
    """, (status, ticket_id))

    connection.commit()
    updated = cursor.rowcount
    connection.close()

    if updated == 0:
        return jsonify({"error": "Ticket not found."}), 404

    return jsonify({"message": "Ticket status updated.", "ticket_id": ticket_id, "status": status})


@app.route("/api/tickets/<int:ticket_id>", methods=["DELETE"])
def delete_ticket(ticket_id):
    """Delete one ticket by primary key."""
    connection = get_db_connection()

    # DELETE FROM removes only the row whose primary key matches.
    cursor = connection.execute(
        "DELETE FROM tickets WHERE ticket_id = ?", (ticket_id,)
    )

    connection.commit()
    deleted = cursor.rowcount
    connection.close()

    if deleted == 0:
        return jsonify({"error": "Ticket not found."}), 404

    return jsonify({"message": "Ticket deleted.", "ticket_id": ticket_id})


@app.route("/api/summary", methods=["GET"])
def get_summary():
    """Count tickets by status, priority, category, and requester department."""
    connection = get_db_connection()

    # GROUP BY status combines rows with the same status, and COUNT(*) totals each group.
    status_rows = connection.execute("""
        SELECT status, COUNT(*) AS count
        FROM tickets
        GROUP BY status
    """).fetchall()

    # A separate GROUP BY priority supplies counts for each priority level.
    priority_rows = connection.execute("""
        SELECT priority, COUNT(*) AS count
        FROM tickets
        GROUP BY priority
    """).fetchall()

    category_rows = connection.execute("""
        SELECT category, COUNT(*) AS count
        FROM tickets
        GROUP BY category
    """).fetchall()

    department_rows = connection.execute("""
        SELECT u.department, COUNT(*) AS count
        FROM tickets AS t
        INNER JOIN users AS u ON t.user_id = u.user_id
        GROUP BY u.department
    """).fetchall()

    total_tickets = connection.execute(
        "SELECT COUNT(*) AS count FROM tickets"
    ).fetchone()["count"]
    resolved_tickets = connection.execute(
        "SELECT COUNT(*) AS count FROM tickets WHERE status = 'Resolved'"
    ).fetchone()["count"]

    connection.close()

    status_counts = {row["status"]: row["count"] for row in status_rows}
    priority_counts = {row["priority"]: row["count"] for row in priority_rows}
    category_counts = {row["category"]: row["count"] for row in category_rows}
    department_counts = {row["department"]: row["count"] for row in department_rows}

    return jsonify({
        "status_counts": status_counts,
        "priority_counts": priority_counts,
        "category_counts": category_counts,
        "department_counts": department_counts,
        "resolution_rate": round(resolved_tickets / total_tickets * 100, 1)
        if total_tickets else 0,
    })


initialize_database()


if __name__ == "__main__":
    # A small delay gives the server time to start listening before the browser opens.
    # use_reloader=False prevents the Flask development reloader from launching two tabs.
    threading.Timer(1.0, lambda: webbrowser.open_new_tab("http://127.0.0.1:5000")).start()
    app.run(debug=True, use_reloader=False)

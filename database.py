"""
database.py — FX Journal
SQLite schema + initialization.
Swap ENGINE_URL for PostgreSQL in production.
"""

import sqlite3
import os

DB_PATH = os.environ.get('DB_PATH', 'fxjournal.db')


def get_conn():
    """Return a SQLite connection with row_factory set."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db():
    """Create all tables if they don't exist yet."""
    conn = get_conn()
    c = conn.cursor()

    # ACCOUNTS
    c.execute("""
    CREATE TABLE IF NOT EXISTS accounts (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        name             TEXT    NOT NULL,
        broker           TEXT,
        balance          REAL    NOT NULL DEFAULT 0,
        starting_balance REAL    NOT NULL DEFAULT 0,
        account_type     TEXT    DEFAULT 'Live',
        currency         TEXT    DEFAULT 'USD',
        created_at       TEXT    DEFAULT (datetime('now'))
    )
    """)

    # TRADES
    c.execute("""
    CREATE TABLE IF NOT EXISTS trades (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id  INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        date        TEXT    NOT NULL,
        pair        TEXT    NOT NULL,
        direction   TEXT    NOT NULL CHECK(direction IN ('BUY','SELL')),
        lots        REAL,
        entry       REAL,
        exit        REAL,
        sl          REAL,
        tp          REAL,
        pnl         REAL,
        strategy    TEXT,
        emotion     TEXT,
        session     TEXT,
        notes       TEXT,
        created_at  TEXT    DEFAULT (datetime('now'))
    )
    """)

    # SETTINGS (single-row config)
    c.execute("""
    CREATE TABLE IF NOT EXISTS settings (
        id          INTEGER PRIMARY KEY CHECK(id = 1),
        trader_name TEXT    DEFAULT 'Trader',
        risk_pct    REAL    DEFAULT 1.0,
        strategies  TEXT    DEFAULT 'Breakout,Pullback,Reversal,Scalp,Swing'
    )
    """)

    c.execute("INSERT OR IGNORE INTO settings (id) VALUES (1)")

    conn.commit()
    conn.close()
    print("[DB] Initialized:", DB_PATH)

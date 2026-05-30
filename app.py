"""
app.py — FX Journal Backend
Flask REST API for accounts, trades, settings, analytics, CSV export.
"""

import os
import csv
import io
from flask import Flask, jsonify, request, make_response, render_template, send_from_directory
from flask_cors import CORS
from database import get_conn, init_db

# ── APP SETUP ─────────────────────────────────────────────────
app = Flask(
    __name__,
    template_folder='templates',   # index.html lives here
    static_folder='static',        # style.css + script.js live here
    static_url_path='/static'
)
CORS(app)


# ── SERVE FRONTEND ────────────────────────────────────────────

@app.route('/')
def index():
    return render_template('index.html')


# ── UTILITY ───────────────────────────────────────────────────

def row_to_dict(row):
    """Convert sqlite3.Row to plain dict."""
    return dict(row) if row else None

def rows_to_list(rows):
    return [dict(r) for r in rows]

def err(msg, code=400):
    return jsonify({'error': msg}), code


# ══════════════════════════════════════════════════════════════
# ACCOUNTS
# ══════════════════════════════════════════════════════════════

@app.route('/api/accounts', methods=['GET'])
def get_accounts():
    conn = get_conn()
    rows = conn.execute("SELECT * FROM accounts ORDER BY created_at DESC").fetchall()
    conn.close()
    return jsonify(rows_to_list(rows))


@app.route('/api/accounts', methods=['POST'])
def create_account():
    d = request.get_json()
    if not d or not d.get('name') or not d.get('balance'):
        return err('name and balance are required')

    name     = str(d['name']).strip()
    broker   = str(d.get('broker', '')).strip()
    balance  = float(d['balance'])
    atype    = d.get('account_type', 'Live')
    currency = d.get('currency', 'USD')

    conn = get_conn()
    cur = conn.execute(
        """INSERT INTO accounts (name, broker, balance, starting_balance, account_type, currency)
           VALUES (?,?,?,?,?,?)""",
        (name, broker, balance, balance, atype, currency)
    )
    conn.commit()
    row = conn.execute("SELECT * FROM accounts WHERE id=?", (cur.lastrowid,)).fetchone()
    conn.close()
    return jsonify(row_to_dict(row)), 201


@app.route('/api/accounts/<int:acc_id>', methods=['GET'])
def get_account(acc_id):
    conn = get_conn()
    row = conn.execute("SELECT * FROM accounts WHERE id=?", (acc_id,)).fetchone()
    conn.close()
    if not row:
        return err('Account not found', 404)
    return jsonify(row_to_dict(row))


@app.route('/api/accounts/<int:acc_id>', methods=['PUT'])
def update_account(acc_id):
    d = request.get_json()
    conn = get_conn()
    row = conn.execute("SELECT * FROM accounts WHERE id=?", (acc_id,)).fetchone()
    if not row:
        conn.close()
        return err('Account not found', 404)

    name     = d.get('name', row['name'])
    broker   = d.get('broker', row['broker'])
    atype    = d.get('account_type', row['account_type'])
    currency = d.get('currency', row['currency'])

    conn.execute(
        "UPDATE accounts SET name=?, broker=?, account_type=?, currency=? WHERE id=?",
        (name, broker, atype, currency, acc_id)
    )
    conn.commit()
    row = conn.execute("SELECT * FROM accounts WHERE id=?", (acc_id,)).fetchone()
    conn.close()
    return jsonify(row_to_dict(row))


@app.route('/api/accounts/<int:acc_id>', methods=['DELETE'])
def delete_account(acc_id):
    conn = get_conn()
    conn.execute("DELETE FROM accounts WHERE id=?", (acc_id,))
    conn.commit()
    conn.close()
    return jsonify({'deleted': True, 'id': acc_id})


# ══════════════════════════════════════════════════════════════
# TRADES
# ══════════════════════════════════════════════════════════════

@app.route('/api/trades/<int:acc_id>', methods=['GET'])
def get_trades(acc_id):
    conn = get_conn()
    rows = conn.execute(
        "SELECT * FROM trades WHERE account_id=? ORDER BY date DESC",
        (acc_id,)
    ).fetchall()
    conn.close()
    return jsonify(rows_to_list(rows))


@app.route('/api/trades', methods=['POST'])
def create_trade():
    d = request.get_json()
    if not d or not d.get('account_id') or not d.get('pair') or not d.get('date'):
        return err('account_id, pair and date are required')

    def f(k):
        return float(d[k]) if d.get(k) not in (None, '', 'null') else None

    conn = get_conn()
    cur = conn.execute(
        """INSERT INTO trades
           (account_id, date, pair, direction, lots, entry, exit, sl, tp, pnl,
            strategy, emotion, session, notes)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (
            int(d['account_id']),
            d['date'],
            str(d['pair']).upper().strip(),
            d.get('direction', 'BUY'),
            f('lots'), f('entry'), f('exit'), f('sl'), f('tp'), f('pnl'),
            d.get('strategy'), d.get('emotion'), d.get('session'),
            d.get('notes', '')
        )
    )
    trade_id = cur.lastrowid
    _recalc_balance(conn, int(d['account_id']))
    conn.commit()
    row = conn.execute("SELECT * FROM trades WHERE id=?", (trade_id,)).fetchone()
    conn.close()
    return jsonify(row_to_dict(row)), 201


@app.route('/api/trades/<int:trade_id>', methods=['PUT'])
def update_trade(trade_id):
    d = request.get_json()
    conn = get_conn()
    row = conn.execute("SELECT * FROM trades WHERE id=?", (trade_id,)).fetchone()
    if not row:
        conn.close()
        return err('Trade not found', 404)

    def f(k, default=None):
        v = d.get(k, default)
        return float(v) if v not in (None, '', 'null') else None

    conn.execute(
        """UPDATE trades SET
           date=?, pair=?, direction=?, lots=?, entry=?, exit=?, sl=?, tp=?, pnl=?,
           strategy=?, emotion=?, session=?, notes=?
           WHERE id=?""",
        (
            d.get('date', row['date']),
            str(d.get('pair', row['pair'])).upper().strip(),
            d.get('direction', row['direction']),
            f('lots', row['lots']),   f('entry', row['entry']),
            f('exit', row['exit']),   f('sl', row['sl']),
            f('tp', row['tp']),       f('pnl', row['pnl']),
            d.get('strategy', row['strategy']),
            d.get('emotion', row['emotion']),
            d.get('session', row['session']),
            d.get('notes', row['notes']),
            trade_id
        )
    )
    _recalc_balance(conn, row['account_id'])
    conn.commit()
    row = conn.execute("SELECT * FROM trades WHERE id=?", (trade_id,)).fetchone()
    conn.close()
    return jsonify(row_to_dict(row))


@app.route('/api/trades/<int:trade_id>', methods=['DELETE'])
def delete_trade(trade_id):
    conn = get_conn()
    row = conn.execute("SELECT account_id FROM trades WHERE id=?", (trade_id,)).fetchone()
    if not row:
        conn.close()
        return err('Trade not found', 404)
    acc_id = row['account_id']
    conn.execute("DELETE FROM trades WHERE id=?", (trade_id,))
    _recalc_balance(conn, acc_id)
    conn.commit()
    conn.close()
    return jsonify({'deleted': True, 'id': trade_id})


def _recalc_balance(conn, acc_id):
    """Recalculate account balance = starting_balance + sum(pnl)."""
    row = conn.execute("SELECT starting_balance FROM accounts WHERE id=?", (acc_id,)).fetchone()
    if not row:
        return
    total_pnl = conn.execute(
        "SELECT COALESCE(SUM(pnl),0) FROM trades WHERE account_id=? AND pnl IS NOT NULL",
        (acc_id,)
    ).fetchone()[0]
    conn.execute(
        "UPDATE accounts SET balance=? WHERE id=?",
        (row['starting_balance'] + total_pnl, acc_id)
    )


# ══════════════════════════════════════════════════════════════
# ANALYTICS
# ══════════════════════════════════════════════════════════════

@app.route('/api/analytics/<int:acc_id>', methods=['GET'])
def get_analytics(acc_id):
    conn = get_conn()
    rows = conn.execute(
        "SELECT * FROM trades WHERE account_id=? ORDER BY date ASC",
        (acc_id,)
    ).fetchall()
    conn.close()

    trades = [dict(r) for r in rows]
    total  = len(trades)

    if total == 0:
        return jsonify({
            'total': 0, 'wins': 0, 'losses': 0,
            'win_rate': 0, 'total_pnl': 0,
            'avg_rr': 0, 'profit_factor': 0,
            'max_drawdown': 0, 'best_trade': 0, 'worst_trade': 0,
        })

    wins   = sum(1 for t in trades if t.get('pnl') and float(t['pnl']) > 0)
    losses = sum(1 for t in trades if t.get('pnl') and float(t['pnl']) < 0)
    pnls   = [float(t['pnl']) for t in trades if t.get('pnl') is not None]

    gross_profit  = sum(p for p in pnls if p > 0) or 0
    gross_loss    = abs(sum(p for p in pnls if p < 0)) or 0
    profit_factor = round(gross_profit / gross_loss, 2) if gross_loss else 0

    rr_vals = []
    for t in trades:
        e, x, sl = t.get('entry'), t.get('exit'), t.get('sl')
        if e and x and sl and e != sl:
            rr_vals.append(abs((x - e) / (e - sl)))
    avg_rr = round(sum(rr_vals) / len(rr_vals), 2) if rr_vals else 0

    equity = 0
    peak   = 0
    max_dd = 0
    for p in pnls:
        equity += p
        if equity > peak:
            peak = equity
        dd = peak - equity
        if dd > max_dd:
            max_dd = dd

    return jsonify({
        'total':         total,
        'wins':          wins,
        'losses':        losses,
        'win_rate':      round(wins / total * 100, 1) if total else 0,
        'total_pnl':     round(sum(pnls), 2),
        'avg_rr':        avg_rr,
        'profit_factor': profit_factor,
        'max_drawdown':  round(max_dd, 2),
        'best_trade':    round(max(pnls), 2) if pnls else 0,
        'worst_trade':   round(min(pnls), 2) if pnls else 0,
    })


# ══════════════════════════════════════════════════════════════
# CSV EXPORT
# ══════════════════════════════════════════════════════════════

@app.route('/api/export/<int:acc_id>', methods=['GET'])
def export_csv(acc_id):
    conn = get_conn()
    rows = conn.execute(
        "SELECT * FROM trades WHERE account_id=? ORDER BY date DESC",
        (acc_id,)
    ).fetchall()
    conn.close()

    output = io.StringIO()
    fields = ['id', 'date', 'pair', 'direction', 'lots', 'entry', 'exit',
              'sl', 'tp', 'pnl', 'strategy', 'emotion', 'session', 'notes']
    writer = csv.DictWriter(output, fieldnames=fields, extrasaction='ignore')
    writer.writeheader()
    for row in rows:
        writer.writerow(dict(row))

    response = make_response(output.getvalue())
    response.headers['Content-Type'] = 'text/csv'
    response.headers['Content-Disposition'] = f'attachment; filename=trades_account_{acc_id}.csv'
    return response


# ══════════════════════════════════════════════════════════════
# SETTINGS
# ══════════════════════════════════════════════════════════════

@app.route('/api/settings', methods=['GET'])
def get_settings():
    conn = get_conn()
    row = conn.execute("SELECT * FROM settings WHERE id=1").fetchone()
    conn.close()
    return jsonify(row_to_dict(row))


@app.route('/api/settings', methods=['PUT'])
def save_settings():
    d = request.get_json()
    conn = get_conn()
    conn.execute(
        "UPDATE settings SET trader_name=?, risk_pct=?, strategies=? WHERE id=1",
        (
            d.get('trader_name', 'Trader'),
            float(d.get('risk_pct', 1.0)),
            d.get('strategies', 'Breakout,Pullback,Reversal,Scalp,Swing')
        )
    )
    conn.commit()
    row = conn.execute("SELECT * FROM settings WHERE id=1").fetchone()
    conn.close()
    return jsonify(row_to_dict(row))


# ── ENTRY POINT ───────────────────────────────────────────────

if __name__ == '__main__':
    init_db()
    port  = int(os.environ.get('PORT', 5000))
    debug = os.environ.get('FLASK_ENV', 'development') == 'development'
    app.run(host='0.0.0.0', port=port, debug=debug)

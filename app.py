import os
import json
import hashlib
import secrets
from datetime import datetime
from functools import wraps
from flask import (Flask, render_template, request, jsonify,
                   session, redirect, url_for, send_from_directory)
import sqlite3
import mutagen
from mutagen.mp3 import MP3
from mutagen.flac import FLAC
from mutagen.oggvorbis import OggVorbis

# ─────────────────────────────────────────
#  CONFIG
# ─────────────────────────────────────────
app = Flask(__name__)
app.secret_key = secrets.token_hex(32)   # change en prod !

BASE_DIR    = os.path.dirname(os.path.abspath(__file__))
UPLOAD_DIR  = os.path.join(BASE_DIR, 'static', 'uploads')
DB_PATH     = os.path.join(BASE_DIR, 'pulse.db')
ALLOWED_EXT = {'.mp3', '.flac', '.wav', '.ogg', '.m4a', '.aac'}

os.makedirs(UPLOAD_DIR, exist_ok=True)

# ─────────────────────────────────────────
#  BASE DE DONNÉES
# ─────────────────────────────────────────
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn

def init_db():
    with get_db() as db:
        db.executescript("""
            CREATE TABLE IF NOT EXISTS users (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                username   TEXT    NOT NULL UNIQUE,
                email      TEXT    NOT NULL UNIQUE,
                password   TEXT    NOT NULL,
                created_at TEXT    DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS songs (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                filename   TEXT    NOT NULL,
                title      TEXT    NOT NULL,
                artist     TEXT    DEFAULT 'Inconnu',
                album      TEXT    DEFAULT '',
                duration   REAL    DEFAULT 0,
                uploaded_at TEXT   DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS playlists (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                name        TEXT    NOT NULL,
                description TEXT    DEFAULT '',
                created_at  TEXT    DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS playlist_songs (
                playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
                song_id     INTEGER NOT NULL REFERENCES songs(id)     ON DELETE CASCADE,
                position    INTEGER DEFAULT 0,
                added_at    TEXT    DEFAULT (datetime('now')),
                PRIMARY KEY (playlist_id, song_id)
            );

            CREATE TABLE IF NOT EXISTS history (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                song_id    INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
                played_at  TEXT    DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS favorites (
                user_id    INTEGER NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
                song_id    INTEGER NOT NULL REFERENCES songs(id)  ON DELETE CASCADE,
                added_at   TEXT    DEFAULT (datetime('now')),
                PRIMARY KEY (user_id, song_id)
            );
        """)

init_db()

# ─────────────────────────────────────────
#  HELPERS
# ─────────────────────────────────────────
def hash_password(pwd):
    return hashlib.sha256(pwd.encode()).hexdigest()

def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if 'user_id' not in session:
            return jsonify({'error': 'Non connecté', 'redirect': '/login'}), 401
        return f(*args, **kwargs)
    return decorated

def get_audio_meta(filepath):
    """Extrait titre, artiste, durée depuis les tags ID3/Vorbis."""
    title  = os.path.splitext(os.path.basename(filepath))[0]
    artist = 'Inconnu'
    duration = 0
    try:
        ext = os.path.splitext(filepath)[1].lower()
        if ext == '.mp3':
            audio = MP3(filepath)
            duration = audio.info.length
            tags = audio.tags
            if tags:
                title  = str(tags.get('TIT2', title))
                artist = str(tags.get('TPE1', artist))
        elif ext == '.flac':
            audio = FLAC(filepath)
            duration = audio.info.length
            title  = (audio.get('title')  or [title])[0]
            artist = (audio.get('artist') or [artist])[0]
        elif ext == '.ogg':
            audio = OggVorbis(filepath)
            duration = audio.info.length
            title  = (audio.get('title')  or [title])[0]
            artist = (audio.get('artist') or [artist])[0]
        else:
            import mutagen
            audio = mutagen.File(filepath)
            if audio:
                duration = getattr(audio.info, 'length', 0)
    except Exception as e:
        print(f'Metadata error: {e}')
    return title, artist, duration

def row_to_dict(row):
    return dict(row) if row else None

# ─────────────────────────────────────────
#  ROUTES PAGES
# ─────────────────────────────────────────
@app.route('/')
def index():
    if 'user_id' not in session:
        return redirect('/login')
    return render_template('index.html')

@app.route('/login')
def login_page():
    if 'user_id' in session:
        return redirect('/')
    return render_template('auth.html', mode='login')

@app.route('/register')
def register_page():
    if 'user_id' in session:
        return redirect('/')
    return render_template('auth.html', mode='register')

# ─────────────────────────────────────────
#  API AUTH
# ─────────────────────────────────────────
@app.route('/api/register', methods=['POST'])
def api_register():
    data = request.get_json()
    username = (data.get('username') or '').strip()
    email    = (data.get('email')    or '').strip().lower()
    password = (data.get('password') or '').strip()

    if not username or not email or not password:
        return jsonify({'error': 'Tous les champs sont requis'}), 400
    if len(password) < 6:
        return jsonify({'error': 'Mot de passe trop court (6 car. min)'}), 400

    try:
        with get_db() as db:
            db.execute(
                "INSERT INTO users (username, email, password) VALUES (?,?,?)",
                (username, email, hash_password(password))
            )
        return jsonify({'success': True, 'message': 'Compte créé !'})
    except sqlite3.IntegrityError:
        return jsonify({'error': 'Email ou nom d\'utilisateur déjà utilisé'}), 409

@app.route('/api/login', methods=['POST'])
def api_login():
    data     = request.get_json()
    email    = (data.get('email')    or '').strip().lower()
    password = (data.get('password') or '').strip()

    with get_db() as db:
        user = db.execute(
            "SELECT * FROM users WHERE email=? AND password=?",
            (email, hash_password(password))
        ).fetchone()

    if not user:
        return jsonify({'error': 'Email ou mot de passe incorrect'}), 401

    session['user_id']  = user['id']
    session['username'] = user['username']
    return jsonify({'success': True, 'username': user['username']})

@app.route('/api/logout', methods=['POST'])
def api_logout():
    session.clear()
    return jsonify({'success': True})

@app.route('/api/me')
@login_required
def api_me():
    return jsonify({'user_id': session['user_id'], 'username': session['username']})

# ─────────────────────────────────────────
#  API SONGS
# ─────────────────────────────────────────
@app.route('/api/songs')
@login_required
def api_songs():
    with get_db() as db:
        songs = db.execute(
            "SELECT * FROM songs WHERE user_id=? ORDER BY uploaded_at DESC",
            (session['user_id'],)
        ).fetchall()
        # Récupérer les favoris de l'utilisateur
        favs = {row['song_id'] for row in db.execute(
            "SELECT song_id FROM favorites WHERE user_id=?",
            (session['user_id'],)
        ).fetchall()}
    result = []
    for s in songs:
        d = row_to_dict(s)
        d['is_favorite'] = s['id'] in favs
        result.append(d)
    return jsonify(result)

@app.route('/api/upload', methods=['POST'])
@login_required
def api_upload():
    files = request.files.getlist('file')
    if not files:
        return jsonify({'error': 'Aucun fichier reçu'}), 400

    count = 0
    errors = []
    for f in files:
        ext = os.path.splitext(f.filename)[1].lower()
        if ext not in ALLOWED_EXT:
            errors.append(f'{f.filename}: format non supporté')
            continue
        # Nom unique pour éviter les collisions
        unique_name = f"{session['user_id']}_{secrets.token_hex(6)}{ext}"
        filepath    = os.path.join(UPLOAD_DIR, unique_name)
        f.save(filepath)

        title, artist, duration = get_audio_meta(filepath)
        with get_db() as db:
            db.execute(
                "INSERT INTO songs (user_id, filename, title, artist, duration) VALUES (?,?,?,?,?)",
                (session['user_id'], unique_name, title, artist, duration)
            )
        count += 1

    if count == 0:
        return jsonify({'error': errors[0] if errors else 'Échec upload'}), 400
    return jsonify({'success': True, 'count': count, 'errors': errors})

@app.route('/api/play/<filename>')
@login_required
def api_play(filename):
    # Vérifie que le fichier appartient bien à l'utilisateur
    with get_db() as db:
        song = db.execute(
            "SELECT * FROM songs WHERE filename=? AND user_id=?",
            (filename, session['user_id'])
        ).fetchone()
    if not song:
        return jsonify({'error': 'Accès refusé'}), 403

    # Enregistrer dans l'historique
    with get_db() as db:
        db.execute(
            "INSERT INTO history (user_id, song_id) VALUES (?,?)",
            (session['user_id'], song['id'])
        )
    return send_from_directory(UPLOAD_DIR, filename)

@app.route('/api/songs/<int:song_id>', methods=['DELETE'])
@login_required
def api_delete_song(song_id):
    with get_db() as db:
        song = db.execute(
            "SELECT * FROM songs WHERE id=? AND user_id=?",
            (song_id, session['user_id'])
        ).fetchone()
        if not song:
            return jsonify({'error': 'Introuvable'}), 404
        # Supprimer le fichier physique
        try:
            os.remove(os.path.join(UPLOAD_DIR, song['filename']))
        except FileNotFoundError:
            pass
        db.execute("DELETE FROM songs WHERE id=?", (song_id,))
    return jsonify({'success': True})

# ─────────────────────────────────────────
#  API FAVORIS
# ─────────────────────────────────────────
@app.route('/api/favorites', methods=['GET'])
@login_required
def api_get_favorites():
    with get_db() as db:
        songs = db.execute("""
            SELECT s.*, 1 as is_favorite
            FROM songs s
            JOIN favorites f ON f.song_id = s.id
            WHERE f.user_id = ?
            ORDER BY f.added_at DESC
        """, (session['user_id'],)).fetchall()
    return jsonify([row_to_dict(s) for s in songs])

@app.route('/api/favorites/<int:song_id>', methods=['POST', 'DELETE'])
@login_required
def api_toggle_favorite(song_id):
    uid = session['user_id']
    with get_db() as db:
        existing = db.execute(
            "SELECT 1 FROM favorites WHERE user_id=? AND song_id=?", (uid, song_id)
        ).fetchone()
        if request.method == 'POST':
            if not existing:
                db.execute("INSERT INTO favorites (user_id, song_id) VALUES (?,?)", (uid, song_id))
            return jsonify({'success': True, 'is_favorite': True})
        else:
            db.execute("DELETE FROM favorites WHERE user_id=? AND song_id=?", (uid, song_id))
            return jsonify({'success': True, 'is_favorite': False})

# ─────────────────────────────────────────
#  API HISTORIQUE
# ─────────────────────────────────────────
@app.route('/api/history')
@login_required
def api_history():
    with get_db() as db:
        rows = db.execute("""
            SELECT s.*, h.played_at
            FROM history h
            JOIN songs s ON s.id = h.song_id
            WHERE h.user_id = ?
            ORDER BY h.played_at DESC
            LIMIT 50
        """, (session['user_id'],)).fetchall()
    return jsonify([row_to_dict(r) for r in rows])

# ─────────────────────────────────────────
#  API PLAYLISTS
# ─────────────────────────────────────────
@app.route('/api/playlists', methods=['GET'])
@login_required
def api_get_playlists():
    with get_db() as db:
        pls = db.execute(
            "SELECT * FROM playlists WHERE user_id=? ORDER BY created_at DESC",
            (session['user_id'],)
        ).fetchall()
    return jsonify([row_to_dict(p) for p in pls])

@app.route('/api/playlists', methods=['POST'])
@login_required
def api_create_playlist():
    data = request.get_json()
    name = (data.get('name') or '').strip()
    desc = (data.get('description') or '').strip()
    if not name:
        return jsonify({'error': 'Nom requis'}), 400
    with get_db() as db:
        cur = db.execute(
            "INSERT INTO playlists (user_id, name, description) VALUES (?,?,?)",
            (session['user_id'], name, desc)
        )
        pl_id = cur.lastrowid
        pl = db.execute("SELECT * FROM playlists WHERE id=?", (pl_id,)).fetchone()
    return jsonify(row_to_dict(pl)), 201

@app.route('/api/playlists/<int:pl_id>', methods=['DELETE'])
@login_required
def api_delete_playlist(pl_id):
    with get_db() as db:
        pl = db.execute(
            "SELECT * FROM playlists WHERE id=? AND user_id=?",
            (pl_id, session['user_id'])
        ).fetchone()
        if not pl:
            return jsonify({'error': 'Introuvable'}), 404
        db.execute("DELETE FROM playlists WHERE id=?", (pl_id,))
    return jsonify({'success': True})

@app.route('/api/playlists/<int:pl_id>/songs', methods=['GET'])
@login_required
def api_playlist_songs(pl_id):
    with get_db() as db:
        songs = db.execute("""
            SELECT s.* FROM songs s
            JOIN playlist_songs ps ON ps.song_id = s.id
            WHERE ps.playlist_id = ?
            ORDER BY ps.position
        """, (pl_id,)).fetchall()
    return jsonify([row_to_dict(s) for s in songs])

@app.route('/api/playlists/<int:pl_id>/songs/<int:song_id>', methods=['POST', 'DELETE'])
@login_required
def api_playlist_song(pl_id, song_id):
    uid = session['user_id']
    with get_db() as db:
        # Vérifie que la playlist appartient à l'utilisateur
        pl = db.execute(
            "SELECT 1 FROM playlists WHERE id=? AND user_id=?", (pl_id, uid)
        ).fetchone()
        if not pl:
            return jsonify({'error': 'Accès refusé'}), 403

        if request.method == 'POST':
            existing = db.execute(
                "SELECT 1 FROM playlist_songs WHERE playlist_id=? AND song_id=?",
                (pl_id, song_id)
            ).fetchone()
            if not existing:
                pos = db.execute(
                    "SELECT COUNT(*) as c FROM playlist_songs WHERE playlist_id=?", (pl_id,)
                ).fetchone()['c']
                db.execute(
                    "INSERT INTO playlist_songs (playlist_id, song_id, position) VALUES (?,?,?)",
                    (pl_id, song_id, pos)
                )
            return jsonify({'success': True})
        else:
            db.execute(
                "DELETE FROM playlist_songs WHERE playlist_id=? AND song_id=?",
                (pl_id, song_id)
            )
            return jsonify({'success': True})

# ─────────────────────────────────────────
#  LANCEMENT
# ─────────────────────────────────────────
if __name__ == '__main__':
    app.run(debug=True, port=5000)
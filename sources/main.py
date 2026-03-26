import os
import hashlib
import secrets
from functools import wraps
from flask import (Flask, render_template, request, jsonify,
                   session, redirect, send_from_directory)
import sqlite3
from mutagen.mp3 import MP3
from mutagen.flac import FLAC
from mutagen.oggvorbis import OggVorbis

# ─────────────────────────────────────────
#  CONFIG
# ─────────────────────────────────────────
app = Flask(__name__)
app.secret_key = 'CHANGE_MOI_EN_PROD_' + secrets.token_hex(16)

BASE_DIR    = os.path.dirname(os.path.abspath(__file__))
UPLOAD_DIR  = os.path.join(BASE_DIR, 'static', 'uploads')
GLOBAL_DIR  = os.path.join(BASE_DIR, 'static', 'global')
AVATAR_DIR  = os.path.join(BASE_DIR, 'static', 'avatars')
DB_PATH     = os.path.join(BASE_DIR, 'pulse.db')
ALLOWED_EXT = {'.mp3', '.flac', '.wav', '.ogg', '.m4a', '.aac'}
ALLOWED_IMG = {'.jpg', '.jpeg', '.png', '.webp', '.gif'}

ADMIN_EMAIL = 'admin@pulse.com'

os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(GLOBAL_DIR, exist_ok=True)
os.makedirs(AVATAR_DIR, exist_ok=True)

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
                is_admin   INTEGER DEFAULT 0,
                bio        TEXT    DEFAULT '',
                avatar     TEXT    DEFAULT '',
                created_at TEXT    DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS songs (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
                filename    TEXT    NOT NULL,
                title       TEXT    NOT NULL,
                artist      TEXT    DEFAULT 'Inconnu',
                album       TEXT    DEFAULT '',
                duration    REAL    DEFAULT 0,
                is_global   INTEGER DEFAULT 0,
                position    INTEGER DEFAULT 0,
                uploaded_at TEXT    DEFAULT (datetime('now'))
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
                id        INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                song_id   INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
                played_at TEXT    DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS favorites (
                user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                song_id   INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
                added_at  TEXT    DEFAULT (datetime('now')),
                PRIMARY KEY (user_id, song_id)
            );
        """)

init_db()

# ─────────────────────────────────────────
#  MIGRATIONS
# ─────────────────────────────────────────
def migrate_db():
    with get_db() as db:
        cols_songs = [r["name"] for r in db.execute("PRAGMA table_info(songs)").fetchall()]
        if "position" not in cols_songs:
            db.execute("ALTER TABLE songs ADD COLUMN position INTEGER DEFAULT 0")
            db.execute("UPDATE songs SET position = id WHERE is_global = 1")

        cols_users = [r["name"] for r in db.execute("PRAGMA table_info(users)").fetchall()]
        if "bio" not in cols_users:
            db.execute("ALTER TABLE users ADD COLUMN bio TEXT DEFAULT ''")
        if "avatar" not in cols_users:
            db.execute("ALTER TABLE users ADD COLUMN avatar TEXT DEFAULT ''")

migrate_db()

# ─────────────────────────────────────────
#  HELPERS
# ─────────────────────────────────────────
def hash_password(pwd):
    return hashlib.sha256(pwd.encode()).hexdigest()

def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if 'user_id' not in session:
            return jsonify({'error': 'Non connecté'}), 401
        return f(*args, **kwargs)
    return decorated

def admin_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if not session.get('is_admin'):
            return jsonify({'error': 'Accès admin requis'}), 403
        return f(*args, **kwargs)
    return decorated

def get_audio_meta(filepath):
    title    = os.path.splitext(os.path.basename(filepath))[0]
    artist   = 'Inconnu'
    duration = 0
    try:
        ext = os.path.splitext(filepath)[1].lower()
        if ext == '.mp3':
            audio    = MP3(filepath)
            duration = audio.info.length
            tags     = audio.tags
            if tags:
                title  = str(tags.get('TIT2', title))
                artist = str(tags.get('TPE1', artist))
        elif ext == '.flac':
            audio    = FLAC(filepath)
            duration = audio.info.length
            title    = (audio.get('title')  or [title])[0]
            artist   = (audio.get('artist') or [artist])[0]
        elif ext == '.ogg':
            audio    = OggVorbis(filepath)
            duration = audio.info.length
            title    = (audio.get('title')  or [title])[0]
            artist   = (audio.get('artist') or [artist])[0]
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

@app.route('/admin')
def admin_page():
    if not session.get('is_admin'):
        return redirect('/')
    return render_template('admin.html')

# ─────────────────────────────────────────
#  API AUTH
# ─────────────────────────────────────────
@app.route('/api/register', methods=['POST'])
def api_register():
    data     = request.get_json()
    username = (data.get('username') or '').strip()
    email    = (data.get('email')    or '').strip().lower()
    password = (data.get('password') or '').strip()

    if not username or not email or not password:
        return jsonify({'error': 'Tous les champs sont requis'}), 400
    if len(password) < 6:
        return jsonify({'error': 'Mot de passe trop court (6 car. min)'}), 400

    is_admin = 1 if email == ADMIN_EMAIL else 0
    try:
        with get_db() as db:
            db.execute(
                "INSERT INTO users (username, email, password, is_admin) VALUES (?,?,?,?)",
                (username, email, hash_password(password), is_admin)
            )
        return jsonify({'success': True})
    except sqlite3.IntegrityError:
        return jsonify({'error': "Email ou nom d'utilisateur déjà utilisé"}), 409

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
    session['is_admin'] = bool(user['is_admin'])
    return jsonify({'success': True, 'username': user['username'], 'is_admin': bool(user['is_admin'])})

@app.route('/api/logout', methods=['POST'])
def api_logout():
    session.clear()
    return jsonify({'success': True})

@app.route('/api/me')
@login_required
def api_me():
    return jsonify({
        'user_id':  session['user_id'],
        'username': session['username'],
        'is_admin': session.get('is_admin', False)
    })

# ─────────────────────────────────────────
#  API PROFIL UTILISATEUR
# ─────────────────────────────────────────
@app.route('/api/profile', methods=['GET'])
@login_required
def api_get_profile():
    """Retourne le profil complet + stats de l'utilisateur connecté."""
    uid = session['user_id']
    with get_db() as db:
        user = db.execute(
            "SELECT id, username, email, bio, avatar, created_at FROM users WHERE id=?", (uid,)
        ).fetchone()

        total_plays = db.execute(
            "SELECT COUNT(*) as c FROM history WHERE user_id=?", (uid,)
        ).fetchone()['c']

        total_favs = db.execute(
            "SELECT COUNT(*) as c FROM favorites WHERE user_id=?", (uid,)
        ).fetchone()['c']

        total_playlists = db.execute(
            "SELECT COUNT(*) as c FROM playlists WHERE user_id=?", (uid,)
        ).fetchone()['c']

        top_artist = db.execute("""
            SELECT s.artist, COUNT(*) as plays
            FROM history h
            JOIN songs s ON s.id = h.song_id
            WHERE h.user_id = ?
            GROUP BY s.artist
            ORDER BY plays DESC
            LIMIT 1
        """, (uid,)).fetchone()

        top_song = db.execute("""
            SELECT s.title, s.artist, COUNT(*) as plays
            FROM history h
            JOIN songs s ON s.id = h.song_id
            WHERE h.user_id = ?
            GROUP BY h.song_id
            ORDER BY plays DESC
            LIMIT 1
        """, (uid,)).fetchone()

        total_time = db.execute("""
            SELECT COALESCE(SUM(s.duration), 0) as total
            FROM history h
            JOIN songs s ON s.id = h.song_id
            WHERE h.user_id = ?
        """, (uid,)).fetchone()['total']

    profile = row_to_dict(user)
    profile['stats'] = {
        'total_plays':     total_plays,
        'total_favs':      total_favs,
        'total_playlists': total_playlists,
        'total_time':      int(total_time),
        'top_artist':      top_artist['artist'] if top_artist else '—',
        'top_song':        top_song['title']    if top_song   else '—',
        'top_song_artist': top_song['artist']   if top_song   else '',
    }
    return jsonify(profile)

@app.route('/api/profile', methods=['PATCH'])
@login_required
def api_update_profile():
    """Modifier la bio de l'utilisateur."""
    data = request.get_json()
    bio  = (data.get('bio') or '').strip()[:300]
    with get_db() as db:
        db.execute("UPDATE users SET bio=? WHERE id=?", (bio, session['user_id']))
    return jsonify({'success': True, 'bio': bio})

@app.route('/api/profile/avatar', methods=['POST'])
@login_required
def api_upload_avatar():
    """Upload d'un avatar pour l'utilisateur."""
    if 'avatar' not in request.files:
        return jsonify({'error': 'Aucun fichier reçu'}), 400
    f   = request.files['avatar']
    ext = os.path.splitext(f.filename)[1].lower()
    if ext not in ALLOWED_IMG:
        return jsonify({'error': 'Format non supporté (jpg, png, webp, gif)'}), 400
    uid         = session['user_id']
    avatar_name = f"avatar_{uid}_{secrets.token_hex(4)}{ext}"
    filepath    = os.path.join(AVATAR_DIR, avatar_name)
    with get_db() as db:
        old = db.execute("SELECT avatar FROM users WHERE id=?", (uid,)).fetchone()
        if old and old['avatar']:
            try:
                os.remove(os.path.join(AVATAR_DIR, old['avatar']))
            except FileNotFoundError:
                pass
    f.save(filepath)
    with get_db() as db:
        db.execute("UPDATE users SET avatar=? WHERE id=?", (avatar_name, uid))
    return jsonify({'success': True, 'avatar': avatar_name})

@app.route('/api/avatar/<filename>')
@login_required
def api_get_avatar(filename):
    return send_from_directory(AVATAR_DIR, filename)

# ─────────────────────────────────────────
#  API RECOMMANDATIONS
# ─────────────────────────────────────────
@app.route('/api/recommendations')
@login_required
def api_recommendations():
    """
    Algorithme de recommandation :
    1. Artistes les plus écoutés → musiques non encore écoutées de ces artistes
    2. Compléter avec les musiques globales les plus populaires jamais écoutées
    3. Fallback : tendances globales si aucun historique
    """
    uid = session['user_id']
    with get_db() as db:
        top_artists = db.execute("""
            SELECT s.artist, COUNT(*) as plays
            FROM history h
            JOIN songs s ON s.id = h.song_id
            WHERE h.user_id = ?
            GROUP BY s.artist
            ORDER BY plays DESC
            LIMIT 5
        """, (uid,)).fetchall()

        already_heard = {row['song_id'] for row in db.execute(
            "SELECT DISTINCT song_id FROM history WHERE user_id=?", (uid,)
        ).fetchall()}

        recommendations = []

        if top_artists:
            artist_names = [a['artist'] for a in top_artists]
            placeholders = ','.join('?' * len(artist_names))
            by_artist = db.execute(f"""
                SELECT * FROM songs
                WHERE artist IN ({placeholders})
                AND is_global = 1
                ORDER BY RANDOM()
                LIMIT 10
            """, artist_names).fetchall()
            for s in by_artist:
                if s['id'] not in already_heard:
                    d = row_to_dict(s)
                    d['reason'] = f"Car tu écoutes {s['artist']}"
                    recommendations.append(d)

        popular = db.execute("""
            SELECT s.*, COUNT(h.id) as play_count
            FROM songs s
            LEFT JOIN history h ON h.song_id = s.id
            WHERE s.is_global = 1
            GROUP BY s.id
            ORDER BY play_count DESC
            LIMIT 20
        """).fetchall()

        seen_ids = {r['id'] for r in recommendations}
        for s in popular:
            if s['id'] not in already_heard and s['id'] not in seen_ids:
                d = row_to_dict(s)
                d['reason'] = "Populaire sur PULSE"
                recommendations.append(d)
                seen_ids.add(s['id'])
                if len(recommendations) >= 12:
                    break

        if not recommendations:
            fallback = db.execute("""
                SELECT s.*, COUNT(h.id) as play_count
                FROM songs s
                LEFT JOIN history h ON h.song_id = s.id
                WHERE s.is_global = 1
                GROUP BY s.id
                ORDER BY play_count DESC
                LIMIT 12
            """).fetchall()
            for s in fallback:
                d = row_to_dict(s)
                d['reason'] = "Tendance sur PULSE"
                recommendations.append(d)

    return jsonify(recommendations[:12])

# ─────────────────────────────────────────
#  API CLASSEMENT UTILISATEURS
# ─────────────────────────────────────────
@app.route('/api/leaderboard')
@login_required
def api_leaderboard():
    """Classement des utilisateurs par écoutes totales + rang personnel."""
    uid = session['user_id']
    with get_db() as db:
        top_users = db.execute("""
            SELECT u.id, u.username, u.avatar,
                   COUNT(h.id) as total_plays,
                   COUNT(DISTINCT h.song_id) as unique_songs
            FROM users u
            LEFT JOIN history h ON h.user_id = u.id
            GROUP BY u.id
            ORDER BY total_plays DESC
            LIMIT 10
        """).fetchall()

        user_rank = db.execute("""
            SELECT COUNT(*) + 1 as rank FROM (
                SELECT u.id, COUNT(h.id) as plays
                FROM users u
                LEFT JOIN history h ON h.user_id = u.id
                GROUP BY u.id
            ) WHERE plays > (
                SELECT COUNT(*) FROM history WHERE user_id = ?
            )
        """, (uid,)).fetchone()

        user_plays = db.execute(
            "SELECT COUNT(*) as c FROM history WHERE user_id=?", (uid,)
        ).fetchone()['c']

    return jsonify({
        'leaderboard': [row_to_dict(u) for u in top_users],
        'my_rank':     user_rank['rank'] if user_rank else 1,
        'my_plays':    user_plays
    })

# ─────────────────────────────────────────
#  API SONGS (utilisateur)
# ─────────────────────────────────────────
@app.route('/api/songs')
@login_required
def api_songs():
    uid = session['user_id']
    with get_db() as db:
        songs = db.execute("""
            SELECT * FROM songs
            WHERE is_global = 1
               OR (is_global = 0 AND user_id = ?)
            ORDER BY is_global DESC, position ASC, uploaded_at DESC
        """, (uid,)).fetchall()
        favs = {row['song_id'] for row in db.execute(
            "SELECT song_id FROM favorites WHERE user_id=?", (uid,)
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
    count, errors = 0, []
    for f in files:
        ext = os.path.splitext(f.filename)[1].lower()
        if ext not in ALLOWED_EXT:
            errors.append(f'{f.filename}: format non supporté')
            continue
        unique_name = f"user_{session['user_id']}_{secrets.token_hex(6)}{ext}"
        filepath    = os.path.join(UPLOAD_DIR, unique_name)
        f.save(filepath)
        title, artist, duration = get_audio_meta(filepath)
        with get_db() as db:
            db.execute(
                "INSERT INTO songs (user_id, filename, title, artist, duration, is_global) VALUES (?,?,?,?,?,0)",
                (session['user_id'], unique_name, title, artist, duration)
            )
        count += 1
    if count == 0:
        return jsonify({'error': errors[0] if errors else 'Échec upload'}), 400
    return jsonify({'success': True, 'count': count, 'errors': errors})

@app.route('/api/songs/<int:song_id>', methods=['DELETE'])
@login_required
def api_delete_song(song_id):
    uid = session['user_id']
    with get_db() as db:
        song = db.execute(
            "SELECT * FROM songs WHERE id=? AND user_id=? AND is_global=0",
            (song_id, uid)
        ).fetchone()
        if not song:
            return jsonify({'error': 'Introuvable ou accès refusé'}), 404
        try:
            os.remove(os.path.join(UPLOAD_DIR, song['filename']))
        except FileNotFoundError:
            pass
        db.execute("DELETE FROM songs WHERE id=?", (song_id,))
    return jsonify({'success': True})

# ─────────────────────────────────────────
#  API ADMIN
# ─────────────────────────────────────────
@app.route('/api/admin/songs', methods=['GET'])
@login_required
@admin_required
def api_admin_songs():
    with get_db() as db:
        songs = db.execute(
            "SELECT * FROM songs WHERE is_global=1 ORDER BY position ASC, uploaded_at ASC"
        ).fetchall()
    return jsonify([row_to_dict(s) for s in songs])

@app.route('/api/admin/upload', methods=['POST'])
@login_required
@admin_required
def api_admin_upload():
    files = request.files.getlist('file')
    if not files:
        return jsonify({'error': 'Aucun fichier reçu'}), 400
    count, errors = 0, []
    for f in files:
        ext = os.path.splitext(f.filename)[1].lower()
        if ext not in ALLOWED_EXT:
            errors.append(f'{f.filename}: format non supporté')
            continue
        unique_name = f"global_{secrets.token_hex(8)}{ext}"
        filepath    = os.path.join(GLOBAL_DIR, unique_name)
        f.save(filepath)
        title, artist, duration = get_audio_meta(filepath)
        with get_db() as db:
            db.execute(
                "INSERT INTO songs (user_id, filename, title, artist, duration, is_global) VALUES (?,?,?,?,?,1)",
                (session['user_id'], unique_name, title, artist, duration)
            )
        count += 1
    if count == 0:
        return jsonify({'error': errors[0] if errors else 'Échec upload'}), 400
    return jsonify({'success': True, 'count': count, 'errors': errors})

@app.route('/api/admin/songs/<int:song_id>', methods=['DELETE'])
@login_required
@admin_required
def api_admin_delete_song(song_id):
    """
    Suppression admin complete :
    - Globales (is_global=1) ET musiques user (is_global=0)
    - Cherche fichier dans GLOBAL_DIR puis UPLOAD_DIR
    - Nettoie les fantomes (entrees DB sans fichier sur disque)
    """
    with get_db() as db:
        song = db.execute("SELECT * FROM songs WHERE id=?", (song_id,)).fetchone()
        if not song:
            return jsonify({'error': 'Musique introuvable'}), 404

        filename     = song['filename']
        deleted_file = False
        for directory in [GLOBAL_DIR, UPLOAD_DIR]:
            filepath = os.path.join(directory, filename)
            if os.path.exists(filepath):
                try:
                    os.remove(filepath)
                    deleted_file = True
                except OSError as e:
                    print(f'Erreur suppression fichier {filepath}: {e}')
                break

        # Supprime de la DB meme si le fichier est absent (nettoyage fantomes)
        db.execute("DELETE FROM songs WHERE id=?", (song_id,))

    return jsonify({'success': True, 'file_deleted': deleted_file})
@app.route('/api/admin/songs/<int:song_id>', methods=['PATCH'])
@login_required
@admin_required
def api_admin_edit_song(song_id):
    data   = request.get_json()
    title  = (data.get('title')  or '').strip()
    artist = (data.get('artist') or '').strip()
    if not title:
        return jsonify({'error': 'Le titre est requis'}), 400
    with get_db() as db:
        song = db.execute("SELECT * FROM songs WHERE id=? AND is_global=1", (song_id,)).fetchone()
        if not song:
            return jsonify({'error': 'Introuvable'}), 404
        db.execute("UPDATE songs SET title=?, artist=? WHERE id=?", (title, artist, song_id))
    return jsonify({'success': True})

@app.route('/api/admin/songs/reorder', methods=['POST'])
@login_required
@admin_required
def api_admin_reorder_songs():
    data  = request.get_json()
    order = data.get('order', [])
    with get_db() as db:
        for position, song_id in enumerate(order):
            db.execute("UPDATE songs SET position=? WHERE id=? AND is_global=1", (position, song_id))
    return jsonify({'success': True})

@app.route('/api/admin/stats')
@login_required
@admin_required
def api_admin_stats():
    with get_db() as db:
        total_songs = db.execute("SELECT COUNT(*) as c FROM songs WHERE is_global=1").fetchone()['c']
        total_users = db.execute("SELECT COUNT(*) as c FROM users").fetchone()['c']
        total_plays = db.execute("SELECT COUNT(*) as c FROM history").fetchone()['c']
        top = db.execute("""
            SELECT s.title FROM history h
            JOIN songs s ON s.id = h.song_id
            GROUP BY h.song_id ORDER BY COUNT(*) DESC LIMIT 1
        """).fetchone()
    return jsonify({
        'total_songs': total_songs,
        'total_users': total_users,
        'total_plays': total_plays,
        'top_song':    top['title'] if top else '—'
    })

@app.route('/api/admin/stats/top')
@login_required
@admin_required
def api_admin_stats_top():
    with get_db() as db:
        rows = db.execute("""
            SELECT s.id, s.title, s.artist, COUNT(h.id) as plays
            FROM history h
            JOIN songs s ON s.id = h.song_id
            GROUP BY h.song_id
            ORDER BY plays DESC
            LIMIT 10
        """).fetchall()
    return jsonify([row_to_dict(r) for r in rows])

@app.route('/api/admin/users')
@login_required
@admin_required
def api_admin_users():
    with get_db() as db:
        users = db.execute(
            "SELECT id, username, email, is_admin, created_at FROM users ORDER BY created_at DESC"
        ).fetchall()
    return jsonify([row_to_dict(u) for u in users])

@app.route('/api/admin/users/<int:user_id>', methods=['DELETE'])
@login_required
@admin_required
def api_admin_delete_user(user_id):
    if user_id == session['user_id']:
        return jsonify({'error': 'Impossible de se supprimer soi-même'}), 400
    with get_db() as db:
        user = db.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
        if not user:
            return jsonify({'error': 'Introuvable'}), 404
        if user['is_admin']:
            return jsonify({'error': 'Impossible de supprimer un admin'}), 403
        songs = db.execute("SELECT filename FROM songs WHERE user_id=? AND is_global=0", (user_id,)).fetchall()
        for s in songs:
            try:
                os.remove(os.path.join(UPLOAD_DIR, s['filename']))
            except FileNotFoundError:
                pass
        db.execute("DELETE FROM users WHERE id=?", (user_id,))
    return jsonify({'success': True})

# ─────────────────────────────────────────
@app.route('/api/admin/cleanup', methods=['POST'])
@login_required
@admin_required
def api_admin_cleanup():
    """
    Nettoie toutes les entrees fantomes de la base de donnees :
    musiques dont le fichier n'existe plus sur le disque.
    Retourne le nombre d'entrees supprimees.
    """
    with get_db() as db:
        all_songs = db.execute("SELECT id, filename, is_global FROM songs").fetchall()
        removed = 0
        for song in all_songs:
            directory = GLOBAL_DIR if song['is_global'] else UPLOAD_DIR
            filepath  = os.path.join(directory, song['filename'])
            if not os.path.exists(filepath):
                db.execute("DELETE FROM songs WHERE id=?", (song['id'],))
                removed += 1
    return jsonify({'success': True, 'removed': removed})

#  LECTURE AUDIO
# ─────────────────────────────────────────
@app.route('/api/play/<path:filename>')
@login_required
def api_play(filename):
    uid = session['user_id']
    with get_db() as db:
        song = db.execute("""
            SELECT * FROM songs
            WHERE filename=? AND (is_global=1 OR user_id=?)
        """, (filename, uid)).fetchone()
    if not song:
        return jsonify({'error': 'Accès refusé'}), 403
    with get_db() as db:
        db.execute("INSERT INTO history (user_id, song_id) VALUES (?,?)", (uid, song['id']))
    directory = GLOBAL_DIR if song['is_global'] else UPLOAD_DIR
    return send_from_directory(directory, filename)

# ─────────────────────────────────────────
#  API FAVORIS
# ─────────────────────────────────────────
@app.route('/api/favorites', methods=['GET'])
@login_required
def api_get_favorites():
    with get_db() as db:
        songs = db.execute("""
            SELECT s.*, 1 as is_favorite FROM songs s
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
            SELECT s.*, h.played_at FROM history h
            JOIN songs s ON s.id = h.song_id
            WHERE h.user_id = ?
            ORDER BY h.played_at DESC LIMIT 50
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
        pl = db.execute("SELECT * FROM playlists WHERE id=?", (cur.lastrowid,)).fetchone()
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
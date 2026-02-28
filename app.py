import os
from flask import Flask, render_template, jsonify, send_file, request
from flask_cors import CORS
from pathlib import Path
import mimetypes

app = Flask(__name__)
CORS(app)

app.config['AUDIO_FOLDER'] = 'audio_files'
app.config['UPLOAD_FOLDER'] = 'audio_files'
app.config['MAX_CONTENT_LENGTH'] = 500 * 1024 * 1024  # 500 MB max

os.makedirs(app.config['AUDIO_FOLDER'], exist_ok=True)

ALLOWED_EXTENSIONS = {'.mp3', '.flac', '.wav', '.ogg', '.m4a', '.aac'}

def get_mimetype(filename):
    ext = Path(filename).suffix.lower()
    mimetypes_map = {
        '.mp3':  'audio/mpeg',
        '.flac': 'audio/flac',
        '.wav':  'audio/wav',
        '.ogg':  'audio/ogg',
        '.m4a':  'audio/mp4',
        '.aac':  'audio/aac',
    }
    return mimetypes_map.get(ext, 'audio/mpeg')

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/songs')
def get_songs():
    songs = []
    audio_folder = Path(app.config['AUDIO_FOLDER'])
    print(f"\n📁 Scan: {audio_folder.absolute()}")

    if not audio_folder.exists():
        print("❌ Dossier audio_files introuvable!")
        return jsonify([])

    for file in sorted(audio_folder.iterdir()):
        if file.is_file() and file.suffix.lower() in ALLOWED_EXTENSIONS:
            songs.append({
                'id':       file.name,         # juste le nom du fichier
                'title':    file.stem,
                'artist':   'Inconnu',
                'album':    'Inconnu',
                'duration': 0,
                'filename': file.name
            })
            print(f"✅ {file.name}")

    print(f"🎵 Total: {len(songs)} chanson(s)\n")
    return jsonify(songs)

@app.route('/api/play/<filename>')
def play_song(filename):
    try:
        # On n'accepte que le nom de fichier, pas un chemin arbitraire (sécurité)
        safe_name = Path(filename).name
        full_path = Path(app.config['AUDIO_FOLDER']) / safe_name

        if not full_path.exists():
            print(f"❌ Fichier introuvable: {full_path}")
            return jsonify({'error': 'Fichier introuvable'}), 404

        mime = get_mimetype(safe_name)
        print(f"🎧 Lecture: {safe_name} ({mime})")
        return send_file(str(full_path), mimetype=mime, conditional=True)

    except Exception as e:
        print(f"❌ Erreur lecture: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/upload', methods=['POST'])
def upload_file():
    # Supporte plusieurs fichiers
    files = request.files.getlist('file')

    if not files or all(f.filename == '' for f in files):
        return jsonify({'error': 'Aucun fichier reçu'}), 400

    uploaded = []
    errors   = []

    for file in files:
        if file.filename == '':
            continue

        ext = Path(file.filename).suffix.lower()
        if ext not in ALLOWED_EXTENSIONS:
            errors.append(f"{file.filename} : format non supporté")
            continue

        # Sécuriser le nom
        from werkzeug.utils import secure_filename
        filename  = secure_filename(file.filename)
        save_path = Path(app.config['UPLOAD_FOLDER']) / filename

        # Éviter d'écraser un fichier existant
        counter = 1
        stem, suffix = Path(filename).stem, Path(filename).suffix
        while save_path.exists():
            save_path = Path(app.config['UPLOAD_FOLDER']) / f"{stem}_{counter}{suffix}"
            counter += 1

        file.save(str(save_path))
        uploaded.append(save_path.name)
        print(f"✅ Uploadé: {save_path.name}")

    if errors and not uploaded:
        return jsonify({'error': '; '.join(errors)}), 400

    return jsonify({
        'success':  True,
        'uploaded': uploaded,
        'errors':   errors,
        'count':    len(uploaded)
    })

if __name__ == '__main__':
    print("🚀 Démarrage de PULSE...")
    print(f"📁 Dossier audio: {os.path.abspath(app.config['AUDIO_FOLDER'])}")
    app.run(debug=True, host='0.0.0.0', port=5000)
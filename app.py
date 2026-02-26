import os
from flask import Flask, render_template, jsonify, send_file, request
from flask_cors import CORS
from pathlib import Path
import mimetypes

app = Flask(__name__)
CORS(app)  # Pour éviter les problèmes de CORS

# Configuration
app.config['AUDIO_FOLDER'] = 'audio_files'
app.config['UPLOAD_FOLDER'] = 'audio_files'  # On utilise le même dossier
app.config['MAX_CONTENT_LENGTH'] = 100 * 1024 * 1024  # 100 MB max

# Créer le dossier s'il n'existe pas
os.makedirs(app.config['AUDIO_FOLDER'], exist_ok=True)

@app.route('/')
def index():
    """Page d'accueil"""
    return render_template('index.html')

@app.route('/api/songs')
def get_songs():
    """Récupérer la liste des chansons"""
    songs = []
    extensions = ['.mp3', '.flac', '.wav', '.ogg', '.m4a']
    
    audio_folder = Path(app.config['AUDIO_FOLDER'])
    print(f"\n📁 Scan du dossier: {audio_folder.absolute()}")
    
    if not audio_folder.exists():
        print("❌ Le dossier audio_files n'existe pas!")
        return jsonify([])
    
    for file in audio_folder.iterdir():
        if file.is_file():
            print(f"🔍 Fichier trouvé: {file.name}")
            if file.suffix.lower() in extensions:
                # Nettoyer le chemin pour Windows
                file_path = str(file).replace('\\', '/')
                songs.append({
                    'id': file_path,
                    'title': file.stem,
                    'artist': 'Inconnu',
                    'album': 'Inconnu',
                    'path': file_path,
                    'duration': 0,
                    'filename': file.name
                })
                print(f"✅ Ajouté: {file.name}")
    
    print(f"🎵 Total: {len(songs)} chansons\n")
    return jsonify(songs)

@app.route('/api/play/<path:song_path>')
def play_song(song_path):
    """Jouer un fichier audio"""
    try:
        print(f"🎧 Lecture demandée: {song_path}")
        # Nettoyer le chemin
        song_path = song_path.replace('\\', '/')
        
        # Vérifier si le chemin est absolu
        if os.path.isabs(song_path):
            return send_file(song_path, mimetype='audio/mpeg')
        else:
            # Chercher dans le dossier audio_files
            full_path = os.path.join(app.config['AUDIO_FOLDER'], os.path.basename(song_path))
            return send_file(full_path, mimetype='audio/mpeg')
    except Exception as e:
        print(f"❌ Erreur lecture: {e}")
        return jsonify({'error': str(e)}), 404

@app.route('/api/upload', methods=['POST'])
def upload_file():
    """Upload de fichiers audio"""
    if 'file' not in request.files:
        return jsonify({'error': 'Aucun fichier'}), 400
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'Nom de fichier vide'}), 400
    
    if file:
        filename = file.filename
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(filepath)
        print(f"✅ Fichier uploadé: {filename}")
        return jsonify({'success': True, 'filename': filename})

if __name__ == '__main__':
    print("🚀 Démarrage de PULSE...")
    print(f"📁 Dossier audio: {os.path.abspath(app.config['AUDIO_FOLDER'])}")
    app.run(debug=True, host='0.0.0.0', port=5000)
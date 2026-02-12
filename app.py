import os
from flask import Flask, render_template, jsonify, send_file
from pathlib import Path

app = Flask(__name__)

# Dossier pour les fichiers audio
app.config['AUDIO_FOLDER'] = 'audio_files'

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
    extensions = ['.mp3', '.flac', '.wav', '.ogg']
    
    for file in Path(app.config['AUDIO_FOLDER']).iterdir():
        if file.suffix.lower() in extensions:
            songs.append({
                'id': str(file),
                'title': file.stem,
                'artist': 'Inconnu',
                'path': str(file)
            })
    
    return jsonify(songs)

@app.route('/api/play/<path:song_path>')
def play_song(song_path):
    """Jouer un fichier audio"""
    return send_file(song_path)

if __name__ == '__main__':
    app.run(debug=True, port=5000)
class AudioPlayer {
    constructor() {
        this.audio        = document.getElementById('audio-element');
        this.playlist     = [];
        this.currentIndex = -1;
        this.isPlaying    = false;
        this.playlists    = {};

        console.log('🎵 Initialisation PULSE...');
        this.initEventListeners();
        this.loadSongs();
    }

    initEventListeners() {
        this.$('play-btn')?.addEventListener('click',  () => this.play());
        this.$('pause-btn')?.addEventListener('click', () => this.pause());
        this.$('prev-btn')?.addEventListener('click',  () => this.previous());
        this.$('next-btn')?.addEventListener('click',  () => this.next());

        const progress = this.$('progress');
        this.audio.ontimeupdate = () => {
            if (this.audio.duration && progress) {
                progress.value = (this.audio.currentTime / this.audio.duration) * 100;
                this.updateTimeDisplay();
            }
        };
        progress?.addEventListener('input', e => {
            this.audio.currentTime = (e.target.value / 100) * (this.audio.duration || 0);
        });

        const volume = this.$('volume');
        if (volume) {
            this.audio.volume = volume.value;
            volume.addEventListener('input', e => { this.audio.volume = e.target.value; });
        }

        document.querySelectorAll('.nav-btn[data-view]').forEach(btn => {
            btn.addEventListener('click', () => {
                const view = btn.dataset.view;
                if (view) this.switchView(view);
            });
        });

        this.$('upload-form')?.addEventListener('submit', e => {
            e.preventDefault();
            this.uploadFiles();
        });

        this.$('search-input')?.addEventListener('input', e => {
            this.searchSongs(e.target.value);
            if (e.target.value.trim()) this.switchView('search');
        });

        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            });
        });

        this.audio.onended = () => this.next();

        document.addEventListener('keydown', e => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
            if (e.code === 'Space')           { e.preventDefault(); this.isPlaying ? this.pause() : this.play(); }
            else if (e.code === 'ArrowLeft')  this.previous();
            else if (e.code === 'ArrowRight') this.next();
        });
    }

    async loadSongs() {
        try {
            const res   = await fetch('/api/songs');
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const songs = await res.json();
            this.playlist = songs;
            console.log('✅ ' + songs.length + ' chanson(s) chargée(s)');
            this.displaySongs(songs);
            // Rafraîchir la vue active (home au démarrage)
            setTimeout(() => this.switchView('home'), 50);
        } catch (err) {
            console.error('❌ Erreur chargement:', err);
            this.notify('❌ Impossible de charger les chansons', 'error');
        }
    }

    displaySongs(songs) {
        const html = songs.length === 0
            ? '<div class="no-songs">📁 Aucune musique. Utilise "Importer" pour ajouter des fichiers.</div>'
            : songs.map(s => this.songCardHTML(s)).join('');

        ['songs-list', 'recent-songs', 'all-songs-for-playlist'].forEach(id => {
            const el = this.$(id);
            if (el) el.innerHTML = html;
        });
    }

    songCardHTML(song) {
        return '<div class="song-card" data-id="' + this.esc(song.id) + '">' +
            '<div class="song-card-icon">🎵</div>' +
            '<div class="song-card-info">' +
            '<h3>' + this.esc(song.title) + '</h3>' +
            '<p>' + this.esc(song.artist) + '</p>' +
            '</div>' +
            '<span class="duration">' + this.formatTime(song.duration) + '</span>' +
            '</div>';
    }

    playSong(songId) {
        const idx = this.playlist.findIndex(s => s.id === songId);
        if (idx === -1) return console.warn('Chanson introuvable:', songId);

        this.currentIndex = idx;
        const song = this.playlist[idx];

        this.audio.src = '/api/play/' + encodeURIComponent(song.filename);
        this.audio.load();
        this.play();

        this.setText('current-song',   song.title);
        this.setText('current-artist', song.artist);

        document.querySelectorAll('.song-card').forEach(c => c.classList.remove('playing'));
        document.querySelectorAll('.song-card[data-id="' + this.esc(songId) + '"]')
                 .forEach(c => c.classList.add('playing'));
    }

    play() {
        this.audio.play().catch(err => console.error('Erreur play:', err));
        const pb = this.$('play-btn');
        const pp = this.$('pause-btn');
        if (pb) pb.style.display = 'none';
        if (pp) pp.style.display = 'flex';
        this.isPlaying = true;
    }

    pause() {
        this.audio.pause();
        const pb = this.$('play-btn');
        const pp = this.$('pause-btn');
        if (pb) pb.style.display = 'flex';
        if (pp) pp.style.display = 'none';
        this.isPlaying = false;
    }

    previous() {
        if (this.currentIndex > 0)
            this.playSong(this.playlist[this.currentIndex - 1].id);
    }

    next() {
        if (this.currentIndex < this.playlist.length - 1)
            this.playSong(this.playlist[this.currentIndex + 1].id);
    }

    async uploadFiles() {
        const input = this.$('audio-file');
        if (!input || !input.files.length)
            return this.notify('❌ Sélectionne au moins un fichier audio', 'error');

        const formData = new FormData();
        for (const file of input.files) formData.append('file', file);

        const btn = this.$('upload-btn');
        if (btn) { btn.disabled = true; btn.textContent = 'Import…'; }

        try {
            const res  = await fetch('/api/upload', { method: 'POST', body: formData });
            const data = await res.json();
            if (res.ok && data.success) {
                this.notify('✅ ' + data.count + ' fichier(s) importé(s) !', 'success');
                input.value = '';
                await this.loadSongs();
            } else {
                this.notify('❌ ' + (data.error || 'Erreur upload'), 'error');
            }
        } catch (err) {
            console.error('Erreur upload:', err);
            this.notify('❌ Impossible de contacter le serveur', 'error');
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = 'Importer'; }
        }
    }

    searchSongs(query) {
        const q = query.toLowerCase().trim();
        const results = q
            ? this.playlist.filter(s =>
                s.title.toLowerCase().includes(q) ||
                s.artist.toLowerCase().includes(q))
            : this.playlist;

        const container = this.$('search-results');
        if (!container) return;
        container.innerHTML = results.length
            ? results.map(s => this.songCardHTML(s)).join('')
            : '<div class="no-songs">Aucun résultat</div>';
    }

    createPlaylist() {
        const name = this.$('playlist-name') ? this.$('playlist-name').value.trim() : '';
        if (!name) return this.notify('Donne un nom à ta playlist', 'error');
        const desc = this.$('playlist-description') ? this.$('playlist-description').value.trim() : '';
        this.playlists[name] = { name, description: desc, songs: [], created: new Date().toISOString() };
        this.notify('✅ Playlist "' + name + '" créée !', 'success');
        this.displayPlaylists();
        if (this.$('playlist-name'))        this.$('playlist-name').value        = '';
        if (this.$('playlist-description')) this.$('playlist-description').value = '';
    }

    displayPlaylists() {
        const container = this.$('playlists-list');
        if (!container) return;
        const createBtn = container.querySelector('[data-view="create-playlist"]');
        container.innerHTML = '';
        if (createBtn) container.appendChild(createBtn);
        Object.keys(this.playlists).forEach(name => {
            const btn = document.createElement('button');
            btn.className    = 'nav-btn';
            btn.dataset.view = 'pl_' + name;
            btn.innerHTML    = '<span class="icon">📋</span> ' + this.esc(name);
            btn.addEventListener('click', () => this.showPlaylist(name));
            container.appendChild(btn);
        });
    }

    showPlaylist(name) {
        const pl = this.playlists[name];
        if (!pl) return;
        this.setText('playlist-title',            pl.name);
        this.setText('playlist-description-text', pl.description);
        this.setText('playlist-stats',            pl.songs.length + ' morceau(x)');
        const container = this.$('playlist-songs');
        if (container)
            container.innerHTML = pl.songs.length
                ? pl.songs.map(s => this.songCardHTML(s)).join('')
                : '<div class="no-songs">Playlist vide</div>';
        this.switchView('playlist');
    }

    switchView(view) {
        // Cacher toutes les vues
        document.querySelectorAll('.view').forEach(v => {
            v.classList.remove('active');
            v.style.display = 'none';
        });

        // Afficher la bonne vue
        const target = document.getElementById(view + '-view');
        if (target) {
            target.classList.add('active');
            target.style.display = 'block';
        } else {
            console.warn('Vue introuvable: ' + view + '-view');
        }

        // Mettre à jour boutons nav
        document.querySelectorAll('.nav-btn[data-view]').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.view === view);
        });

        // Rafraîchir le contenu selon la vue
        const noSongs = '<div class="no-songs">📁 Aucune musique. Utilise "Importer" pour en ajouter.</div>';
        const songsHtml = this.playlist.length ? this.playlist.map(s => this.songCardHTML(s)).join('') : noSongs;

        if (view === 'home') {
            const el = this.$('recent-songs');
            if (el) el.innerHTML = songsHtml;
        }
        if (view === 'library') {
            const el = this.$('songs-list');
            if (el) el.innerHTML = songsHtml;
        }
        if (view === 'create-playlist') {
            const el = this.$('all-songs-for-playlist');
            if (el) el.innerHTML = songsHtml;
        }
    }

    $(id)             { return document.getElementById(id); }
    setText(id, text) { const el = this.$(id); if (el) el.textContent = text; }
    esc(str)          { return String(str).replace(/[&<>"']/g, c =>
        ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

    formatTime(seconds) {
        if (!seconds) return '0:00';
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return m + ':' + s.toString().padStart(2, '0');
    }

    updateTimeDisplay() {
        this.setText('time-current', this.formatTime(this.audio.currentTime));
        this.setText('time-total',   this.formatTime(this.audio.duration));
    }

    notify(msg, type) {
        if (!type) type = 'info';
        console.log(msg);
        const banner = document.createElement('div');
        banner.className = 'notify notify-' + type;
        banner.textContent = msg;
        document.body.appendChild(banner);
        setTimeout(function() { banner.remove(); }, 3000);
    }
}

document.addEventListener('DOMContentLoaded', function() {
    window.player = new AudioPlayer();

    ['songs-list','recent-songs','all-songs-for-playlist','search-results','playlist-songs'].forEach(function(id) {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('click', function(e) {
                const card = e.target.closest('.song-card');
                if (card && card.dataset.id) window.player.playSong(card.dataset.id);
            });
        }
    });
});
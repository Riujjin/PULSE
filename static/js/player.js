class AudioPlayer {
    constructor() {
        this.audio        = document.getElementById('audio-element');
        this.playlist     = [];
        this.currentIndex = -1;
        this.isPlaying    = false;
        this.playlists    = [];
        this.currentUser  = null;

        console.log('🎵 Initialisation PULSE...');
        this.initEventListeners();
        this.loadUser();
    }

    async loadUser() {
        try {
            const res = await fetch('/api/me');
            if (res.status === 401) { window.location.href = '/login'; return; }
            this.currentUser = await res.json();
            this.setText('username-display', this.currentUser.username);
            if (this.currentUser.is_admin) {
                const btn = document.getElementById('admin-btn');
                if (btn) btn.style.display = 'flex';
                }
            await this.loadSongs();
            await this.loadPlaylists();
            this.switchView('home');
        } catch (e) { console.error('Erreur init:', e); }
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
            btn.addEventListener('click', () => { if (btn.dataset.view) this.switchView(btn.dataset.view); });
        });

        this.$('upload-form')?.addEventListener('submit', e => { e.preventDefault(); this.uploadFiles(); });
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

        this.$('btn-create-playlist')?.addEventListener('click', () => this.createPlaylist());
        this.$('logout-btn')?.addEventListener('click', () => this.logout());
        this.audio.onended = () => this.next();

        document.addEventListener('keydown', e => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
            if (e.code === 'Space')           { e.preventDefault(); this.isPlaying ? this.pause() : this.play(); }
            else if (e.code === 'ArrowLeft')  this.previous();
            else if (e.code === 'ArrowRight') this.next();
        });

        document.addEventListener('click', e => {
            const card   = e.target.closest('.song-card[data-id]');
            const favBtn = e.target.closest('.btn-fav');
            const addBtn = e.target.closest('.btn-add-pl');

            if (favBtn) { e.stopPropagation(); this.toggleFavorite(parseInt(favBtn.dataset.id), favBtn.dataset.fav === 'true'); return; }
            if (addBtn) { e.stopPropagation(); this.showAddToPlaylistMenu(parseInt(addBtn.dataset.id), addBtn); return; }
            if (card && !e.target.closest('.song-actions')) { this.playSong(parseInt(card.dataset.id)); return; }
        });
    }

    // ── SONGS ─────────────────────────────────────────────
    async loadSongs() {
        try {
            const res = await fetch('/api/songs');
            if (!res.ok) throw new Error('HTTP ' + res.status);
            this.playlist = await res.json();
        } catch (err) { this.notify('❌ Impossible de charger les chansons', 'error'); }
    }

    songCardHTML(song, showActions = true) {
        const isFav   = song.is_favorite ? 'true' : 'false';
        const favIcon = song.is_favorite ? '❤️' : '🤍';
        const actions = showActions ? `
            <div class="song-actions">
                <button class="btn-fav"    data-id="${song.id}" data-fav="${isFav}">${favIcon}</button>
                <button class="btn-add-pl" data-id="${song.id}">➕</button>
            </div>` : '';
        return `<div class="song-card" data-id="${song.id}">
            <div class="song-card-icon">🎵</div>
            <div class="song-card-info">
                <h3>${this.esc(song.title)}</h3>
                <p>${this.esc(song.artist)}</p>
            </div>
            <span class="duration">${this.formatTime(song.duration)}</span>
            ${actions}
        </div>`;
    }

    playSong(songId) {
        const idx = this.playlist.findIndex(s => s.id === songId);
        if (idx === -1) return;
        this.currentIndex = idx;
        const song = this.playlist[idx];
        this.audio.src = '/api/play/' + encodeURIComponent(song.filename);
        this.audio.load();
        this.play();
        this.setText('current-song',   song.title);
        this.setText('current-artist', song.artist);
        document.querySelectorAll('.song-card').forEach(c => c.classList.remove('playing'));
        document.querySelectorAll(`.song-card[data-id="${song.id}"]`).forEach(c => c.classList.add('playing'));
    }

    play() {
        this.audio.play().catch(e => console.error(e));
        const pb = this.$('play-btn'), pp = this.$('pause-btn');
        if (pb) pb.style.display = 'none';
        if (pp) pp.style.display = 'flex';
        this.isPlaying = true;
    }

    pause() {
        this.audio.pause();
        const pb = this.$('play-btn'), pp = this.$('pause-btn');
        if (pb) pb.style.display = 'flex';
        if (pp) pp.style.display = 'none';
        this.isPlaying = false;
    }

    previous() { if (this.currentIndex > 0) this.playSong(this.playlist[this.currentIndex - 1].id); }
    next()     { if (this.currentIndex < this.playlist.length - 1) this.playSong(this.playlist[this.currentIndex + 1].id); }

    async uploadFiles() {
        const input = this.$('audio-file');
        if (!input?.files.length) return this.notify('❌ Sélectionne au moins un fichier', 'error');
        const formData = new FormData();
        for (const f of input.files) formData.append('file', f);
        const btn = this.$('upload-btn');
        if (btn) { btn.disabled = true; btn.textContent = 'Import…'; }
        try {
            const res  = await fetch('/api/upload', { method: 'POST', body: formData });
            const data = await res.json();
            if (res.ok && data.success) {
                this.notify('✅ ' + data.count + ' fichier(s) importé(s) !', 'success');
                input.value = '';
                await this.loadSongs();
                this.switchView('home');
            } else { this.notify('❌ ' + (data.error || 'Erreur upload'), 'error'); }
        } catch { this.notify('❌ Impossible de contacter le serveur', 'error'); }
        finally { if (btn) { btn.disabled = false; btn.textContent = 'Importer'; } }
    }

    searchSongs(query) {
        const q = query.toLowerCase().trim();
        const results = q ? this.playlist.filter(s => s.title.toLowerCase().includes(q) || s.artist.toLowerCase().includes(q)) : this.playlist;
        const el = this.$('search-results');
        if (el) el.innerHTML = results.length ? results.map(s => this.songCardHTML(s)).join('') : '<div class="no-songs">Aucun résultat</div>';
    }

    // ── FAVORIS ───────────────────────────────────────────
    async toggleFavorite(songId, currentlyFav) {
        try {
            const res = await fetch(`/api/favorites/${songId}`, { method: currentlyFav ? 'DELETE' : 'POST' });
            if ((await res.json()).success) {
                const song = this.playlist.find(s => s.id === songId);
                if (song) song.is_favorite = !currentlyFav;
                document.querySelectorAll(`.btn-fav[data-id="${songId}"]`).forEach(btn => {
                    btn.dataset.fav = String(!currentlyFav);
                    btn.textContent = !currentlyFav ? '❤️' : '🤍';
                });
                this.notify(currentlyFav ? '💔 Retiré des favoris' : '❤️ Ajouté aux favoris', 'info');
            }
        } catch { this.notify('❌ Erreur', 'error'); }
    }

    async loadFavorites() {
        try {
            const songs = await (await fetch('/api/favorites')).json();
            const el = this.$('favorites-songs');
            if (el) el.innerHTML = songs.length ? songs.map(s => this.songCardHTML(s)).join('') : '<div class="no-songs">❤️ Aucun favori pour l\'instant</div>';
        } catch(e) { console.error(e); }
    }

    // ── HISTORIQUE ────────────────────────────────────────
    async loadHistory() {
        try {
            const songs = await (await fetch('/api/history')).json();
            const el = this.$('history-songs');
            if (el) el.innerHTML = songs.length ? songs.map(s => this.songCardHTML(s, false)).join('') : '<div class="no-songs">🕒 Aucun historique</div>';
        } catch(e) { console.error(e); }
    }

    // ── PLAYLISTS ─────────────────────────────────────────
    async loadPlaylists() {
        try {
            this.playlists = await (await fetch('/api/playlists')).json();
            this.renderPlaylistNav();
        } catch(e) { console.error(e); }
    }

    renderPlaylistNav() {
        const container = this.$('playlists-list');
        if (!container) return;
        const createBtn = container.querySelector('[data-view="create-playlist"]');
        container.innerHTML = '';
        if (createBtn) container.appendChild(createBtn);
        this.playlists.forEach(pl => {
            const btn = document.createElement('button');
            btn.className = 'nav-btn';
            btn.innerHTML = `<span class="icon">📋</span> ${this.esc(pl.name)}`;
            btn.addEventListener('click', () => this.showPlaylist(pl));
            container.appendChild(btn);
        });
    }

    async createPlaylist() {
        const nameInput = this.$('playlist-name');
        const descInput = this.$('playlist-description');
        const name = nameInput?.value.trim();
        if (!name) return this.notify('Donne un nom à ta playlist', 'error');
        try {
            const res  = await fetch('/api/playlists', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, description: descInput?.value.trim() || '' })
            });
            const data = await res.json();
            if (res.ok) {
                this.playlists.unshift(data);
                this.renderPlaylistNav();
                this.notify(`✅ Playlist "${name}" créée !`, 'success');
                if (nameInput) nameInput.value = '';
                if (descInput) descInput.value = '';
            } else { this.notify('❌ ' + (data.error || 'Erreur'), 'error'); }
        } catch { this.notify('❌ Erreur serveur', 'error'); }
    }

    async showPlaylist(pl) {
        this.setText('playlist-title',            pl.name);
        this.setText('playlist-description-text', pl.description || '');
        this.switchView('playlist');
        try {
            const songs = await (await fetch(`/api/playlists/${pl.id}/songs`)).json();
            songs.forEach(s => { s.is_favorite = this.playlist.find(p => p.id === s.id)?.is_favorite || false; });
            const el = this.$('playlist-songs');
            if (el) el.innerHTML = songs.length ? songs.map(s => this.songCardHTML(s)).join('') : '<div class="no-songs">Playlist vide</div>';
            this.setText('playlist-stats', songs.length + ' morceau(x)');
        } catch(e) { console.error(e); }
    }

    showAddToPlaylistMenu(songId, btn) {
        document.querySelectorAll('.pl-menu').forEach(m => m.remove());
        if (!this.playlists.length) return this.notify('Crée d\'abord une playlist !', 'info');
        const menu = document.createElement('div');
        menu.className = 'pl-menu';
        Object.assign(menu.style, {
            position:'fixed', zIndex:'9999', background:'#1a1825',
            border:'1px solid rgba(124,58,237,0.3)', borderRadius:'10px',
            padding:'6px', minWidth:'180px', boxShadow:'0 8px 32px rgba(0,0,0,0.5)'
        });
        this.playlists.forEach(pl => {
            const item = document.createElement('button');
            Object.assign(item.style, {
                display:'block', width:'100%', padding:'9px 14px', background:'none',
                border:'none', color:'#f0eeff', fontFamily:'Outfit,sans-serif',
                fontSize:'13px', textAlign:'left', cursor:'pointer', borderRadius:'7px'
            });
            item.textContent = '📋 ' + pl.name;
            item.onmouseenter = () => item.style.background = 'rgba(124,58,237,0.15)';
            item.onmouseleave = () => item.style.background = 'none';
            item.addEventListener('click', async () => { menu.remove(); await this.addSongToPlaylist(pl.id, songId, pl.name); });
            menu.appendChild(item);
        });
        const rect = btn.getBoundingClientRect();
        menu.style.top  = (rect.bottom + 4) + 'px';
        menu.style.left = rect.left + 'px';
        document.body.appendChild(menu);
        setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 0);
    }

    async addSongToPlaylist(plId, songId, plName) {
        try {
            const res = await fetch(`/api/playlists/${plId}/songs/${songId}`, { method: 'POST' });
            if (res.ok) this.notify(`✅ Ajouté à "${plName}"`, 'success');
            else this.notify('❌ Erreur', 'error');
        } catch { this.notify('❌ Erreur serveur', 'error'); }
    }

    async logout() {
        await fetch('/api/logout', { method: 'POST' });
        window.location.href = '/login';
    }

    // ── VUES ──────────────────────────────────────────────
    switchView(view) {
        document.querySelectorAll('.view').forEach(v => { v.classList.remove('active'); v.style.display = 'none'; });
        const target = document.getElementById(view + '-view');
        if (target) { target.classList.add('active'); target.style.display = 'block'; }
        document.querySelectorAll('.nav-btn[data-view]').forEach(btn => btn.classList.toggle('active', btn.dataset.view === view));

        const noSongs  = '<div class="no-songs">📁 Aucune musique. Utilise "Importer" pour en ajouter.</div>';
        const songsHtml = this.playlist.length ? this.playlist.map(s => this.songCardHTML(s)).join('') : noSongs;

        if (view === 'home')            { const el = this.$('recent-songs');           if (el) el.innerHTML = songsHtml; }
        if (view === 'library')         { const el = this.$('songs-list');             if (el) el.innerHTML = songsHtml; }
        if (view === 'create-playlist') { const el = this.$('all-songs-for-playlist'); if (el) el.innerHTML = songsHtml; }
        if (view === 'favorites')       this.loadFavorites();
        if (view === 'history')         this.loadHistory();
    }

    // ── UTILS ─────────────────────────────────────────────
    $(id)             { return document.getElementById(id); }
    setText(id, text) { const el = this.$(id); if (el) el.textContent = text; }
    esc(str)          { return String(str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
    formatTime(s)     { if (!s) return '0:00'; return Math.floor(s/60)+':'+Math.floor(s%60).toString().padStart(2,'0'); }
    updateTimeDisplay() { this.setText('time-current', this.formatTime(this.audio.currentTime)); this.setText('time-total', this.formatTime(this.audio.duration)); }

    notify(msg, type = 'info') {
        const b = document.createElement('div');
        b.className = 'notify notify-' + type;
        b.textContent = msg;
        document.body.appendChild(b);
        setTimeout(() => b.remove(), 3000);
    }
}

document.addEventListener('DOMContentLoaded', () => { window.player = new AudioPlayer(); });
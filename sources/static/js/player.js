class AudioPlayer {
    constructor() {
        this.audio        = document.getElementById('audio-element');
        this.playlist     = [];
        this.currentIndex = -1;
        this.isPlaying    = false;
        this.playlists    = [];
        this.currentUser  = null;
        // Nouvelles propriétés
        this.shuffleMode  = false;
        this.repeatMode   = 'none'; // 'none' | 'all' | 'one'
        this.queue        = [];     // indices dans this.playlist
        this.lyricsCache  = {};     // songId → paroles
        this.analyser     = null;
        this.animFrame    = null;

        console.log('🎵 Initialisation PULSE...');
        this.initEventListeners();
        this.loadUser();
        this.initTheme();
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
        this.audio.onended = () => this.onTrackEnded();

        // Shuffle & Repeat
        this.$('shuffle-btn')?.addEventListener('click', () => this.toggleShuffle());
        this.$('repeat-btn')?.addEventListener('click',  () => this.cycleRepeat());

        // Paroles & Queue
        this.$('lyrics-btn')?.addEventListener('click', () => this.togglePanel('lyrics'));
        this.$('queue-btn')?.addEventListener('click',  () => this.togglePanel('queue'));

        // Thème
        this.$('theme-toggle')?.addEventListener('click', () => this.toggleTheme());

        // Rechargement automatique si des musiques sont supprimées depuis le panel admin
        document.addEventListener('visibilitychange', async () => {
            if (document.visibilityState === 'visible') {
                await this.loadSongs();
                this.refreshCurrentView();
            }
        });

        window.addEventListener('storage', async (e) => {
            if (e.key === 'pulse_songs_updated') {
                await this.loadSongs();
                this.refreshCurrentView();
            }
        });

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

    refreshCurrentView() {
        // Retire la chanson en cours du lecteur si elle a été supprimée
        if (this.currentIndex >= 0) {
            const currentSong = this.playlist[this.currentIndex];
            if (!currentSong) {
                this.audio.pause();
                this.audio.src = '';
                this.currentIndex = -1;
                this.isPlaying = false;
                this.setText('track-title',  'Aucune piste');
                this.setText('track-artist', '—');
            }
        }
        // Rafraîchit la vue active pour supprimer les cartes fantômes
        const activeView = document.querySelector('.view.active')?.id?.replace('view-', '');
        if (activeView) this.switchView(activeView);
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

        // Pochette animée
        const cover = this.$('song-cover');
        if (cover) { cover.classList.add('spinning'); }

        // Couleur dynamique selon l'index (teinte violette variée)
        this.applyDynamicColor(idx);

        // Visualiseur Web Audio
        this.initVisualizer();

        // Paroles auto si panel ouvert
        if (document.getElementById('lyrics-panel')?.classList.contains('open')) {
            this.fetchLyrics(song);
        }

        // Mettre à jour la queue
        this.renderQueue();
    }

    play() {
        this.audio.play().catch(e => console.error(e));
        const pb = this.$('play-btn'), pp = this.$('pause-btn');
        if (pb) pb.style.display = 'none';
        if (pp) pp.style.display = 'flex';
        this.isPlaying = true;
        const cover = this.$('song-cover');
        if (cover) cover.classList.add('spinning');
    }

    pause() {
        this.audio.pause();
        const pb = this.$('play-btn'), pp = this.$('pause-btn');
        if (pb) pb.style.display = 'flex';
        if (pp) pp.style.display = 'none';
        this.isPlaying = false;
    }

    pause() {
        this.audio.pause();
        const pb = this.$('play-btn'), pp = this.$('pause-btn');
        if (pb) pb.style.display = 'flex';
        if (pp) pp.style.display = 'none';
        this.isPlaying = false;
        const cover = this.$('song-cover');
        if (cover) cover.classList.remove('spinning');
    }

    previous() {
        if (this.audio.currentTime > 3) { this.audio.currentTime = 0; return; }
        if (this.currentIndex > 0) this.playSong(this.playlist[this.currentIndex - 1].id);
    }

    next() {
        if (this.repeatMode === 'one') { this.audio.currentTime = 0; this.play(); return; }
        if (this.shuffleMode) {
            const idx = Math.floor(Math.random() * this.playlist.length);
            this.playSong(this.playlist[idx].id);
        } else if (this.currentIndex < this.playlist.length - 1) {
            this.playSong(this.playlist[this.currentIndex + 1].id);
        } else if (this.repeatMode === 'all') {
            this.playSong(this.playlist[0].id);
        }
    }

    onTrackEnded() { this.next(); }

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
        if (view === 'recommendations') this.loadRecommendations();
        if (view === 'leaderboard')     this.loadLeaderboard();
        if (view === 'profile')         this.loadProfile();
    }

    // ── RECOMMANDATIONS ───────────────────────────────────
    async loadRecommendations() {
        const el = this.$('recommendations-grid');
        if (!el) return;
        el.innerHTML = '<div class="no-songs" style="opacity:0.5">Chargement…</div>';
        try {
            const songs = await (await fetch('/api/recommendations')).json();
            if (!songs.length) {
                el.innerHTML = '<div class="no-songs">✨ Écoute des musiques pour obtenir des recommandations !</div>';
                return;
            }
            el.innerHTML = songs.map(s => {
                const isFav   = s.is_favorite ? 'true' : 'false';
                const favIcon = s.is_favorite ? '❤️' : '🤍';
                return `<div class="song-card" data-id="${s.id}">
                    <div class="song-card-icon">🎵</div>
                    <div class="song-card-info">
                        <h3>${this.esc(s.title)}</h3>
                        <p>${this.esc(s.artist)}</p>
                    </div>
                    <span class="duration">${this.formatTime(s.duration)}</span>
                    <span class="reco-reason">${this.esc(s.reason || '')}</span>
                    <div class="song-actions">
                        <button class="btn-fav"    data-id="${s.id}" data-fav="${isFav}">${favIcon}</button>
                        <button class="btn-add-pl" data-id="${s.id}">➕</button>
                    </div>
                </div>`;
            }).join('');
        } catch(e) { el.innerHTML = '<div class="no-songs">❌ Impossible de charger les recommandations</div>'; }
    }

    // ── CLASSEMENT ────────────────────────────────────────
    async loadLeaderboard() {
        const listEl   = this.$('leaderboard-list');
        const bannerEl = this.$('my-rank-banner');
        if (!listEl) return;
        listEl.innerHTML = '<div class="no-songs" style="opacity:0.5">Chargement…</div>';
        try {
            const data   = await (await fetch('/api/leaderboard')).json();
            const myId   = this.currentUser?.user_id;
            const medals = ['🥇','🥈','🥉'];
            const rankClass = ['gold','silver','bronze'];

            if (bannerEl) {
                bannerEl.innerHTML = `
                    <div class="rank-pos">#${data.my_rank}</div>
                    <div class="rank-text">
                        Tu es <strong>${this.rankLabel(data.my_rank)}</strong> sur PULSE
                        avec <strong>${data.my_plays} écoute${data.my_plays !== 1 ? 's' : ''}</strong>
                    </div>`;
            }

            if (!data.leaderboard.length) {
                listEl.innerHTML = '<div class="no-songs">Aucune écoute enregistrée pour le moment.</div>';
                return;
            }

            listEl.innerHTML = data.leaderboard.map((u, i) => {
                const isMe    = u.id === myId;
                const rankNum = i + 1;
                const rankTxt = rankNum <= 3 ? medals[i] : rankNum;
                const cls     = rankNum <= 3 ? rankClass[i] : '';
                const avatarHtml = u.avatar
                    ? `<img src="/api/avatar/${u.avatar}" alt="avatar">`
                    : '👤';
                return `<div class="leaderboard-item ${isMe ? 'me' : ''}">
                    <div class="lb-rank ${cls}">${rankTxt}</div>
                    <div class="lb-avatar">${avatarHtml}</div>
                    <div class="lb-info">
                        <div class="lb-name">${this.esc(u.username)}${isMe ? ' <span style="color:var(--violet-light);font-size:11px;">(toi)</span>' : ''}</div>
                        <div class="lb-sub">${u.unique_songs} morceau${u.unique_songs !== 1 ? 'x' : ''} différent${u.unique_songs !== 1 ? 's' : ''}</div>
                    </div>
                    <div class="lb-plays">${u.total_plays} écoute${u.total_plays !== 1 ? 's' : ''}</div>
                </div>`;
            }).join('');
        } catch(e) { listEl.innerHTML = '<div class="no-songs">❌ Erreur chargement classement</div>'; }
    }

    rankLabel(rank) {
        if (rank === 1) return '🥇 N°1';
        if (rank === 2) return '🥈 2ème';
        if (rank === 3) return '🥉 3ème';
        return `${rank}ème`;
    }

    // ── PROFIL ────────────────────────────────────────────
    async loadProfile() {
        try {
            const p = await (await fetch('/api/profile')).json();

            this.setText('profile-username', p.username);
            this.setText('profile-email',    p.email);
            this.setText('profile-joined',   '🗓 Membre depuis le ' + new Date(p.created_at).toLocaleDateString('fr-FR', { year:'numeric', month:'long', day:'numeric' }));
            this.setText('profile-bio-text', p.bio || 'Pas encore de bio.');

            // Avatar
            const img  = this.$('profile-avatar-img');
            const ph   = this.$('profile-avatar-placeholder');
            if (p.avatar && img) {
                img.src = `/api/avatar/${p.avatar}`;
                img.style.display = 'block';
                if (ph) ph.style.display = 'none';
            } else if (img) {
                img.style.display = 'none';
                if (ph) ph.style.display = 'flex';
            }

            // Stats
            const s = p.stats;
            this.setText('stat-plays',     s.total_plays.toLocaleString('fr-FR'));
            this.setText('stat-favs',      s.total_favs.toLocaleString('fr-FR'));
            this.setText('stat-playlists', s.total_playlists.toLocaleString('fr-FR'));
            this.setText('stat-time',      this.formatListenTime(s.total_time));
            this.setText('stat-top-artist',     s.top_artist);
            this.setText('stat-top-song',       s.top_song);
            this.setText('stat-top-song-artist', s.top_song_artist ? '— ' + s.top_song_artist : '');

            // Bio édition
            this.$('profile-bio-edit-btn')?.addEventListener('click', () => this.openBioEditor(p.bio));
            this.$('profile-bio-cancel')?.addEventListener('click',   () => this.closeBioEditor());
            this.$('profile-bio-save')?.addEventListener('click',     () => this.saveBio());

            // Avatar upload
            this.$('avatar-input')?.addEventListener('change', e => this.uploadAvatar(e.target.files[0]));

        } catch(e) { console.error('Erreur profil:', e); }
    }

    openBioEditor(currentBio) {
        const editor = this.$('profile-bio-editor');
        const input  = this.$('profile-bio-input');
        const wrap   = this.$('profile-bio-wrap');
        if (input)  input.value = currentBio || '';
        if (editor) editor.style.display = 'flex';
        if (wrap)   wrap.style.display   = 'none';
        input?.focus();
    }

    closeBioEditor() {
        const editor = this.$('profile-bio-editor');
        const wrap   = this.$('profile-bio-wrap');
        if (editor) editor.style.display = 'none';
        if (wrap)   wrap.style.display   = 'flex';
    }

    async saveBio() {
        const input = this.$('profile-bio-input');
        const bio   = (input?.value || '').trim();
        try {
            const res  = await fetch('/api/profile', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ bio })
            });
            const data = await res.json();
            if (data.success) {
                this.setText('profile-bio-text', bio || 'Pas encore de bio.');
                this.closeBioEditor();
                this.notify('✅ Bio mise à jour', 'success');
            } else { this.notify('❌ Erreur', 'error'); }
        } catch { this.notify('❌ Erreur serveur', 'error'); }
    }

    async uploadAvatar(file) {
        if (!file) return;
        const formData = new FormData();
        formData.append('avatar', file);
        try {
            const res  = await fetch('/api/profile/avatar', { method: 'POST', body: formData });
            const data = await res.json();
            if (data.success) {
                const img = this.$('profile-avatar-img');
                const ph  = this.$('profile-avatar-placeholder');
                if (img) { img.src = `/api/avatar/${data.avatar}`; img.style.display = 'block'; }
                if (ph)  ph.style.display = 'none';
                this.notify('✅ Avatar mis à jour !', 'success');
            } else { this.notify('❌ ' + (data.error || 'Erreur'), 'error'); }
        } catch { this.notify('❌ Erreur serveur', 'error'); }
    }

    formatListenTime(seconds) {
        if (!seconds) return '0 min';
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        if (h >= 1) return `${h}h${m > 0 ? m + 'm' : ''}`;
        return `${m} min`;
    }

    // ── SHUFFLE & REPEAT ──────────────────────────────────
    toggleShuffle() {
        this.shuffleMode = !this.shuffleMode;
        const btn = this.$('shuffle-btn');
        if (btn) btn.classList.toggle('active', this.shuffleMode);
        this.notify(this.shuffleMode ? '🔀 Aléatoire activé' : '🔀 Aléatoire désactivé', 'info');
    }

    cycleRepeat() {
        const modes = ['none', 'all', 'one'];
        const next  = modes[(modes.indexOf(this.repeatMode) + 1) % 3];
        this.repeatMode = next;
        const btn = this.$('repeat-btn');
        if (btn) {
            btn.classList.toggle('active', next !== 'none');
            btn.textContent = next === 'one' ? '🔂' : '🔁';
        }
        const labels = { none: '🔁 Répétition désactivée', all: '🔁 Répétition : tout', one: '🔂 Répétition : 1 morceau' };
        this.notify(labels[next], 'info');
    }

    // ── PANNEAUX ──────────────────────────────────────────
    togglePanel(name) {
        const panel   = document.getElementById(name + '-panel');
        const overlay = this.$('panel-overlay');
        const isOpen  = panel?.classList.contains('open');
        document.querySelectorAll('.side-panel').forEach(p => p.classList.remove('open'));
        if (!isOpen) {
            panel?.classList.add('open');
            overlay?.classList.add('active');
            if (name === 'lyrics' && this.currentIndex >= 0) {
                this.fetchLyrics(this.playlist[this.currentIndex]);
            }
            if (name === 'queue') this.renderQueue();
        } else {
            overlay?.classList.remove('active');
        }
    }

    // ── QUEUE ─────────────────────────────────────────────
    renderQueue() {
        const el = this.$('queue-content');
        if (!el) return;
        if (!this.playlist.length) { el.innerHTML = '<p style="padding:20px;color:var(--text-muted);font-size:13px;">La bibliothèque est vide.</p>'; return; }
        el.innerHTML = this.playlist.map((s, i) => {
            const isCurrent = i === this.currentIndex;
            return `<div class="queue-item ${isCurrent ? 'queue-playing' : ''}" onclick="window.player.playSong(${s.id})">
                <div class="queue-idx">${isCurrent ? '▶' : i + 1}</div>
                <div class="queue-info">
                    <div class="queue-title">${this.esc(s.title)}</div>
                    <div class="queue-artist">${this.esc(s.artist)}</div>
                </div>
                <div class="queue-dur">${this.formatTime(s.duration)}</div>
            </div>`;
        }).join('');
        // Scroll vers la musique en cours
        const current = el.querySelector('.queue-playing');
        if (current) current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    // ── PAROLES ───────────────────────────────────────────
    async fetchLyrics(song) {
        const el = this.$('lyrics-content');
        if (!el) return;

        // Cache
        if (this.lyricsCache[song.id]) {
            el.innerHTML = `<pre class="lyrics-text">${this.esc(this.lyricsCache[song.id])}</pre>`;
            return;
        }

        el.innerHTML = '<div class="lyrics-loading"><div class="lyrics-spinner"></div><span>Recherche des paroles…</span></div>';

        try {
            const artist = encodeURIComponent(song.artist.replace(/['"]/g,''));
            const title  = encodeURIComponent(song.title.replace(/['"]/g,''));
            const res    = await fetch(`https://api.lyrics.ovh/v1/${artist}/${title}`);
            if (!res.ok) throw new Error('not found');
            const data   = await res.json();
            if (!data.lyrics) throw new Error('empty');
            this.lyricsCache[song.id] = data.lyrics;
            el.innerHTML = `<pre class="lyrics-text">${this.esc(data.lyrics)}</pre>`;
        } catch {
            el.innerHTML = `<p class="lyrics-error">😕 Paroles introuvables pour<br><strong>${this.esc(song.title)}</strong></p>`;
        }
    }

    // ── VISUALISEUR AUDIO ─────────────────────────────────
    initVisualizer() {
        const canvas = document.getElementById('visualizer');
        if (!canvas) return;

        // Créer le contexte audio une seule fois
        if (!this.audioCtx) {
            try {
                this.audioCtx  = new (window.AudioContext || window.webkitAudioContext)();
                this.analyser  = this.audioCtx.createAnalyser();
                const source   = this.audioCtx.createMediaElementSource(this.audio);
                source.connect(this.analyser);
                this.analyser.connect(this.audioCtx.destination);
                this.analyser.fftSize = 128;
            } catch(e) { console.warn('Visualiseur non disponible:', e); return; }
        }

        if (this.audioCtx.state === 'suspended') this.audioCtx.resume();
        if (this.animFrame) cancelAnimationFrame(this.animFrame);
        this.drawVisualizer(canvas);
    }

    drawVisualizer(canvas) {
        if (!this.analyser) return;
        const ctx    = canvas.getContext('2d');
        const buf    = new Uint8Array(this.analyser.frequencyBinCount);

        const draw = () => {
            this.animFrame = requestAnimationFrame(draw);
            canvas.width  = canvas.offsetWidth;
            canvas.height = canvas.offsetHeight;
            this.analyser.getByteFrequencyData(buf);

            ctx.clearRect(0, 0, canvas.width, canvas.height);
            const barW = canvas.width / buf.length;
            buf.forEach((val, i) => {
                const h   = (val / 255) * canvas.height;
                const hue = 260 + (i / buf.length) * 80; // violet → rose
                ctx.fillStyle = `hsla(${hue}, 80%, 65%, 0.7)`;
                ctx.fillRect(i * barW, canvas.height - h, barW - 1, h);
            });
        };
        draw();
    }

    // ── COULEUR DYNAMIQUE ─────────────────────────────────
    applyDynamicColor(idx) {
        const player = document.querySelector('.audio-player');
        if (!player) return;
        // Teintes basées sur l'index — violet à rose/bleu
        const hues   = [260, 280, 240, 300, 220, 270, 250, 290];
        const hue    = hues[idx % hues.length];
        player.style.background = `linear-gradient(90deg, hsla(${hue},60%,8%,0.97) 0%, rgba(9,8,13,0.97) 60%)`;
    }

    // ── THÈME ─────────────────────────────────────────────
    initTheme() {
        const saved = localStorage.getItem('pulse-theme') || 'dark';
        document.documentElement.setAttribute('data-theme', saved);
        const btn = this.$('theme-toggle');
        if (btn) btn.textContent = saved === 'dark' ? '🌙' : '☀️';
    }

    toggleTheme() {
        const html    = document.documentElement;
        const current = html.getAttribute('data-theme');
        const next    = current === 'dark' ? 'light' : 'dark';
        html.setAttribute('data-theme', next);
        localStorage.setItem('pulse-theme', next);
        const btn = this.$('theme-toggle');
        if (btn) btn.textContent = next === 'dark' ? '🌙' : '☀️';
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
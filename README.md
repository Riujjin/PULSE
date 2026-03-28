# 🚀 PULSE - Lecteur Audio Web

## 📝 Description

**PULSE** est une application web de lecteur audio développée dans le cadre des Trophées NSI. L'objectif est de créer un lecteur musical fonctionnel dans l'esprit de Spotify, mais en version application bureau, avec une identité visuelle futuriste violet/noir.

**Pourquoi ce projet ?**  
Nous sommes tous les deux passionnés de musique et de développement. Nous voulions créer un outil élégant et fonctionnel qui permette d'écouter sa musique locale sans publicité, sans tracking, et avec une expérience utilisateur soignée.

**Originalité :**  
- Interface **application bureau** (pas un simple site web)
- Design **futuriste violet/noir** avec effets de glow
- Glisser-déposer de fichiers
- Raccourcis clavier (espace = play/pause)
- Sauvegarde automatique des playlists

---

## 👥 L'Équipe

- **Lavorata Swann** (@Swann.lvt) : **Responsable Interface & Design**  
  Conception HTML/CSS, design application bureau, responsive PC, tests d'ergonomie

- **Aubert Enzo** (@Enzoxx07) : **Responsable Logique & Fonctionnalités**  
  JavaScript et API audio, gestion upload/lecture, contrôles clavier/souris, sauvegarde LocalStorage

*Classe : TG4 / TG3*

---

## 🛠️ Aspects Techniques (Spécificités NSI)

Cette section détaille les concepts du programme de NSI mobilisés dans PULSE :

### 🐍 **Python / Flask**
- **Backend complet** en Python avec le micro-framework Flask
- **Gestion des fichiers audio** : analyse des métadonnées ID3 (MP3)
- **API REST** : endpoints pour la bibliothèque et la lecture
- **Programmation Orientée Objet** : classe `AudioLibrary` pour gérer la collection

### 🌐 **Frontend (HTML/CSS/JS)**
- **Manipulation du DOM** : affichage dynamique de la bibliothèque
- **Événements** : gestion des clics, du glisser-déposer, des raccourcis clavier
- **Web Audio API** : contrôle précis de la lecture
- **LocalStorage** : sauvegarde persistante des playlists

### 📊 **Structures de données utilisées**
- **Dictionnaires** : métadonnées des morceaux (titre, artiste, durée, chemin)
- **Listes** : playlist en cours, bibliothèque de morceaux
- **Objets JSON** : sérialisation pour la sauvegarde locale

### 🔧 **Algorithmes et concepts**
- **Parcours de fichiers** : scan récursif du dossier audio
- **Filtrage** : recherche par titre/artiste
- **Gestion d'état** : lecteur (play/pause/volume/progression)
- **Programmation événementielle** : réactivité de l'interface

---

## 🚀 Installation et Utilisation

### Prérequis
- Python 3.8 ou supérieur
- Navigateur moderne (Chrome, Edge, Firefox)

### Installation

1. **Cloner le dépôt**
```bash
git clone https://github.com/votre-repo/pulse.git
cd pulse

2. **Afficher tout les modules a installer**
```bash

# N9chat Pro

Application de chat IA statique, installable comme PWA.

## Ouvrir l’application

Après le déploiement GitHub Pages : https://ghostbada-hub.github.io/N9chatpro/

## Configuration IA

1. Ouvrez l’application puis **Profil → Connexion IA (Groq)**.
2. Saisissez votre propre clé API Groq et enregistrez-la.
3. La clé est conservée dans la session du navigateur et envoyée directement à l’API Groq. Elle n’est pas incluse dans le dépôt.

L’application utilise l’API Groq pour le chat, la vision et la transcription audio. Les réponses IA nécessitent une connexion Internet.

## Sécurité

Une clé Groq avait été intégrée dans une ancienne version publique du code. Révoquez-la et créez-en une nouvelle dans votre compte Groq, même si elle a été retirée des fichiers actuels : l’historique Git peut encore contenir l’ancienne valeur.

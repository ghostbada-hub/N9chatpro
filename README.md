# N9chat Pro

Une application de chat IA légère, sans framework ni bibliothèque externe côté navigateur. L’interface charge un seul document, redimensionne les images avant l’envoi et affiche les réponses en continu.

## Application

La version rapide est dans `n9chat-pro-v5/`. Le site GitHub Pages sera accessible à https://ghostbada-hub.github.io/N9chatpro/ lorsque Pages sera activé dans les réglages du dépôt.

## Configuration IA

Ouvrez **Paramètres** dans l’application, collez votre clé API Groq puis enregistrez-la. La clé reste dans la session du navigateur et est envoyée directement à Groq pour les requêtes. Le chat utilise `qwen/qwen3.8-27b`; l’analyse d’image utilise `meta-llama/llama-4-scout-17b-16e-instruct`.

Les conversations sont conservées dans le stockage local de cet appareil. Les réponses IA demandent une connexion Internet. Les images sont réduites côté navigateur avant leur envoi.

## Sécurité importante

Une ancienne clé Groq a été publiée dans une version précédente du code. Elle peut rester visible dans l’historique Git : révoquez-la dans Groq et remplacez-la par une nouvelle clé.

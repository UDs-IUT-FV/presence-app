# Présence par QR code – IUT Fotso Victor de Bandjoun

Ce dépôt **public** contient uniquement les pages du système, aucune donnée nominative :

| Page | Adresse | Usage |
|---|---|---|
| Application de scan | `https://uds-iut-fv.github.io/presence-app/` | Délégués : scan des cartes des étudiants et des enseignants |
| Administration | `…/presence-app/admin.html` | Département ou direction : création des dépôts, import des listes, diffusion des mises à jour |
| Statistiques | `…/presence-app/statistiques.html` | Chefs de département, direction : taux de présence, étudiants à suivre, exports Excel |

Les données de chaque filière sont dans un dépôt **privé** distinct (`presence-<filière>`, et `presence-donnees` pour DUT GC1). La liste des départements et des filières est dans `filieres.json`.

## Les trois sortes de jetons

Tous se créent dans *Settings → Developer settings → Personal access tokens → Fine-grained tokens*, connecté au compte de l'IUT.

| Jeton | Accès aux dépôts | Permissions |
|---|---|---|
| Administration (une seule personne) | All repositories | Administration, Contents et Workflows : *Read and write* |
| Délégué ou adjoint | Only select repositories : le ou les dépôts de ses filières | Contents : *Read and write* |
| Statistiques (chef de département, direction) | Only select repositories : les dépôts du département (ou All repositories pour la direction) | Contents : *Read-only* |

Un jeton de délégué ne peut ni lire ni écrire dans les dépôts qui ne lui ont pas été attribués : l'application ne lui montre que ses filières.

## Mettre en service une nouvelle filière

1. Ouvrir la page d'administration et se connecter avec le jeton d'administration.
2. Choisir le département, puis cliquer sur **Créer le dépôt** (ou **Créer les dépôts manquants du département**).
3. Cliquer sur **Importer la liste…** et choisir le fichier Excel de la filière. Toutes les feuilles sont lues ; une colonne « Noms et prénoms » (ou « Nom » et « Prénom ») suffit. Colonnes facultatives : Matricule, Sexe, Groupe (TD), Groupe TP, Statut.
4. Deux à trois minutes plus tard, les cartes sont dans le dépôt de la filière, dossier `classes/<filière>/` : `Cartes_QR_<filière>.pdf` (étudiants) et `Cartes_QR_<filière>_reserve.pdf` (20 cartes vierges numérotées à partir de 901).
5. Créer le jeton du délégué en ne cochant que le dépôt de sa filière.

Pour ajouter des étudiants plus tard, importer à nouveau la liste complète : les étudiants déjà enregistrés gardent leur identifiant, donc leur carte.

## Fréquence des mises à jour

La fiche hebdomadaire et les statistiques sont régénérées chaque soir à 19 h. Pour une mise à jour immédiate : dépôt de la filière → onglet **Actions** → **Fiche de présence hebdomadaire** → **Run workflow**. Ce rythme quotidien permet de rester dans le quota gratuit de GitHub Actions (2 000 minutes par mois pour l'ensemble des dépôts privés du compte).

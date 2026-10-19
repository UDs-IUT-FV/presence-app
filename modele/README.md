# Présence par QR code – dépôt d'une filière

Dépôt **privé** créé par la page d'administration du système de présence de l'IUT Fotso Victor. Il contient des données nominatives : il ne doit jamais être rendu public.

| Dossier ou fichier | Rôle |
|---|---|
| `classes/<FILIÈRE>/etudiants.csv` | Liste des étudiants : `id`, `matricule`, `noms_prenoms`, `sexe`, `liste`, `statut`, `groupe_td`, `groupe_tp` |
| `classes/<FILIÈRE>/classe.json` | Informations d'en-tête de la fiche (filière, niveau, semestre, salle principale, responsable, département) |
| `classes/<FILIÈRE>/Cartes_QR_*.pdf` | Cartes des étudiants et cartes de réserve, générées automatiquement après chaque import de liste |
| `enseignants/enseignants.csv`, `salles.csv` | Copies des listes communes, diffusées depuis la page d'administration |
| `scans/` | Un fichier par séance, envoyé par l'application de scan |
| `fiches/` | Fiche de présence hebdomadaire (Word), régénérée à chaque envoi |
| `stats/` | Données consolidées lues par le tableau de bord statistique |

À compléter une fois dans `classe.json` : `semestre` et `responsable` (bouton crayon sur GitHub).

Ne modifiez jamais la colonne `id` de `etudiants.csv` : c'est elle que contient le QR code de chaque carte.

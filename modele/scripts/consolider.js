#!/usr/bin/env node
/*
 * Consolide tous les scans d'une ou plusieurs classes en un fichier par classe,
 * lu par le tableau de bord statistique : stats/<CLASSE>/seances.csv
 *
 *   node scripts/consolider.js            toutes les classes du dépôt
 *
 * Une ligne par séance (date, créneau, nature, groupe) avec les listes d'identifiants :
 *   presents : étudiants attendus et présents
 *   absents  : étudiants attendus et absents
 *   hors     : étudiants présents sans être attendus (autre groupe, TP sans répartition)
 * Règles identiques à celles de la fiche hebdomadaire (generer_fiche.js).
 */
const fs = require("fs");
const path = require("path");
const RACINE = path.resolve(__dirname, "..");

function lireCsv(fichier) {
  const texte = fs.readFileSync(fichier, "utf8").replace(/^﻿/, "");
  const lignes = []; let champ = "", ligne = [], guillemets = false;
  for (let i = 0; i < texte.length; i++) {
    const c = texte[i];
    if (guillemets) {
      if (c === '"' && texte[i + 1] === '"') { champ += '"'; i++; } else if (c === '"') guillemets = false; else champ += c;
    } else if (c === '"') guillemets = true;
    else if (c === ",") { ligne.push(champ); champ = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && texte[i + 1] === "\n") i++;
      ligne.push(champ); champ = ""; if (ligne.some((x) => x !== "")) lignes.push(ligne); ligne = [];
    } else champ += c;
  }
  ligne.push(champ); if (ligne.some((x) => x !== "")) lignes.push(ligne);
  if (!lignes.length) return [];
  const entetes = lignes.shift().map((h) => h.trim());
  return lignes.map((l) => Object.fromEntries(entetes.map((h, i) => [h, (l[i] || "").trim()])));
}
const csvChamp = (v) => { v = String(v == null ? "" : v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };

const statutDe = (e) => {
  const v = (e.statut || "").trim().toLowerCase().replace(/[()]/g, "");
  if (v === "non-inscrit") return "non-inscrit";
  return v.startsWith("cr") || v.startsWith("cré") || v === "c" ? "creditaire" : v.startsWith("r") ? "redoublant" : "";
};
const groupeDe = (e, nature) => ((nature === "TD" ? e.groupe_td : nature === "TP" ? e.groupe_tp : "") || "").trim().toUpperCase();
const attendu = (s, e) => s.nature === "CM" || (!!s.groupe && groupeDe(e, s.nature) === s.groupe);

function consolider(classe) {
  const dossierClasse = path.join(RACINE, "classes", classe);
  const etudiants = lireCsv(path.join(dossierClasse, "etudiants.csv")).filter((e) => e.id);
  const fProfs = path.join(RACINE, "enseignants", "enseignants.csv");
  const profs = new Map((fs.existsSync(fProfs) ? lireCsv(fProfs) : []).filter((e) => e.id).map((e) => [e.id.toUpperCase(), e.noms_prenoms]));
  const dossierScans = path.join(RACINE, "scans", classe);
  const seances = new Map();
  if (fs.existsSync(dossierScans)) {
    for (const date of fs.readdirSync(dossierScans).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort()) {
      const dossier = path.join(dossierScans, date);
      for (const f of fs.readdirSync(dossier).filter((x) => x.toLowerCase().endsWith(".csv")).sort()) {
        const m = /^C([1-5])_(?:(CM|TD|TP)(?:-([A-Za-z0-9]+))?_)?/.exec(f);
        if (!m) continue;
        const lignes = lireCsv(path.join(dossier, f));
        const l0 = lignes[0] || {};
        const nature = (l0.nature || m[2] || "CM").toUpperCase();
        const groupe = nature === "CM" ? "" : ((l0.nature ? l0.groupe : m[3]) || "").toUpperCase();
        const cle = [date, m[1], nature, groupe].join("|");
        let s = seances.get(cle);
        if (!s) { s = { date, creneau: m[1], nature, groupe, ue: "", salle: "", scannes: new Set(), enseignants: new Map() }; seances.set(cle, s); }
        for (const l of lignes) {
          const id = (l.id || "").toUpperCase();
          if (!id) continue;
          if (l.mode === "enseignant") { if (!s.enseignants.has(id)) s.enseignants.set(id, l.heure || ""); }
          else s.scannes.add(id);
          if (!s.ue && l.ue) s.ue = l.ue;
          if (!s.salle && l.salle) s.salle = l.salle;
        }
      }
    }
  }
  const entete = "date,creneau,nature,groupe,ue,salle,enseignants_id,enseignants,emarge_qr,nb_attendus,nb_presents,nb_absents,nb_hors,presents,absents,hors";
  const sortie = [entete];
  for (const s of [...seances.values()].sort((a, b) => (a.date + a.creneau + a.nature + a.groupe).localeCompare(b.date + b.creneau + b.nature + b.groupe))) {
    const presents = [], absents = [], hors = [];
    const connus = new Set();
    for (const e of etudiants) {
      const id = e.id.toUpperCase(); connus.add(id);
      const scanne = s.scannes.has(id);
      if (attendu(s, e)) (scanne ? presents : absents).push(id);
      else if (scanne) hors.push(id);
    }
    for (const id of s.scannes) if (!connus.has(id)) hors.push(id); // cartes pas encore saisies dans la liste
    const ensIds = [...s.enseignants.keys()];
    sortie.push([s.date, s.creneau, s.nature, s.groupe, s.ue, s.salle, ensIds.join(" "), ensIds.map((i) => profs.get(i) || i).join(" ; "),
      ensIds.length ? 1 : 0, presents.length + absents.length, presents.length, absents.length, hors.length,
      presents.join(" "), absents.join(" "), hors.join(" ")].map(csvChamp).join(","));
  }
  const dossierSortie = path.join(RACINE, "stats", classe);
  fs.mkdirSync(dossierSortie, { recursive: true });
  fs.writeFileSync(path.join(dossierSortie, "seances.csv"), sortie.join("\n") + "\n");
  console.log(classe + " : " + seances.size + " séance(s) consolidée(s) -> stats/" + classe + "/seances.csv");
}

const dossierClasses = path.join(RACINE, "classes");
for (const classe of fs.readdirSync(dossierClasses).filter((d) => fs.existsSync(path.join(dossierClasses, d, "etudiants.csv")))) consolider(classe);

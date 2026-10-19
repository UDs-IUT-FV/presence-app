#!/usr/bin/env node
/*
 * Génère la fiche de présence hebdomadaire (Word, A4 paysage) d'une classe à partir des scans.
 *
 *   node scripts/generer_fiche.js                         toutes les classes, semaine en cours
 *   node scripts/generer_fiche.js --classe DUT-GC1        une seule classe
 *   node scripts/generer_fiche.js --semaine 2026-10-12    semaine contenant cette date
 *   node scripts/generer_fiche.js --decalage -1           semaine précédente
 *
 * Règle : un créneau est considéré comme tenu dès qu'un fichier de scan existe pour lui.
 * Pour un créneau tenu, l'étudiant scanné reçoit P, les autres A. Les créneaux sans scan restent vides.
 * Colonne « statut » de etudiants.csv : (R) redoublant, (Cr) créditaire, (N) nouveau ou régulier. Tous sont comptés
 * normalement ; seul le libellé change sur la fiche.
 * (ne suit qu'une partie des cours : P s'il est scanné, case vide sinon, aucune absence décomptée).
 * Une carte scannée qui ne figure pas encore dans la liste apparaît en fin de tableau, sans nom.
 * La carte d'un enseignant (enseignants/enseignants.csv) scannée pendant la séance vaut émargement.
 * Séances de groupe : chaque séance porte une nature (CM, TD, TP) et un groupe. En CM, toute la classe
 * est attendue ; en TD (colonne groupe_td) ou en TP (colonne groupe_tp), seuls les étudiants du groupe.
 * Un étudiant non attendu (autre groupe, TP sans répartition) a une case vide s'il n'est pas scanné.
 * Plusieurs séances peuvent avoir lieu sur le même créneau (TD groupe A et TD groupe B, par exemple).
 * La colonne DIMANCHE n'apparaît que si des scans existent pour le dimanche de la semaine.
 * Dépendance : npm install docx
 */
const fs = require("fs");
const path = require("path");
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType,
  AlignmentType, BorderStyle, PageOrientation, ShadingType, HeightRule, VerticalAlign,
  TabStopType, LeaderType, Footer, PageNumber, ImageRun,
} = require("docx");

const RACINE = path.resolve(__dirname, "..");
const TOUS_JOURS = ["LUNDI", "MARDI", "MERCREDI", "JEUDI", "VENDREDI", "SAMEDI", "DIMANCHE"];
let JOURS = TOUS_JOURS.slice(0, 6); // le dimanche n'est ajouté que les semaines où il a été pointé
const CRENEAUX = ["07h30 – 09h30", "09h40 – 11h40", "12h30 – 14h30", "14h40 – 16h40", "16h50 – 18h50"];

// ---------- Arguments ----------
const args = process.argv.slice(2);
const arg = (nom) => { const i = args.indexOf("--" + nom); return i >= 0 ? args[i + 1] : undefined; };
const iso = (d) => d.toISOString().slice(0, 10);
function lundiDe(dateIso, decalage) {
  const d = new Date(dateIso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + 7 * decalage);
  return d;
}
const aujourdHui = iso(new Date(Date.now() + 3600 * 1000)); // heure du Cameroun (UTC+1)
const lundi = lundiDe(arg("semaine") || aujourdHui, parseInt(arg("decalage") || "0", 10));
const dates = TOUS_JOURS.map((_, i) => { const d = new Date(lundi); d.setUTCDate(d.getUTCDate() + i); return iso(d); });
const fr = (d) => d.slice(8, 10) + "/" + d.slice(5, 7) + "/" + d.slice(0, 4);

// ---------- Lecture des données ----------
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

const ORDRE_NATURE = { CM: 0, TD: 1, TP: 2 };
function chargerSemaine(classe) {
  // seances[jour][creneau] = [{ nature, groupe, presents:Set, horsGroupe:Set, ue, salle, enseignants }]
  const seances = dates.map(() => ({}));
  dates.forEach((date, j) => {
    const dossier = path.join(RACINE, "scans", classe, date);
    if (!fs.existsSync(dossier)) return;
    for (const f of fs.readdirSync(dossier).filter((x) => x.toLowerCase().endsWith(".csv")).sort()) {
      const m = /^C([1-5])_(?:(CM|TD|TP)(?:-([A-Za-z0-9]+))?_)?/.exec(f);
      if (!m) continue;
      const lignesCsv = lireCsv(path.join(dossier, f));
      const l0 = lignesCsv[0] || {};
      const nature = ((l0.nature || m[2] || "CM").toUpperCase());
      const groupe = nature === "CM" ? "" : ((l0.groupe != null && l0.nature ? l0.groupe : m[3]) || "").toUpperCase();
      const liste = (seances[j][m[1]] = seances[j][m[1]] || []);
      let s = liste.find((x) => x.nature === nature && x.groupe === groupe);
      if (!s) { s = { nature, groupe, presents: new Set(), horsGroupe: new Set(), ue: "", salle: "", enseignants: [] }; liste.push(s); }
      liste.sort((a, b) => (ORDRE_NATURE[a.nature] - ORDRE_NATURE[b.nature]) || a.groupe.localeCompare(b.groupe));
      for (const l of lignesCsv) {
        const id = (l.id || "").toUpperCase();
        if (l.mode === "enseignant") { if (id && !s.enseignants.some((x) => x.id === id)) s.enseignants.push({ id, heure: l.heure || "" }); }
        else if (id) { s.presents.add(id); if (l.mode === "hors-groupe") s.horsGroupe.add(id); }
        if (!s.ue && l.ue) s.ue = l.ue;
        if (!s.salle && l.salle) s.salle = l.salle;
      }
    }
  });
  return seances;
}

// ---------- Mise en page ----------
const W = 15478, FONT = "Arial", GRIS = "E7E6E6";
const t = (text, o = {}) => new TextRun({ text, font: FONT, size: 18, ...o });
const p = (children, o = {}) => new Paragraph({ children: Array.isArray(children) ? children : [children], spacing: { before: 0, after: 0 }, ...o });
const thin = { style: BorderStyle.SINGLE, size: 4, color: "000000" };
const thick = { style: BorderStyle.SINGLE, size: 12, color: "000000" };
const none = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const allThin = { top: thin, bottom: thin, left: thin, right: thin };
const allNone = { top: none, bottom: none, left: none, right: none };
function cell(content, width, o = {}) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    borders: o.borders || allThin,
    verticalAlign: o.vAlign || VerticalAlign.CENTER,
    columnSpan: o.span,
    verticalMerge: o.vMerge,
    shading: o.fill ? { type: ShadingType.CLEAR, color: "auto", fill: o.fill } : undefined,
    margins: o.margins || { top: 30, bottom: 30, left: 60, right: 60 },
    children: Array.isArray(content) ? content : [content],
  });
}
const center = (txt, o = {}) => p(t(txt, o), { alignment: AlignmentType.CENTER });
const dot = (pos) => ({ type: TabStopType.LEFT, position: pos, leader: LeaderType.DOT });

// Nom du département : classe.json (departement_nom), Génie Civil par défaut pour les anciens dépôts
const nomDep = (infos) => infos.departement_nom || "Département de Génie Civil";
const nomDepEn = (infos) => infos.departement_nom != null ? (infos.departement_nom_en || "") : "Department of Civil Engineering";
const statutDe = (e) => {
  const v = (e.statut || "").trim().toLowerCase().replace(/[()]/g, "");
  if (v === "non-inscrit") return "non-inscrit";
  return v.startsWith("cr") || v.startsWith("cré") || v === "c" ? "creditaire" : v.startsWith("r") ? "redoublant" : "";
};
const horsDecompte = (e) => statutDe(e) === "non-inscrit"; // carte pas encore saisie dans la liste : absences non décomptées

const groupeDe = (e, nature) => ((nature === "TD" ? e.groupe_td : nature === "TP" ? e.groupe_tp : "") || "").trim().toUpperCase();
// L'étudiant est-il attendu à cette séance ?
function attendu(s, e) {
  if (s.nature === "CM") return true;
  return !!s.groupe && groupeDe(e, s.nature) === s.groupe;
}
const libelle = (s) => s.nature === "CM" ? "CM · classe entière" : s.nature + (s.groupe ? " · groupe " + s.groupe : " · sans répartition");

function construire(classe, infos, etudiants, seances, profs) {
  const inscrits = etudiants.filter((e) => statutDe(e) !== "non-inscrit");
  const attendusDe = (s) => etudiants.filter((e) => !horsDecompte(e) && attendu(s, e));
  const presentsDe = (s) => attendusDe(s).filter((e) => s.presents.has(e.id.toUpperCase())).length;
  const absentsDe = (s) => attendusDe(s).length - presentsDe(s);
  const horsDe = (s) => etudiants.filter((e) => s.presents.has(e.id.toUpperCase()) && !attendu(s, e)).length;
  // En-tête
  const hl = (text, o = {}) => p(t(text, { size: 13, ...o }), { alignment: AlignmentType.CENTER });
  const hW = [6200, 3078, 6200];
  const cheminLogo = path.join(__dirname, "logo.png");
  const logo = fs.existsSync(cheminLogo)
    ? p(new ImageRun({ type: "png", data: fs.readFileSync(cheminLogo), transformation: { width: 59, height: 80 } }), { alignment: AlignmentType.CENTER })
    : p(t(""));
  const entete = new Table({
    width: { size: W, type: WidthType.DXA }, columnWidths: hW,
    rows: [new TableRow({ children: [
      cell([
        hl("RÉPUBLIQUE DU CAMEROUN", { bold: true }), hl("REPUBLIC OF CAMEROON"),
        hl("Peace – Work – Fatherland", { italics: true, size: 11 }),
        hl("UNIVERSITÉ DE DSCHANG", { bold: true, size: 15 }), hl("UNIVERSITY OF DSCHANG", { size: 15 }),
        hl("Scholae Thesaurus Dschangensis Ibi Cordum", { italics: true, size: 11 }),
        hl("BP 96, Dschang (Cameroun) – Tél./Fax (237) 233 45 13 81", { size: 11 }),
        hl("Website : http://www.univ-dschang.org – E-mail : udsrectorat@univ-dschang.org", { size: 11 }),
      ], hW[0], { borders: allNone }),
      cell(logo, hW[1], { borders: allNone }),
      cell([
        hl("INSTITUT UNIVERSITAIRE DE TECHNOLOGIE", { bold: true }), hl("FOTSO VICTOR DE BANDJOUN", { bold: true }),
        hl("FOTSO VICTOR UNIVERSITY INSTITUTE OF TECHNOLOGY"),
        hl(nomDep(infos), { bold: true, size: 17 }),
        ...(nomDepEn(infos) ? [hl(nomDepEn(infos), { italics: true, size: 15 })] : []),
        hl("BP 134, Bandjoun – Tél. (237) 697 922 938 / 666 585 422", { size: 11 }),
        hl("Website : http://www.univ-dschang.org/iutfv/", { size: 11 }),
      ], hW[2], { borders: allNone }),
    ] })],
  });
  const titre = p(t("FICHE DE PRÉSENCE HEBDOMADAIRE", { bold: true, size: 26 }), {
    alignment: AlignmentType.CENTER, spacing: { before: 100, after: 80 },
    border: { top: { style: BorderStyle.SINGLE, size: 8, color: "000000", space: 5 } },
  });

  // Identification : valeur connue en gras, sinon pointillés à remplir
  const identite = (paires, stops, o = {}) =>
    p(paires.flatMap(([label, val], i) => [
      t((i ? "  " : "") + label, { size: 18 }),
      ...(val ? [t(String(val), { size: 18, bold: true })] : []),
      t("\t", { size: 18 }),
    ]), { tabStops: stops.map((s, i) => (paires[i][1] ? { type: TabStopType.LEFT, position: s } : dot(s))), spacing: { before: 50, after: 50 }, ...o });
  const ident1 = identite([["Filière : ", infos.filiere], ["Niveau : ", infos.niveau], ["Semestre : ", infos.semestre], ["Année académique : ", infos.annee]], [5200, 8000, 10800, W]);
  const ident2 = identite([["Semaine du ", fr(dates[0])], ["au ", fr(dates[JOURS.length - 1])], ["Salle principale : ", infos.salle_principale], ["Responsable de niveau : ", infos.responsable]], [3000, 5200, 10000, W]);
  const sousTitre = (txt, o = {}) => p(t(txt, { bold: true, size: 19 }), { spacing: { before: 100, after: 60 }, ...o });

  // Tableau 1 : émargement des enseignants
  const sept = JOURS.length === 7;
  const wH = sept ? 950 : 1090, wJ = Math.floor((W - wH) / JOURS.length), tabIn = wJ - 150;
  const champ = (label, val) =>
    p([t(label, { size: 13 }), ...(val ? [t(String(val), { size: 13, bold: true })] : [t("\t", { size: 13 })])],
      { tabStops: [dot(tabIn)], spacing: { before: 0, after: 26 } });
  const nomsProfs = (s) => s.enseignants.map((x) => profs.get(x.id) || x.id).join(", ");
  const heuresQR = (s) => s.enseignants.map((x) => x.heure.slice(0, 5).replace(":", "h")).join(", ");
  const effectifs = (s) => {
    const hors = horsDe(s), libre = s.nature !== "CM" && !s.groupe;
    return [t("Prés. : ", { size: 13 }), t(String(libre ? s.presents.size : presentsDe(s)), { size: 13, bold: true }),
      ...(libre ? [t("  (pointage libre)", { size: 12, italics: true })]
        : [t("   Abs. : ", { size: 13 }), t(String(absentsDe(s)), { size: 13, bold: true })]),
      ...(hors && !libre ? [t("   +" + hors + " hors gr.", { size: 12, italics: true })] : [])];
  };
  const blocVide = () => [
    champ("UE : "), champ("Enseignant : "),
    p([t(sept ? "CM TD TP" : "CM   TD   TP", { size: 13 }), t(sept ? "  Prés. : " : "     Prés. : ", { size: 13 }), t("\t"), t(" Abs. : ", { size: 13 }), t("\t")],
      { tabStops: [dot(sept ? 1330 : 1620), dot(tabIn)], spacing: { before: 0, after: 26 } }),
    champ("Salle : "), p(t("Signature :", { size: 13 })),
  ];
  const blocUnique = (s) => [
    p([t(libelle(s), { size: 13, bold: true }), ...(s.ue ? [t(" – " + s.ue, { size: 13, bold: true })] : [])], { spacing: { before: 0, after: 26 } }),
    champ("Enseignant : ", nomsProfs(s)),
    p(effectifs(s), { spacing: { before: 0, after: 26 } }),
    champ("Salle : ", s.salle),
    p(s.enseignants.length ? t("Émargé par QR à " + heuresQR(s), { size: 13, bold: true }) : t("Signature :", { size: 13 })),
  ];
  // Plusieurs séances sur le même créneau : un bloc compact de trois lignes par séance
  const blocCompact = (s, i) => [
    p([t(libelle(s).replace(" · groupe ", " gr. "), { size: 12, bold: true }), ...(s.ue ? [t(" – " + s.ue, { size: 12, bold: true })] : []),
       ...(s.salle ? [t(" · " + s.salle, { size: 12 })] : [])],
      { spacing: { before: i ? 40 : 0, after: 10 }, border: i ? { top: { style: BorderStyle.DOTTED, size: 4, color: "808080", space: 2 } } : undefined }),
    p([t("Ens. : ", { size: 12 }), t(nomsProfs(s) || "…………………………", { size: 12, bold: !!s.enseignants.length })], { spacing: { before: 0, after: 10 } }),
    p([...effectifs(s).map((r) => r), t("   ", { size: 12 }),
       s.enseignants.length ? t("QR " + heuresQR(s), { size: 12, bold: true }) : t("Sign. :", { size: 12 })], { spacing: { before: 0, after: 0 } }),
  ];
  const caseSeance = (liste) =>
    cell(!liste || !liste.length ? blocVide() : liste.length === 1 ? blocUnique(liste[0]) : liste.flatMap(blocCompact),
      wJ, { vAlign: VerticalAlign.TOP, margins: { top: 45, bottom: 20, left: 60, right: 60 } });
  const t1 = new Table({
    width: { size: wH + wJ * JOURS.length, type: WidthType.DXA }, columnWidths: [wH, ...Array(JOURS.length).fill(wJ)],
    rows: [
      new TableRow({ height: { value: 280, rule: HeightRule.EXACT }, children: [
        cell(center("HORAIRES", { bold: true, size: 15 }), wH, { fill: GRIS }),
        ...JOURS.map((j, d) => cell(center(j + " " + dates[d].slice(8, 10) + "/" + dates[d].slice(5, 7), { bold: true, size: 15 }), wJ, { fill: GRIS })),
      ] }),
      ...CRENEAUX.map((h, i) => new TableRow({ height: { value: 1250, rule: HeightRule.ATLEAST }, children: [
        cell([center("Créneau " + (i + 1), { bold: true, size: 15 }), center(h, { size: 14 })], wH, { fill: GRIS }),
        ...JOURS.map((_, d) => caseSeance(seances[d][String(i + 1)])),
      ] })),
    ],
  });
  const note = p([
    t("Mode d'emploi : ", { bold: true, size: 14 }),
    t("le pointage (tableau 2) est établi à partir du scan des cartes QR par le délégué ou son adjoint. En CM, toute la classe est attendue ; en TD et en TP, seuls les étudiants du groupe concerné. Les effectifs (Prés./Abs.) sont calculés sur les étudiants attendus ; « hors gr. » compte les étudiants venus d'un autre groupe. L'enseignant émarge en présentant sa carte QR au début de la séance ; à défaut, il inscrit son nom et signe. Les cases des créneaux sans cours sont barrées.", { size: 14 }),
  ], { spacing: { before: 80, after: 100 }, alignment: AlignmentType.JUSTIFIED });
  const vW = [5159, 5160, 5159];
  const visa = (a, b, w) => cell([center(a, { bold: true, size: 17 }), center(b, { size: 13 })], w, { borders: allNone, vAlign: VerticalAlign.TOP });
  const visas = new Table({ width: { size: W, type: WidthType.DXA }, columnWidths: vW, rows: [new TableRow({ children: [
    visa("Le Délégué de classe", "(nom, date et signature)", vW[0]),
    visa("Le Responsable de niveau", "(date et signature)", vW[1]),
    visa("Le Chef de Département", "(date, signature et cachet)", vW[2]),
  ] })] });

  // Tableau 2 : pointage des étudiants
  const nC = JOURS.length * CRENEAUX.length;
  const [wN, wM, wGr, wC, wTot] = sept ? [450, 1100, 380, 280, 550] : [500, 1300, 400, 320, 678];
  const wNom = W - wN - wM - wGr - wTot - wC * nC;
  const tight = { top: 20, bottom: 20, left: 20, right: 20 };
  const bordC = (k) => ({ top: thin, bottom: thin, left: k % CRENEAUX.length === 0 ? thick : thin, right: k === nC - 1 ? thick : thin });
  const head1 = new TableRow({ tableHeader: true, height: { value: 290, rule: HeightRule.EXACT }, children: [
    cell(center("N°", { bold: true, size: 15 }), wN, { fill: GRIS, vMerge: "restart" }),
    cell(center("Matricule / ID", { bold: true, size: 14 }), wM, { fill: GRIS, vMerge: "restart", margins: tight }),
    cell(center("Noms et prénoms", { bold: true, size: 15 }), wNom, { fill: GRIS, vMerge: "restart" }),
    cell(center("Gr. TD", { bold: true, size: 13 }), wGr, { fill: GRIS, vMerge: "restart", margins: tight }),
    ...JOURS.map((j, d) => cell(center(j, { bold: true, size: 14 }), wC * CRENEAUX.length, {
      fill: GRIS, span: CRENEAUX.length, margins: tight,
      borders: { top: thin, bottom: thin, left: thick, right: d === JOURS.length - 1 ? thick : thin },
    })),
    cell(center("Total A", { bold: true, size: 14 }), wTot, { fill: GRIS, vMerge: "restart", margins: tight }),
  ] });
  const head2 = new TableRow({ tableHeader: true, height: { value: 250, rule: HeightRule.EXACT }, children: [
    cell(p(t("")), wN, { fill: GRIS, vMerge: "continue" }),
    cell(p(t("")), wM, { fill: GRIS, vMerge: "continue" }),
    cell(p(t("")), wNom, { fill: GRIS, vMerge: "continue" }),
    cell(p(t("")), wGr, { fill: GRIS, vMerge: "continue" }),
    ...Array.from({ length: nC }, (_, k) => cell(center(String((k % CRENEAUX.length) + 1), { bold: true, size: 14 }), wC, { fill: GRIS, margins: tight, borders: bordC(k) })),
    cell(p(t("")), wTot, { fill: GRIS, vMerge: "continue" }),
  ] });
  const auMoinsUneSeance = seances.some((j) => Object.keys(j).length);
  const lignes = etudiants.map((e, i) => {
    let absences = 0;
    const cases = Array.from({ length: nC }, (_, k) => {
      const liste = seances[Math.floor(k / CRENEAUX.length)][String((k % CRENEAUX.length) + 1)];
      if (!liste || !liste.length) return cell(p(t("")), wC, { margins: tight, borders: bordC(k) });
      const present = liste.some((s) => s.presents.has(e.id.toUpperCase()));
      const estAttendu = liste.some((s) => attendu(s, e));
      if (!present && (horsDecompte(e) || !estAttendu)) return cell(p(t("")), wC, { margins: tight, borders: bordC(k) });
      if (!present) absences++;
      return cell(center(present ? "P" : "A", { size: 15, bold: !present }), wC, { margins: tight, borders: bordC(k), fill: present ? undefined : "D9D9D9" });
    });
    return new TableRow({ cantSplit: true, height: { value: 330, rule: HeightRule.EXACT }, children: [
      cell(center(String(i + 1), { size: 15 }), wN, { margins: tight }),
      cell(center(e.matricule || e.id, { size: (e.matricule || e.id).length > 12 ? (sept ? 11 : 12) : 14 }), wM, { margins: tight }),
      cell(p(t(e.noms_prenoms + ({ redoublant: " (R)", creditaire: " (Cr)" }[statutDe(e)] || ""), { size: 14, italics: statutDe(e) === "non-inscrit" })), wNom, { margins: { top: 20, bottom: 20, left: 50, right: 20 } }),
      cell(center(groupeDe(e, "TD") || (statutDe(e) === "non-inscrit" ? "" : "?"), { size: 14, bold: true }), wGr, { margins: tight }),
      ...cases,
      cell(center(!auMoinsUneSeance ? "" : horsDecompte(e) ? "–" : String(absences), { size: 15, bold: true }), wTot),
    ] });
  });
  const t2 = new Table({ width: { size: W, type: WidthType.DXA }, columnWidths: [wN, wM, wNom, wGr, ...Array(nC).fill(wC), wTot], rows: [head1, head2, ...lignes] });
  const rappel = p([
    t("Filière : ", { size: 18 }), t(infos.filiere || classe, { size: 18, bold: true }),
    t("     Semaine du ", { size: 18 }), t(fr(dates[0]), { size: 18, bold: true }), t(" au ", { size: 18 }), t(fr(dates[JOURS.length - 1]), { size: 18, bold: true }),
    t("     Effectif : ", { size: 18 }), t(String(inscrits.length), { size: 18, bold: true }),
  ], { spacing: { before: 0, after: 50 } });
  const legende = p([
    t("P = présent, A = absent, case vide = pas de pointage ou séance d'un autre groupe.  (R) redoublant, (Cr) créditaire.  Gr. TD « ? » = groupe non attribué.  Créneaux : ", { bold: true, size: 14 }),
    t(CRENEAUX.map((h, i) => i + 1 + " = " + h.replace(" – ", "–")).join("   ·   "), { size: 14 }),
  ], { spacing: { before: 0, after: 80 } });

  const footer = new Footer({ children: [p([
    t("IUT Fotso Victor de Bandjoun – " + nomDep(infos) + " – Fiche de présence " + (infos.filiere || classe) + ", semaine du " + fr(dates[0]), { size: 13 }),
    t("\tPage ", { size: 13 }), new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 13 }),
    t(" / ", { size: 13 }), new TextRun({ children: [PageNumber.TOTAL_PAGES], font: FONT, size: 13 }),
  ], { tabStops: [{ type: TabStopType.RIGHT, position: W }] })] });

  return new Document({
    creator: nomDep(infos), title: "Fiche de présence hebdomadaire " + classe,
    styles: { default: { document: { run: { font: FONT, size: 18 } } } },
    sections: [{
      properties: { page: {
        size: { width: 11906, height: 16838, orientation: PageOrientation.LANDSCAPE },
        margin: { top: 567, bottom: 624, left: 680, right: 680, footer: 300 },
      } },
      footers: { default: footer },
      children: [entete, titre, ident1, ident2, sousTitre("1. Émargement des enseignants"), t1, note, visas,
        sousTitre("2. Pointage des étudiants", { pageBreakBefore: true, spacing: { before: 0, after: 60 } }), rappel, legende, t2],
    }],
  });
}

// ---------- Exécution ----------
(async () => {
  const dossierClasses = path.join(RACINE, "classes");
  const liste = arg("classe") ? [arg("classe")] : fs.readdirSync(dossierClasses).filter((d) => fs.existsSync(path.join(dossierClasses, d, "etudiants.csv")));
  for (const classe of liste) {
    const dossier = path.join(dossierClasses, classe);
    const etudiants = lireCsv(path.join(dossier, "etudiants.csv")).filter((e) => e.id)
      .sort((a, b) => a.noms_prenoms.localeCompare(b.noms_prenoms, "fr", { sensitivity: "base" }));
    const fInfos = path.join(dossier, "classe.json");
    const infos = fs.existsSync(fInfos) ? JSON.parse(fs.readFileSync(fInfos, "utf8")) : {};
    let seances = chargerSemaine(classe);
    const dimanche = Object.keys(seances[6]).length > 0;
    JOURS = TOUS_JOURS.slice(0, dimanche ? 7 : 6);
    seances = seances.slice(0, JOURS.length);
    const connus = new Set(etudiants.map((e) => e.id.toUpperCase()));
    const inconnus = new Set();
    seances.forEach((j) => Object.values(j).forEach((l) => l.forEach((s) => s.presents.forEach((id) => { if (!connus.has(id)) inconnus.add(id); }))));
    const sansGroupe = etudiants.filter((e) => !horsDecompte(e) && !groupeDe(e, "TD"));
    if (sansGroupe.length) console.warn("  Attention, " + sansGroupe.length + " étudiant(s) sans groupe de TD : " + sansGroupe.map((e) => e.id).join(", "));
    if (inconnus.size) console.warn("  Attention, cartes scannées absentes de la liste : " + [...inconnus].sort().join(", "));
    for (const id of [...inconnus].sort()) etudiants.push({ id, matricule: "", noms_prenoms: "(carte non enregistrée dans la liste)", statut: "non-inscrit" });
    const fProfs = path.join(RACINE, "enseignants", "enseignants.csv");
    const profs = new Map((fs.existsSync(fProfs) ? lireCsv(fProfs) : []).filter((e) => e.id).map((e) => [e.id.toUpperCase(), e.noms_prenoms]));
    const sortieDossier = arg("sortie") || path.join(RACINE, "fiches", classe);
    fs.mkdirSync(sortieDossier, { recursive: true });
    const sortie = path.join(sortieDossier, "Fiche_presence_" + classe + "_semaine_" + dates[0] + ".docx");
    fs.writeFileSync(sortie, await Packer.toBuffer(construire(classe, infos, etudiants, seances, profs)));
    const tenues = seances.reduce((n, j) => n + Object.values(j).reduce((m, l) => m + l.length, 0), 0);
    console.log(classe + " : " + etudiants.filter((e) => e.statut !== "non-inscrit").length + " étudiants, " + tenues + " séance(s) pointée(s) -> " + path.relative(RACINE, sortie));
  }
})().catch((e) => { console.error(e); process.exit(1); });

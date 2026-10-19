#!/usr/bin/env python3
"""Génère les planches de cartes QR (10 cartes par page A4).

  python3 scripts/generer_cartes.py DUT-GC1                 cartes des étudiants de la classe
  python3 scripts/generer_cartes.py DUT-GC1 --reserve 30    30 cartes vierges (inscriptions tardives)
  python3 scripts/generer_cartes.py DUT-GC1 --a-partir GC1-26-145
                                                            uniquement les cartes à partir de cet identifiant
  python3 scripts/generer_cartes.py --enseignants           cartes des enseignants

Dépendances : pip install qrcode reportlab pillow
Le QR code contient uniquement l'identifiant (colonne « id »).
"""
import argparse
import csv
import json
import os
import re

import qrcode
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader, simpleSplit
from reportlab.pdfgen import canvas

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CARTE_L, CARTE_H = 90 * mm, 54 * mm
COLS, LIGNES = 2, 5
BLEU = (0.12, 0.22, 0.39)
BORDEAUX = (0.45, 0.10, 0.12)


def qr_image(texte):
    qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_Q, box_size=12, border=2)
    qr.add_data(texte)
    qr.make(fit=True)
    return ImageReader(qr.make_image(fill_color="black", back_color="white").get_image())


def dessiner_carte(c, x, y, carte, logo):
    """carte = {id, nom, bandeau, couleur, ligne1, ligne2}. Un nom vide donne une carte à compléter à la main."""
    c.setStrokeColorRGB(0.6, 0.6, 0.6)
    c.setLineWidth(0.4)
    c.rect(x, y, CARTE_L, CARTE_H)

    c.setFillColorRGB(*carte["couleur"])
    c.rect(x, y + CARTE_H - 11 * mm, CARTE_L, 11 * mm, stroke=0, fill=1)
    c.setFillColorRGB(1, 1, 1)
    if logo:
        c.drawImage(logo, x + 2 * mm, y + CARTE_H - 10.2 * mm, width=6.9 * mm, height=9.4 * mm, mask="auto")
    c.setFont("Helvetica-Bold", 7.6)
    c.drawString(x + 11 * mm, y + CARTE_H - 4.8 * mm, "IUT FOTSO VICTOR DE BANDJOUN")
    c.setFont("Helvetica", 7)
    c.drawString(x + 11 * mm, y + CARTE_H - 8.6 * mm, (carte.get("departement") or "Département de Génie Civil") + " – " + carte["bandeau"])

    cote = 38 * mm
    c.drawImage(qr_image(carte["id"]), x + 2.5 * mm, y + 2.5 * mm, width=cote, height=cote)

    tx = x + 43 * mm
    largeur = CARTE_L - 45.5 * mm
    c.setFillColorRGB(0, 0, 0)
    if carte["nom"]:
        taille = 9.5
        lignes = simpleSplit(carte["nom"], "Helvetica-Bold", taille, largeur)
        while len(lignes) > 3 and taille > 7:
            taille -= 0.5
            lignes = simpleSplit(carte["nom"], "Helvetica-Bold", taille, largeur)
        c.setFont("Helvetica-Bold", taille)
        ty = y + CARTE_H - 16.5 * mm
        for ligne in lignes:
            c.drawString(tx, ty, ligne)
            ty -= taille * 1.18
    else:
        c.setFont("Helvetica", 8)
        c.drawString(tx, y + CARTE_H - 16.5 * mm, "Nom et prénoms :")
        c.setStrokeColorRGB(0.4, 0.4, 0.4)
        c.setDash(1, 2)
        for k in (0, 1):
            c.line(tx, y + CARTE_H - (23 + 6.5 * k) * mm, x + CARTE_L - 3 * mm, y + CARTE_H - (23 + 6.5 * k) * mm)
        c.setDash()

    taille1 = 8
    while taille1 > 5.5 and c.stringWidth(carte["ligne1"], "Helvetica", taille1) > largeur:
        taille1 -= 0.25
    c.setFont("Helvetica", taille1)
    c.drawString(tx, y + 16.5 * mm, carte["ligne1"])
    c.setFont("Helvetica-Bold", 9)
    c.drawString(tx, y + 11 * mm, "ID : " + carte["id"])
    c.setFont("Helvetica", 8)
    c.drawString(tx, y + 5.5 * mm, carte["ligne2"])


def ecrire_pdf(cartes, sortie, titre):
    chemin_logo = os.path.join(RACINE, "scripts", "logo.png")
    logo = ImageReader(chemin_logo) if os.path.exists(chemin_logo) else None
    c = canvas.Canvas(sortie, pagesize=A4)
    c.setTitle(titre)
    pl, ph = A4
    mx = (pl - COLS * CARTE_L) / 2
    my = (ph - LIGNES * CARTE_H) / 2
    for i, carte in enumerate(cartes):
        k = i % (COLS * LIGNES)
        if i and k == 0:
            c.showPage()
        dessiner_carte(c, mx + (k % COLS) * CARTE_L, ph - my - (k // COLS + 1) * CARTE_H, carte, logo)
    c.save()
    print("%d cartes -> %s" % (len(cartes), sortie))


def lire_csv(chemin):
    with open(chemin, encoding="utf-8-sig", newline="") as f:
        return [l for l in csv.DictReader(f) if (l.get("id") or "").strip()]


def main():
    a = argparse.ArgumentParser(description="Cartes QR de présence")
    a.add_argument("classe", nargs="?", default="DUT-GC1")
    a.add_argument("--enseignants", action="store_true", help="cartes des enseignants")
    a.add_argument("--reserve", type=int, default=0, help="nombre de cartes vierges à générer")
    a.add_argument("--debut", type=int, default=0, help="premier numéro des cartes de réserve (par défaut : après le dernier étudiant)")
    a.add_argument("--a-partir", default="", help="ne générer que les cartes à partir de cet identifiant")
    a.add_argument("--sortie", default="")
    args = a.parse_args()

    if args.enseignants:
        dossier = os.path.join(RACINE, "enseignants")
        cartes = [{"id": e["id"].strip(), "nom": e["noms_prenoms"].strip(), "bandeau": "Carte d'émargement enseignant", "departement": "IUT Fotso Victor",
                   "couleur": BORDEAUX, "ligne1": "Enseignant", "ligne2": "À présenter à chaque séance"}
                  for e in lire_csv(os.path.join(dossier, "enseignants.csv"))]
        return ecrire_pdf(cartes, args.sortie or os.path.join(dossier, "Cartes_QR_enseignants.pdf"), "Cartes des enseignants")

    dossier = os.path.join(RACINE, "classes", args.classe)
    etudiants = lire_csv(os.path.join(dossier, "etudiants.csv"))
    with open(os.path.join(dossier, "classe.json"), encoding="utf-8") as f:
        infos = json.load(f)
    ligne1 = "%s – %s" % (infos.get("filiere", args.classe), infos.get("annee", ""))
    dep = infos.get("departement_nom") or "Département de Génie Civil"

    if args.reserve:
        m = re.match(r"^(.*?)(\d+)$", etudiants[-1]["id"].strip())
        prefixe, chiffres = m.group(1), len(m.group(2))
        dernier = max(int(re.match(r"^.*?(\d+)$", e["id"].strip()).group(1)) for e in etudiants)
        depart = (args.debut - 1) if args.debut else dernier
        cartes = [{"id": "%s%0*d" % (prefixe, chiffres, depart + k), "nom": "", "bandeau": "Carte de présence", "departement": dep,
                   "couleur": BLEU, "ligne1": ligne1, "ligne2": "Matricule : " + "." * 24} for k in range(1, args.reserve + 1)]
        return ecrire_pdf(cartes, args.sortie or os.path.join(dossier, "Cartes_QR_%s_reserve.pdf" % args.classe),
                          "Cartes de réserve %s" % args.classe)

    if args.a_partir:
        etudiants = [e for e in etudiants if e["id"].strip().upper() >= args.a_partir.upper()]
    cartes = [{"id": e["id"].strip(), "nom": e["noms_prenoms"].strip(), "bandeau": "Carte de présence", "couleur": BLEU, "departement": dep,
               "ligne1": ligne1,
               "ligne2": "Matricule : " + ((e.get("matricule") or "").strip() or "." * 24)} for e in etudiants]
    ecrire_pdf(cartes, args.sortie or os.path.join(dossier, "Cartes_QR_%s.pdf" % args.classe), "Cartes de présence %s" % args.classe)


if __name__ == "__main__":
    main()

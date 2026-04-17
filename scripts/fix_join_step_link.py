#!/usr/bin/env python3
"""Replace mailto:hello@esrf.net in about.join_step_1_html across all 27 locales
with a link to the request-listing.html form. Keeps the leading <strong>…</strong>
headline; rewrites the second sentence to a locale-appropriate 'fill in the form'
phrasing with the link anchor being a natural phrase (not a raw URL)."""
import json
import os
import re

# Per-locale second sentence. Keeps the same information (name, one-paragraph
# description, primary sector) but directs the user to the form instead of email.
# The <a> anchor text is a natural phrase in each language.
SECOND_SENTENCE = {
    "bg": 'Попълнете <a href="request-listing.html" style="color:var(--accent)">формуляра за регистрация</a> с името на организацията, едноабзацно описание и основния ви сектор.',
    "cs": 'Vyplňte <a href="request-listing.html" style="color:var(--accent)">registrační formulář</a> s názvem organizace, popisem v jednom odstavci a primárním sektorem vaší činnosti.',
    "da": 'Udfyld <a href="request-listing.html" style="color:var(--accent)">tilmeldingsformularen</a> med din organisations navn, en beskrivelse på ét afsnit og din primære praksissektor.',
    "de": 'Füllen Sie das <a href="request-listing.html" style="color:var(--accent)">Anmeldeformular</a> mit dem Namen Ihrer Organisation, einer Kurzbeschreibung und Ihrem Haupttätigkeitssektor aus.',
    "el": 'Συμπληρώστε τη <a href="request-listing.html" style="color:var(--accent)">φόρμα καταχώρισης</a> με το όνομα του οργανισμού σας, μια παράγραφο περιγραφή και τον κύριο τομέα σας.',
    "en": 'Fill in the <a href="request-listing.html" style="color:var(--accent)">request-a-listing form</a> with your organisation’s name, a one-paragraph description and your primary sector of practice.',
    "es": 'Complete el <a href="request-listing.html" style="color:var(--accent)">formulario de solicitud</a> con el nombre de su organización, una descripción de un párrafo y su sector de práctica principal.',
    "et": 'Täida <a href="request-listing.html" style="color:var(--accent)">registreerimisvorm</a> organisatsiooni nime, lühikirjelduse ja peamise tegevusvaldkonnaga.',
    "fi": 'Täytä <a href="request-listing.html" style="color:var(--accent)">ilmoittautumislomake</a>, johon merkitset organisaatiosi nimen, yhden kappaleen kuvauksen ja ensisijaisen toimintasektorisi.',
    "fr": 'Remplissez le <a href="request-listing.html" style="color:var(--accent)">formulaire d’inscription</a> avec le nom de votre organisation, une description d’un paragraphe et votre secteur d’activité principal.',
    "ga": 'Líon isteach an <a href="request-listing.html" style="color:var(--accent)">fhoirm iarratais</a> le hainm d’eagraíochta, tuairisc aon alt amháin agus príomhearnáil do chleachtais.',
    "hr": 'Ispunite <a href="request-listing.html" style="color:var(--accent)">obrazac za prijavu</a> s imenom vaše organizacije, opisom u jednom odlomku i vašim primarnim sektorom prakse.',
    "hu": 'Töltse ki a <a href="request-listing.html" style="color:var(--accent)">jelentkezési űrlapot</a> szervezete nevével, egy bekezdéses leírással és elsődleges tevékenységi szektorával.',
    "is": 'Fylltu út <a href="request-listing.html" style="color:var(--accent)">skráningarformið</a> með nafni stofnunar þinnar, einnar málsgreinar lýsingu og aðalgeira starfsemi þinnar.',
    "it": 'Compilate il <a href="request-listing.html" style="color:var(--accent)">modulo di richiesta</a> con il nome della vostra organizzazione, una descrizione di un paragrafo e il vostro settore principale di attività.',
    "lt": 'Užpildykite <a href="request-listing.html" style="color:var(--accent)">registracijos formą</a> nurodydami organizacijos pavadinimą, vienos pastraipos aprašymą ir pagrindinį veiklos sektorių.',
    "lv": 'Aizpildiet <a href="request-listing.html" style="color:var(--accent)">pieteikuma veidlapu</a> ar organizācijas nosaukumu, viena rindkopas aprakstu un galveno darbības nozari.',
    "mt": 'Imla l-<a href="request-listing.html" style="color:var(--accent)">formola tal-applikazzjoni</a> bl-isem tal-organizzazzjoni tiegħek, deskrizzjoni ta’ paragrafu u s-settur prinċipali tal-prattika tiegħek.',
    "nl": 'Vul het <a href="request-listing.html" style="color:var(--accent)">aanmeldformulier</a> in met de naam van uw organisatie, een beschrijving van één alinea en uw primaire sector.',
    "no": 'Fyll ut <a href="request-listing.html" style="color:var(--accent)">registreringsskjemaet</a> med organisasjonens navn, en enparagrafsbeskrivelse og din primære praksissektor.',
    "pl": 'Wypełnij <a href="request-listing.html" style="color:var(--accent)">formularz zgłoszeniowy</a>, podając nazwę organizacji, opis w jednym akapicie i główny sektor działalności.',
    "pt": 'Preencha o <a href="request-listing.html" style="color:var(--accent)">formulário de inscrição</a> com o nome da sua organização, uma descrição de um parágrafo e o seu setor principal de atividade.',
    "ro": 'Completați <a href="request-listing.html" style="color:var(--accent)">formularul de înscriere</a> cu numele organizației, o descriere de un paragraf și sectorul principal de activitate.',
    "sk": 'Vyplňte <a href="request-listing.html" style="color:var(--accent)">registračný formulár</a> s názvom organizácie, popisom v jednom odseku a primárnym sektorom vašej činnosti.',
    "sl": 'Izpolnite <a href="request-listing.html" style="color:var(--accent)">prijavni obrazec</a> z imenom vaše organizacije, enostavčnim opisom in vašim primarnim sektorjem prakse.',
    "sv": 'Fyll i <a href="request-listing.html" style="color:var(--accent)">anmälningsformuläret</a> med din organisations namn, en enmeningsbeskrivning och din primära praktiksektor.',
    "uk": 'Заповніть <a href="request-listing.html" style="color:var(--accent)">форму для реєстрації</a>, вказавши назву організації, короткий опис та основний сектор діяльності.',
}

BASE = os.path.join(os.path.dirname(__file__), "..", "i18n")
BASE = os.path.abspath(BASE)

HEAD_RE = re.compile(r"^(<strong>[^<]+</strong>)", re.UNICODE)

for lang in sorted(SECOND_SENTENCE):
    path = os.path.join(BASE, f"{lang}.json")
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    ab = data.setdefault("about", {})
    old = ab.get("join_step_1_html", "")
    m = HEAD_RE.match(old)
    if not m:
        print(f"[{lang}] WARNING: no leading <strong>…</strong> found, skipping")
        continue
    head = m.group(1)
    new = f"{head} {SECOND_SENTENCE[lang]}"
    ab["join_step_1_html"] = new
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(f"[{lang}] updated")

print(f"\nDone. Updated {len(SECOND_SENTENCE)} locales.")

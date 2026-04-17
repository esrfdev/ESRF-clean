#!/usr/bin/env python3
"""
Breidt i18n uit:
- Voegt nieuwe EN + NL keys toe aan en.json / nl.json
- Patched HTML-bestanden met data-i18n attributen op ontbrekende tekstnodes
"""
import json, os, re, sys
from pathlib import Path

ROOT = Path('/home/user/workspace/esrf')

# ────────────────────────────────────────────────────────────────
# Nieuwe keys per taal
# ────────────────────────────────────────────────────────────────
NEW_KEYS = {
    # ── COMMON / CITIES / SECTORS / COUNTRIES (gedeeld) ──
    'city': {
        'brussels': {'en':'Brussels','nl':'Brussel'},
        'amsterdam': {'en':'Amsterdam','nl':'Amsterdam'},
        'warsaw': {'en':'Warsaw','nl':'Warschau'},
        'rome': {'en':'Rome','nl':'Rome'},
        'lisbon': {'en':'Lisbon','nl':'Lissabon'},
        'tallinn': {'en':'Tallinn','nl':'Tallinn'},
        'athens': {'en':'Athens','nl':'Athene'},
        'berlin': {'en':'Berlin','nl':'Berlijn'},
        'dublin': {'en':'Dublin','nl':'Dublin'},
        'helsinki': {'en':'Helsinki','nl':'Helsinki'},
        'paris': {'en':'Paris','nl':'Parijs'},
        'madrid': {'en':'Madrid','nl':'Madrid'},
        'vienna': {'en':'Vienna','nl':'Wenen'},
        'prague': {'en':'Prague','nl':'Praag'},
        'copenhagen': {'en':'Copenhagen','nl':'Kopenhagen'},
        'stockholm': {'en':'Stockholm','nl':'Stockholm'},
        'bucharest': {'en':'Bucharest','nl':'Boekarest'},
        'zagreb': {'en':'Zagreb','nl':'Zagreb'},
        'sofia': {'en':'Sofia','nl':'Sofia'},
        'vilnius': {'en':'Vilnius','nl':'Vilnius'},
        'riga': {'en':'Riga','nl':'Riga'},
        'bratislava': {'en':'Bratislava','nl':'Bratislava'},
        'luxembourg': {'en':'Luxembourg','nl':'Luxemburg'},
        'ljubljana': {'en':'Ljubljana','nl':'Ljubljana'},
        'nicosia': {'en':'Nicosia','nl':'Nicosia'},
        'valletta': {'en':'Valletta','nl':'Valletta'},
        'budapest': {'en':'Budapest','nl':'Boedapest'},
        'oslo': {'en':'Oslo','nl':'Oslo'},
        'london': {'en':'London','nl':'Londen'},
    },

    'sector': {
        'emergency': {'en':'Emergency & Crisis Response','nl':'Noodhulp & Crisisrespons'},
        'security': {'en':'Security & Protection','nl':'Beveiliging & Bescherming'},
        'risk': {'en':'Risk & Continuity Management','nl':'Risico- & Continuïteitsbeheer'},
        'digital': {'en':'Digital Infrastructure & Cybersecurity','nl':'Digitale Infrastructuur & Cybersecurity'},
        'knowledge': {'en':'Knowledge, Training & Research','nl':'Kennis, Training & Onderzoek'},
        'health': {'en':'Health & Medical Manufacturing','nl':'Gezondheid & Medische Productie'},
        'critical': {'en':'Critical Infrastructure','nl':'Kritieke Infrastructuur'},
        'dual_use': {'en':'Dual-use Technology & Manufacturing','nl':'Dual-use Technologie & Productie'},
        'transport': {'en':'Transport, Maritime & Aerospace','nl':'Transport, Maritiem & Luchtvaart'},
        'energy': {'en':'Energy & Grid Resilience','nl':'Energie & Netwerkweerbaarheid'},
        # kort label voor chips
        'short_emergency': {'en':'Emergency','nl':'Noodhulp'},
        'short_security': {'en':'Security','nl':'Beveiliging'},
        'short_risk': {'en':'Risk','nl':'Risico'},
        'short_digital': {'en':'Digital','nl':'Digitaal'},
        'short_knowledge': {'en':'Knowledge','nl':'Kennis'},
        'short_health': {'en':'Health','nl':'Gezondheid'},
        'short_critical': {'en':'Critical','nl':'Kritiek'},
        'short_dual_use': {'en':'Dual-use','nl':'Dual-use'},
        'short_transport': {'en':'Transport','nl':'Transport'},
        'short_energy': {'en':'Energy','nl':'Energie'},
    },

    'country': {
        'austria': {'en':'Austria','nl':'Oostenrijk'},
        'belgium': {'en':'Belgium','nl':'België'},
        'bulgaria': {'en':'Bulgaria','nl':'Bulgarije'},
        'croatia': {'en':'Croatia','nl':'Kroatië'},
        'cyprus': {'en':'Cyprus','nl':'Cyprus'},
        'czech_republic': {'en':'Czech Republic','nl':'Tsjechië'},
        'denmark': {'en':'Denmark','nl':'Denemarken'},
        'estonia': {'en':'Estonia','nl':'Estland'},
        'finland': {'en':'Finland','nl':'Finland'},
        'france': {'en':'France','nl':'Frankrijk'},
        'germany': {'en':'Germany','nl':'Duitsland'},
        'greece': {'en':'Greece','nl':'Griekenland'},
        'hungary': {'en':'Hungary','nl':'Hongarije'},
        'ireland': {'en':'Ireland','nl':'Ierland'},
        'italy': {'en':'Italy','nl':'Italië'},
        'latvia': {'en':'Latvia','nl':'Letland'},
        'lithuania': {'en':'Lithuania','nl':'Litouwen'},
        'luxembourg': {'en':'Luxembourg','nl':'Luxemburg'},
        'malta': {'en':'Malta','nl':'Malta'},
        'netherlands': {'en':'Netherlands','nl':'Nederland'},
        'poland': {'en':'Poland','nl':'Polen'},
        'portugal': {'en':'Portugal','nl':'Portugal'},
        'romania': {'en':'Romania','nl':'Roemenië'},
        'slovakia': {'en':'Slovakia','nl':'Slowakije'},
        'slovenia': {'en':'Slovenia','nl':'Slovenië'},
        'spain': {'en':'Spain','nl':'Spanje'},
        'sweden': {'en':'Sweden','nl':'Zweden'},
        'iceland': {'en':'Iceland','nl':'IJsland'},
        'norway': {'en':'Norway','nl':'Noorwegen'},
        'ukraine': {'en':'Ukraine','nl':'Oekraïne'},
        'united_kingdom': {'en':'United Kingdom','nl':'Verenigd Koninkrijk'},
        'switzerland': {'en':'Switzerland','nl':'Zwitserland'},
        'albania': {'en':'Albania','nl':'Albanië'},
        'bosnia_herzegovina': {'en':'Bosnia and Herzegovina','nl':'Bosnië en Herzegovina'},
        'montenegro': {'en':'Montenegro','nl':'Montenegro'},
        'north_macedonia': {'en':'North Macedonia','nl':'Noord-Macedonië'},
        'serbia': {'en':'Serbia','nl':'Servië'},
        'turkey': {'en':'Turkey','nl':'Turkije'},
    },

    # Algemene UI termen
    'common': {
        'read_charter': {'en':'Read the charter →','nl':'Lees het charter →'},
        'browse_directory': {'en':'Browse the directory →','nl':'Bekijk de directory →'},
        'see_analytics': {'en':'See analytics →','nl':'Bekijk analytics →'},
        'open_atlas': {'en':'Open the full atlas →','nl':'Open de volledige atlas →'},
        'read_figures': {'en':'Read all three figures →','nl':'Lees alle drie de figuren →'},
        'read_dispatch': {'en':'Read the full dispatch →','nl':'Lees het volledige bulletin →'},
        'open_dispatch': {'en':'Open the dispatch →','nl':'Open het bulletin →'},
        'submit_signal': {'en':'Submit a signal →','nl':'Dien een signaal in →'},
        'request_listing_cta': {'en':'Request your listing →','nl':'Vraag uw vermelding aan →'},
        'visit_website': {'en':'Visit website ↗','nl':'Bezoek website ↗'},
        'close_panel': {'en':'✕ Close','nl':'✕ Sluiten'},
        'plotted': {'en':'· plotted','nl':'· zichtbaar'},
        'of_total': {'en':'of 1,890','nl':'van 1.890'},
        'about': {'en':'About','nl':'Over ons'},
        'principles': {'en':'Principles','nl':'Principes'},
        'contact': {'en':'Contact','nl':'Contact'},
        'articles': {'en':'articles','nl':'artikelen'},
        'updated': {'en':'updated','nl':'bijgewerkt'},
        'no_articles': {'en':'No articles yet.','nl':'Nog geen artikelen.'},
        'foot_copyright': {'en':'© 2026 ESRF.net · European Security & Resilience Foundation','nl':'© 2026 ESRF.net · European Security & Resilience Foundation'},
    },

    # ── INDEX (home) ──
    'index': {
        'hero_title_1': {'en':'The people','nl':'De mensen'},
        'hero_title_2': {'en':'who hold','nl':'die Europa'},
        'hero_title_3': {'en':'Europe','nl':'bijeen'},
        'hero_title_4': {'en':'together.','nl':'houden.'},
        'hero_deck_html': {
            'en':"Where governments set policy and international bodies coordinate, <strong>ESRF.net</strong> unites the businesses, institutions and citizens whose daily work quietly sustains our shared life — a decentralised framework powered by the organisations that drive the economy.",
            'nl':"Waar overheden beleid maken en internationale organen coördineren, verbindt <strong>ESRF.net</strong> de bedrijven, instellingen en burgers wier dagelijkse werk ons gezamenlijke leven stilletjes in stand houdt — een gedecentraliseerd raamwerk, gedragen door de organisaties die de economie aandrijven."
        },
        'hero_fig_label': {'en':'Fig. 01','nl':'Fig. 01'},
        'hero_fig_caption': {
            'en':'A community of practitioners, spanning twenty-nine nations, bound by five moral principles.',
            'nl':'Een gemeenschap van professionals, verspreid over negenentwintig landen, verbonden door vijf morele principes.'
        },
        'scroll_hint': {'en':'Scroll · the atlas opens ↓','nl':'Scrol · de atlas opent ↓'},
        'foundation_kicker': {'en':'§ 01 · The Foundation','nl':'§ 01 · De Stichting'},
        'foundation_title_1': {'en':'Leadership','nl':'Leiderschap'},
        'foundation_title_2': {'en':'by','nl':'door'},
        'foundation_title_3': {'en':'example','nl':'voorbeeld'},
        'foundation_sub': {
            'en':'For local impact. For shared resilience. For a Europe that holds.',
            'nl':'Voor lokale impact. Voor gedeelde weerbaarheid. Voor een Europa dat standhoudt.'
        },
        'foundation_body_1_html': {
            'en':"The European Security &amp; Resilience Framework is the foundation of <strong>ESRF.net</strong> — a decentralised network built for, and by, the entrepreneurs with local impact. We believe security is not merely a government mandate. It is an entrepreneurial responsibility, and a civic one.",
            'nl':"Het European Security &amp; Resilience Framework is de basis van <strong>ESRF.net</strong> — een gedecentraliseerd netwerk gebouwd voor, en door, ondernemers met lokale impact. Wij geloven dat veiligheid niet louter een overheidsmandaat is. Het is een ondernemersverantwoordelijkheid, en een burgerlijke."
        },
        'foundation_pull_html': {
            'en':"Security is not just a mandate. <em>It is a responsibility we carry, together.</em>",
            'nl':"Veiligheid is geen mandaat alleen. <em>Het is een verantwoordelijkheid die we samen dragen.</em>"
        },
        'foundation_body_2': {
            'en':'By building resilience from the ground up, we connect organisations across twenty-nine countries into self-sustaining ecosystems with regional impact. The foundation channels donations, contributions and aligned capital into initiatives that strengthen the network and expand its reach across the continent.',
            'nl':'Door weerbaarheid van onderop op te bouwen verbinden we organisaties in negenentwintig landen tot zelfvoorzienende ecosystemen met regionale impact. De stichting leidt donaties, bijdragen en afgestemd kapitaal naar initiatieven die het netwerk versterken en zijn bereik over het continent uitbreiden.'
        },
        'foundation_body_3_html': {
            'en':"Organisations are classified across <strong>ten vital sectors</strong> aligned with the EU NIS2 Directive and guided by five moral principles: <em>vigilance, stewardship, empowerment, solidarity</em> and <em>renewal</em>.",
            'nl':"Organisaties worden geclassificeerd in <strong>tien vitale sectoren</strong> in lijn met de EU NIS2-richtlijn en geleid door vijf morele principes: <em>waakzaamheid, rentmeesterschap, veerkracht, solidariteit</em> en <em>vernieuwing</em>."
        },
        'sectors_kicker': {'en':'§ 03 · Vital Sectors','nl':'§ 03 · Vitale Sectoren'},
        'sectors_title_1': {'en':'Ten fields','nl':'Tien velden'},
        'sectors_title_2': {'en':'of','nl':'van'},
        'sectors_title_3': {'en':'practice','nl':'praktijk'},
        'sectors_lede': {
            'en':'Every organisation in the ESRF.net community is classified across ten vital sectors — the domains where resilience is either built or lost. Counts below reflect the current directory.',
            'nl':'Elke organisatie in de ESRF.net-gemeenschap is geclassificeerd in tien vitale sectoren — de domeinen waar weerbaarheid wordt opgebouwd of verloren gaat. De onderstaande aantallen weerspiegelen de huidige directory.'
        },
        'atlas_kicker': {'en':'§ 04 · The Community Atlas','nl':'§ 04 · De Community Atlas'},
        'atlas_title_1': {'en':'Where the','nl':'Waar het'},
        'atlas_title_2': {'en':'work','nl':'werk'},
        'atlas_title_3': {'en':'happens','nl':'gebeurt'},
        'atlas_lede': {
            'en':'Every pin is an organisation; every cluster, a city; every colour, a sector. The atlas is a living record of who sustains the daily machinery of a resilient Europe.',
            'nl':'Elke speld is een organisatie; elke cluster een stad; elke kleur een sector. De atlas is een levend register van wie de dagelijkse machinerie van een weerbaar Europa draaiende houdt.'
        },
        'analytics_kicker': {'en':'§ 05 · Analytics','nl':'§ 05 · Analytics'},
        'analytics_title_1': {'en':'Patterns','nl':'Patronen'},
        'analytics_title_2': {'en':'in the','nl':'in het'},
        'analytics_title_3': {'en':'network','nl':'netwerk'},
        'analytics_lede': {
            'en':'Three figures, published each issue — where the community is concentrated, where it is sparse, and how the ten sectors distribute across countries.',
            'nl':'Drie figuren, bij elke uitgave gepubliceerd — waar de gemeenschap zich concentreert, waar ze dun is, en hoe de tien sectoren over landen zijn verdeeld.'
        },
        'fig01_title_1': {'en':'Organisations','nl':'Organisaties'},
        'fig01_title_2': {'en':'per sector','nl':'per sector'},
        'fig01_desc': {
            'en':'A horizontal bar comparing the ten vital sectors. Emergency & Crisis Response leads; Energy & Grid Resilience is the frontier.',
            'nl':'Een horizontale staaf die de tien vitale sectoren vergelijkt. Noodhulp & Crisisrespons leidt; Energie & Netwerkweerbaarheid is de nieuwe grens.'
        },
        'fig02_title_1': {'en':'Organisations','nl':'Organisaties'},
        'fig02_title_2': {'en':'per country','nl':'per land'},
        'fig02_desc': {
            'en':'A bar across twenty-nine nations. The Netherlands, United Kingdom and Germany carry the current weight of the network.',
            'nl':'Een staaf over negenentwintig landen. Nederland, het Verenigd Koninkrijk en Duitsland dragen momenteel het gewicht van het netwerk.'
        },
        'dispatch_kicker': {'en':'§ 06 · Dispatch','nl':'§ 06 · Bulletin'},
        'dispatch_title_1': {'en':'From the','nl':'Vanaf het'},
        'dispatch_title_2': {'en':'continent','nl':'continent'},
        'dispatch_lede': {
            'en':'A curated feed of European security, resilience and crisis signals — filed under the sector each story touches. The full dispatch is updated continuously.',
            'nl':'Een zorgvuldig samengestelde stroom Europese veiligheids-, weerbaarheids- en crisissignalen — gesorteerd op de sector waar elk verhaal aan raakt. Het volledige bulletin wordt voortdurend bijgewerkt.'
        },
        'join_title_1': {'en':'Does your organisation','nl':'Draagt uw organisatie'},
        'join_title_2': {'en':'contribute to a','nl':'bij aan een'},
        'join_title_3': {'en':'Europe that holds?','nl':'Europa dat standhoudt?'},
    },

    # ── ABOUT ──
    'about': {
        'title_tag': {'en':'Foundation — ESRF.net','nl':'Stichting — ESRF.net'},
        'hero_kicker': {'en':'§ 01 · The Foundation','nl':'§ 01 · De Stichting'},
        'hero_title_1': {'en':'A Europe','nl':'Een Europa'},
        'hero_title_2': {'en':'that','nl':'dat'},
        'hero_title_3': {'en':'holds','nl':'standhoudt'},
        'hero_deck': {
            'en':'The European Security & Resilience Framework — the foundation of ESRF.net — is built on a simple conviction: resilience is not the exclusive work of states. It is the everyday labour of the organisations, institutions and citizens whose local impact sustains the whole.',
            'nl':'Het European Security & Resilience Framework — de basis van ESRF.net — rust op één overtuiging: weerbaarheid is niet het exclusieve werk van staten. Het is de dagelijkse arbeid van organisaties, instellingen en burgers wier lokale impact het geheel draagt.'
        },
        'charter_line1': {'en':'Security is not just a mandate.','nl':'Veiligheid is geen mandaat alleen.'},
        'charter_line2': {'en':'It is a responsibility','nl':'Het is een verantwoordelijkheid'},
        'charter_line3': {'en':'we carry, together.','nl':'die we samen dragen.'},
        'charter_cite': {'en':'— ESRF.net Charter, Art. 01','nl':'— ESRF.net Charter, Art. 01'},
        'what_kicker': {'en':'What is ESRF.net','nl':'Wat is ESRF.net'},
        'what_title_1': {'en':'A framework','nl':'Een raamwerk'},
        'what_title_2': {'en':'built','nl':'gebouwd'},
        'what_title_3': {'en':'from below','nl':'van onderop'},
        'what_sub': {'en':'Decentralised by design, civic in purpose, European in reach.','nl':'Gedecentraliseerd van opzet, burgerlijk van doel, Europees in bereik.'},
        'what_body_1_html': {
            'en':"<strong>ESRF.net</strong> is the community layer of the European Security &amp; Resilience Framework — a network of <strong>1,890 organisations</strong> across <strong>29 countries</strong> whose work, visible or otherwise, strengthens the continent's ability to prevent harm, protect what sustains us, prepare for shocks, respond in solidarity and recover with renewal.",
            'nl':"<strong>ESRF.net</strong> is de community-laag van het European Security &amp; Resilience Framework — een netwerk van <strong>1.890 organisaties</strong> in <strong>29 landen</strong> wier werk, zichtbaar of niet, het vermogen van het continent versterkt om schade te voorkomen, te beschermen wat ons draagt, zich voor te bereiden op schokken, te reageren in solidariteit en te herstellen met vernieuwing."
        },
        'what_body_2_html': {
            'en':"Where governments set policy and international bodies coordinate, ESRF.net unites the <strong>entrepreneurs, institutions and first responders</strong> whose daily practice is the actual substrate of resilience. We classify organisations across ten vital sectors — aligned with the EU NIS2 Directive — and file each under one of five moral pillars.",
            'nl':"Waar overheden beleid maken en internationale organen coördineren, verbindt ESRF.net de <strong>ondernemers, instellingen en hulpverleners</strong> wier dagelijkse praktijk het werkelijke substraat van weerbaarheid vormt. Wij classificeren organisaties in tien vitale sectoren — in lijn met de EU NIS2-richtlijn — en plaatsen elk onder één van vijf morele pijlers."
        },
        'what_pull_html': {
            'en':'We are not a regulator. <em>We are a community of practice.</em>',
            'nl':'Wij zijn geen toezichthouder. <em>Wij zijn een praktijkgemeenschap.</em>'
        },
        'what_body_3': {
            'en':'The foundation channels donations, contributions and aligned capital into initiatives that strengthen the network and expand its reach. Listings are free; contributions are welcome; participation is a matter of stewardship, not subscription.',
            'nl':'De stichting leidt donaties, bijdragen en afgestemd kapitaal naar initiatieven die het netwerk versterken en zijn bereik vergroten. Vermeldingen zijn gratis; bijdragen zijn welkom; deelname is een kwestie van rentmeesterschap, niet van abonnement.'
        },
        'name_note_html': {
            'en':"<strong>A note on the name.</strong> ESRF.net is unrelated to the European Synchrotron Radiation Facility, a scientific instrument in Grenoble. Please refer to us only as <em>ESRF.net</em> to prevent confusion.",
            'nl':"<strong>Een opmerking over de naam.</strong> ESRF.net staat los van de European Synchrotron Radiation Facility, een wetenschappelijk instrument in Grenoble. Verwijs naar ons uitsluitend als <em>ESRF.net</em> om verwarring te voorkomen."
        },
        'pillars_kicker': {'en':'§ 02 · The Moral Compass','nl':'§ 02 · Het Moreel Kompas'},
        'pillars_title_1': {'en':'Five','nl':'Vijf'},
        'pillars_title_2': {'en':'principles','nl':'principes'},
        'pillars_title_3': {'en':'One community.','nl':'Eén gemeenschap.'},
        'pillar1_num': {'en':'Nº 01 · Prevent','nl':'Nº 01 · Voorkomen'},
        'pillar1_sectors': {'en':'Sectors : Risk & Continuity · Knowledge, Training & Research','nl':'Sectoren : Risico & Continuïteit · Kennis, Training & Onderzoek'},
        'pillar1_name': {'en':'Vigilance','nl':'Waakzaamheid'},
        'pillar1_body_html': {
            'en':"To notice before it is loud. The first pillar is the patient, structural attention to signals, scenarios and systemic risks — the work of risk managers, continuity planners, researchers and trainers whose intelligence arrives a day too early and never a minute too late. <strong>527 organisations</strong> serve under this principle.",
            'nl':"Opmerken voordat het luid wordt. De eerste pijler is de geduldige, structurele aandacht voor signalen, scenario's en systeemrisico's — het werk van risicomanagers, continuïteitsplanners, onderzoekers en trainers wier inzicht een dag te vroeg komt en nooit een minuut te laat. <strong>527 organisaties</strong> dienen onder dit principe."
        },
        'pillar2_num': {'en':'Nº 02 · Protect','nl':'Nº 02 · Beschermen'},
        'pillar2_sectors': {'en':'Sectors : Security & Protection · Critical Infrastructure','nl':'Sectoren : Beveiliging & Bescherming · Kritieke Infrastructuur'},
        'pillar2_name': {'en':'Stewardship','nl':'Rentmeesterschap'},
        'pillar2_body_html': {
            'en':"To guard what sustains us. The second pillar holds the operators who defend physical, digital and institutional perimeters — from private security to power grid custodians. They do not own what they protect; they steward it for everyone who depends on it. <strong>503 organisations</strong> serve under this principle.",
            'nl':"Bewaken wat ons draagt. De tweede pijler verenigt de operators die fysieke, digitale en institutionele grenzen verdedigen — van particuliere beveiliging tot hoeders van het elektriciteitsnet. Zij bezitten niet wat zij beschermen; zij beheren het voor iedereen die ervan afhankelijk is. <strong>503 organisaties</strong> dienen onder dit principe."
        },
        'pillar3_num': {'en':'Nº 03 · Prepare','nl':'Nº 03 · Voorbereiden'},
        'pillar3_sectors': {'en':'Sectors : Digital Infrastructure & Cybersecurity · Dual-use Technology & Manufacturing','nl':'Sectoren : Digitale Infrastructuur & Cybersecurity · Dual-use Technologie & Productie'},
        'pillar3_name': {'en':'Empowerment','nl':'Veerkracht'},
        'pillar3_body_html': {
            'en':"To stand ready, together. The third pillar gathers the makers — cybersecurity firms, dual-use technologists, manufacturers — whose product is optionality. Preparedness is not stockpiling; it is the capacity to act with confidence when a plan meets weather. <strong>240 organisations</strong> serve under this principle.",
            'nl':"Samen klaarstaan. De derde pijler brengt de makers samen — cybersecuritybedrijven, dual-use technologen, producenten — wier product keuzemogelijkheid is. Paraatheid is geen voorraden aanleggen; het is het vermogen met vertrouwen te handelen wanneer een plan de werkelijkheid ontmoet. <strong>240 organisaties</strong> dienen onder dit principe."
        },
        'pillar4_num': {'en':'Nº 04 · Respond','nl':'Nº 04 · Reageren'},
        'pillar4_sectors': {'en':'Sectors : Emergency & Crisis Response · Health & Medical Manufacturing','nl':'Sectoren : Noodhulp & Crisisrespons · Gezondheid & Medische Productie'},
        'pillar4_name': {'en':'Solidarity','nl':'Solidariteit'},
        'pillar4_body_html': {
            'en':"To act as one when it matters. The fourth and largest pillar holds the first responders, the medical manufacturers, the coordinators of crisis. Solidarity is the virtue of arriving — reliably, quickly, together. <strong>604 organisations</strong> serve under this principle, the community's largest constituency.",
            'nl':"Als één handelen wanneer het telt. De vierde en grootste pijler verenigt de hulpverleners, medische producenten en crisiscoördinatoren. Solidariteit is de deugd van aankomen — betrouwbaar, snel, samen. <strong>604 organisaties</strong> dienen onder dit principe, de grootste achterban van de gemeenschap."
        },
        'pillar5_num': {'en':'Nº 05 · Recover','nl':'Nº 05 · Herstellen'},
        'pillar5_sectors': {'en':'Sectors : Energy & Grid Resilience · Transport, Maritime & Aerospace','nl':'Sectoren : Energie & Netwerkweerbaarheid · Transport, Maritiem & Luchtvaart'},
        'pillar5_name': {'en':'Renewal','nl':'Vernieuwing'},
        'pillar5_body_html': {
            'en':"To rise stronger than before. The fifth pillar holds the rebuilders — energy operators, transport and aerospace engineers — whose task is to absorb shocks and restart systems. Renewal treats recovery as an opportunity to fix what the last crisis revealed. <strong>18 organisations</strong> serve under this principle — the community's frontier, actively expanding.",
            'nl':"Sterker opstaan dan voorheen. De vijfde pijler verenigt de herbouwers — energieoperators, transport- en luchtvaartingenieurs — wier taak het is schokken op te vangen en systemen te herstarten. Vernieuwing ziet herstel als kans om te repareren wat de vorige crisis blootlegde. <strong>18 organisaties</strong> dienen onder dit principe — de grens van de gemeenschap, actief in uitbreiding."
        },
        'join_kicker': {'en':'§ 07 · How to join','nl':'§ 07 · Hoe deel te nemen'},
        'join_title_1': {'en':'Take your','nl':'Neem uw'},
        'join_title_2': {'en':'place','nl':'plek'},
        'join_sub': {'en':'A listing is free. Stewardship is the only dues we collect.','nl':'Vermelding is gratis. Rentmeesterschap is de enige bijdrage die wij vragen.'},
        'join_body_1': {
            'en':'Any organisation — commercial, institutional, non-profit — whose work strengthens European security and resilience is welcome on the atlas. There are three steps:',
            'nl':'Elke organisatie — commercieel, institutioneel, non-profit — wier werk de Europese veiligheid en weerbaarheid versterkt, is welkom op de atlas. Er zijn drie stappen:'
        },
        'join_step_1_html': {
            'en':'<strong>Request a listing.</strong> Write to <a href="mailto:hello@esrf.net" style="color:var(--accent)">hello@esrf.net</a> with your organisation\'s name, a one-paragraph description and your primary sector of practice.',
            'nl':'<strong>Vraag een vermelding aan.</strong> Schrijf naar <a href="mailto:hello@esrf.net" style="color:var(--accent)">hello@esrf.net</a> met de naam van uw organisatie, een beschrijving van één alinea en uw primaire sector.'
        },
        'join_step_2_html': {
            'en':'<strong>Align with the charter.</strong> Every listed organisation subscribes to the ESRF.net charter — one page, no fine print.',
            'nl':'<strong>Onderschrijf het charter.</strong> Elke vermelde organisatie onderschrijft het ESRF.net-charter — één pagina, geen kleine lettertjes.'
        },
        'join_step_3_html': {
            'en':'<strong>Appear on the atlas.</strong> Your listing goes live on the directory, the map and, where relevant, the dispatch.',
            'nl':'<strong>Verschijn op de atlas.</strong> Uw vermelding verschijnt in de directory, op de kaart en — waar relevant — in het bulletin.'
        },
        'join_body_2': {
            'en':'Contributions to the foundation — financial or in-kind — are welcome but never required. ESRF.net does not sell listings, rank its members, or charge subscription fees.',
            'nl':'Bijdragen aan de stichting — financieel of in natura — zijn welkom maar nooit verplicht. ESRF.net verkoopt geen vermeldingen, rangschikt haar leden niet en heft geen abonnementskosten.'
        },
    },

    # ── ANALYTICS ──
    'analytics': {
        'title_tag': {'en':'Analytics — ESRF.net','nl':'Analytics — ESRF.net'},
        'hero_kicker': {'en':'§ 05 · Analytics','nl':'§ 05 · Analytics'},
        'hero_title_1': {'en':'Patterns in','nl':'Patronen in'},
        'hero_title_2': {'en':'the','nl':'het'},
        'hero_title_3': {'en':'network','nl':'netwerk'},
        'hero_deck': {
            'en':'Three figures published with every issue. Where the community concentrates, where it is sparse, and how the ten sectors distribute across countries.',
            'nl':'Drie figuren bij elke uitgave gepubliceerd. Waar de gemeenschap zich concentreert, waar ze dun is, en hoe de tien sectoren over landen zijn verdeeld.'
        },
        'fig01_label': {'en':'Fig. 01','nl':'Fig. 01'},
        'fig01_title_1': {'en':'Organisations','nl':'Organisaties'},
        'fig01_title_2': {'en':'per sector','nl':'per sector'},
        'fig01_desc': {
            'en':'The first responders and the risk engineers are the weight-bearing columns of the community; energy and transport are the frontier, where the framework is youngest.',
            'nl':'De eerste hulpverleners en de risico-ingenieurs zijn de dragende kolommen van de gemeenschap; energie en transport vormen de frontier, waar het raamwerk het jongst is.'
        },
        'fig01_caption': {
            'en':'Fig. 01 — Counts of organisations in each of the ten vital sectors. Bar colour follows the sector itself.',
            'nl':'Fig. 01 — Aantallen organisaties in elk van de tien vitale sectoren. De balkkleur volgt de sector zelf.'
        },
        'fig02_label': {'en':'Fig. 02','nl':'Fig. 02'},
        'fig02_title_1': {'en':'Organisations','nl':'Organisaties'},
        'fig02_title_2': {'en':'per country','nl':'per land'},
        'fig02_desc': {
            'en':'Twenty-nine nations, each contributing a share of the whole. The Netherlands, United Kingdom and Germany currently carry the most; Malta and Bulgaria the fewest — a balance the framework is actively redistributing.',
            'nl':'Negenentwintig landen, elk met een aandeel in het geheel. Nederland, het Verenigd Koninkrijk en Duitsland dragen momenteel het meeste; Malta en Bulgarije het minst — een balans die het raamwerk actief herverdeelt.'
        },
        'fig02_caption': {
            'en':'Fig. 02 — Distribution of listed organisations across the 29 countries represented on the atlas.',
            'nl':'Fig. 02 — Verdeling van vermelde organisaties over de 29 landen die op de atlas zijn vertegenwoordigd.'
        },
        'cta_title_1': {'en':'Read the','nl':'Lees de'},
        'cta_title_2': {'en':'stories','nl':'verhalen'},
        'cta_title_3': {'en':'behind the figures.','nl':'achter de cijfers.'},
        'cta_sub': {
            'en':"The dispatch files each day's European resilience signals to the sector it touches.",
            'nl':'Het bulletin rangschikt elke dag Europese weerbaarheidssignalen naar de sector waar ze aan raken.'
        },
    },

    # ── NEWS / DISPATCH ──
    'news': {
        'title_tag': {'en':'Dispatch — ESRF.net','nl':'Bulletin — ESRF.net'},
        'hero_kicker': {'en':'§ 06 · Dispatch','nl':'§ 06 · Bulletin'},
        'hero_title_1': {'en':'From the','nl':'Vanaf het'},
        'hero_title_2': {'en':'continent','nl':'continent'},
        'hero_deck': {
            'en':'A curated ledger of European security, resilience and crisis signals — each filed by sector and topic. Updated continuously.',
            'nl':'Een zorgvuldig bijgehouden register van Europese veiligheids-, weerbaarheids- en crisissignalen — gesorteerd op sector en onderwerp. Voortdurend bijgewerkt.'
        },
        'submit_title_1': {'en':'Put your','nl':'Plaats uw'},
        'submit_title_2': {'en':'signal','nl':'signaal'},
        'submit_title_3': {'en':'on the dispatch.','nl':'op het bulletin.'},
        'submit_sub': {
            'en':'Organisations listed on the atlas can contribute stories, reports and updates to the ESRF.net dispatch.',
            'nl':'Organisaties die op de atlas staan, kunnen verhalen, rapporten en updates aanleveren voor het ESRF.net-bulletin.'
        },
    },

    # ── MAP ──
    'map_ext': {
        'title_tag': {'en':'Atlas — ESRF.net','nl':'Atlas — ESRF.net'},
    },

    # ── DIRECTORY ──
    'directory_ext': {
        'title_word_the': {'en':'The','nl':'De'},
        'title_word_of_practice': {'en':'of practice.','nl':'van de praktijk.'},
        'join_title_prefix': {'en':'Not yet on the','nl':'Nog niet op de'},
        'join_title_suffix': {'en':'atlas?','nl':'atlas?'},
    },
}


def deep_merge(base, extra):
    """Merge extra into base (mutates base)."""
    for k, v in extra.items():
        if isinstance(v, dict) and isinstance(base.get(k), dict):
            deep_merge(base[k], v)
        else:
            base[k] = v
    return base


def build_lang_dict(lang):
    """Bouw keys-tree voor gegeven taal."""
    out = {}
    for section, keys in NEW_KEYS.items():
        # Map 'map_ext' → 'map', 'directory_ext' → 'directory'
        target = {'map_ext':'map','directory_ext':'directory'}.get(section, section)
        out.setdefault(target, {})
        for key, trans in keys.items():
            out[target][key] = trans.get(lang) or trans['en']
    return out


def update_json(path, lang):
    with open(path) as f:
        data = json.load(f)
    new = build_lang_dict(lang)
    deep_merge(data, new)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f'  updated {path.name}')


def main():
    i18n = ROOT / 'i18n'
    update_json(i18n / 'en.json', 'en')
    update_json(i18n / 'nl.json', 'nl')
    # Voor alle andere talen: vul met EN-fallback (kunnen later vertaald worden)
    for p in sorted(i18n.glob('*.json')):
        if p.stem in ('en','nl'): continue
        update_json(p, 'en')  # EN als fallback voor nu
    print('Done.')


if __name__ == '__main__':
    main()

# ChessMirror WMD

Weapon of Math Destruction — Behavioral Profiling & Subtle Influence

ChessMirror WMD is een volledig lokaal draaiend onderzoeksprototype dat onderzoekt hoe gebruikersgedrag in een schaakomgeving kan worden verzameld, geanalyseerd, geprofileerd en subtiel beïnvloed.

Hoewel de applicatie eruitziet als een schaakspel, is het echte doel niet schaakverbetering, maar het aantonen hoe micro-interacties kunnen worden omgezet in gedragsprofielen en invloed — een concreet voorbeeld van een Weapon of Math Destruction (WMD).

# Projectdoel (WMD-context)

Dit project werd ontwikkeld binnen het vak Development V als individuele opdracht.

Het demonstreert hoe:

- gebruikersdata op individueel niveau kan worden verzameld

- gedrag kan worden gereduceerd tot statistische signalen

- deze signalen worden omgezet in abstracte profielen

- die profielen worden gebruikt om beslissingen te nemen

- en hoe die beslissingen de gebruikerservaring beïnvloeden

De gebruiker ziet het effect, niet de volledige logica erachter.

# Concept: “Mirror, not coach”

ChessMirror is geen schaakengine en geen coach.

Het systeem:

- geeft geen beste zetten

- verandert geen spelregels

- forceert geen gedrag

In plaats daarvan fungeert het als een gedragsspiegel:
het observeert hoe spelers beslissingen nemen en stuurt dit gedrag subtiel via UX-interventies.

# Architectuuroverzicht

Het systeem bestaat uit vier duidelijk gescheiden onderdelen, zoals vereist in de opdracht:

- User-facing applicatie (frontend)

Interactieve schaakinterface waarin gedrag wordt gelogd en beïnvloed.

- Backend & databank

Express API + PostgreSQL voor validatie, opslag en aggregatie van data.

- Admin dashboard

Interface om gebruikersdata te bekijken, analyseren en interventies toe te passen.

- Written report

Analyse van uitkomsten, tekortkomingen en ethische implicaties.

Alles draait volledig lokaal binnen één Docker Compose-omgeving.

# Player applicatie (User-facing)
- Functionaliteit

Automatische anonieme UID (geen login, geen accounts)

Tracking van:

- zet-denktijd

- hover-events

- clicks (links/rechts)

- focus & blur

- navigatie

- hintgebruik

- Spel tegen een adaptieve bot

- Subtiele beïnvloeding

Afhankelijk van het gedragsprofiel:

- random confirm move prompt (“Are you sure?”)

- tekstuele nudges (“Take a second before committing”)

- adaptief botgedrag

- profielafhankelijke hints

# Admin dashboard

De admin interface fungeert als het controlecentrum van de WMD.

De admin kan:

- alle actieve UIDs bekijken

per gebruiker:

- aantal zetten

- gemiddelde denktijd

- blunderpercentage

- hover-intensiteit

- gedragstrends visualiseren (bv. denktijd over tijd)

- interventies aan/uit zetten per UID

- beslissingen nemen die direct invloed hebben op de player UI

De gebruiker heeft geen inzicht in deze beslissingslogica.

# Data & gedragsprofilering
Verzamelde data (per UID)

- SAN & UCI zetten

- denktijd per zet

- hover-aantallen en bursts

- klik- en navigatie-events

- hintgebruik

- zetkwaliteit (bv. blunder)

- botinteracties

- beperkte device metadata (opgeschoond)

- Profilering

Ruwe data wordt geaggregeerd tot signalen zoals:

- gemiddelde denktijd

- hovers per zet

- blunderpercentage

- consistentie

Deze signalen worden vertaald naar dynamische gedragssegmenten, zoals:

- Impulsive

- Hesitant

- Reflective

- Explorer

- Balanced

- Warming up

# Privacy & scope

Geen accounts

Geen namen of e-mails

Geen externe tracking

Geen externe API’s

Alles lokaal

UID = enige identifier

Het project is bewust privacy-minimaal, om de focus te houden op gedragsmechanismen.

# Technische stack
Frontend

React

Vite

Vanilla CSS

Chart.js

react-chessboard

chess.js

Backend

Node.js

Express

Prisma ORM

Database

PostgreSQL

Infrastructure

Docker

Docker Compose

# Installatie & opstarten
Vereisten

- Docker

- Docker Compose

# Stappen
git clone https://github.com/EHB-MCT/wdm-KylianAlgoet.git
cd chessmirror-wmd

cp .env.example .env
docker compose up --build

URLs

Frontend: http://localhost:5173

Backend API: http://localhost:3001

Admin dashboard: via frontend (admin password vereist mag je zelf kiezen)

# Rapport & bronnen
Het volledige geschreven **Weapon of Math Destruction-rapport**
is beschikbaar als PDF:

`./ChessMirror_WMD_Report.pdf`


# Disclaimer

ChessMirror WMD is een educatief onderzoeksprototype.
Het illustreert hoe datagedreven systemen problematisch kunnen worden wanneer transparantie en context ontbreken.

# Auteur

Kylian Algoet
Erasmus Hogeschool Brussel
Development V
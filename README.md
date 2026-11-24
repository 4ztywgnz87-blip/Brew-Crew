# ☕ Brew Crew

Een webapp voor Dauwe, Reinoud en Walter om de koffies van [Cross Roast](https://www.crossroast.be/productcategorie/koffiebonen/) bij te houden, te scoren en te ontdekken wat jullie lekker vinden.

## Wat kan de app (versie 1)

| Scherm | Wat |
|---|---|
| **Coffees** | Alle koffies met ieders score. Bovenaan staat hoeveel koffies nog een score nodig hebben; op een fiche brengt **Next to score** je meteen naar de volgende. Zoeken, filteren (Reorder/Skip, single origin/blend, continent) en sorteren. Swipe naar links om te verwijderen. |
| **Taste** | Smaakprofiel van de crew of per persoon: samenvatting, top 10, "niet meer bestellen", smaakkaart, proces, aciditeit/body/zoetheid/bitterheid, smaken, herkomst, wie op wie lijkt. |
| **Shop** | Het huidige aanbod van Cross Roast met filters. Tik op een koffie voor de fiche met verwachte score per persoon; tik op het rondje om hem aan te vinken en voeg je selectie toe aan je laatste of een nieuwe bestelling. Ook al geproefde koffies kan je zo opnieuw bestellen. Onder **Our orders** staan jullie bestellingen. |
| **Settings** | Crew, demodata, uitleg over de schattingen, **back-up bewaren en terugzetten**, gegevens wissen. |

Alles werkt **zonder AI en volledig gratis**: de smaakanalyse gebruikt een ingebouwde woordenlijst (bv. "limoen" → citrus → meer aciditeit) en eenvoudige statistiek.

> **Let op:** in versie 1 worden de gegevens op het toestel zelf bewaard. Gebruik de app dus op één gsm (die van Dauwe) en bewaar af en toe een back-up via Settings → **Save backup**. Synchroniseren tussen toestellen komt in versie 2.

## Online zetten via Cloudflare

De repository bevat een `wrangler.jsonc`. Daarin staat alles wat Cloudflare moet weten, dus je hoeft **niets in te stellen**:

1. [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages** → **Create** → **Import a repository** → kies **Brew-Crew** → **Deploy**.
2. Na ongeveer een minuut krijg je een link zoals `https://brew-crew.<jouw-naam>.workers.dev`.

Elke nieuwe versie op GitHub zet Cloudflare daarna automatisch online.

*Heb je toch een **Pages**-project gemaakt (link eindigt op `.pages.dev`)?* Ga dan naar het project → **Settings** → **Build** → **Build configuration** → **Edit**, zet **Build output directory** op `public` en kies daarna bij **Deployments** → **Retry deployment**.

### Op je iPhone zetten als app
Open de link in **Safari** → deelknop → **Zet op beginscherm**. De app opent dan schermvullend, zonder adresbalk, en start ook zonder internet (alleen het ophalen van nieuwe koffies heeft internet nodig).

### Uitproberen
Ga naar ⚙️ (rechtsboven op Coffees) → **Load demo data**: 14 echte Cross Roast-koffies met verzonnen scores. Met **Remove demo data** verwijder je ze weer; jullie eigen koffies blijven staan.

## Hoe het technisch werkt (voor later)

- `public/`: de app zelf (HTML, CSS en JavaScript, geen build-stap)
- `src/worker.js` + `functions/api/`: kleine Cloudflare-functies die de productgegevens van crossroast.be ophalen (de browser mag dat niet rechtstreeks). Ze praten enkel met crossroast.be.
- Lukt de eigen functie niet (bv. lokaal geopend), dan probeert de app automatisch gratis publieke tussendiensten. Lukt ook dat niet, dan kan je een koffie manueel invullen.
- `tests/`: automatische tests (`npm test`); `tools/dev-server.mjs` start een lokale versie (`npm run dev`).

## Ideeën voor versie 2
- Synchroniseren tussen gsm's via Cloudflare D1 (gratis)
- Eigen smaakkenmerken scoren (aciditeit, body …) naast de totaalscore

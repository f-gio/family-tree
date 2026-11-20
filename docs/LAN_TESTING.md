# Tests depuis le réseau local (LAN)

Ce document décrit le support LAN de La Nostra Storia : comment ouvrir
l'application depuis un autre appareil du réseau, ce qui est versionné, et ce
qui reste strictement local.

## Principe

La sélection de l'environnement est déterminée par l'origine de la page
(`js/firebase-environment.js`) :

| Origine de la page | Environnement | Projet Firebase | Émulateurs |
| --- | --- | --- | --- |
| `https://lanostrastoria.web.app`, `https://family-tree-c2fe2.web.app`, `https://f-gio.github.io/family-tree` | Production | `family-tree-c2fe2` | — |
| `https://la-nostra-storia-recette.web.app` | Recette | `la-nostra-storia-recette` | — |
| `http(s)://localhost`, `http(s)://127.0.0.1` | local | `family-tree-emulator-test` | hôte de `localEmulatorHost` (boucle locale par défaut) |
| `http(s)://<IP privée RFC1918>` | local | `family-tree-emulator-test` | **l'adresse IP de la page elle-même** |
| toute autre origine | refusée | aucune | — |

Conséquences :

- **Un appareil du réseau local n'a besoin d'aucune configuration** : en
  ouvrant l'application sur `http://<IP-du-poste>:<port>/`, les émulateurs sont
  visés sur cette même adresse.
- **Aucune adresse personnelle n'est versionnée** : la valeur par défaut de
  `localEmulatorHost` est la boucle locale (`127.0.0.1`).
- **La reconnaissance LAN ne peut jamais rejoindre un environnement publié** :
  une adresse privée donne toujours le projet fictif
  `family-tree-emulator-test`, jamais la Production ni la Recette (testé par
  `tests/firebase-environment.test.mjs`).

## Prérequis pour ouvrir l'application depuis un autre appareil

1. Servir les fichiers statiques du dépôt sur une interface joignable du LAN
   (aucun build n'est nécessaire).
2. Démarrer les émulateurs Firestore et Auth (`8080` / `9099`) **de façon
   joignable depuis l'appareil** : par défaut l'émulateur n'écoute que sur la
   boucle locale, un réglage d'écoute réseau de votre environnement de
   démarrage est donc nécessaire. Le `firebase.json` versionné ne fixe que les
   ports et ne doit pas être modifié pour cela.
3. Ouvrir `http://<IP-du-poste>:<port>/` sur l'appareil.

## Ajuster localement l'hôte d'émulateur (facultatif)

Si votre émulateur n'est accessible que sous une autre adresse (poste distant,
interface dédiée), modifier **une seule ligne** dans
`js/firebase-environment.js` :

```js
const localEmulatorHost = "127.0.0.1"; // ← valeur locale, à ne jamais committer
```

Limites et garde-fous :

- La valeur doit rester en **boucle locale** (`127.0.0.1`, `localhost`, `::1`)
  ou dans une **plage privée RFC1918** (`10/8`, `172.16/12`, `192.168/16`) :
  `tests/firebase-environment.test.mjs` refuse toute autre valeur.
- Cette modification reste **locale** : elle ne doit jamais être commitée. Les
  deux builds la retirent systématiquement de l'artefact publié
  (`scripts/build-recette-environment.mjs`,
  `scripts/production-environment.mjs`), qui échouent explicitement si un
  réglage local subsiste.
- `tests/firebase-environment.test.mjs` lit la constante dans le module : la
  suite reste verte avec une valeur locale ajustée.

## Isolation des tests d'interface

`tests/helpers.mjs` (`blockedServiceFor`) intercepte les appels aux
émulateurs **sur la boucle locale comme sur une IP privée**, uniquement sur
les ports `8080` (Firestore) et `9099` (Auth) : les connexions indésirables
sont donc bloquées avant d'émettre une erreur réseau, sans que les assertions
d'erreur de console soient affaiblies. Le port seul ne suffit jamais (le
serveur statique des tests écoute sur un port éphémère), et un hôte public sur
ces ports n'est pas traité comme un émulateur.

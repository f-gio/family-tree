# Activer l’autocomplétion GeoNames

Family Tree conserve toujours la saisie libre des lieux. GeoNames ajoute uniquement des suggestions mondiales et ne bloque jamais l’enregistrement.

La version GitHub Pages utilise le relais HTTPS Cloudflare Worker suivant afin de rester compatible avec le service gratuit GeoNames :

```text
https://family-tree-geonames.giovannoni-f.workers.dev/
```

## Configuration gratuite

1. Créez un compte gratuit sur <https://www.geonames.org/login>.
2. Dans votre compte GeoNames, activez l’accès aux services web gratuits.
3. Ouvrez `index.html` et recherchez :

   ```html
   <meta name="geonames-username" content="">
   ```

4. Placez votre nom d’utilisateur entre les guillemets de `content`, par exemple :

   ```html
   <meta name="geonames-username" content="mon_compte_geonames">
   ```

5. Vérifiez que le Worker `family-tree-geonames` est déployé dans Cloudflare.
6. Publiez `index.html`, `css/` et `js/` ensemble sur GitHub Pages.

Le nom d’utilisateur GeoNames n’est pas un mot de passe ni une clé secrète. Ne renseignez jamais votre mot de passe GeoNames dans le projet.

## Données enregistrées

Le texte reste stocké dans les propriétés historiques (`place`, `deathPlace`, `unionPlace`, `endPlace`). Après sélection explicite d’une suggestion, Family Tree ajoute une propriété structurée compagnon contenant le nom, la région, le pays, le code pays et l’identifiant GeoNames.

Les anciens lieux texte ne sont ni convertis ni réécrits. Si une suggestion n’est pas choisie, la saisie est enregistrée exactement comme elle a été saisie.

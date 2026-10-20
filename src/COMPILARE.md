# Compilare OfficinaONE

La compilazione avviene su GitHub (workflow `compila-release.yml`): basta aggiornare la versione in
`src/package.json`, le note in `src/NOTE-RELEASE.md` e caricare tutto sul ramo `build`.

Produce: OfficinaONE-Setup (con dati), OfficinaONE-Update (solo programma), OfficinaONE-Portable (zip),
OfficinaONE-x.y.z-x86_64.AppImage (con dati), OfficinaONE-Update-x.y.z-x86_64.AppImage, più ducato86.pak e x250.pak.

In locale:

    npm install
    npx electron-builder --win            (o --linux)      -> solo programma
    npx electron-builder --win --config full.json          -> con i dati (cartella ../data con data.pak, ducato86.pak, x250.pak)

Note della release: una riga `obbligatorio: sì` rende l'aggiornamento non rimandabile;
`minima: x.y.z` lo rende obbligatorio solo per le versioni precedenti a x.y.z.

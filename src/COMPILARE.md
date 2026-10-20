# Compilare OfficinaONE

La compilazione avviene su GitHub (workflow `compila-release.yml`): basta aggiornare la versione in
`src/package.json`, le note in `src/NOTE-RELEASE.md` e caricare tutto sul ramo `build`.

Produce: OfficinaONE-Setup (con dati), OfficinaONE-Update (solo programma), OfficinaONE-Portable (zip),
OfficinaONE-x.y.z-x86_64.AppImage (con dati), OfficinaONE-Update-x.y.z-x86_64.AppImage, più ducato86.pak e x250.pak.

In locale:

    npm install
    npx electron-builder --win            (o --linux)      -> solo programma
    npx electron-builder --win --config full.json          -> con i dati (cartella ../data con data.pak, ducato86.pak, x250.pak)

Dalla 3.2.1 ogni aggiornamento è obbligatorio. Lasciare comunque la riga `obbligatorio: sì` nelle note: serve a chi ha ancora la 3.2.0.

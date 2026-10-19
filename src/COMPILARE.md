# Compilare DucatONE

    npm install

Windows (da Windows): installer NSIS e versione portatile, come le release esistenti.

Linux (da Linux):

    npx electron-builder --linux AppImage
        -> DucatONE-Update-x.y.z-x86_64.AppImage (solo programma, per l'aggiornamento automatico)
    npx electron-builder --linux AppImage --config full.json
        -> DucatONE-x.y.z-x86_64.AppImage (programma + dati: data.pak, ducato86.pak, x250.pak in extraResources/data)

Nelle note della release: `sha256: <hash Update .exe>` e `sha256-linux: <hash Update .AppImage>`.
Su Linux i dati vengono copiati al primo avvio in ~/.local/share/DucatONE/data.

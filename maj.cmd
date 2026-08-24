@echo off
title PlexCompare - mise a jour
cd /d "%~dp0"

echo.
echo   PlexCompare - recuperation de la derniere version
echo   ------------------------------------------------
echo.

git pull --ff-only
if errorlevel 1 (
  echo.
  echo   ECHEC.
  echo.
  echo   Le dossier contient probablement des modifications locales
  echo   qui empechent la mise a jour. Ouvre une invite de commandes
  echo   ici et tape "git status" pour voir lesquelles.
  echo.
  pause
  exit /b 1
)

echo.
echo   A jour.
echo.
echo   Derniere etape : dans l'onglet qui vient de s'ouvrir, clique le
echo   bouton de rechargement sur la carte PlexCompare.
echo   Recharge ensuite tes onglets Centris.
echo.

start "" chrome "chrome://extensions"

pause

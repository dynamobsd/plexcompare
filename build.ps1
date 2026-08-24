<#
    PlexCompare — fabrication du .crx signé et du manifeste de mise à jour.

    Utilisation :
        .\build.ps1              # fabrique dist\plexcompare.crx et updates.xml
        .\build.ps1 -Publier     # …puis crée la release GitHub et pousse updates.xml

    La clé de signature vit HORS du dépôt, dans
    C:\Users\Sidney\.plexcompare-signing\plexcompare.pem
    Si vous la perdez, l'ID de l'extension change et il faut réinstaller
    sur chaque poste. Sauvegardez-la.
#>

param(
  [switch]$Publier,
  [string]$Cle = "$env:USERPROFILE\.plexcompare-signing\plexcompare.pem"
)

$ErrorActionPreference = "Stop"
$racine = Split-Path -Parent $MyInvocation.MyCommand.Definition

# ---------- Vérifications ----------

if (-not (Test-Path $Cle)) {
  throw "Clé de signature introuvable : $Cle"
}

$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
if (-not (Test-Path $chrome)) {
  $chrome = "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
}
if (-not (Test-Path $chrome)) {
  throw "chrome.exe introuvable — nécessaire pour signer le .crx"
}

$manifeste = Get-Content "$racine\manifest.json" -Raw -Encoding UTF8 | ConvertFrom-Json
$version = $manifeste.version
$appid = "lfibmbaifoddfiaophkjbhfgeenialjc"
$depot = "dynamobsd/plexcompare"

Write-Host "PlexCompare $version" -ForegroundColor Cyan

# ---------- Copie propre ----------
# On ne livre que ce que l'extension exécute : ni tests, ni documentation,
# ni historique git — tout cela alourdirait le .crx téléchargé à chaque
# mise à jour.

$aLivrer = @(
  "manifest.json", "defaults.js", "finance.js", "content.js",
  "background.js", "popup.html", "popup.js",
  "dashboard.html", "dashboard.js", "panel.css"
)

$dist = "$racine\dist"
$scene = "$dist\plexcompare"
if (Test-Path $dist) { Remove-Item $dist -Recurse -Force }
New-Item -ItemType Directory -Path $scene -Force | Out-Null

foreach ($f in $aLivrer) {
  if (-not (Test-Path "$racine\$f")) { throw "Fichier manquant : $f" }
  Copy-Item "$racine\$f" "$scene\$f"
}
Copy-Item "$racine\icons" "$scene\icons" -Recurse

# ---------- Signature ----------

Write-Host "Signature du paquet…"
# --user-data-dir isole l'appel : sans ça, si Chrome tourne déjà, la
# commande est transmise à l'instance existante qui l'ignore, et aucun
# .crx n'est produit.
$profilTemp = Join-Path $env:TEMP "plexcompare-pack"
if (Test-Path $profilTemp) { Remove-Item $profilTemp -Recurse -Force }
Start-Process -FilePath $chrome -Wait -NoNewWindow -ArgumentList @(
  "--pack-extension=$scene",
  "--pack-extension-key=$Cle",
  "--user-data-dir=$profilTemp",
  "--no-message-box"
)
if (Test-Path $profilTemp) { Remove-Item $profilTemp -Recurse -Force -ErrorAction SilentlyContinue }

$crxBrut = "$dist\plexcompare.crx"
if (-not (Test-Path $crxBrut)) {
  throw "Chrome n'a pas produit de .crx — vérifiez que Chrome n'est pas déjà en train de tourner avec un profil verrouillé."
}

$crx = "$dist\plexcompare-$version.crx"
Move-Item $crxBrut $crx -Force
Remove-Item $scene -Recurse -Force
$taille = [math]::Round((Get-Item $crx).Length / 1KB, 1)
$sha = (Get-FileHash $crx -Algorithm SHA256).Hash.ToLower()

Write-Host "  dist\plexcompare-$version.crx  ($taille Ko)" -ForegroundColor Green

# ---------- Manifeste de mise à jour ----------
# Chrome interroge ce fichier toutes les ~5 h. Dès que la version qu'il
# annonce dépasse la version installée, il télécharge le codebase.

$codebase = "https://github.com/$depot/releases/download/v$version/plexcompare-$version.crx"
$xml = @"
<?xml version='1.0' encoding='UTF-8'?>
<gupdate xmlns='http://www.google.com/update2/response' protocol='2.0'>
  <app appid='$appid'>
    <updatecheck codebase='$codebase' version='$version' />
  </app>
</gupdate>
"@
# Sans BOM : certains analyseurs XML refusent les octets qui précèdent
# la déclaration <?xml ?>.
[System.IO.File]::WriteAllText(
  "$racine\updates.xml", $xml, (New-Object System.Text.UTF8Encoding $false))
Write-Host "  updates.xml → version $version" -ForegroundColor Green

if (-not $Publier) {
  Write-Host ""
  Write-Host "Pour publier : .\build.ps1 -Publier" -ForegroundColor Yellow
  exit 0
}

# ---------- Publication ----------

Write-Host ""
Write-Host "Publication de la release v$version…"

git -C $racine add updates.xml manifest.json
git -C $racine diff --cached --quiet
if ($LASTEXITCODE -ne 0) {
  git -C $racine commit -m "updates.xml -> $version"
}
git -C $racine push

# On liste les tags plutôt que d'interroger une release absente : sous
# PowerShell 5.1, la sortie d'erreur d'un exécutable natif est convertie
# en erreur bloquante, et « release not found » ferait échouer le script.
$tags = @(gh release list --repo $depot --json tagName --jq ".[].tagName")
if ($tags -contains "v$version") {
  Write-Host "  La release v$version existe déjà, remplacement de l'asset."
  gh release upload "v$version" $crx --repo $depot --clobber
} else {
  gh release create "v$version" $crx --repo $depot --title "PlexCompare $version" --notes "SHA-256 : ``$sha``"
}
if ($LASTEXITCODE -ne 0) { throw "La publication GitHub a échoué." }

Write-Host ""
Write-Host "Publié. Chrome récupérera la mise à jour dans les 5 heures," -ForegroundColor Green
Write-Host "ou immédiatement via chrome://extensions → Tout mettre à jour." -ForegroundColor Green
